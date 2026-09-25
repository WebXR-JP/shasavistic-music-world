/**
 * 調波和音の聴き比べの組合せ。
 *
 * 音色プリセットそのものに音程比を混入させず、「音色と比率集合」の組合せを
 * 操作側の小さな定義として扱う。集合には単声も残し、受入れ済みの調波単音を
 * 利用経路から消さない。和音集合・声数上限・利得分配の具体値はテスト・
 * 聴き比べの入力を定める実装段階の決定であり、理論が唯一規定する
 * 「標準和音」とは呼ばない。
 */

import { HARMONIC_PRESETS, type HarmonicPreset } from '../../audio/harmonicPresets';
import type { HarmonicRatioInput } from '../../audio/harmonicRatio';

/**
 * 一つの聴き比べ単位。音色と比率集合の組合せだけを表す。
 */
export interface HarmonicChordSet {
  /** 表示名。操作部品の表示にそのまま使う。 */
  readonly name: string;
  /** 鳴らす音色。全声に共通。 */
  readonly preset: HarmonicPreset;
  /** 音程比の集合。有効な声数は同時発音の上限以下にする。 */
  readonly ratios: readonly HarmonicRatioInput[];
}

function findPreset(name: string): HarmonicPreset {
  const preset = HARMONIC_PRESETS.find((candidate) => candidate.name === name);
  if (preset === undefined) {
    throw new Error(`聴き比べに使うプリセットが見つからない: ${name}`);
  }
  return preset;
}

/**
 * 聴き比べに使う組合せ列。先頭は単声とし、従来の調波単音を残す。
 */
export const HARMONIC_CHORD_SETS: readonly HarmonicChordSet[] = [
  {
    name: '単声 Neutral',
    preset: findPreset('Neutral Harmonic'),
    ratios: [{ numerator: 1, denominator: 1 }],
  },
  {
    name: '五度 Low-Limit',
    preset: findPreset('Low-Limit Pure'),
    ratios: [
      { numerator: 1, denominator: 1 },
      { numerator: 3, denominator: 2 },
    ],
  },
  {
    name: '長三和音 Neutral',
    preset: findPreset('Neutral Harmonic'),
    ratios: [
      { numerator: 1, denominator: 1 },
      { numerator: 5, denominator: 4 },
      { numerator: 3, denominator: 2 },
    ],
  },
  {
    name: '七度 Septimal',
    preset: findPreset('Septimal'),
    ratios: [
      { numerator: 1, denominator: 1 },
      { numerator: 7, denominator: 4 },
    ],
  },
];
