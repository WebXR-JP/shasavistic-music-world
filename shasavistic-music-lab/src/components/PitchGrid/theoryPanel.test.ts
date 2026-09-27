/**
 * 格子奥側の理論説明パネルの行区切りと配置の検査。
 *
 * 音声文脈や描画を使わず、文章から `TextPlate`（最大2行）への写像だけを
 * 確かめる。見出しの先頭配置、段落順序の保持、行幅と2行上限、格子奥側への
 * 配置を判定対象とする。具体値（行数・寸法・配置）はこの検査に置く。
 */

import { describe, expect, it } from 'vitest';
import {
  THEORY_BEHIND_Z,
  THEORY_BODY_COLUMNS,
  THEORY_BODY_TOP_Y,
  THEORY_CENTER_X,
  splitTheoryLines,
  theoryPanelPlates,
  type PitchGridIntro,
} from './theoryPanel';
import introData from '../../content/pitch-grid-intro.json';

const intro: PitchGridIntro = introData;

describe('理論説明の行区切り', () => {
  it('一行の最大文字数で先頭から区切る', () => {
    expect(splitTheoryLines('あいうえお', 2)).toEqual(['あい', 'うえ', 'お']);
  });

  it('空文は行を作らない', () => {
    expect(splitTheoryLines('', 12)).toEqual([]);
  });

  it('不正な最大文字数は拒む', () => {
    expect(() => splitTheoryLines('あ', 0)).toThrow(RangeError);
  });
});

describe('理論説明パネルの配置', () => {
  it('見出しを先頭に一行で置く', () => {
    const specs = theoryPanelPlates(intro);
    expect(specs[0]?.lines).toEqual([intro.title]);
  });

  it('段落の順序を保ち2行までの複数枚に分ける', () => {
    const specs = theoryPanelPlates(intro);
    const bodyLines = specs.slice(1).flatMap((spec) => [...spec.lines]);
    const expected = intro.paragraphs.flatMap((paragraph) => splitTheoryLines(paragraph));
    expect(bodyLines).toEqual(expected);
    for (const spec of specs) {
      expect(spec.lines.length).toBeLessThanOrEqual(2);
    }
    // 長文を一枚に詰め込まず、本文だけで複数枚になること。
    expect(specs.length).toBeGreaterThan(2);
  });

  it('すべての面を格子の奥側に置く', () => {
    const specs = theoryPanelPlates(intro);
    expect(THEORY_BEHIND_Z).toBeLessThan(0);
    for (const spec of specs) {
      expect(spec.position[2]).toBe(THEORY_BEHIND_Z);
    }
  });

  it('本文を左右二列・上段から並べる', () => {
    const specs = theoryPanelPlates(intro);
    const bodies = specs.slice(1);
    expect(bodies[0]?.position[0]).toBe(THEORY_BODY_COLUMNS[0]);
    expect(bodies[1]?.position[0]).toBe(THEORY_BODY_COLUMNS[1]);
    expect(bodies[0]?.position[1]).toBe(THEORY_BODY_TOP_Y);
    // 段を下るごとに高さが下がること。
    expect(bodies[2]?.position[1]).toBeLessThan(bodies[0]?.position[1] ?? 0);
  });

  it('枚数が奇数の場合の最後の一枚は中央に置く', () => {
    const single: PitchGridIntro = { title: '見出し', paragraphs: ['あいうえお'] };
    const specs = theoryPanelPlates(single);
    expect(specs).toHaveLength(2);
    expect(specs[1]?.position[0]).toBe(THEORY_CENTER_X);
  });
});
