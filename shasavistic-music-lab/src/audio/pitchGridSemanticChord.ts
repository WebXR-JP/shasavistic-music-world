/**
 * 格子入力から意味論型への純粋変換。
 *
 * 検査済みの格子入力（オン点の座標と各点の配置済み整数 `k`、選択次元、
 * 機能根の座標、ベース指定の有無と位置）を受け、`SemanticChord` を作る。
 * 座標 `(x, y)` は横指数（素数3）に `x`、縦指数（選択主要次元の素数）に
 * `y`、素数2は配置指数 `k` を写す。解音は格子中央に固定する。
 *
 * 選び直し・根の推定・解音の選択・ベースの自動導出・音域最適化はしない。
 * 由来（`functionalRootSource`）は `SemanticChord` に入れない。
 * 空集合は和音を作らない。周波数を使わず、`log2` 逆算をしない。
 * 外部状態・時刻を読まず、入力オブジェクトを変更しない。
 *
 * @packageDocumentation
 */

import {
  PITCH_GRID_HORIZONTAL_PRIME,
  type PitchGridDimension,
  isInPitchGrid,
  isPitchGridDimension,
  pitchGridKey,
  verticalPrimeFor,
} from './pitchGrid';
import type { SemanticChord, SemanticPitchOffset } from './semanticChord';

/** 配置済みの格子入力の1点。座標と配置指数の組。 */
export interface PitchGridSemanticChordPoint {
  /** 横座標。`-2…2` の整数。 */
  readonly x: number;
  /** 縦座標。`-1…1` の整数。 */
  readonly y: number;
  /** 配置済みの素数2の指数の整数。配置結果の値をそのまま受け取る。 */
  readonly k: number;
}

/** 機能根・ベースの位置を示す座標。 */
export interface PitchGridSemanticChordPosition {
  /** 横座標。`-2…2` の整数。 */
  readonly x: number;
  /** 縦座標。`-1…1` の整数。 */
  readonly y: number;
}

/** ベースの位置と配置指数。指数の出所が確定するまでは `k` 必須の仮扱いとする。 */
export interface PitchGridSemanticChordBass extends PitchGridSemanticChordPosition {
  /** ベースの素数2の指数の整数。欠落は拒む。 */
  readonly k: number;
}

/**
 * 格子入力から意味論型への純粋変換の入力。
 *
 * すべて読み取り専用とし、変換は変更しない。
 */
export interface PitchGridSemanticChordInput {
  /** 選択次元。縦軸の素数を定める。 */
  readonly dimension: PitchGridDimension;
  /** オン点の座標と各点の配置済み指数。空にしない。 */
  readonly points: readonly PitchGridSemanticChordPoint[];
  /** 機能根の座標。オン点のいずれかであること。 */
  readonly functionalRoot: PitchGridSemanticChordPosition;
  /** ベースの位置と配置指数。省略時はベースなしで返す。 */
  readonly bass?: PitchGridSemanticChordBass;
}

function failPitchGridSemanticChord(message: string): never {
  throw new RangeError(message);
}

// 素数指数の写像から零でない指数だけを残し、`{ primeExponents: ... }` で包む。
// 零の指数は意味論型の検査で落とされることはないが、合成の既約形に揃える。
function wrapOffset(exponents: Readonly<Record<number, number>>): SemanticPitchOffset {
  const primeExponents: Record<number, number> = {};
  for (const [primeText, exponent] of Object.entries(exponents)) {
    if (exponent !== 0) {
      primeExponents[Number(primeText)] = exponent;
    }
  }
  return { primeExponents };
}

// 格子点の配置指数を素数指数の写像へ読み替える。
// `E(q) = { 2: kq, 3: xq, p: yq }`。対応表は既存の定数と関数だけを使い、新設しない。
function exponentsOf(
  point: PitchGridSemanticChordPoint,
  verticalPrime: number,
): Record<number, number> {
  return {
    2: point.k,
    [PITCH_GRID_HORIZONTAL_PRIME]: point.x,
    [verticalPrime]: point.y,
  };
}

// 二つの写像の差を求める。整数指数の引き算だけを行い、周波数や比率を経由しない。
function subtractExponents(
  minuend: Readonly<Record<number, number>>,
  subtrahend: Readonly<Record<number, number>>,
): Record<number, number> {
  const difference: Record<number, number> = {};
  const keys = new Set<string>([...Object.keys(minuend), ...Object.keys(subtrahend)]);
  for (const keyText of keys) {
    const value = (minuend[Number(keyText)] ?? 0) - (subtrahend[Number(keyText)] ?? 0);
    if (!Number.isSafeInteger(value)) {
      failPitchGridSemanticChord(`指数の差が整数精度を逸脱する: 素数 ${keyText}`);
    }
    if (value !== 0) {
      difference[Number(keyText)] = value;
    }
  }
  return difference;
}

// 配置済みの1点を確かめ、正規化した写しを返す。入力は変更しない。
function checkedPoint(point: PitchGridSemanticChordPoint, label: string): PitchGridSemanticChordPoint {
  if (point === null || typeof point !== 'object' || Array.isArray(point)) {
    failPitchGridSemanticChord(`${label}は座標と配置指数を持つこと: ${String(point)}`);
  }
  if (!isInPitchGrid(point)) {
    failPitchGridSemanticChord(`${label}は格子内の座標であること: ${String(point)}`);
  }
  if (typeof point.k !== 'number' || !Number.isSafeInteger(point.k)) {
    failPitchGridSemanticChord(`${label}の配置指数 k は安全な整数であること: ${String(point.k)}`);
  }
  return { x: point.x, y: point.y, k: point.k };
}

/**
 * 格子入力から意味論型を組み立てる。
 *
 * 合成は `E(q) = { 2: kq, 3: xq, 選択主要次元の素数: yq }`、解音
 * `E(s) = { 2: 0, 3: 0, p: 0 }` とし、`functionalRootOffset = E(r) − E(s)`、
 * `toneOffsets = E(q) − E(r)`（根自身は除外）、ベース指定時は
 * `bass = E(b) − E(r)` とする。
 *
 * @param input - 検査済みの格子入力。変更しない。
 * @returns 意味論の和音とベース（ベース省略時は `bass` なし）。
 * @throws `RangeError` — 選択次元でない、空集合、配置の欠落・重複・
 * 格子外の点・非整数の `k`、機能根が集合に含まれない、ベースの `k` 欠落、
 * 指数精度の逸脱がある場合。
 * @remarks
 * デフォルト引数・既定値・外部状態・時刻を読まない。
 * 入力が不正な場合、出力は作らない。
 */
export function toPitchGridSemanticChord(input: PitchGridSemanticChordInput): SemanticChord {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    failPitchGridSemanticChord(`格子入力は構造であること: ${String(input)}`);
  }
  if (!isPitchGridDimension(input.dimension)) {
    failPitchGridSemanticChord(
      `選択次元は3・4・5のいずれかであること: ${String(input.dimension)}`,
    );
  }
  if (!Array.isArray(input.points) || input.points.length === 0) {
    failPitchGridSemanticChord('オン点が空の場合は和音を作らない');
  }
  // ADR: 縦軸の素数は既存対応表から取り、複製しない。
  const verticalPrime = verticalPrimeFor(input.dimension);
  const points = input.points.map((point, index) =>
    checkedPoint(point, `オン点${String(index)}`),
  );
  const seen = new Set<string>();
  for (const point of points) {
    const key = pitchGridKey(point);
    if (seen.has(key)) {
      failPitchGridSemanticChord(`重複したオン点である: ${key}`);
    }
    seen.add(key);
  }
  if (
    input.functionalRoot === null ||
    typeof input.functionalRoot !== 'object' ||
    Array.isArray(input.functionalRoot)
  ) {
    failPitchGridSemanticChord(`機能根は座標であること: ${String(input.functionalRoot)}`);
  }
  const rootKey = pitchGridKey(input.functionalRoot);
  const rootPoint = points.find((point) => pitchGridKey(point) === rootKey);
  if (!isInPitchGrid(input.functionalRoot) || rootPoint === undefined) {
    failPitchGridSemanticChord(`機能根はオン点のいずれかであること: ${rootKey}`);
  }
  // 解音 `E(s)` は零写像のため、`functionalRootOffset = E(r) − E(s)` は
  // 根の写像そのものになる。差分の形を保ち、周波数を経由しない。
  const rootExponents = exponentsOf(rootPoint, verticalPrime);
  const functionalRootOffset = wrapOffset(
    subtractExponents(rootExponents, { 2: 0, [PITCH_GRID_HORIZONTAL_PRIME]: 0, [verticalPrime]: 0 }),
  );
  const toneOffsets = points
    .filter((point) => pitchGridKey(point) !== rootKey)
    .map((point) => wrapOffset(subtractExponents(exponentsOf(point, verticalPrime), rootExponents)));
  if (input.bass === undefined) {
    return {
      primaryDimension: input.dimension,
      functionalRootOffset,
      toneOffsets,
    };
  }
  if (input.bass === null || typeof input.bass !== 'object' || Array.isArray(input.bass)) {
    failPitchGridSemanticChord(`ベースは座標と配置指数を持つこと: ${String(input.bass)}`);
  }
  if (!isInPitchGrid(input.bass)) {
    failPitchGridSemanticChord(`ベースは格子内の座標であること: ${String(input.bass)}`);
  }
  // ADR: ベースの素数2の指数の出所は配置方針の確定待ちであり、確定までは
  // `k` 欠落を拒む仮扱いとする。自動導出はしない。
  if (typeof input.bass.k !== 'number' || !Number.isSafeInteger(input.bass.k)) {
    failPitchGridSemanticChord(`ベースの配置指数 k は安全な整数であること: ${String(input.bass.k)}`);
  }
  const bassExponents = exponentsOf(
    { x: input.bass.x, y: input.bass.y, k: input.bass.k },
    verticalPrime,
  );
  return {
    primaryDimension: input.dimension,
    functionalRootOffset,
    toneOffsets,
    bass: wrapOffset(subtractExponents(bassExponents, rootExponents)),
  };
}
