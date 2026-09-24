import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { commitChange, inspectChange } from "../lib/commit-change.mjs";

function git(root, args) {
  return new Promise((resolvePromise, reject) => execFile("git", ["-C", root, ...args], { encoding: "utf8" }, (error, stdout, stderr) => {
    if (error) reject(new Error(stderr || stdout)); else resolvePromise(stdout.trim());
  }));
}

function defaultPolicy(overrides = {}) {
  return {
    protectedBranches: ["main", "master"],
    protectedPaths: [{ id: "sensitive", path: "sensitive/" }, { id: "archived", path: "archived/" }],
    forbiddenPathSegments: ["tmp"],
    subjectMaxCharacters: 80,
    messageHeadings: { summary: "概要", verification: "検証", reference: "参照" },
    ...overrides,
  };
}

async function writePolicy(root, overrides = {}) {
  await mkdir(resolve(root, ".opencode"), { recursive: true });
  await writeFile(resolve(root, ".opencode/commit-policy.json"), `${JSON.stringify(defaultPolicy(overrides), null, 2)}\n`);
}

async function repository(branch = "work", policyOverrides = {}) {
  const root = await mkdtemp(resolve(tmpdir(), "commit-change-test-"));
  await git(root, ["init", "-q", "-b", branch]);
  await git(root, ["config", "user.email", "test@example.invalid"]);
  await git(root, ["config", "user.name", "Test"]);
  await writePolicy(root, policyOverrides);
  await writeFile(resolve(root, "base.txt"), "base\n");
  await git(root, ["add", "base.txt", ".opencode/commit-policy.json"]);
  await git(root, ["commit", "-qm", "初期化"]);
  return root;
}

async function withRepository(callback, branch, policyOverrides) {
  const root = await repository(branch, policyOverrides);
  try { await callback(root); } finally { await rm(root, { recursive: true, force: true }); }
}

function parameters(root, snapshot, paths = ["base.txt"]) {
  return { root, paths, snapshot, subject: "変更を記録", summaries: ["対象を更新"], verifications: ["node --test（成功）"],
    references: ["AGENTS.md"], flags: {} };
}

test("inspect の snapshot を使うと対象だけをコミットする", async () => withRepository(async (root) => {
  await writeFile(resolve(root, "base.txt"), "updated\n");
  await writeFile(resolve(root, "other.txt"), "remain\n");
  const inspected = await inspectChange({ root, paths: ["base.txt"] });
  assert.deepEqual(inspected.outsidePaths, ["other.txt"]);
  const result = await commitChange(parameters(root, inspected.snapshot));
  assert.equal(result.paths[0], "base.txt");
  assert.equal(await git(root, ["show", "--format=%s", "-s"]), "変更を記録");
  assert.match(await git(root, ["show", "--format=%B", "-s"]), /概要:\n- 対象を更新\n\n検証:\n- node --test（成功）\n\n参照:\n- AGENTS\.md/);
  assert.equal(await git(root, ["status", "--short"]), "?? other.txt");
}));

test("既存の staged 変更がある場合は変更しない", async () => withRepository(async (root) => {
  await writeFile(resolve(root, "base.txt"), "staged\n");
  await git(root, ["add", "base.txt"]);
  await assert.rejects(inspectChange({ root, paths: ["base.txt"] }), /既存の staged/);
  assert.equal(await git(root, ["diff", "--cached", "--name-only"]), "base.txt");
}));

test("古い snapshot はコミットできない", async () => withRepository(async (root) => {
  await writeFile(resolve(root, "base.txt"), "one\n");
  const inspected = await inspectChange({ root, paths: ["base.txt"] });
  await writeFile(resolve(root, "base.txt"), "two\n");
  await assert.rejects(commitChange(parameters(root, inspected.snapshot)), /snapshot が古い/);
  assert.match(await git(root, ["status", "--short"]), /^M base\.txt/);
}));

test("実行権限だけが変化した場合も snapshot の更新を必要とする", async () => withRepository(async (root) => {
  await chmod(resolve(root, "base.txt"), 0o755);
  const inspected = await inspectChange({ root, paths: ["base.txt"] });
  await chmod(resolve(root, "base.txt"), 0o644);
  await assert.rejects(commitChange(parameters(root, inspected.snapshot)), /変更されていない対象パス|snapshot が古い/);
}));

test("シンボリックリンクの参照先文字列を snapshot に含める", async () => withRepository(async (root) => {
  await writeFile(resolve(root, "target-a.txt"), "a\n");
  await writeFile(resolve(root, "target-b.txt"), "b\n");
  await symlink("target-a.txt", resolve(root, "link.txt"));
  const inspected = await inspectChange({ root, paths: ["link.txt"] });
  await rm(resolve(root, "link.txt"));
  await symlink("target-b.txt", resolve(root, "link.txt"));
  await assert.rejects(commitChange(parameters(root, inspected.snapshot, ["link.txt"])), /snapshot が古い/);
}));

test("危険なパスと不正なメッセージを受け付けない", async () => withRepository(async (root) => {
  await assert.rejects(inspectChange({ root, paths: ["../base.txt"] }), /対象パス/);
  await assert.rejects(inspectChange({ root, paths: ["tmp/a.txt"] }), /禁止断片/);
  await writeFile(resolve(root, "base.txt"), "updated\n");
  const inspected = await inspectChange({ root, paths: ["base.txt"] });
  await assert.rejects(commitChange({ ...parameters(root, inspected.snapshot), subject: "\n" }), /件名/);
  await assert.rejects(commitChange({ ...parameters(root, inspected.snapshot), subject: "あ".repeat(81) }), /件名/);
}));

test("保護パスは許可フラグを必要とする", async () => withRepository(async (root) => {
  await mkdir(resolve(root, "sensitive"));
  await mkdir(resolve(root, "archived"));
  await writeFile(resolve(root, "sensitive", "note.txt"), "x\n");
  await writeFile(resolve(root, "archived", "note.txt"), "x\n");
  await assert.rejects(inspectChange({ root, paths: ["sensitive/note.txt"] }), /--allow-protected-path sensitive/);
  await assert.rejects(inspectChange({ root, paths: ["archived/note.txt"] }), /--allow-protected-path archived/);
  assert.ok((await inspectChange({ root, paths: ["sensitive/note.txt"], flags: { allowProtectedPaths: ["sensitive"] } })).snapshot);
  assert.ok((await inspectChange({ root, paths: ["archived/note.txt"], flags: { allowProtectedPaths: ["archived"] } })).snapshot);
}));

test("保護ブランチは許可フラグを必要とする", async () => withRepository(async (root) => {
  await writeFile(resolve(root, "base.txt"), "updated\n");
  await assert.rejects(inspectChange({ root, paths: ["base.txt"] }), /allow-protected-branch/);
  assert.ok((await inspectChange({ root, paths: ["base.txt"], flags: { allowProtectedBranch: true } })).snapshot);
}, "main"));

test("件名上限と見出し語はポリシーに従う", async () => withRepository(async (root) => {
  await writeFile(resolve(root, "base.txt"), "updated\n");
  const inspected = await inspectChange({ root, paths: ["base.txt"] });
  const result = await commitChange(parameters(root, inspected.snapshot));
  const body = await git(root, ["show", "--format=%B", "-s"]);
  assert.match(body, /概要:\n- 対象を更新/);
  assert.match(body, /検証:\n- node --test/);
}, undefined, { subjectMaxCharacters: 16, messageHeadings: { summary: "概要", verification: "検証", reference: "参照" } }));

test("短い件名上限を超える件名は拒否する", async () => withRepository(async (root) => {
  await writeFile(resolve(root, "base.txt"), "updated\n");
  const inspected = await inspectChange({ root, paths: ["base.txt"] });
  await assert.rejects(commitChange(parameters(root, inspected.snapshot)), /件名/);
}, undefined, { subjectMaxCharacters: 4 }));

test("コミットフック失敗後は対象を stage せず作業内容を残す", async () => withRepository(async (root) => {
  await writeFile(resolve(root, "base.txt"), "updated\n");
  const inspected = await inspectChange({ root, paths: ["base.txt"] });
  const hooks = resolve(root, "hooks");
  await mkdir(hooks);
  await writeFile(resolve(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  await git(root, ["config", "core.hooksPath", hooks]);
  await assert.rejects(commitChange(parameters(root, inspected.snapshot)), /git hook/);
  assert.equal(await git(root, ["diff", "--cached", "--name-only"]), "");
  assert.match(await git(root, ["status", "--short"]), /^M base\.txt/);
}));

test("コミットフックが対象外をステージした場合はコミットしない", async () => withRepository(async (root) => {
  await writeFile(resolve(root, "base.txt"), "updated\n");
  await writeFile(resolve(root, "other.txt"), "other\n");
  const inspected = await inspectChange({ root, paths: ["base.txt"] });
  const before = await git(root, ["rev-parse", "HEAD"]);
  const hooks = resolve(root, "hooks");
  await mkdir(hooks);
  await writeFile(resolve(hooks, "pre-commit"), "#!/bin/sh\ngit add other.txt\n", { mode: 0o755 });
  await git(root, ["config", "core.hooksPath", hooks]);
  await assert.rejects(commitChange(parameters(root, inspected.snapshot)), /ステージ対象が変化/);
  assert.equal(await git(root, ["rev-parse", "HEAD"]), before);
  assert.equal(await git(root, ["diff", "--cached", "--name-only"]), "");
}));

test("準備フックが対象内容を変えた場合はコミットしない", async () => withRepository(async (root) => {
  await writeFile(resolve(root, "base.txt"), "updated\n");
  const inspected = await inspectChange({ root, paths: ["base.txt"] });
  const before = await git(root, ["rev-parse", "HEAD"]);
  const hooks = resolve(root, "hooks");
  await mkdir(hooks);
  await writeFile(resolve(hooks, "prepare-commit-msg"), "#!/bin/sh\nprintf 'changed\\n' >> base.txt\n", { mode: 0o755 });
  await git(root, ["config", "core.hooksPath", hooks]);
  await assert.rejects(commitChange(parameters(root, inspected.snapshot)), /対象が変化/);
  assert.equal(await git(root, ["rev-parse", "HEAD"]), before);
}));

test("新規ファイルと削除を対象どおりにコミットする", async () => withRepository(async (root) => {
  await rm(resolve(root, "base.txt"));
  await writeFile(resolve(root, "added.txt"), "added\n");
  const paths = ["added.txt", "base.txt"];
  const inspected = await inspectChange({ root, paths });
  await commitChange(parameters(root, inspected.snapshot, paths));
  assert.equal(await git(root, ["show", "--format=", "--name-only", "HEAD"]), "added.txt\nbase.txt");
  assert.equal(await git(root, ["status", "--short"]), "");
}));

test("コミットメッセージフックが規則を壊した場合はコミットしない", async () => withRepository(async (root) => {
  await writeFile(resolve(root, "base.txt"), "updated\n");
  const inspected = await inspectChange({ root, paths: ["base.txt"] });
  const before = await git(root, ["rev-parse", "HEAD"]);
  const hooks = resolve(root, "hooks");
  await mkdir(hooks);
  await writeFile(resolve(hooks, "commit-msg"), "#!/bin/sh\nprintf '規則外の件名\\n' > \"$1\"\n", { mode: 0o755 });
  await git(root, ["config", "core.hooksPath", hooks]);
  await assert.rejects(commitChange(parameters(root, inspected.snapshot)), /メッセージ/);
  assert.equal(await git(root, ["rev-parse", "HEAD"]), before);
  assert.equal(await git(root, ["diff", "--cached", "--name-only"]), "");
}));

test("別のGit操作がindexをロックしている場合はそのロックを保持して終了する", async () => withRepository(async (root) => {
  await writeFile(resolve(root, "base.txt"), "updated\n");
  const inspected = await inspectChange({ root, paths: ["base.txt"] });
  const indexPath = await git(root, ["rev-parse", "--git-path", "index"]);
  const lockPath = `${resolve(root, indexPath)}.lock`;
  await writeFile(lockPath, "owner");
  await assert.rejects(commitChange(parameters(root, inspected.snapshot)), /別のGit操作/);
  assert.equal(await readFile(lockPath, "utf8"), "owner");
}));

test("post-commitフック失敗は作成済みコミットと警告を返す", async () => withRepository(async (root) => {
  await writeFile(resolve(root, "base.txt"), "updated\n");
  const inspected = await inspectChange({ root, paths: ["base.txt"] });
  const hooks = resolve(root, "hooks");
  await mkdir(hooks);
  await writeFile(resolve(hooks, "post-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  await git(root, ["config", "core.hooksPath", hooks]);
  const result = await commitChange(parameters(root, inspected.snapshot));
  assert.match(result.commit, /^[0-9a-f]{40}$/);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /post-commit hook/);
}));

test("post-commit後に対象へ生じた変更を未コミットのまま警告する", async () => withRepository(async (root) => {
  await writeFile(resolve(root, "base.txt"), "updated\n");
  const inspected = await inspectChange({ root, paths: ["base.txt"] });
  const hooks = resolve(root, "hooks");
  await mkdir(hooks);
  await writeFile(resolve(hooks, "post-commit"), "#!/bin/sh\nprintf 'after hook\\n' > base.txt\n", { mode: 0o755 });
  await git(root, ["config", "core.hooksPath", hooks]);
  const result = await commitChange(parameters(root, inspected.snapshot));
  assert.equal(await git(root, ["show", "HEAD:base.txt"]), "updated");
  assert.equal(await readFile(resolve(root, "base.txt"), "utf8"), "after hook\n");
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /対象パスへ新しい未コミット変更/);
}));
