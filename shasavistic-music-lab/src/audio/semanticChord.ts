/**
 * 静的な和音とベースの意味論型と解音基準の純粋変換。
 *
 * 音高は解音を基準に定める。機能根は解音からの相対移動、他の構成音と
 * ベースは機能根からの相対移動で表す。相対移動は素数から整数移動量への
 * 写像とし、合成は素数指数の加算で行う。周波数や有理比を経由して
 * 再構成しない。有理比化・約分・周波数計算・束ね・低音順は既存
 * （`harmonicRatio`）に委ねる。発音口への接続、波形、時間、演奏進行は
 * 扱わず、発音側（`harmonicChord`）から分離する。
 *
 * @packageDocumentation
 */

import {
  type HarmonicPrimeDimensions,
  type ResolvedHarmonicVoice,
  resolveHarmonicVoices,
} from './harmonicRatio';
import {
  PITCH_GRID_HORIZONTAL_PRIME,
  type PitchGridDimension,
  isPitchGridDimension,
  verticalPrimeFor,
} from './pitchGrid';

/**
 * 相対音高の移動量。素数から整数移動量への写像。
 *
 * 鍵は次元番号ではなく素数とする。許す素数は素数 `2`・横軸の素数・
 * 選択した主要次元の縦軸の素数だけであり、変換入口で確かめる。
 */
export type SemanticPitchOffset = HarmonicPrimeDimensions;

/** 和音が使う主要次元。選択次元そのものを保持する。 */
export type SemanticPrimaryDimension = PitchGridDimension;

/**
 * 静的な和音とベースの意味論。すべて読み取り専用とする。
 *
 * 実行時の深い凍結は契約に含めない。
 */
export interface SemanticChord {
  /** 使う主要次元。使用指数だけでは指数ゼロの主要次元や未選択の文脈を判別できないため必須とする。 */
  readonly primaryDimension: SemanticPrimaryDimension;
  /** 解音から機能根への移動。 */
  readonly functionalRootOffset: SemanticPitchOffset;
  /**
   * 機能根から他の構成音への移動。機能根自身は暗黙に含め、ここへ再記載しない。
   * 単音の場合は空にする。
   */
  readonly toneOffsets: readonly SemanticPitchOffset[];
  /** 機能根からベースへの移動。単一で省略可。役割の区別は別項目で表す。 */
  readonly bass?: SemanticPitchOffset;
}

/**
 * 解音基準で解決した和音とベース。
 */
export interface ResolvedSemanticChord {
  /** 機能根の声。解音基準の比率と周波数を持つ。 */
  readonly functionalRoot: ResolvedHarmonicVoice;
  /** 他の構成音の声。同一比率は束ね、低音順に並ぶ。単音の場合は空になる。 */
  readonly chordVoices: readonly ResolvedHarmonicVoice[];
  /** ベースの声。構成音と同音でも別の出力に残す。省略時は `undefined`。 */
  readonly bass?: ResolvedHarmonicVoice;
  /**
   * 和声が成立しているか。機能根と他の構成音について、素数 `2` の指数を
   * 除いた異なる位置が3種以上ある場合だけ `true`。ベースは種数に加算しない。
   */
  readonly harmonyEstablished: boolean;
}

function failSemanticChord(message: string): never {
  throw new RangeError(message);
}

// 移動量の写像を検査し、正規化した写しを返す。
// 許す鍵は素数 `2`・横軸の素数・選択した主要次元の縦軸の素数だけとする。
// 合成後の相殺で禁止次元を見逃さないため、各入力の鍵を個別に確かめる。
// 入力は変更せず、新しい写像を返す。
function checkedPitchOffset(
  offset: SemanticPitchOffset,
  allowedPrimes: ReadonlySet<number>,
  label: string,
): Record<number, number> {
  if (offset === null || typeof offset !== 'object' || Array.isArray(offset)) {
    failSemanticChord(`${label}は素数から指数への写像であること: ${String(offset)}`);
  }
  const primeExponents = (offset as SemanticPitchOffset).primeExponents;
  if (primeExponents === null || typeof primeExponents !== 'object' || Array.isArray(primeExponents)) {
    failSemanticChord(`${label}は素数から指数への写像であること: ${String(offset)}`);
  }
  const exponents: Record<number, number> = {};
  for (const [primeText, exponent] of Object.entries(primeExponents)) {
    const prime = Number(primeText);
    if (!allowedPrimes.has(prime)) {
      failSemanticChord(
        `${label}の鍵は素数2・横軸の素数・選択した主要次元の縦軸の素数のいずれかであること: ${primeText}`,
      );
    }
    if (typeof exponent !== 'number' || !Number.isSafeInteger(exponent)) {
      failSemanticChord(
        `${label}の素数 ${primeText} の指数は安全な整数であること: ${String(exponent)}`,
      );
    }
    if (exponent !== 0) {
      exponents[prime] = exponent;
    }
  }
  return exponents;
}

// 解音基準のオフセットへ合成する。素数指数の加算だけを行い、
// 周波数や有理比を経由しない。合成後の指数が整数精度を逸脱する場合は拒む。
function combinePitchOffsets(
  rootExponents: Readonly<Record<number, number>>,
  relativeExponents: Readonly<Record<number, number>>,
): Record<number, number> {
  const combined: Record<number, number> = {};
  const keys = new Set<string>([...Object.keys(rootExponents), ...Object.keys(relativeExponents)]);
  for (const keyText of keys) {
    const prime = Number(keyText);
    const sum = (rootExponents[prime] ?? 0) + (relativeExponents[prime] ?? 0);
    if (!Number.isSafeInteger(sum)) {
      failSemanticChord(`合成後の素数 ${keyText} の指数が整数精度を逸脱する`);
    }
    if (sum !== 0) {
      combined[prime] = sum;
    }
  }
  return combined;
}

// 単一の声として既存の解決器で解く。周波数計算は委譲し、独自に求めない。
function resolveSingleVoice(
  primeExponents: Readonly<Record<number, number>>,
  resolutionToneFrequencyHz: number,
): ResolvedHarmonicVoice {
  return resolveHarmonicVoices([{ primeExponents }], resolutionToneFrequencyHz)[0];
}

// 素数 `2` の指数を除いた位置の鍵を返す。オクターブ違いは同じ位置にまとまる。
function positionKeyWithoutOctave(
  exponents: Readonly<Record<number, number>>,
  verticalPrime: number,
): string {
  return `${exponents[PITCH_GRID_HORIZONTAL_PRIME] ?? 0},${exponents[verticalPrime] ?? 0}`;
}

/**
 * 意味論の和音とベースを解音基準で解決する。
 *
 * 機能根は `F·R(r)`、構成音は `F·R(r+t)`、ベースは `F·R(r+b)` とする
 *（`F` は解音周波数、`r` は機能根の移動、`t` は構成音の移動、
 * `b` はベースの移動、`R` は指数から有理比への変換）。
 * すべての `ratio` を解音基準に統一する。ベースは構成音と同音でも
 * 別の出力に残し、構成音との間で束ねない。
 *
 * @param chord - 意味論の和音とベース。変更しない。
 * @param resolutionToneFrequencyHz - 解音周波数（Hz）。正の有限値。既定値は設けない。
 * @returns 機能根・構成音・ベース（省略時は `undefined`）と和声成立の有無。
 * @throws `RangeError` — 主要次元が選択次元でない、解音周波数が正の有限値でない、
 * 移動量の列が配列でない、許されない鍵・非整数の指数・整数精度逸脱がある場合。
 * @remarks
 * 入力が不正な場合、出力は作らない。
 */
export function resolveSemanticChord(
  chord: SemanticChord,
  resolutionToneFrequencyHz: number,
): ResolvedSemanticChord {
  if (chord === null || typeof chord !== 'object') {
    failSemanticChord(`和音は意味論の構造であること: ${String(chord)}`);
  }
  if (!isPitchGridDimension(chord.primaryDimension)) {
    failSemanticChord(`主要次元は3・4・5のいずれかであること: ${String(chord.primaryDimension)}`);
  }
  if (!Number.isFinite(resolutionToneFrequencyHz) || resolutionToneFrequencyHz <= 0) {
    failSemanticChord(`解音周波数は正の有限値であること: ${String(resolutionToneFrequencyHz)}`);
  }
  if (!Array.isArray(chord.toneOffsets)) {
    failSemanticChord(`構成音の移動は配列であること: ${String(chord.toneOffsets)}`);
  }
  // ADR: 許す素数の集合は選択次元ごとに定める。横軸の素数の値は
  // 既存対応表から取り、複製しない。
  const verticalPrime = verticalPrimeFor(chord.primaryDimension);
  const allowedPrimes: ReadonlySet<number> = new Set([
    2,
    PITCH_GRID_HORIZONTAL_PRIME,
    verticalPrime,
  ]);
  const rootExponents = checkedPitchOffset(chord.functionalRootOffset, allowedPrimes, '機能根');
  const toneExponents = chord.toneOffsets.map((offset, index) =>
    checkedPitchOffset(offset, allowedPrimes, `構成音${String(index)}`),
  );
  const bassExponents =
    chord.bass === undefined
      ? null
      : checkedPitchOffset(chord.bass, allowedPrimes, 'ベース');
  const composedTones = toneExponents.map((exponents) =>
    combinePitchOffsets(rootExponents, exponents),
  );
  const composedBass =
    bassExponents === null ? null : combinePitchOffsets(rootExponents, bassExponents);
  const functionalRoot = resolveSingleVoice(rootExponents, resolutionToneFrequencyHz);
  // ADR: 構成音の束ねと低音順は既存の解決器に委ねる。単音（構成音なし）は
  // 空の声列とし、解決器の空集合拒否には当てない。
  const chordVoices =
    composedTones.length === 0
      ? []
      : resolveHarmonicVoices(
          composedTones.map((primeExponents) => ({ primeExponents })),
          resolutionToneFrequencyHz,
        );
  const bass =
    composedBass === null
      ? undefined
      : resolveSingleVoice(composedBass, resolutionToneFrequencyHz);
  // ADR: 成立種数は束ね前の合成指数から数える。同一比率の束ねとは別の操作であり、
  // オクターブ違いは素数 `2` の指数を除くことで同じ種にまとまる。
  const positions = new Set<string>([
    positionKeyWithoutOctave(rootExponents, verticalPrime),
    ...composedTones.map((exponents) => positionKeyWithoutOctave(exponents, verticalPrime)),
  ]);
  const harmonyEstablished = positions.size >= 3;
  return bass === undefined
    ? { functionalRoot, chordVoices, harmonyEstablished }
    : { functionalRoot, chordVoices, bass, harmonyEstablished };
}
