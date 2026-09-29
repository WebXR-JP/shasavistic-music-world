/**
 * 格子点の座標・論理比・発音用配置とオン集合の状態遷移の検査。
 *
 * 音声文脈を使わず、純粋計算と状態遷移だけを確かめる。15点の一意性、
 * 論理比と発音用配置の区別、候補の音域収容と論理比の保存、集合単位の
 * 配置の厳密性と決定性、八方向の平行移動、重なり、端での全体拒否、
 * 空集合の無適用、次元切替の集合保持を判定対象とする。
 * 具体値はこの検査に置く。音声信号の採取は対象外とする。
 */

import { describe, expect, it } from 'vitest';
import {
  PITCH_GRID_BASE_FREQUENCY_HZ,
  PITCH_GRID_POINT_COUNT,
  PITCH_GRID_SOUND_HIGH_HZ,
  PITCH_GRID_SOUND_LOW_HZ,
  allPitchGridPoints,
  assignPitchGridFrequencies,
  createPitchGridState,
  isInPitchGrid,
  logicalRatioFor,
  pitchGridKey,
  shiftPitchGridPoints,
  soundingCandidatesFor,
  verticalPrimeFor,
  type PitchGridDimension,
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
});

describe('発音域の候補', () => {
  it('全点の候補が両端を含む音域に収まり論理比を保つ', () => {
    for (const dimension of [3, 4, 5] as const) {
      for (const point of allPitchGridPoints()) {
        const label = `(${point.x}, ${point.y})・${dimension}次元`;
        const candidates = soundingCandidatesFor(point, dimension);
        // 3オクターブの音域に必ず1件以上の候補があること。
        expect(candidates.length, label).toBeGreaterThan(0);
        const { numerator, denominator } = logicalRatioFor(point, dimension);
        // 周波数昇順（`k` 昇順と同じ）に並ぶこと。
        const frequencies = candidates.map((candidate) => candidate.frequency);
        expect([...frequencies].sort((a, b) => a - b), label).toEqual(frequencies);
        for (const candidate of candidates) {
          expect(candidate.key, label).toBe(pitchGridKey(point));
          expect(candidate.frequency, label).toBeGreaterThanOrEqual(PITCH_GRID_SOUND_LOW_HZ);
          expect(candidate.frequency, label).toBeLessThanOrEqual(PITCH_GRID_SOUND_HIGH_HZ);
          // 論理比を変えず2の整数冪だけ移したものであること。
          expect(
            ((PITCH_GRID_BASE_FREQUENCY_HZ * numerator) / denominator) * 2 ** candidate.k,
            label,
          ).toBe(candidate.frequency);
          const octaves = Math.log2(
            (candidate.frequency * denominator) /
              (PITCH_GRID_BASE_FREQUENCY_HZ * numerator),
          );
          expect(octaves, label).toBeCloseTo(Math.round(octaves), 9);
        }
      }
    }
  });

  it('候補は両端の周波数を含む', () => {
    // 中央は基準そのものであり、両端ちょうどに候補を持つこと。
    expect(soundingCandidatesFor({ x: 0, y: 0 }, 3).map((candidate) => candidate.frequency)).toEqual(
      [220, 440, 880, 1760],
    );
  });

  it('不正な候補要求を拒む', () => {
    expect(() => soundingCandidatesFor({ x: 3, y: 0 }, 3)).toThrow();
    expect(() => soundingCandidatesFor({ x: 0, y: 0 }, 2 as never)).toThrow(RangeError);
  });
});

/** 全列挙の独立オラクル用の候補1件。 */
interface OracleCandidate {
  /** 2の整数冪の移動量。 */
  readonly k: number;
  /** 閉形で求め直した周波数（Hz）。 */
  readonly frequency: number;
}

/**
 * 点の候補を `while` 式の範囲絞りで独立に列挙する。
 *
 * `k` の集合の求め方は実装と別手順とし、比較用の周波数だけ
 * 閉形（`基準 × 論理比 × 2^k`）で求め直す。
 */
function oracleCandidates(point: PitchGridPoint, dimension: PitchGridDimension): OracleCandidate[] {
  const { numerator, denominator } = logicalRatioFor(point, dimension);
  let frequency = (PITCH_GRID_BASE_FREQUENCY_HZ * numerator) / denominator;
  let k = 0;
  while (frequency < PITCH_GRID_SOUND_LOW_HZ) {
    frequency *= 2;
    k += 1;
  }
  while (frequency / 2 >= PITCH_GRID_SOUND_LOW_HZ) {
    frequency /= 2;
    k -= 1;
  }
  const ks: number[] = [];
  while (frequency <= PITCH_GRID_SOUND_HIGH_HZ) {
    ks.push(k);
    frequency *= 2;
    k += 1;
  }
  return ks.map((value) => ({
    k: value,
    frequency: ((PITCH_GRID_BASE_FREQUENCY_HZ * numerator) / denominator) * 2 ** value,
  }));
}

/** 全列挙の独立オラクルの配置結果1件。 */
interface OracleChoice {
  /** 固定座標順に並べた鍵。 */
  readonly keys: readonly string[];
  /** 固定座標順に並べた `k` 列。 */
  readonly ks: readonly number[];
}

/**
 * 小集合の最適配置を全列挙で求める独立オラクル。
 *
 * 実装の動的計画法とは別に直積をすべて評価し、間隔は発音周波数の
 * 対数差、中央寄せは発音周波数の対数と音域対数中心の差で求める。
 * 同値は固定座標順の `k` 列の辞書順で小さい方を選ぶ。
 * 準最適との差が微小な検証集合は使わず、その場合は失敗させる。
 */
function oracleAssign(
  points: readonly PitchGridPoint[],
  dimension: PitchGridDimension,
): OracleChoice {
  const ordered = [...points].sort((a, b) => b.y - a.y || a.x - b.x);
  const perPoint = ordered.map((point) => ({
    key: pitchGridKey(point),
    candidates: oracleCandidates(point, dimension),
  }));
  const centerLog = (Math.log2(PITCH_GRID_SOUND_LOW_HZ) + Math.log2(PITCH_GRID_SOUND_HIGH_HZ)) / 2;
  // 比較順は第一目的、第二目的、固定座標順の `k` 列の辞書順（小さい方）とする。
  const compareChoices = (
    a: { first: number; second: number; ks: readonly number[] },
    b: { first: number; second: number; ks: readonly number[] },
  ): number => {
    if (a.first !== b.first) {
      return a.first < b.first ? -1 : 1;
    }
    if (a.second !== b.second) {
      return a.second < b.second ? -1 : 1;
    }
    for (let index = 0; index < a.ks.length; index += 1) {
      if (a.ks[index] < b.ks[index]) {
        return -1;
      }
      if (b.ks[index] < a.ks[index]) {
        return 1;
      }
    }
    return 0;
  };
  const evaluated: Array<{ first: number; second: number; ks: number[] }> = [];
  const chosen: OracleCandidate[] = [];
  const evaluate = (): void => {
    const sounding = chosen
      .map((candidate, index) => ({ ...candidate, order: index }))
      .sort((a, b) => a.frequency - b.frequency || a.order - b.order || a.k - b.k);
    let first = 0;
    for (let index = 1; index < sounding.length; index += 1) {
      const gap = Math.log2(sounding[index].frequency / sounding[index - 1].frequency);
      const diff = gap - 0.25;
      first += diff * diff + (gap < 0.25 ? diff * diff : 0);
    }
    let second = 0;
    for (const candidate of chosen) {
      const deviation = Math.log2(candidate.frequency) - centerLog;
      second += deviation * deviation;
    }
    evaluated.push({ first, second, ks: chosen.map((candidate) => candidate.k) });
  };
  const recurse = (index: number): void => {
    if (index === perPoint.length) {
      evaluate();
      return;
    }
    for (const candidate of perPoint[index].candidates) {
      chosen.push(candidate);
      recurse(index + 1);
      chosen.pop();
    }
  };
  recurse(0);
  expect(evaluated.length).toBeGreaterThan(0);
  const ranked = [...evaluated].sort(compareChoices);
  const best = ranked[0];
  const runnerUp = ranked.length > 1 ? ranked[1] : null;
  // 準最適との差が微小だと、間隔・偏差の求め方の違いによる丸めで
  // 判定が揺れるため、そのような検証集合は使わない。
  // 完全な同値（差がちょうどゼロ）は `k` 列の辞書順で決まるため許容する。
  if (runnerUp !== null) {
    const firstMargin = runnerUp.first - best.first;
    const secondMargin = runnerUp.second - best.second;
    const tight =
      (firstMargin > 0 && firstMargin < 1e-9) ||
      (firstMargin === 0 && secondMargin > 0 && secondMargin < 1e-9);
    expect(tight, '検証集合が準最適に近接しすぎる').toBe(false);
  }
  return { keys: perPoint.map((entry) => entry.key), ks: best.ks };
}

describe('集合単位の発音配置', () => {
  it('空集合には空の配置を返す', () => {
    expect(assignPitchGridFrequencies([], 3)).toEqual([]);
  });

  it('中央の単音は中央寄せで440Hzになる', () => {
    // 第一目的ゼロ・第二目的同値の 440Hz と 880Hz のうち、
    // 固定座標順の `k` 列の辞書順で小さい方（`k = 1`）を選ぶこと。
    // 中央だけをオンにしたときに220Hzへ固定しないことも確かめる。
    expect(assignPitchGridFrequencies([{ x: 0, y: 0 }], 3)).toEqual([
      { key: '0,0', frequency: 440 },
    ]);
  });

  it('単音は候補の中から選ばれ論理比を保つ', () => {
    for (const dimension of [3, 4, 5] as const) {
      for (const point of allPitchGridPoints()) {
        const label = `(${point.x}, ${point.y})・${dimension}次元`;
        const assigned = assignPitchGridFrequencies([point], dimension);
        expect(assigned, label).toHaveLength(1);
        expect(assigned[0].key, label).toBe(pitchGridKey(point));
        expect(assigned[0].frequency, label).toBeGreaterThanOrEqual(PITCH_GRID_SOUND_LOW_HZ);
        expect(assigned[0].frequency, label).toBeLessThanOrEqual(PITCH_GRID_SOUND_HIGH_HZ);
        // その点の候補のいずれかと一致すること。
        expect(
          soundingCandidatesFor(point, dimension).map((candidate) => candidate.frequency),
          label,
        ).toContain(assigned[0].frequency);
      }
    }
  });

  it('二音でも目標への近さを評価する', () => {
    // 660Hz と 880Hz の間隔が目標1/4オクターブに最も近く、
    // 中央寄せとの両立でも最良になること。
    expect(
      assignPitchGridFrequencies(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        3,
      ),
    ).toEqual([
      { key: '0,0', frequency: 880 },
      { key: '1,0', frequency: 660 },
    ]);
  });

  it('右への移動が常に実音の上昇とはならない', () => {
    // 単音の配置でも (1, 0) の660Hz に対し右へ進んだ (2, 0) は下がること。
    const before = assignPitchGridFrequencies([{ x: 1, y: 0 }], 3);
    const after = assignPitchGridFrequencies([{ x: 2, y: 0 }], 3);
    expect(before).toEqual([{ key: '1,0', frequency: 660 }]);
    expect(after).toEqual([{ key: '2,0', frequency: 495 }]);
    expect(after[0].frequency).toBeLessThan(before[0].frequency);
  });

  it('密集集合でも全声を音域に収めて返す', () => {
    for (const dimension of [3, 4, 5] as const) {
      const points = allPitchGridPoints();
      const assigned = assignPitchGridFrequencies(points, dimension);
      expect(assigned, `${dimension}次元`).toHaveLength(PITCH_GRID_POINT_COUNT);
      // 固定座標順に鍵が並び、すべてを覆うこと。
      expect(
        assigned.map((voice) => voice.key),
        `${dimension}次元`,
      ).toEqual(points.map(pitchGridKey));
      const frequencies = assigned.map((voice) => voice.frequency);
      for (const frequency of frequencies) {
        expect(frequency, `${dimension}次元`).toBeGreaterThanOrEqual(PITCH_GRID_SOUND_LOW_HZ);
        expect(frequency, `${dimension}次元`).toBeLessThanOrEqual(PITCH_GRID_SOUND_HIGH_HZ);
      }
      // 異なる格子点は2の冪だけの移動では同音高にならないこと。
      expect(new Set(frequencies).size, `${dimension}次元`).toBe(PITCH_GRID_POINT_COUNT);
    }
  });

  it('入力順と再計算に依存しない', () => {
    const points: PitchGridPoint[] = [
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: -1, y: -1 },
      { x: 2, y: 0 },
      { x: 0, y: 0 },
    ];
    const orders: PitchGridPoint[][] = [
      points,
      [...points].reverse(),
      [...points.slice(2), ...points.slice(0, 2)],
      [points[3], points[0], points[4], points[1], points[2]],
    ];
    const first = assignPitchGridFrequencies(orders[0], 4);
    for (const order of orders) {
      expect(assignPitchGridFrequencies(order, 4)).toEqual(first);
    }
    // 同じ集合の求め直しでも変わらないこと。
    expect(assignPitchGridFrequencies(points, 4)).toEqual(first);
    // 鏡像対称の集合でも入力順によらず同じ配置になること。
    // 数学的な同値の裁定は丸めに依存し得るが、処理順の影響は受けない。
    const mirrored: PitchGridPoint[] = [
      { x: -2, y: -1 },
      { x: 2, y: 1 },
      { x: 0, y: 0 },
    ];
    const mirroredFirst = assignPitchGridFrequencies(mirrored, 3);
    expect(mirroredFirst).toHaveLength(3);
    expect(assignPitchGridFrequencies([...mirrored].reverse(), 3)).toEqual(mirroredFirst);
    expect(assignPitchGridFrequencies([mirrored[1], mirrored[2], mirrored[0]], 3)).toEqual(
      mirroredFirst,
    );
  });

  it('重複と範囲外と不正な次元を拒む', () => {
    expect(() => assignPitchGridFrequencies([{ x: 0, y: 0 }, { x: 0, y: 0 }], 3)).toThrow();
    expect(() => assignPitchGridFrequencies([{ x: 3, y: 0 }], 3)).toThrow();
    expect(() => assignPitchGridFrequencies([{ x: 0, y: 0 }], 2 as never)).toThrow(RangeError);
    expect(() => assignPitchGridFrequencies([], 2 as never)).toThrow(RangeError);
  });

  it('小集合は全列挙の独立オラクルと一致する', () => {
    const sets: Array<{ points: PitchGridPoint[]; dimension: PitchGridDimension }> = [
      { points: [{ x: 1, y: 0 }], dimension: 3 },
      {
        points: [
          { x: 0, y: 1 },
          { x: 1, y: 0 },
        ],
        dimension: 3,
      },
      {
        points: [
          { x: -2, y: -1 },
          { x: 1, y: 1 },
          { x: 0, y: 0 },
        ],
        dimension: 3,
      },
      {
        points: [
          { x: -1, y: 1 },
          { x: 2, y: -1 },
          { x: 1, y: 0 },
        ],
        dimension: 4,
      },
      {
        points: [
          { x: 0, y: 1 },
          { x: 1, y: -1 },
          { x: -1, y: 0 },
          { x: 2, y: 0 },
        ],
        dimension: 5,
      },
      {
        points: [
          { x: -2, y: 0 },
          { x: -1, y: 0 },
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 2, y: 0 },
        ],
        dimension: 4,
      },
    ];
    for (const { points, dimension } of sets) {
      const label = `${points.map(pitchGridKey).join(' ')}・${dimension}次元`;
      const expected = oracleAssign(points, dimension);
      const actual = assignPitchGridFrequencies(points, dimension);
      expect(
        actual.map((voice) => voice.key),
        label,
      ).toEqual(expected.keys);
      const ordered = [...points].sort((a, b) => b.y - a.y || a.x - b.x);
      const actualKs = actual.map((voice, index) => {
        const match = oracleCandidates(ordered[index], dimension).find(
          (candidate) => candidate.frequency === voice.frequency,
        );
        expect(match, `${label}・${voice.key}`).toBeDefined();
        return match?.k;
      });
      expect(actualKs, label).toEqual(expected.ks);
    }
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

  it('次元切替でオン集合を保持して次元だけを変える', () => {
    const state = createPitchGridState();
    state.toggle({ x: 0, y: 0 });
    state.toggle({ x: 1, y: -1 });
    const result = state.selectDimension(4);
    expect(result.changed).toBe(true);
    expect(result.snapshot.dimension).toBe(4);
    expect(result.snapshot.points).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: -1 },
    ]);
  });

  it('空集合の次元切替は次元だけを変える', () => {
    const state = createPitchGridState();
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
