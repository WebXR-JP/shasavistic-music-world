import { commitChange, inspectChange } from "../lib/commit-change.mjs";

function usage() {
  return "使用法: commit-change.mjs inspect|commit --path <相対ファイル>... [オプション]";
}

function parseArguments(argv) {
  const [operation, ...rest] = argv;
  if (operation !== "inspect" && operation !== "commit") throw new Error(usage());
  const values = { operation, paths: [], allowProtectedPaths: [], summaries: [], verifications: [], references: [], flags: {} };
  const valueOptions = new Map([
    ["--path", "paths"], ["--snapshot", "snapshot"], ["--subject", "subject"],
    ["--summary", "summaries"], ["--verification", "verifications"], ["--reference", "references"],
    ["--allow-protected-path", "allowProtectedPaths"],
  ]);
  const flagOptions = new Map([
    ["--allow-protected-branch", "allowProtectedBranch"],
  ]);
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (flagOptions.has(argument)) {
      values.flags[flagOptions.get(argument)] = true;
      continue;
    }
    const destination = valueOptions.get(argument);
    if (!destination || index + 1 === rest.length || rest[index + 1].startsWith("--")) {
      throw new Error(`${usage()} (${argument})`);
    }
    const value = rest[++index];
    if (Array.isArray(values[destination])) values[destination].push(value);
    else values[destination] = value;
  }
  // 保護パス許可は繰り返し指定できる。一覧としてフラグへ渡す。
  values.flags.allowProtectedPaths = values.allowProtectedPaths;
  delete values.allowProtectedPaths;
  return values;
}

try {
  const arguments_ = parseArguments(process.argv.slice(2));
  const root = process.cwd();
  const result = arguments_.operation === "inspect"
    ? await inspectChange({ root, paths: arguments_.paths, flags: arguments_.flags })
    : await commitChange({ root, paths: arguments_.paths, snapshot: arguments_.snapshot, subject: arguments_.subject,
      summaries: arguments_.summaries, verifications: arguments_.verifications, references: arguments_.references,
      flags: arguments_.flags });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
