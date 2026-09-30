/**
 * 和音図パネルの純粋部分の検査。
 *
 * Canvas や React を使わず、内容署名の安定性と次元線の色の割当て
 * だけを確かめる。線の長さ・重なり・判読性はXR実画面の確認に寄せ、
 * この検査では断定しない。
 */

import { describe, expect, it } from 'vitest';
import { chordDiagramPanelSignature, chordDiagramSegmentColor } from './ChordDiagramPanel';

describe('パネル内容の署名', () => {
  it('鍵の順序が違っても同じ署名になる', () => {
    expect(chordDiagramPanelSignature(3, ['1,0', '0,0'], null)).toBe(
      chordDiagramPanelSignature(3, ['0,0', '1,0'], null),
    );
  });

  it('次元・鍵・根の違いを区別する', () => {
    const base = chordDiagramPanelSignature(3, ['0,0'], null);
    expect(chordDiagramPanelSignature(4, ['0,0'], null)).not.toBe(base);
    expect(chordDiagramPanelSignature(3, ['1,0'], null)).not.toBe(base);
    expect(chordDiagramPanelSignature(3, ['0,0'], '0,0')).not.toBe(base);
  });

  it('根未指定を表す', () => {
    expect(chordDiagramPanelSignature(3, [], null)).toBe('3||-');
  });
});

describe('次元線の色の割当て', () => {
  it('x軸区間は2次元の色で描く', () => {
    expect(chordDiagramSegmentColor('x', 3)).toBe('#c62828');
    expect(chordDiagramSegmentColor('x', 5)).toBe('#c62828');
  });

  it('y軸区間は選択次元の色で描く', () => {
    expect(chordDiagramSegmentColor('y', 3)).toBe('#43a047');
    expect(chordDiagramSegmentColor('y', 4)).toBe('#1976d2');
    expect(chordDiagramSegmentColor('y', 5)).toBe('#7b1fa2');
  });

  it('選択次元でない場合は拒む', () => {
    // 実行時の検証の確認のため、型の範囲外の値を渡す。
    expect(() => chordDiagramSegmentColor('y', 2 as 3)).toThrow(RangeError);
  });
});
