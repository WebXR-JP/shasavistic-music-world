/**
 * 格子点の座標・論理比・発音周波数とオン集合の状態遷移の検査。
 *
 * 音声文脈を使わず、純粋計算と状態遷移だけを確かめる。15点の一意性、
 * 論理比と発音周波数の区別、オクターブ収容、八方向の平行移動、重なり、
 * 端での全体拒否、空集合の無適用、次元切替の集合クリアを判定対象とする。
 * 具体値はこの検査に置く。音声信号の採取は対象外とする。
 */

import { describe, expect, it } from 'vitest';
import {
  PITCH_GRID_POINT_COUNT,
  PITCH_GRID_SOUND_HIGH_HZ,
  PITCH_GRID_SOUND_LOW_HZ,
  allPitchGridPoints,
  createPitchGridState,
  isInPitchGrid,
  logicalRatioFor,
  pitchGridKey,
  shiftPitchGridPoints,
  soundingFrequencyFor,
  verticalPrimeFor,
  type PitchGridPoint,
} from './pitchGrid';

describe('格子の座標と論理比', () => {
  it('15点からなり座標が一意である', () => {
    const points = allPitchGridPoints();
    expect(points).toHaveLength(PITCH_GRID_POINT_COUNT);
    const keys = new Set(points.map(pitchGridKey));
    expect(keys.size).toBe(PITCH_GRID_POINT_COUNT);
    // 中央を含み、横 -2…2・縦 -1…1 の範囲に収まること。
    expect(keys.has('0,0')).toBe(true);
    for (const point of points) {
      expect(isInPitchGrid(point)).toBe(true);
    }
  });

  it('次元ごとに縦軸の素数を使い分ける', () => {
    expect(verticalPrimeFor(3)).toBe(5);
    expect(verticalPrimeFor(4)).toBe(7);
    expect(verticalPrimeFor(5)).toBe(11);
  });

  it('論理比は3^x p^yを保つ', () => {
    // (1, 1) は 3^1 * p^1 になること。
    expect(logicalRatioFor({ x: 1, y: 1 }, 3)).toEqual({ numerator: 15, denominator: 1 });
    expect(logicalRatioFor({ x: 1, y: 1 }, 4)).toEqual({ numerator: 21, denominator: 1 });
    expect(logicalRatioFor({ x: 1, y: 1 }, 5)).toEqual({ numerator: 33, denominator: 1 });
    // 負の座標は分母側の素因数になること。
    expect(logicalRatioFor({ x: -2, y: -1 }, 3)).toEqual({ numerator: 1, denominator: 45 });
    // 中央は基準そのものであること。
    expect(logicalRatioFor({ x: 0, y: 0 }, 4)).toEqual({ numerator: 1, denominator: 1 });
  });

  it('発音周波数は収容区間に収まり論理比と区別される', () => {
    // 中央は基準周波数そのものであること。
    expect(soundingFrequencyFor({ x: 0, y: 0 }, 3)).toBe(220);
    // 論理比 45（(2, 1)・3次元）は 9900Hz ではなく区間内に収まること。
    const folded = soundingFrequencyFor({ x: 2, y: 1 }, 3);
    expect(folded).toBeGreaterThanOrEqual(PITCH_GRID_SOUND_LOW_HZ);
    expect(folded).toBeLessThan(PITCH_GRID_SOUND_HIGH_HZ);
    expect(folded).toBe(9900 / 32);
  });

  it('全点の発音周波数が収容区間に収まる', () => {
    for (const dimension of [3, 4, 5] as const) {
      for (const point of allPitchGridPoints()) {
        const frequency = soundingFrequencyFor(point, dimension);
        expect(frequency, `(${point.x}, ${point.y})・${dimension}次元`).toBeGreaterThanOrEqual(
          PITCH_GRID_SOUND_LOW_HZ,
        );
        expect(frequency, `(${point.x}, ${point.y})・${dimension}次元`).toBeLessThan(
          PITCH_GRID_SOUND_HIGH_HZ,
        );
      }
    }
  });

  it('異なる座標の発音周波数は重ならない', () => {
    // 2の整数冪の差しかない論理比は存在しないため、折り返し後の衝突もないこと。
    for (const dimension of [3, 4, 5] as const) {
      const frequencies = allPitchGridPoints().map((point) =>
        soundingFrequencyFor(point, dimension),
      );
      expect(new Set(frequencies).size).toBe(PITCH_GRID_POINT_COUNT);
    }
  });

  it('右・上への移動が常に実音の上昇とはならない', () => {
    // (1, 0) は 330Hz だが、右へ進んだ (2, 0) は区間内に収まり下がること。
    const before = soundingFrequencyFor({ x: 1, y: 0 }, 3);
    const after = soundingFrequencyFor({ x: 2, y: 0 }, 3);
    expect(before).toBe(330);
    expect(after).toBeLessThan(before);
  });
});

describe('オン集合の状態遷移', () => {
  it('点のオン・オフを切り替える', () => {
    const state = createPitchGridState();
    expect(state.getSnapshot().points).toEqual([]);
    state.toggle({ x: 0, y: 0 });
    expect(state.getSnapshot().points).toEqual([{ x: 0, y: 0 }]);
    state.toggle({ x: 0, y: 0 });
    expect(state.getSnapshot().points).toEqual([]);
  });

  it('八方向の平行移動で集合全体がずれる', () => {
    const directions: Array<[number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ];
    for (const [dx, dy] of directions) {
      const state = createPitchGridState();
      state.toggle({ x: 0, y: 0 });
      const result = state.move(dx, dy);
      expect(result.applied).toBe(true);
      expect(result.snapshot.points).toEqual([{ x: dx, y: dy }]);
    }
  });

  it('移動で重なった点を固定点として残さない', () => {
    // 移動前の集合をそのまま平行移動したものになり、重なりを特別扱いしないこと。
    const state = createPitchGridState();
    state.toggle({ x: 0, y: 0 });
    state.toggle({ x: 1, y: 0 });
    const result = state.move(1, 0);
    expect(result.applied).toBe(true);
    expect(result.snapshot.points).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
  });

  it('端での移動は集合全体について行わない', () => {
    const state = createPitchGridState();
    state.toggle({ x: 2, y: 0 });
    const result = state.move(1, 0);
    expect(result.applied).toBe(false);
    // 集合は変わらず、折り返しもしないこと。
    expect(result.snapshot.points).toEqual([{ x: 2, y: 0 }]);
    // 一つでも外へ出る場合は全体を拒否すること。
    const crowded = createPitchGridState();
    crowded.toggle({ x: 0, y: 0 });
    crowded.toggle({ x: 2, y: 1 });
    const rejected = crowded.move(0, 1);
    expect(rejected.applied).toBe(false);
    expect(rejected.snapshot.points).toEqual([
      { x: 2, y: 1 },
      { x: 0, y: 0 },
    ]);
  });

  it('空集合の移動は適用しない', () => {
    const state = createPitchGridState();
    const result = state.move(1, 0);
    expect(result.applied).toBe(false);
    expect(result.snapshot.points).toEqual([]);
  });

  it('次元切替で集合を空にして次元を変える', () => {
    const state = createPitchGridState();
    state.toggle({ x: 0, y: 0 });
    state.toggle({ x: 1, y: -1 });
    const result = state.selectDimension(4);
    expect(result.changed).toBe(true);
    expect(result.snapshot.dimension).toBe(4);
    expect(result.snapshot.points).toEqual([]);
  });

  it('同じ次元の選び直しは何もしない', () => {
    const state = createPitchGridState();
    state.toggle({ x: 0, y: 0 });
    const result = state.selectDimension(3);
    expect(result.changed).toBe(false);
    expect(result.snapshot.points).toEqual([{ x: 0, y: 0 }]);
  });

  it('不正な操作は状態を変えずに拒む', () => {
    const state = createPitchGridState();
    state.toggle({ x: 0, y: 0 });
    expect(() => state.toggle({ x: 3, y: 0 })).toThrow();
    expect(state.getSnapshot().points).toEqual([{ x: 0, y: 0 }]);
    expect(() => state.move(0, 0)).toThrow(RangeError);
    expect(() => state.move(2, 0)).toThrow(RangeError);
    expect(state.getSnapshot().points).toEqual([{ x: 0, y: 0 }]);
    expect(() => state.selectDimension(2 as never)).toThrow(RangeError);
    expect(state.getSnapshot().dimension).toBe(3);
  });

  it('純粋な平行移動は格子外で空振りする', () => {
    const points: PitchGridPoint[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ];
    expect(shiftPitchGridPoints(points, 1, 0)).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
    expect(
      shiftPitchGridPoints(
        [
          { x: 1, y: 0 },
          { x: 2, y: 0 },
        ],
        1,
        0,
      ),
    ).toBe(null);
    expect(shiftPitchGridPoints([], 1, 0)).toBe(null);
  });
});
