/**
 * 格子奥側の理論説明1枚パネルの折返し・配置・収まりの検査。
 *
 * 描画を使わず、文章から一枚分の配置への写像だけを確かめる。
 * 見出しと全段落の順序・段落境界の保持、実測幅での折返し、
 * 奥側（+z向き）の配置、収まらない入力の検出を判定対象とする。
 * 具体値（上限・寸法・配置）はこの検査に置く。
 * 利用者文面の具体文字列は複製せず、実JSONを読んで性質を確認する。
 */

import { describe, expect, it } from 'vitest';
import introData from '../../content/pitch-grid-intro.json';
import { WORLD_CONFIG } from '../../constants';
import {
  THEORY_INTRO_BODY_BASE_PX,
  THEORY_INTRO_BODY_LINE_HEIGHT,
  THEORY_INTRO_CANVAS_HEIGHT,
  THEORY_INTRO_CANVAS_WIDTH,
  THEORY_INTRO_MAX_BODY_ROWS,
  THEORY_INTRO_POSITION,
  THEORY_INTRO_ROTATION,
  THEORY_INTRO_SIZE,
  THEORY_INTRO_TITLE_BASE_PX,
  THEORY_INTRO_TITLE_BODY_DELTA_PX,
  THEORY_INTRO_TITLE_LINE_HEIGHT,
  layoutTheoryIntro,
  theoryBodyFont,
  theoryIntroMaxLineWidthPx,
  theoryTitleFont,
  wrapMeasuredText,
  type PitchGridIntro,
  type TheoryTextWidth,
} from './theoryPanel';

const intro: PitchGridIntro = introData;

/** 全角相当の保守的な送り幅で測る測定口。書体サイズ以下になる送りでは収まる。 */
const fullWidthMeasure: TheoryTextWidth = (font, text) => {
  const px = Number(font.match(/(\d+)px/)?.[1] ?? Number.NaN);
  return px * Array.from(text).length;
};

/** 行頭に置かない文字の集合。折返し検査で使う。 */
const headForbidden = new Set(Array.from('、。！？）」』…〜・'));

describe('実測幅での折返し', () => {
  it('測定幅で区切り、文字数だけで切らない', () => {
    // 「あ」を他字の倍幅で測る測定口では、2字でも幅を超えて分かれる。
    const measure: TheoryTextWidth = (_font, text) =>
      Array.from(text).reduce((total, char) => total + (char === 'あ' ? 20 : 10), 0);
    expect(wrapMeasuredText(measure, 'あい', 'test font', 25)).toEqual(['あ', 'い']);
  });

  it('空文は行を作らない', () => {
    expect(wrapMeasuredText(fullWidthMeasure, '', theoryBodyFont(34), 100)).toEqual([]);
  });

  it('正でない幅は拒む', () => {
    expect(() => wrapMeasuredText(fullWidthMeasure, 'あ', theoryBodyFont(34), 0)).toThrow(RangeError);
  });

  it('行頭の句読点を行末へ追い込む', () => {
    const rows = wrapMeasuredText(fullWidthMeasure, 'あいう、えお', theoryBodyFont(10), 30);
    expect(rows).toEqual(['あいう、', 'えお']);
    for (const row of rows) {
      expect(headForbidden.has(Array.from(row)[0] ?? '')).toBe(false);
    }
  });

  it('行末の開き約物を次行へ送る', () => {
    const rows = wrapMeasuredText(fullWidthMeasure, 'あい（うえお', theoryBodyFont(10), 30);
    expect(rows).toEqual(['あい', '（うえ', 'お']);
  });

  it('英数字の連続を保てる場合は分断しない', () => {
    const rows = wrapMeasuredText(fullWidthMeasure, 'あ220い', theoryBodyFont(10), 40);
    expect(rows.some((row) => row.includes('220'))).toBe(true);
    expect(rows.join('')).toBe('あ220い');
  });
});

describe('1枚への配置', () => {
  it('見出しを先頭に置き、全段落を順序・境界を保って収める', () => {
    const layout = layoutTheoryIntro(fullWidthMeasure, intro);
    expect(layout.fits).toBe(true);
    expect(layout.titleLines.join('')).toBe(intro.title);
    expect(layout.paragraphLines).toHaveLength(intro.paragraphs.length);
    layout.paragraphLines.forEach((rows, index) => {
      expect(rows.join('')).toBe(intro.paragraphs[index]);
    });
  });

  it('一枚だけを作り、描画面の固定上限を超えない', () => {
    const layout = layoutTheoryIntro(fullWidthMeasure, intro);
    expect(layout.canvasWidth).toBeLessThanOrEqual(THEORY_INTRO_CANVAS_WIDTH);
    expect(layout.canvasHeight).toBeLessThanOrEqual(THEORY_INTRO_CANVAS_HEIGHT);
    // 面は一つであり、段落を別面へ分けない。
    expect(layout.paragraphLines.flat().length).toBeGreaterThan(0);
  });

  it('見出しと本文で書体・行間を分ける', () => {
    expect(THEORY_INTRO_TITLE_BASE_PX).toBeGreaterThan(THEORY_INTRO_BODY_BASE_PX);
    expect(THEORY_INTRO_TITLE_LINE_HEIGHT).not.toBe(THEORY_INTRO_BODY_LINE_HEIGHT);
    expect(theoryTitleFont(56)).toContain('bold');
    expect(theoryBodyFont(34)).not.toContain('bold');
    const layout = layoutTheoryIntro(fullWidthMeasure, intro);
    expect(layout.titleFontPx - layout.bodyFontPx).toBe(THEORY_INTRO_TITLE_BODY_DELTA_PX);
  });

  it('本文の行数が上限を超える入力を検出する', () => {
    const overflowing: PitchGridIntro = { title: intro.title, paragraphs: ['あ'.repeat(700)] };
    const layout = layoutTheoryIntro(fullWidthMeasure, overflowing);
    expect(layout.fits).toBe(false);
    expect(layout.overflowReason).toBe('rows');
    expect(layout.paragraphLines).toHaveLength(1);
  });

  it('行数内でも高さを超える入力を検出する', () => {
    const overflowing: PitchGridIntro = { title: intro.title, paragraphs: ['あ'.repeat(540)] };
    const layout = layoutTheoryIntro(fullWidthMeasure, overflowing);
    expect(layout.fits).toBe(false);
    expect(layout.overflowReason).toBe('height');
  });

  it('一字で幅を超える入力を最低書体超過として検出する', () => {
    const wideMeasure: TheoryTextWidth = () => theoryIntroMaxLineWidthPx() + 1;
    const layout = layoutTheoryIntro(wideMeasure, intro);
    expect(layout.fits).toBe(false);
    expect(layout.overflowReason).toBe('min-font');
  });

  it('実データの本文行数が上限に収まる', () => {
    const layout = layoutTheoryIntro(fullWidthMeasure, intro);
    const bodyRowCount = layout.paragraphLines.reduce((total, rows) => total + rows.length, 0);
    expect(bodyRowCount).toBeLessThanOrEqual(THEORY_INTRO_MAX_BODY_ROWS);
  });
});

describe('奥側の配置', () => {
  it('格子より小さい z の奥側に置く', () => {
    // 格子のワールド z=5（`World.tsx` の `PitchGrid` 配置）を参照する。
    expect(THEORY_INTRO_POSITION[2]).toBeLessThan(5);
  });

  it('正面を訪問者側の +z へ向ける', () => {
    // 面の既定の正面は +z であり、回転しないことを明示する。
    expect([...THEORY_INTRO_ROTATION]).toEqual([0, 0, 0]);
  });

  it('スポーン正面から外して横へ寄せる', () => {
    expect(THEORY_INTRO_POSITION[0]).toBeGreaterThan(0);
  });

  it('壁の内側・地面より上に収める', () => {
    const [x, y] = [THEORY_INTRO_POSITION[0] ?? 0, THEORY_INTRO_POSITION[1] ?? 0];
    const [width, height] = [THEORY_INTRO_SIZE[0] ?? 0, THEORY_INTRO_SIZE[1] ?? 0];
    const innerHalf = WORLD_CONFIG.size / 2 - WORLD_CONFIG.wallThickness;
    expect(Math.abs(x) + width / 2).toBeLessThan(innerHalf);
    expect(y - height / 2).toBeGreaterThan(0);
    expect(y + height / 2).toBeLessThan(WORLD_CONFIG.wallHeight);
  });
});
