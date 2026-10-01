/** API 参照の生成物検査。生成経路の成功後に成果物を検証する。 */
// 判定に使う具体的な経路と期待記号はこの検査を正本とする。
// 対象範囲は内部実装を含む（範囲B）のため、包装の公開口に加えて
// 内部区画の代表口も存在検査の対象にする。
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const jsonPath = join(rootDir, 'tmp', 'typedoc.json');
const htmlDir = join(rootDir, 'docs', 'api');

// 存在を保証する代表口。種別は TypeDoc の ReflectionKind の数値。
// World は const のため Variable (32)、WorldProps は Interface (256)。
const kindName = new Map([[32, 'Variable'], [64, 'Function'], [256, 'Interface']]);
const expectedSymbols = [
  [32, 'World'],
  [256, 'WorldProps'],
  [64, 'pitchGridKey'],
  [64, 'createHarmonicToneSession'],
];

// 代表口頁。TypeDoc の標準 HTML 配置での相対経路。
const expectedPages = [
  'index.html',
  'modules/World.html',
  'interfaces/World.WorldProps.html',
  'functions/audio_pitchGrid.pitchGridKey.html',
];

// HTML が参照する同梱資産。外部取得ではなく生成物内のものを確かめる。
const expectedAssets = ['assets/style.css', 'assets/main.js'];

const failures = [];

function check(label, ok) {
  console.log(`${ok ? 'ok' : 'NG'}: ${label}`);
  if (!ok) failures.push(label);
}

function collectSymbols(node, out) {
  if (typeof node.kind === 'number' && node.name) out.push(`${node.kind}:${node.name}`);
  for (const child of node.children ?? []) collectSymbols(child, out);
}

let doc = null;
try {
  doc = JSON.parse(readFileSync(jsonPath, 'utf8'));
  check(`構造化出力が解析できる (${jsonPath})`, true);
} catch {
  check(`構造化出力が解析できる (${jsonPath})`, false);
}

if (doc) {
  const found = [];
  collectSymbols(doc, found);
  const symbols = new Set(found);
  for (const [kind, name] of expectedSymbols) {
    check(`対象口が存在する (${kindName.get(kind)}:${name})`, symbols.has(`${kind}:${name}`));
  }

  // 除外境界。検査体・採取検査・開発用入口の混入を防ぐ。
  const files = Object.values(doc.files?.entries ?? {});
  check(`構造化出力に対象外の源泉が含まれない (全${files.length}件)`, files.length > 0);
  const mixed = files.filter((f) => f.endsWith('.test.ts') || f === 'src/dev.tsx');
  check('検査体・採取検査・開発用入口が混入しない', mixed.length === 0);
  if (mixed.length > 0) console.log(`混入: ${mixed.join(', ')}`);
  const modules = (doc.children ?? []).map((c) => c.name);
  check(
    '区画一覧に対象外の区画が含まれない',
    modules.every((m) => !/test|dev|capture/i.test(m)),
  );
}

for (const page of expectedPages) {
  check(`HTML が生成される (${page})`, existsSync(join(htmlDir, page)));
}
for (const asset of expectedAssets) {
  check(`参照資産が生成される (${asset})`, existsSync(join(htmlDir, asset)));
}
try {
  const assets = readdirSync(join(htmlDir, 'assets'));
  check(`参照資産の置場が空でない (全${assets.length}件)`, assets.length > 0);
} catch {
  check('参照資産の置場が空でない', false);
}

if (failures.length > 0) {
  console.error(`\n${failures.length}件の検査が失敗した`);
  process.exit(1);
}
console.log('\n生成物の検査に合格した');
