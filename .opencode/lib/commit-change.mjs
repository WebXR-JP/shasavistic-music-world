import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { copyFile, mkdtemp, open, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

/** ポリシーファイルの配置。リポジトリルート相対で固定する。 */
export const POLICY_RELATIVE_PATH = ".opencode/commit-policy.json";

/** 一時ディレクトリの接頭辞。固定する。 */
const TEMPORARY_PREFIX = "repo-agent-commit-";

/** Git の失敗を呼び出し元へ一貫したエラーとして返す。 */
async function git(root, args, options = {}) {
  try {
    const result = await execFile("git", ["-C", root, ...args], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      ...options,
    });
    return result.stdout.trimEnd();
  } catch (error) {
    const detail = error.stderr?.trim() || error.stdout?.trim() || error.message;
    throw new Error(`git ${args[0]} の実行に失敗しました: ${detail}`);
  }
}

async function gitResult(root, args, options = {}) {
  try {
    const result = await execFile("git", ["-C", root, ...args], { encoding: "utf8", ...options });
    return { ...result, code: 0 };
  } catch (error) {
    return { stdout: error.stdout ?? "", stderr: error.stderr ?? "", code: error.code ?? 1 };
  }
}

async function runHook(root, name, args, environment) {
  const configuredPath = await git(root, ["rev-parse", "--git-path", `hooks/${name}`]);
  const hookPath = isAbsolute(configuredPath) ? configuredPath : resolve(root, configuredPath);
  if (!existsSync(hookPath) || (lstatSync(hookPath).mode & 0o111) === 0) return;
  await git(root, ["hook", "run", name, "--", ...args], { env: environment });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function splitNullSeparated(value) {
  return value.split("\0").filter(Boolean);
}

function isInside(root, candidate) {
  const difference = relative(root, candidate);
  return difference === "" || (!difference.startsWith(`..${sep}`) && difference !== "..");
}

function validHeading(value) {
  return typeof value === "string" && value !== "" && value === value.trim() && !/[\0\r\n:：]/u.test(value);
}

/** ポリシーを読み、形が正しい場合だけ返す。 */
export function loadPolicy(root) {
  const policyPath = resolve(root, POLICY_RELATIVE_PATH);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(policyPath, "utf8"));
  } catch (error) {
    throw new Error(`${POLICY_RELATIVE_PATH} を読み込めません: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${POLICY_RELATIVE_PATH} の形式が不正です。`);
  }
  const { protectedBranches, protectedPaths, forbiddenPathSegments, subjectMaxCharacters, messageHeadings } = parsed;
  if (!Array.isArray(protectedBranches) || protectedBranches.some((item) => typeof item !== "string" || item === "")) {
    throw new Error(`${POLICY_RELATIVE_PATH} の protectedBranches が不正です。`);
  }
  if (!Array.isArray(protectedPaths) || protectedPaths.some((entry) =>
      !entry || typeof entry !== "object" || typeof entry.id !== "string" || entry.id === "" ||
      typeof entry.path !== "string" || entry.path === "")) {
    throw new Error(`${POLICY_RELATIVE_PATH} の protectedPaths が不正です。`);
  }
  const ids = protectedPaths.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${POLICY_RELATIVE_PATH} の protectedPaths に重複した id があります。`);
  }
  if (!Array.isArray(forbiddenPathSegments) ||
      forbiddenPathSegments.some((item) => typeof item !== "string" || item === "" || item.includes("/"))) {
    throw new Error(`${POLICY_RELATIVE_PATH} の forbiddenPathSegments が不正です。`);
  }
  if (typeof subjectMaxCharacters !== "number" || !Number.isInteger(subjectMaxCharacters) || subjectMaxCharacters <= 0) {
    throw new Error(`${POLICY_RELATIVE_PATH} の subjectMaxCharacters が不正です。`);
  }
  if (!messageHeadings || typeof messageHeadings !== "object" ||
      !validHeading(messageHeadings.summary) || !validHeading(messageHeadings.verification) ||
      !validHeading(messageHeadings.reference)) {
    throw new Error(`${POLICY_RELATIVE_PATH} の messageHeadings が不正です。`);
  }
  return { protectedBranches, protectedPaths, forbiddenPathSegments, subjectMaxCharacters, messageHeadings };
}

/** 許可済み保護パス id を集合として正規化する。 */
function allowedPathIds(flags = {}) {
  const list = flags.allowProtectedPaths;
  if (Array.isArray(list)) return new Set(list);
  if (list instanceof Set) return new Set(list);
  return new Set();
}

/** 保護パスの接尾区切りを除き、前方一致の判定に使う。 */
function normalizedPolicyPath(entryPath) {
  return entryPath.replace(/\/+$/u, "");
}

/** パス表記の揺れや、意図しない領域の指定を受け付けない。 */
export function validatePaths(root, paths, flags = {}) {
  const policy = loadPolicy(root);
  const canonicalRoot = realpathSync(root);
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error("対象パスを少なくとも1件指定してください。");
  }
  const allowed = allowedPathIds(flags);
  const normalized = [];
  const seen = new Set();
  for (const input of paths) {
    if (typeof input !== "string" || input === "" || isAbsolute(input) || input.includes("\\") ||
        input.startsWith("-") || /[\0\r\n]/u.test(input)) {
      throw new Error(`対象パスが不正です: ${String(input)}`);
    }
    const parts = input.split("/");
    if (parts.some((part) => part === "" || part === "." || part === "..")) {
      throw new Error(`対象パスには絶対パス、..、重複区切りを指定できません: ${input}`);
    }
    const forbidden = parts.find((part) => policy.forbiddenPathSegments.includes(part));
    if (forbidden !== undefined) {
      throw new Error(`対象パスには禁止断片 ${policy.forbiddenPathSegments.join("、")} を指定できません: ${input}`);
    }
    const candidate = resolve(canonicalRoot, input);
    if (!isInside(canonicalRoot, candidate)) {
      throw new Error(`リポジトリ外の対象パスは指定できません: ${input}`);
    }
    const path = input;
    if (seen.has(path)) throw new Error(`対象パスが重複しています: ${path}`);
    seen.add(path);
    for (const entry of policy.protectedPaths) {
      const base = normalizedPolicyPath(entry.path);
      if (path === base || path.startsWith(`${base}/`)) {
        if (!allowed.has(entry.id)) {
          throw new Error(`${entry.path} を含めるには --allow-protected-path ${entry.id} が必要です。`);
        }
      }
    }
    if (existsSync(candidate)) {
      const stat = lstatSync(candidate);
      if (stat.isDirectory()) {
        throw new Error(`対象パスはディレクトリではなくファイルを指定してください: ${path}`);
      }
      if (!stat.isFile() && !stat.isSymbolicLink()) {
        throw new Error(`通常ファイルまたはシンボリックリンク以外は指定できません: ${path}`);
      }
    }
    normalized.push(path);
  }
  return normalized.sort();
}

async function assertRepositoryState(root, flags) {
  const policy = loadPolicy(root);
  const canonicalRoot = realpathSync(root);
  const topLevel = realpathSync(await git(root, ["rev-parse", "--show-toplevel"]));
  if (canonicalRoot !== topLevel) throw new Error("作業ツリーのルートから実行してください。");
  const branchResult = await gitResult(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const branch = branchResult.stdout.trim();
  if (!branch) throw new Error("detached HEAD ではコミットできません。");
  if (policy.protectedBranches.includes(branch) && !flags.allowProtectedBranch) {
    throw new Error(`${branch} へのコミットには --allow-protected-branch が必要です。`);
  }
  const gitDir = await git(root, ["rev-parse", "--git-dir"]);
  const absoluteGitDir = resolve(root, gitDir);
  if (existsSync(resolve(absoluteGitDir, "MERGE_HEAD")) || existsSync(resolve(absoluteGitDir, "CHERRY_PICK_HEAD")) ||
      existsSync(resolve(absoluteGitDir, "REVERT_HEAD")) || existsSync(resolve(absoluteGitDir, "rebase-merge")) ||
      existsSync(resolve(absoluteGitDir, "rebase-apply"))) {
    throw new Error("merge、rebase、cherry-pick、revertの途中ではコミットできません。");
  }
  if ((await git(root, ["ls-files", "-u"])).trim() !== "") {
    throw new Error("競合が残っているためコミットできません。");
  }
  if ((await git(root, ["diff", "--cached", "--name-only"])).trim() !== "") {
    throw new Error("既存の staged 変更があるため、変更を加えずに終了します。");
  }
  return branch;
}

async function changedPaths(root) {
  const tracked = splitNullSeparated(await git(root, ["diff", "--name-only", "--no-renames", "-z", "HEAD"]));
  const untracked = splitNullSeparated(await git(root, ["ls-files", "--others", "--exclude-standard", "-z"]));
  return [...new Set([...tracked, ...untracked])].sort();
}

async function pathSnapshot(root, paths) {
  const canonicalRoot = realpathSync(root);
  const head = await git(root, ["rev-parse", "HEAD"]);
  const entries = [];
  for (const path of paths) {
    const absolute = resolve(canonicalRoot, path);
    let stat;
    try {
      stat = lstatSync(absolute);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (stat?.isSymbolicLink()) {
      const resolvedParent = realpathSync(dirname(absolute));
      if (!isInside(canonicalRoot, resolvedParent)) throw new Error(`対象パスの親がリポジトリ外を参照しています: ${path}`);
      entries.push({ path, state: "symlink", mode: "120000", digest: sha256(readlinkSync(absolute)) });
      continue;
    }
    if (stat?.isFile()) {
      const resolved = realpathSync(absolute);
      if (!isInside(canonicalRoot, resolved)) throw new Error(`対象パスがリポジトリ外を参照しています: ${path}`);
      const mode = (stat.mode & 0o111) === 0 ? "100644" : "100755";
      entries.push({ path, state: "file", mode, digest: sha256(readFileSync(absolute)) });
      continue;
    }
    const tracked = await gitResult(root, ["ls-files", "--error-unmatch", "--", path]);
    if (tracked.code !== 0) throw new Error(`対象ファイルが存在せず、削除対象としても追跡されていません: ${path}`);
    entries.push({ path, state: "deleted", mode: "000000", digest: "" });
  }
  const data = JSON.stringify({ head, entries });
  return { head, paths: [...paths], entries, snapshot: sha256(data) };
}

/** inspect 結果。HEAD と対象ファイル内容を結び付けた再照合用の値を含む。 */
export async function inspectChange({ root, paths, flags = {} }) {
  const normalized = validatePaths(root, paths, flags);
  const branch = await assertRepositoryState(root, flags);
  const changes = await changedPaths(root);
  const changeSet = new Set(changes);
  const unchanged = normalized.filter((path) => !changeSet.has(path));
  if (unchanged.length > 0) throw new Error(`変更されていない対象パスがあります: ${unchanged.join(", ")}`);
  const targetSet = new Set(normalized);
  const outsidePaths = changes.filter((path) => !targetSet.has(path));
  return { branch, outsidePaths, ...(await pathSnapshot(root, normalized)) };
}

function validLine(value) {
  return typeof value === "string" && value !== "" && value === value.trim() && !/[\0\r\n]/u.test(value);
}

function validateMessage(subject, summaries, verifications, references, policy) {
  const limit = policy.subjectMaxCharacters;
  if (!validLine(subject) || [...subject].length > limit) {
    throw new Error(`件名は改行なし、${limit}文字以内で指定してください。`);
  }
  if (!Array.isArray(summaries) || summaries.length === 0 || summaries.some((item) => !validLine(item))) {
    throw new Error("--summary を少なくとも1件、改行なしで指定してください。");
  }
  if (!Array.isArray(verifications) || verifications.length === 0 || verifications.some((item) => !validLine(item))) {
    throw new Error("--verification を少なくとも1件、改行なしで指定してください。");
  }
  if (!Array.isArray(references) || references.some((item) => !validLine(item))) {
    throw new Error("--reference は改行なしで指定してください。");
  }
}

function messageText(subject, summaries, verifications, references, policy) {
  const headings = policy.messageHeadings;
  const referenceText = references.length === 0
    ? ""
    : `\n${headings.reference}:\n${references.map((item) => `- ${item}`).join("\n")}\n`;
  return `${subject}\n\n${headings.summary}:\n${summaries.map((item) => `- ${item}`).join("\n")}\n\n${headings.verification}:\n${verifications.map((item) => `- ${item}`).join("\n")}\n${referenceText}`;
}

function validatePreparedMessage(messagePath, policy) {
  const message = readFileSync(messagePath, "utf8");
  const [subject = ""] = message.split("\n", 1);
  const headings = policy.messageHeadings;
  if (!validLine(subject) || [...subject].length > policy.subjectMaxCharacters ||
      !message.includes(`\n${headings.summary}:\n- `) || !message.includes(`\n${headings.verification}:\n- `)) {
    throw new Error("コミットフック適用後のメッセージが件名または検証記録の規則を満たしていません。");
  }
}

/**
 * 対象だけを一時インデックスへステージし、確認済みのツリーをコミットする。
 *
 * ADR: 通常のインデックスを使うと、コミットフックや並行作業が対象外の変更を混入させる余地がある。
 * 一時インデックス上でフック実行後の集合を再検査し、確認したツリーだけでコミットを作る。
 * このため標準のコミット処理が呼ぶフックは、この関数が同じ順序で明示的に実行する。
 */
export async function commitChange({ root, paths, snapshot, subject, summaries, verifications, references = [], flags = {} }) {
  const policy = loadPolicy(root);
  const normalized = validatePaths(root, paths, flags);
  validateMessage(subject, summaries, verifications, references, policy);
  const current = await inspectChange({ root, paths: normalized, flags });
  if (snapshot !== current.snapshot) throw new Error("snapshot が古いため、inspect からやり直してください。");

  const operationDirectory = await mkdtemp(resolve(tmpdir(), TEMPORARY_PREFIX));
  const temporaryIndexPath = resolve(operationDirectory, "index");
  const messagePath = resolve(operationDirectory, "message.txt");
  const configuredIndexPath = await git(root, ["rev-parse", "--git-path", "index"]);
  const indexPath = isAbsolute(configuredIndexPath) ? configuredIndexPath : resolve(root, configuredIndexPath);
  const indexLockPath = `${indexPath}.lock`;
  const temporaryEnvironment = { ...process.env, GIT_EDITOR: ":", GIT_INDEX_FILE: temporaryIndexPath };
  let ownsIndexLock = false;
  let updatedCommit = null;
  try {
    let lock;
    try {
      lock = await open(indexLockPath, "wx");
      ownsIndexLock = true;
    } catch (error) {
      if (error.code === "EEXIST") throw new Error("別のGit操作がindexを更新中のため、変更を加えずに終了します。");
      throw error;
    } finally {
      await lock?.close();
    }
    const lockedBranch = await assertRepositoryState(root, flags);
    if (lockedBranch !== current.branch) throw new Error("inspect後に現在のブランチが変化しました。");

    await copyFile(indexPath, temporaryIndexPath);
    await writeFile(messagePath, messageText(subject, summaries, verifications, references, policy), "utf8");
    await git(root, ["add", "--all", "--", ...normalized], { env: temporaryEnvironment });
    await runHook(root, "pre-commit", [], temporaryEnvironment);
    await runHook(root, "prepare-commit-msg", [messagePath, "message"], temporaryEnvironment);
    await runHook(root, "commit-msg", [messagePath], temporaryEnvironment);
    validatePreparedMessage(messagePath, policy);

    const afterHooks = await pathSnapshot(root, normalized);
    if (snapshot !== afterHooks.snapshot) throw new Error("コミットフックの実行中に対象が変化しました。");
    const staged = splitNullSeparated(await git(root,
      ["diff", "--cached", "--name-only", "--no-renames", "-z"], { env: temporaryEnvironment })).sort();
    if (JSON.stringify(staged) !== JSON.stringify(normalized)) {
      throw new Error("コミットフックの実行後にステージ対象が変化しました。");
    }
    const worktreeMatch = await gitResult(root, ["diff", "--quiet", "--", ...normalized], { env: temporaryEnvironment });
    if (worktreeMatch.code !== 0) throw new Error("一時インデックスと作業ツリーの対象内容が一致しません。");
    const check = await gitResult(root, ["diff", "--cached", "--check"], { env: temporaryEnvironment });
    if (check.code !== 0) throw new Error(`ステージ済み差分の検査に失敗しました: ${check.stderr || check.stdout}`);

    const finalBranch = await assertRepositoryState(root, flags);
    if (finalBranch !== current.branch) throw new Error("コミットフックの実行中に現在のブランチが変化しました。");
    const tree = await git(root, ["write-tree"], { env: temporaryEnvironment });
    const commitArguments = ["commit-tree", tree, "-p", current.head, "-F", messagePath];
    const signing = await gitResult(root, ["config", "--bool", "commit.gpgSign"]);
    if (signing.stdout.trim() === "true") commitArguments.splice(2, 0, "-S");
    const commit = await git(root, commitArguments);
    const committed = splitNullSeparated(await git(root,
      ["diff-tree", "--no-commit-id", "--name-only", "--no-renames", "-r", "--root", "-z", commit])).sort();
    if (JSON.stringify(committed) !== JSON.stringify(normalized)) {
      throw new Error("作成したコミットの対象集合が一致しないため、HEADを更新せずに終了します。");
    }
    await git(root, ["update-ref", "-m", `commit: ${subject}`, "HEAD", commit, current.head]);
    updatedCommit = commit;
    await copyFile(temporaryIndexPath, indexLockPath);
    await rename(indexLockPath, indexPath);
    ownsIndexLock = false;

    const warnings = [];
    const postCommit = await gitResult(root, ["rev-parse", "--git-path", "hooks/post-commit"]);
    const postCommitPath = postCommit.stdout.trim();
    const absolutePostCommitPath = isAbsolute(postCommitPath) ? postCommitPath : resolve(root, postCommitPath);
    if (existsSync(absolutePostCommitPath) && (lstatSync(absolutePostCommitPath).mode & 0o111) !== 0) {
      const hookResult = await gitResult(root, ["hook", "run", "post-commit"]);
      if (hookResult.code !== 0) warnings.push(`post-commit hookに失敗しました: ${hookResult.stderr || hookResult.stdout}`);
    }
    // HEAD 更新後の変更（並行編集や post-commit による変更）は次の作業として残し、警告する。
    const remainingChanges = new Set(await changedPaths(root));
    const changedTargets = normalized.filter((path) => remainingChanges.has(path));
    if (changedTargets.length > 0) {
      warnings.push(`コミット作成後に対象パスへ新しい未コミット変更があります: ${changedTargets.join(", ")}`);
    }
    return { commit, paths: normalized, warnings };
  } catch (error) {
    if (updatedCommit !== null) {
      throw new Error(`コミット${updatedCommit}は作成済みですが、後処理に失敗しました: ${error.message}`);
    }
    throw error;
  } finally {
    if (ownsIndexLock) await rm(indexLockPath, { force: true });
    await rm(operationDirectory, { recursive: true, force: true });
  }
}
