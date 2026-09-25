/**
 * 調波シンセの初期プリセット。
 *
 * 根拠資料の初期プリセットを候補とした聴き比べ用の定義であり、
 * 係数計算の条件だけを持つ。発音や操作の記述は混ぜない。
 *
 * @packageDocumentation
 */

import type { HarmonicSpectrumParams } from './harmonicSpectrum';

/**
 * 一つの聴き比べ単位。係数計算への条件付けだけを表す。
 */
export interface HarmonicPreset {
  /** 表示名。操作部品の表示にそのまま使う。 */
  readonly name: string;
  /** 倍音減衰係数。 */
  readonly alpha: number;
  /** 素数ごとの重み。省略した素数は1として扱う。 */
  readonly primeWeights: Readonly<Record<number, number>>;
  /** 調波上限（素因数の上限）。省略時は制限しない。 */
  readonly harmonicLimit?: number;
}

/**
 * 初回の聴き比べに使うプリセット列。
 *
 * 強調の倍率は2とし、対象の素数を含む倍音だけを明確に持ち上げる。
 * 次元そのものを反映させるため、上限も強調対象に合わせる。
 */
export const HARMONIC_PRESETS: readonly HarmonicPreset[] = [
  {
    name: 'Neutral Harmonic',
    alpha: 1.5,
    primeWeights: {},
  },
  {
    name: 'Low-Limit Pure',
    alpha: 1.5,
    primeWeights: {},
    harmonicLimit: 5,
  },
  {
    name: 'Septimal',
    alpha: 1.5,
    primeWeights: { 7: 2 },
    harmonicLimit: 7,
  },
  {
    name: 'Undecimal',
    alpha: 1.5,
    primeWeights: { 11: 2 },
    harmonicLimit: 11,
  },
  {
    name: 'Bright Harmonic',
    alpha: 1.1,
    primeWeights: {},
  },
  {
    name: 'Soft Harmonic',
    alpha: 2.0,
    primeWeights: {},
  },
];

/**
 * プリセットを係数計算の条件へ写す。
 *
 * @param preset - 聴き比べ単位。
 * @param fundamentalFrequency - 基音周波数（Hz）。
 * @param sampleRate - 標本化周波数（Hz）。
 * @returns 係数計算に渡す条件。
 */
export function toSpectrumParams(
  preset: HarmonicPreset,
  fundamentalFrequency: number,
  sampleRate: number,
): HarmonicSpectrumParams {
  return {
    fundamentalFrequency,
    sampleRate,
    alpha: preset.alpha,
    primeWeights: preset.primeWeights,
    harmonicLimit: preset.harmonicLimit,
  };
}
