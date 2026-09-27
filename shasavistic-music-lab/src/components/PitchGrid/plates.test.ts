/**
 * 文字銘板の描画幅フィットの検査。
 *
 * Canvas の実描画を使わず、書体選択が「収まる場合は基の大きさのまま、
 * 収まらない場合は描画幅に収まる大きさまで縮小する」ことを確かめる。
 * 既存パネルの短い銘板の見た目を変えないこと、実データから作られる
 * 全パネル行が欠けないことを判定対象とする。文面の内容や文字数は断定しない。
 */

import { describe, expect, it } from 'vitest';
import introData from '../../content/pitch-grid-intro.json';
import {
  PLATE_CANVAS_WIDTH,
  PLATE_TEXT_MARGIN_PX,
  fitPlateFontPx,
  selectPlateFont,
  type PlateTextWidth,
} from './plates';
import { theoryPanelPlates } from './theoryPanel';

/** 行文に使える幅（px）。 */
const maxLineWidth = PLATE_CANVAS_WIDTH - PLATE_TEXT_MARGIN_PX * 2;

/**
 * 全角相当の保守的な送り幅で測る測定口。
 * CJK の送り幅は書体サイズ以下になるため、この想定で収まれば実描画でも収まる。
 */
const fullWidthMeasure: PlateTextWidth = (font, text) => {
  const px = Number(font.match(/(\d+)px/)?.[1] ?? Number.NaN);
  return px * Array.from(text).length;
};

/** 選んだ書体の想定描画幅を求める。 */
function assumedWidth(font: string, text: string): number {
  const px = Number(font.match(/(\d+)px/)?.[1] ?? Number.NaN);
  return px * Array.from(text).length;
}

describe('描画幅に収まる書体サイズ', () => {
  it('収まる幅は基の大きさのままにする', () => {
    expect(fitPlateFontPx(44, maxLineWidth - 1)).toBe(44);
    expect(fitPlateFontPx(44, maxLineWidth)).toBe(44);
  });

  it('測れない幅は基の大きさのままにする', () => {
    expect(fitPlateFontPx(44, 0)).toBe(44);
    expect(fitPlateFontPx(44, Number.NaN)).toBe(44);
  });

  it('超える幅は収まる大きさまで縮小する', () => {
    const fitted = fitPlateFontPx(44, maxLineWidth + 100);
    expect(fitted).toBeLessThan(44);
    expect((fitted * (maxLineWidth + 100)) / 44).toBeLessThanOrEqual(maxLineWidth);
  });

  it('縮小の下限を下回らない', () => {
    expect(fitPlateFontPx(44, 1_000_000)).toBeGreaterThanOrEqual(16);
  });
});

describe('一行分の書体選択', () => {
  it('収まる短い銘板は既定書体を変えない', () => {
    const measure: PlateTextWidth = () => 100;
    expect(selectPlateFont(measure, 64, true, '(2,1)')).toBe('bold 64px sans-serif');
    expect(selectPlateFont(measure, 48, false, '8方向')).toBe('48px sans-serif');
  });

  it('超える行文は左右余白を残して収まる書体にする', () => {
    // 文面に依存しない合成の長文で、縮小と収まりだけを確かめる。
    const text = 'あ'.repeat(15);
    const font = selectPlateFont(fullWidthMeasure, 44, true, text);
    expect(font).toBe('bold 30px sans-serif');
    expect(assumedWidth(font, text)).toBeLessThanOrEqual(maxLineWidth);
  });
});

describe('実データから作るパネル行の描画幅', () => {
  it('見出し行が1行書体で欠けない', () => {
    const font = selectPlateFont(fullWidthMeasure, 44, true, introData.title);
    expect(assumedWidth(font, introData.title)).toBeLessThanOrEqual(maxLineWidth);
  });

  it('本文の全行が小さい書体で欠けない', () => {
    const specs = theoryPanelPlates(introData);
    expect(specs.length).toBeGreaterThan(1);
    for (const spec of specs.slice(1)) {
      for (const line of spec.lines) {
        // 本文の最大基サイズで判定し、どの行配置でも収まることを確かめる。
        const font = selectPlateFont(fullWidthMeasure, 44, true, line);
        expect(assumedWidth(font, line)).toBeLessThanOrEqual(maxLineWidth);
      }
    }
  });
});
