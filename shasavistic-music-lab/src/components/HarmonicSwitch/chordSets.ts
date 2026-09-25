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
import { normalizeHarmonicRatio, type HarmonicRatioInput } from '../../audio/harmonicRatio';

/**
 * 一つの聴き比べ単位。音色と比率集合の組合せだけを表す。
 */
export interface HarmonicChordSet {
  /**
   * Cube の選択 ID。4 件で重ならず、操作側が選択の対応付けに使う。
   * 表示名とは別にし、文言の変更で対応がずれないようにする。
   */
  readonly id: string;
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
    id: 'single-neutral',
    name: '単声 Neutral',
    preset: findPreset('Neutral Harmonic'),
    ratios: [{ numerator: 1, denominator: 1 }],
  },
  {
    id: 'fifth-low-limit',
    name: '五度 Low-Limit',
    preset: findPreset('Low-Limit Pure'),
    ratios: [
      { numerator: 1, denominator: 1 },
      { numerator: 3, denominator: 2 },
    ],
  },
  {
    id: 'major-triad-neutral',
    name: '長三和音 Neutral',
    preset: findPreset('Neutral Harmonic'),
    ratios: [
      { numerator: 1, denominator: 1 },
      { numerator: 5, denominator: 4 },
      { numerator: 3, denominator: 2 },
    ],
  },
  {
    id: 'seventh-septimal',
    name: '七度 Septimal',
    preset: findPreset('Septimal'),
    ratios: [
      { numerator: 1, denominator: 1 },
      { numerator: 7, denominator: 4 },
    ],
  },
];

/**
 * 比率集合を常時表示用の短い1行にする（例: `1/1 5/4 3/2`）。
 *
 * 素数次元表示の入力は声の識別と同じ正規化で有理比へ直してから並べる。
 * 表示の順序は声の低い順に従う。
 *
 * @param ratios - 音程比の集合。
 * @returns 空白区切りの比率列。空の集合には空文字を返す。
 */
export function formatHarmonicRatioLabel(ratios: readonly HarmonicRatioInput[]): string {
  if (ratios.length === 0) {
    return '';
  }
  const normalized = ratios.map((ratio) => normalizeHarmonicRatio(ratio));
  normalized.sort((first, second) => first.numerator / first.denominator - second.numerator / second.denominator);
  return normalized.map((ratio) => `${ratio.numerator}/${ratio.denominator}`).join(' ');
}
