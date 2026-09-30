/**
 * 和音図の線構造プレビューの純粋変換の検査。
 *
 * 描画（Canvas や React）を使わず、数値だけで次を確かめる。
 * 高さ式の一歩の値と方向、非隣接の一本化とオン点での区切り、
 * 低次元優先の標準経路、次元線の左右端割当てと左短縮の識別（選択次元座標が0でないか）、
 * 次元切替の再計算、根なしと未接続の区別、
 * 0〜2点の縮退と和音未成立、格子外・重複の拒否、
 * 譜列挙の端と `h=0` の主音線優先を判定対象とする。
 * 具体値と判定手順はこの検査に置く。
 */

import { describe, expect, it } from 'vitest';
import {
  CHORD_DIAGRAM_HORIZONTAL_STEP,
  CHORD_DIAGRAM_VERTICAL_STEPS,
  chordDiagramHeight,
  chordDiagramSegmentSide,
  chordDiagramVerticalStepFor,
  layoutChordDiagram,
} from './chordDiagramLayout';

/** 横一歩 `a` の具体値。`log2(3/2)` に等しいことの確認に使う。 */
const STEP_A = 0.5849625007211562;
/** 3次元の縦一歩 `b_3` の具体値。`log2(5/4)` に等しいことの確認に使う。 */
const STEP_B3 = 0.32192809488736235;
/** 4次元の縦一歩 `b_4` の具体値。`log2(7/4)` に等しいことの確認に使う。 */
const STEP_B4 = 0.8073549220576041;
/** 5次元の縦一歩 `b_5` の具体値。`log2(11/8)` に等しいことの確認に使う。 */
const STEP_B5 = 0.4594316186372973;

describe('一歩の定数と高さ式', () => {
  it('横一歩と次元ごとの縦一歩を具体値で定める', () => {
    expect(CHORD_DIAGRAM_HORIZONTAL_STEP).toBeCloseTo(STEP_A, 10);
    expect(CHORD_DIAGRAM_VERTICAL_STEPS[3]).toBeCloseTo(STEP_B3, 10);
    expect(CHORD_DIAGRAM_VERTICAL_STEPS[4]).toBeCloseTo(STEP_B4, 10);
    expect(CHORD_DIAGRAM_VERTICAL_STEPS[5]).toBeCloseTo(STEP_B5, 10);
    expect(chordDiagramVerticalStepFor(3)).toBe(CHORD_DIAGRAM_VERTICAL_STEPS[3]);
  });

  it('3次元で横一歩がa・縦一歩がb_3になる', () => {
    expect(chordDiagramHeight({ x: 1, y: 0 }, 3)).toBeCloseTo(STEP_A, 10);
    expect(chordDiagramHeight({ x: 0, y: 1 }, 3)).toBeCloseTo(STEP_B3, 10);
  });

  it('縦方向の差がb_3になる', () => {
    const upper = chordDiagramHeight({ x: 1, y: 1 }, 3);
    const lower = chordDiagramHeight({ x: 1, y: 0 }, 3);
    expect(upper - lower).toBeCloseTo(STEP_B3, 10);
  });

  it('負方向は符号を反転する', () => {
    expect(chordDiagramHeight({ x: -1, y: 0 }, 3)).toBeCloseTo(-STEP_A, 10);
    expect(chordDiagramHeight({ x: 0, y: -1 }, 3)).toBeCloseTo(-STEP_B3, 10);
    expect(chordDiagramHeight({ x: -2, y: -1 }, 3)).toBeCloseTo(-2 * STEP_A - STEP_B3, 10);
  });

  it('中央の高さは0である', () => {
    expect(chordDiagramHeight({ x: 0, y: 0 }, 3)).toBe(0);
    expect(chordDiagramHeight({ x: 0, y: 0 }, 5)).toBe(0);
  });
});

describe('主音線と音高線', () => {
  it('0点では主音線のみを示す', () => {
    const layout = layoutChordDiagram(3, [], null);
    expect(layout.mainLine.height).toBe(0);
    expect(layout.pitchLines).toEqual([]);
    expect(layout.range).toBeNull();
    expect(layout.staffLines1D).toEqual([]);
    expect(layout.staffLines2D).toEqual([]);
    expect(layout.dimensionSegments).toEqual([]);
  });

  it('1点では主音線とその音高線のみを示し譜は引かない', () => {
    const layout = layoutChordDiagram(3, [{ x: 1, y: 0 }], null);
    expect(layout.pitchLines).toHaveLength(1);
    expect(layout.pitchLines[0]?.height).toBeCloseTo(STEP_A, 10);
    expect(layout.range).toEqual({ lower: layout.pitchLines[0]?.height, upper: layout.pitchLines[0]?.height });
    expect(layout.staffLines1D).toEqual([]);
    expect(layout.staffLines2D).toEqual([]);
  });

  it('h=0の音高線を主音線重なりとして識別する', () => {
    const layout = layoutChordDiagram(3, [{ x: 0, y: 0 }, { x: 1, y: 0 }], null);
    expect(layout.pitchLines).toHaveLength(2);
    expect(layout.pitchLines[0]?.overlapsMain).toBe(true);
    expect(layout.pitchLines[1]?.overlapsMain).toBe(false);
  });

  it('音高線を固定座標順に並べる', () => {
    const layout = layoutChordDiagram(3, [{ x: 1, y: 0 }, { x: 0, y: 1 }], null);
    expect(layout.pitchLines.map((line) => line.key)).toEqual(['0,1', '1,0']);
  });
});

describe('譜線の列挙', () => {
  it('2点でも両譜を引き和音未成立と併せ持つ', () => {
    const layout = layoutChordDiagram(3, [{ x: 0, y: 0 }, { x: 1, y: 0 }], null);
    expect(layout.chordUnformed).toBe(true);
    // L=0・U=a のため、1次元譜は n=0 のみで主音線優先により空になる。
    expect(layout.staffLines1D).toEqual([]);
    // 2次元譜は m=0…1 から h=0 を除き m=1 の一本が残る。
    expect(layout.staffLines2D).toHaveLength(1);
    expect(layout.staffLines2D[0]?.index).toBe(1);
    expect(layout.staffLines2D[0]?.height).toBeCloseTo(STEP_A, 10);
  });

  it('h=0は主音線を優先し両譜から除く', () => {
    const layout = layoutChordDiagram(3, [{ x: -1, y: 0 }, { x: 1, y: 0 }], null);
    // L=-a・U=a のため、1次元譜は n=0 のみで空になる。
    expect(layout.staffLines1D).toEqual([]);
    // 2次元譜は m=-1…1 から h=0 を除いた二本が残る。
    expect(layout.staffLines2D.map((line) => line.index)).toEqual([-1, 1]);
    expect(layout.staffLines2D[0]?.height).toBeCloseTo(-STEP_A, 10);
    expect(layout.staffLines2D[1]?.height).toBeCloseTo(STEP_A, 10);
  });

  it('LとUの閉区間の端まで譜を列挙する', () => {
    const layout = layoutChordDiagram(3, [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }], null);
    // 高さは 0・2a・b_3 のため L=0・U=2a である。
    expect(layout.range?.lower).toBe(0);
    expect(layout.range?.upper).toBeCloseTo(2 * STEP_A, 10);
    // 1次元譜は n=0…1 から h=0 を除き n=1 の一本が残る。
    expect(layout.staffLines1D).toEqual([{ index: 1, height: 1 }]);
    // 2次元譜は m=0…2 から h=0 を除いた二本が残る。
    expect(layout.staffLines2D.map((line) => line.index)).toEqual([1, 2]);
  });
});

describe('次元線の標準経路', () => {
  it('非隣接の横2歩を0から2aの一本にする', () => {
    const layout = layoutChordDiagram(3, [{ x: 0, y: 0 }, { x: 2, y: 0 }], { x: 0, y: 0 });
    expect(layout.dimensionSegments).toHaveLength(1);
    const [segment] = layout.dimensionSegments;
    expect(segment?.axis).toBe('x');
    expect(segment?.direction).toBe(1);
    expect(segment?.steps).toBe(2);
    expect(segment?.from).toEqual({ x: 0, y: 0 });
    expect(segment?.to).toEqual({ x: 2, y: 0 });
    expect(segment?.fromHeight).toBe(0);
    expect(segment?.toHeight).toBeCloseTo(2 * STEP_A, 10);
    expect(segment?.orderFromRoot).toBe(0);
    expect(segment?.id).toBe('x:0,0>2,0');
  });

  it('経路上の別のオン点で区切り2本にする', () => {
    const layout = layoutChordDiagram(
      3,
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
      { x: 0, y: 0 },
    );
    expect(layout.dimensionSegments).toHaveLength(2);
    expect(layout.dimensionSegments.map((segment) => segment.id)).toEqual([
      'x:0,0>1,0',
      'y:1,0>1,1',
    ]);
    expect(layout.dimensionSegments.map((segment) => segment.orderFromRoot)).toEqual([0, 1]);
    const [first, second] = layout.dimensionSegments;
    expect(first?.toHeight).toBeCloseTo(STEP_A, 10);
    expect(second?.toHeight).toBeCloseTo(STEP_A + STEP_B3, 10);
  });

  it('複数経路でも低次元優先でx軸を先に進む', () => {
    const layout = layoutChordDiagram(3, [{ x: 0, y: 0 }, { x: 1, y: 1 }], { x: 0, y: 0 });
    expect(layout.dimensionSegments.map((segment) => segment.axis)).toEqual(['x', 'y']);
    expect(layout.dimensionSegments.map((segment) => segment.id)).toEqual([
      'x:0,0>1,0',
      'y:1,0>1,1',
    ]);
  });

  it('斜め差の経路を横区間と縦区間に分ける', () => {
    const layout = layoutChordDiagram(3, [{ x: 0, y: 0 }, { x: 2, y: 1 }], { x: 0, y: 0 });
    expect(layout.dimensionSegments).toHaveLength(2);
    const [horizontal, vertical] = layout.dimensionSegments;
    expect(horizontal?.axis).toBe('x');
    expect(horizontal?.steps).toBe(2);
    expect(horizontal?.to).toEqual({ x: 2, y: 0 });
    expect(vertical?.axis).toBe('y');
    expect(vertical?.steps).toBe(1);
    expect(vertical?.from).toEqual({ x: 2, y: 0 });
    expect(vertical?.to).toEqual({ x: 2, y: 1 });
    expect(vertical?.toHeight).toBeCloseTo(2 * STEP_A + STEP_B3, 10);
  });

  it('非隣接の縦2歩を一本にする', () => {
    const layout = layoutChordDiagram(3, [{ x: 0, y: -1 }, { x: 0, y: 1 }], { x: 0, y: -1 });
    expect(layout.dimensionSegments).toHaveLength(1);
    const [segment] = layout.dimensionSegments;
    expect(segment?.axis).toBe('y');
    expect(segment?.direction).toBe(1);
    expect(segment?.steps).toBe(2);
    expect(segment?.fromHeight).toBeCloseTo(-STEP_B3, 10);
    expect(segment?.toHeight).toBeCloseTo(STEP_B3, 10);
  });

  it('共通区間は重複しない', () => {
    const layout = layoutChordDiagram(
      3,
      [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }],
      { x: 0, y: 0 },
    );
    // (0,0)→(2,0) の一本が (1,1) への横行程を兼ね、角 (1,0) はオフのため通す。
    expect(layout.dimensionSegments.map((segment) => segment.id)).toEqual([
      'x:0,0>2,0',
      'y:1,0>1,1',
    ]);
  });

  it('根から根への自己区間は出さない', () => {
    const layout = layoutChordDiagram(3, [{ x: 0, y: 0 }], { x: 0, y: 0 });
    expect(layout.dimensionSegments).toEqual([]);
    expect(layout.rootOnPoint).toBe(true);
    expect(layout.pitchLines[0]?.isRoot).toBe(true);
  });

  it('入力順を変えても区間と順序は変わらない', () => {
    const forward = layoutChordDiagram(
      3,
      [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }],
      { x: 0, y: 0 },
    );
    const reversed = layoutChordDiagram(
      3,
      [{ x: 1, y: 1 }, { x: 2, y: 0 }, { x: 0, y: 0 }],
      { x: 0, y: 0 },
    );
    expect(reversed.dimensionSegments).toEqual(forward.dimensionSegments);
  });
});

describe('機能根の指定と次元切替', () => {
  it('根なしでは次元線を空にし未指定として区別する', () => {
    const layout = layoutChordDiagram(3, [{ x: 0, y: 0 }, { x: 1, y: 0 }], null);
    expect(layout.dimensionSegments).toEqual([]);
    expect(layout.rootSpecified).toBe(false);
    expect(layout.rootOnPoint).toBe(false);
    expect(layout.functionalRoot).toBeNull();
  });

  it('指定根がオン集合にない場合は未接続として区別する', () => {
    const layout = layoutChordDiagram(3, [{ x: 0, y: 0 }], { x: 1, y: 1 });
    expect(layout.rootSpecified).toBe(true);
    expect(layout.rootOnPoint).toBe(false);
    expect(layout.pitchLines[0]?.isRoot).toBe(false);
    // 根があるため次元線は引く（根から各オン点への標準経路）。
    expect(layout.dimensionSegments.map((segment) => segment.id)).toEqual([
      'x:1,1>0,1',
      'y:0,1>0,0',
    ]);
  });

  it('次元切替で縦一歩を再計算する', () => {
    const points = [{ x: 1, y: 0 }, { x: 1, y: 1 }] as const;
    const third = layoutChordDiagram(3, [...points], { x: 1, y: 0 });
    const fourth = layoutChordDiagram(4, [...points], { x: 1, y: 0 });
    const fifth = layoutChordDiagram(5, [...points], { x: 1, y: 0 });
    // 横だけの点の高さは次元によらず等しい。
    expect(third.pitchLines[1]?.height).toBeCloseTo(STEP_A, 10);
    expect(fourth.pitchLines[1]?.height).toBeCloseTo(STEP_A, 10);
    // 縦を含む点の高さは次元ごとに変わる。
    expect(third.pitchLines[0]?.height).toBeCloseTo(STEP_A + STEP_B3, 10);
    expect(fourth.pitchLines[0]?.height).toBeCloseTo(STEP_A + STEP_B4, 10);
    expect(fifth.pitchLines[0]?.height).toBeCloseTo(STEP_A + STEP_B5, 10);
    // 次元線区間の端点高さも再計算される。
    expect(third.dimensionSegments[0]?.toHeight).toBeCloseTo(STEP_A + STEP_B3, 10);
    expect(fourth.dimensionSegments[0]?.toHeight).toBeCloseTo(STEP_A + STEP_B4, 10);
    expect(fifth.dimensionSegments[0]?.toHeight).toBeCloseTo(STEP_A + STEP_B5, 10);
  });
});

describe('和音未成立の判定', () => {
  it('0点と1点では和音未成立とする', () => {
    expect(layoutChordDiagram(3, [], null).chordUnformed).toBe(true);
    expect(layoutChordDiagram(3, [{ x: 0, y: 0 }], { x: 0, y: 0 }).chordUnformed).toBe(true);
  });

  it('2点では譜を引きつつ和音未成立とする', () => {
    const layout = layoutChordDiagram(3, [{ x: 0, y: 0 }, { x: 2, y: 0 }], { x: 0, y: 0 });
    expect(layout.chordUnformed).toBe(true);
    expect(layout.staffLines2D.length).toBeGreaterThan(0);
  });

  it('3点では和音未成立としない', () => {
    const layout = layoutChordDiagram(
      3,
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
      { x: 0, y: 0 },
    );
    expect(layout.chordUnformed).toBe(false);
  });
});

describe('次元線の左右端と左短縮の識別', () => {
  it('x軸区間は左端・y軸区間は右端に割り当てる', () => {
    expect(chordDiagramSegmentSide('x')).toBe('left');
    expect(chordDiagramSegmentSide('y')).toBe('right');
  });

  it('選択次元座標が0でない音高線だけを短縮対象とする', () => {
    const layout = layoutChordDiagram(
      3,
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
      { x: 0, y: 0 },
    );
    // (1,1) は選択次元移動で到達した音のため短縮し、
    // (1,0)・(0,0) は y=0 のためフルサイズとする。
    const byKey = new Map(layout.pitchLines.map((line) => [line.key, line]));
    expect(byKey.get('1,1')?.isLeftShortened).toBe(true);
    expect(byKey.get('1,0')?.isLeftShortened).toBe(false);
    expect(byKey.get('0,0')?.isLeftShortened).toBe(false);
  });

  it('y=-1の音高線を短縮対象とする', () => {
    const layout = layoutChordDiagram(
      3,
      [{ x: 0, y: 0 }, { x: 0, y: -1 }, { x: 1, y: -1 }],
      { x: 0, y: 0 },
    );
    // 負方向への選択次元移動で到達した音も短縮し、y=0 は対象外とする。
    const byKey = new Map(layout.pitchLines.map((line) => [line.key, line]));
    expect(byKey.get('0,-1')?.isLeftShortened).toBe(true);
    expect(byKey.get('1,-1')?.isLeftShortened).toBe(true);
    expect(byKey.get('0,0')?.isLeftShortened).toBe(false);
  });

  it('y=0だけの集合では短縮対象を出さない', () => {
    const layout = layoutChordDiagram(3, [{ x: 0, y: 0 }, { x: 2, y: 0 }], { x: 0, y: 0 });
    expect(layout.dimensionSegments).toHaveLength(1);
    expect(layout.dimensionSegments[0]?.axis).toBe('x');
    expect(layout.pitchLines.every((line) => !line.isLeftShortened)).toBe(true);
  });

  it('根が選択次元座標0でなくてもyで識別する', () => {
    const layout = layoutChordDiagram(
      3,
      [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
      { x: 0, y: 1 },
    );
    // 根 (0,1) 自体も y≠0 のため短縮し、(0,0) は根からの経路の有無にかかわらず対象外とする。
    const byKey = new Map(layout.pitchLines.map((line) => [line.key, line]));
    expect(byKey.get('0,1')?.isLeftShortened).toBe(true);
    expect(byKey.get('1,1')?.isLeftShortened).toBe(true);
    expect(byKey.get('0,0')?.isLeftShortened).toBe(false);
  });

  it('根なしでもyが0でない音高線を短縮対象とする', () => {
    const layout = layoutChordDiagram(3, [{ x: 0, y: 0 }, { x: 1, y: 1 }], null);
    expect(layout.dimensionSegments).toEqual([]);
    const byKey = new Map(layout.pitchLines.map((line) => [line.key, line]));
    expect(byKey.get('1,1')?.isLeftShortened).toBe(true);
    expect(byKey.get('0,0')?.isLeftShortened).toBe(false);
  });
});

describe('入力の検証', () => {
  it('格子外のオン点を拒む', () => {
    expect(() => layoutChordDiagram(3, [{ x: 3, y: 0 }], null)).toThrow(Error);
    expect(() => chordDiagramHeight({ x: 0, y: 2 }, 3)).toThrow(Error);
  });

  it('重複したオン点を拒む', () => {
    expect(() => layoutChordDiagram(3, [{ x: 0, y: 0 }, { x: 0, y: 0 }], null)).toThrow(Error);
  });

  it('選択次元でない場合は拒む', () => {
    // 実行時の検証の確認のため、型の範囲外の値を渡す。
    expect(() => layoutChordDiagram(2 as 3, [], null)).toThrow(RangeError);
    expect(() => chordDiagramVerticalStepFor(6 as 3)).toThrow(RangeError);
  });

  it('格子外の機能根を拒む', () => {
    expect(() => layoutChordDiagram(3, [{ x: 0, y: 0 }], { x: 5, y: 0 })).toThrow(Error);
  });
});
