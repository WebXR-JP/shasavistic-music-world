/**
 * 格子点の座標・論理比・発音用配置とオン集合の状態遷移。
 *
 * 横 `-2…2`・縦 `-1…1` の15点を範囲とし、横軸の素数を `3`、
 * 縦軸の素数を選択次元に応じ `5`・`7`・`11` とする。
 * 座標 `(x, y)` の論理比 `3^x p^y` は関係として保持し、
 * 発音周波数はオン集合単位の配置関数が基準周波数からの比を
 * 2の整数冪だけ移して `220…1760 Hz`（両端を含む）に収める。
 * 論理比と発音用配置を混同しない。
 * 右・上へ進むことが常に実音の上昇とは扱わない。
 *
 * 音声文脈や声の寿命は扱わず、発音側（`pitchGridSound`）と
 * 操作統合（`pitchGridController`）から分離する。
 *
 * @packageDocumentation
 */

/** 選択できる縦軸の次元。3・4・5次元だけを扱う。 */
export type PitchGridDimension = 3 | 4 | 5;

/** 格子点の座標。中央 `(0, 0)`、横 `x`、縦 `y`。 */
export interface PitchGridPoint {
  /** 横座標。`-2…2` の整数。 */
  readonly x: number;
  /** 縦座標。`-1…1` の整数。 */
  readonly y: number;
}

/** 格子点の論理比。関係として保持する正の有理比。 */
export interface PitchGridLogicalRatio {
  /** 分子。正の整数。 */
  readonly numerator: number;
  /** 分母。正の整数。 */
  readonly denominator: number;
}

/** 横座標の最小値。 */
export const PITCH_GRID_X_MIN = -2;

/** 横座標の最大値。 */
export const PITCH_GRID_X_MAX = 2;

/** 縦座標の最小値。 */
export const PITCH_GRID_Y_MIN = -1;

/** 縦座標の最大値。 */
export const PITCH_GRID_Y_MAX = 1;

/** 中央の基準周波数（Hz）。暫定設計値。 */
export const PITCH_GRID_BASE_FREQUENCY_HZ = 220;

/** 発音周波数の収容区間の下端（Hz）。この値を含む。 */
export const PITCH_GRID_SOUND_LOW_HZ = 220;

/** 発音周波数の収容区間の上端（Hz）。この値を含む。 */
export const PITCH_GRID_SOUND_HIGH_HZ = 1760;

/** 横軸の素数。 */
export const PITCH_GRID_HORIZONTAL_PRIME = 3;

/** 次元ごとの縦軸の素数。 */
export const PITCH_GRID_VERTICAL_PRIMES: Readonly<Record<PitchGridDimension, number>> = {
  3: 5,
  4: 7,
  5: 11,
};

/** 格子点の数。同時にオンにできる上限でもある。 */
export const PITCH_GRID_POINT_COUNT = 15;

/**
 * 選択できる縦軸の次元かを判定する。
 *
 * @param value - 判定対象。
 * @returns 3・4・5次元のいずれかの場合だけ `true`。
 */
export function isPitchGridDimension(value: unknown): value is PitchGridDimension {
  return value === 3 || value === 4 || value === 5;
}

/**
 * 次元の縦軸の素数を返す。
 *
 * @param dimension - 選択次元。
 * @returns 3次元は `5`、4次元は `7`、5次元は `11`。
 * @throws `RangeError` — 選択次元でない場合。音声文脈は生成しない。
 */
export function verticalPrimeFor(dimension: PitchGridDimension): number {
  if (!isPitchGridDimension(dimension)) {
    throw new RangeError(`縦軸の次元は3・4・5のいずれかであること: ${String(dimension)}`);
  }
  return PITCH_GRID_VERTICAL_PRIMES[dimension];
}

/**
 * 格子点の範囲内かを判定する。
 *
 * @param point - 判定対象。
 * @returns 横 `-2…2`・縦 `-1…1` の整数の場合だけ `true`。
 */
export function isInPitchGrid(point: PitchGridPoint): boolean {
  return (
    Number.isInteger(point.x) &&
    Number.isInteger(point.y) &&
    point.x >= PITCH_GRID_X_MIN &&
    point.x <= PITCH_GRID_X_MAX &&
    point.y >= PITCH_GRID_Y_MIN &&
    point.y <= PITCH_GRID_Y_MAX
  );
}

/**
 * 格子点の鍵を返す。声の対応付けと集合の識別に使う。
 *
 * @param point - 格子点。
 * @returns `x,y` 形式の鍵。
 */
export function pitchGridKey(point: PitchGridPoint): string {
  return `${point.x},${point.y}`;
}

/**
 * 座標の論理比を返す。
 *
 * 横軸の素数 `3` の `x` 乗と縦軸の素数の `y` 乗の積を、
 * 正の整数の分子・分母で保持する。
 *
 * @param point - 格子点。範囲内であること。
 * @param dimension - 選択次元。
 * @returns 論理比 `3^x p^y` の分子・分母。
 * @throws `Error` — 格子外の座標の場合。
 * @throws `RangeError` — 選択次元でない場合。
 */
export function logicalRatioFor(
  point: PitchGridPoint,
  dimension: PitchGridDimension,
): PitchGridLogicalRatio {
  if (!isInPitchGrid(point)) {
    throw new Error(`格子外の座標である: (${String(point.x)}, ${String(point.y)})`);
  }
  const verticalPrime = verticalPrimeFor(dimension);
  const numerator =
    PITCH_GRID_HORIZONTAL_PRIME ** Math.max(point.x, 0) * verticalPrime ** Math.max(point.y, 0);
  const denominator =
    PITCH_GRID_HORIZONTAL_PRIME ** Math.max(-point.x, 0) *
    verticalPrime ** Math.max(-point.y, 0);
  return { numerator, denominator };
}

/**
 * オン集合の1点が取り得る発音域内の候補。
 *
 * `k` は2の整数冪の移動量であり、周波数は
 * `基準周波数 × 論理比 × 2^k` で求める。
 * 論理比そのものは変えない。
 */
export interface PitchGridSoundingCandidate {
  /** 座標の鍵（`x,y` 形式）。 */
  readonly key: string;
  /** 2の整数冪の移動量。 */
  readonly k: number;
  /** 発音域に収まる周波数（Hz）。両端を含む。 */
  readonly frequency: number;
}

/**
 * 座標が発音域に収まる候補の一覧を返す。
 *
 * 基準周波数に論理比を掛けた値を2の整数冪だけ移し、
 * 発音域に入る整数 `k` をすべて列挙する。周波数昇順
 *（`k` 昇順と同じ）に並べる。
 *
 * @param point - 格子点。範囲内であること。
 * @param dimension - 選択次元。
 * @returns 発音域に収まる候補の一覧。空にはならない。
 * @throws `Error` — 格子外の座標の場合。
 * @throws `RangeError` — 選択次元でない場合。
 */
export function soundingCandidatesFor(
  point: PitchGridPoint,
  dimension: PitchGridDimension,
): PitchGridSoundingCandidate[] {
  const ratio = logicalRatioFor(point, dimension);
  const key = pitchGridKey(point);
  // 対数比から k の範囲を絞り、周波数の両端比較で確定する。
  // 任意のしきい値による丸め補正は設けず、通常の数値比較だけを使う。
  const logRatio = Math.log2(ratio.numerator) - Math.log2(ratio.denominator);
  const minK = Math.ceil(-logRatio);
  const maxK = Math.floor(3 - logRatio);
  const candidates: PitchGridSoundingCandidate[] = [];
  for (let k = minK; k <= maxK; k += 1) {
    const frequency =
      ((PITCH_GRID_BASE_FREQUENCY_HZ * ratio.numerator) / ratio.denominator) * 2 ** k;
    if (frequency >= PITCH_GRID_SOUND_LOW_HZ && frequency <= PITCH_GRID_SOUND_HIGH_HZ) {
      candidates.push({ key, k, frequency });
    }
  }
  return candidates;
}

/**
 * 集合単位の配置結果の1声分。鍵と発音周波数の組。
 *
 * 全声仕様を作る材料であり、声の寿命や利得は含まない。
 */
export interface PitchGridAssignedVoice {
  /** 座標の鍵（`x,y` 形式）。 */
  readonly key: string;
  /** 配置で選ばれた発音周波数（Hz）。発音域に収まる。 */
  readonly frequency: number;
}

// 隣接間隔の目標の上限（オクターブ単位）。1/4オクターブ。
// 最短間隔の最大化に上限を設け、小集合が必要以上に拡散しないようにする。
const TARGET_GAP_OCTAVES = 0.25;

// 発音域 `[220, 1760]` はちょうど3オクターブであり、対数上の中心は
// 下端から1.5オクターブにある。下端と基準周波数は等しいため、
// 各候補の中心からの偏差（オクターブ単位）は論理比の対数と `k` だけから求まる。
// 基準周波数の対数と中心の対数を経由して差を取ると、仕様上同値の候補
// （例: 中央単音の `440Hz` と `880Hz`）が浮動小数点の丸めで同値にならなくなる。
// 基準周波数と下端の等しさは数学的に打ち消せるため、差だけの形に固定する。
// 前提: `PITCH_GRID_SOUND_LOW_HZ` と `PITCH_GRID_BASE_FREQUENCY_HZ` が等しく、
// 上端が下端の8倍（3オクターブ）であること。定数を変える場合はこの式を見直す。
const CENTER_OFFSET_OCTAVES = 1.5;

/** 配置の動的計画法で扱う候補1件分の内部表現。 */
interface PitchGridAssignCandidate {
  /** 固定座標順に並べた座標列の中の位置。 */
  readonly coordIndex: number;
  /** 2の整数冪の移動量。 */
  readonly k: number;
  /** 発音域に収まる周波数（Hz）。 */
  readonly frequency: number;
  /** 対数比（`log2(分子) − log2(分母)`）。間隔の算出に使う。 */
  readonly logRatio: number;
  /** 中央からの偏差の平方（第三目的の加算分）。 */
  readonly centerDeviationSquared: number;
  /** 全候補中の順位（周波数昇順、同値なら固定座標順、さらに `k` 昇順）。 */
  rank: number;
}

/** 第一段で扱う到達状態の内部表現。 */
interface PitchGridBottleneckState {
  /** 選択済み座標の集合（固定座標順の位置のビット列）。 */
  readonly mask: number;
  /** 最後に選んだ候補の順位。 */
  readonly rank: number;
}

/** 第二段の動的計画法の状態1件分の内部表現。 */
interface PitchGridAssignEntry {
  /** 近さ（隣接間隔の目標からのずれの二乗和）の累積。 */
  readonly closeness: number;
  /** 中央からの偏差平方和の累積。 */
  readonly center: number;
  /** 一つ前の状態。初期状態では `null`。 */
  readonly prev: PitchGridAssignEntry | null;
  /** 最後に選んだ候補の順位。 */
  readonly rank: number;
  /** 選択済み座標の集合（固定座標順の位置のビット列）。 */
  readonly mask: number;
}

/**
 * オン集合単位で発音周波数の配置を求める。
 *
 * 論理比を変えず、2の整数冪の移動だけを使う。選んだ周波数を昇順に並べ、
 * 上限付き最短間隔（最小隣接間隔と1/4オクターブの小さい方）の最大化を
 * 第一目的、隣接間隔の目標からのずれの二乗和を第二目的、発音域の対数上の
 * 中心からの偏差平方和を第三目的とし、さらに同値なら固定座標順の `k` 列の
 * 辞書順で小さい方を選ぶ。二段階の動的計画法で厳密解を求め、近似を使わない。
 *
 * 第一段で到達可能な最大の最短間隔から閾値を定め、第二段はその閾値を満たす
 * 遷移だけに限る。状態は選択済み座標集合と最後の候補とし、順位の低い方から
 * 遷移を確定する。比較・加算の順序は入力順に依存しないため、処理順・
 * 操作履歴が結果を変えない。浮動小数点は有限値を前提に固定式・固定加算順で
 * 通常の数値比較とし、任意のしきい値による「ほぼ同値」を設けない
 * （単一候補初期の `+∞` を除く）。
 *
 * @param points - オン集合の座標列。順序は結果に影響しない。
 * @param dimension - 選択次元。
 * @returns 固定座標順に並べた鍵と発音周波数の一覧。空集合には空の一覧を返す。
 * @throws `Error` — 格子外の座標や重複した座標がある場合。
 * @throws `RangeError` — 選択次元でない場合。
 */
export function assignPitchGridFrequencies(
  points: readonly PitchGridPoint[],
  dimension: PitchGridDimension,
): PitchGridAssignedVoice[] {
  // 空集合でも次元の正当性は先に確かめる。不正ならここで拒む。
  verticalPrimeFor(dimension);
  const ordered = sortPoints(points);
  const keys = new Set<string>();
  for (const point of ordered) {
    const key = pitchGridKey(point);
    if (keys.has(key)) {
      throw new Error(`重複した座標である: ${key}`);
    }
    keys.add(key);
  }
  if (ordered.length === 0) {
    return [];
  }
  // 格子は15点までであり、異なる有効な座標は15通りしかないため、
  // ここでの集合はビット列で表せる。範囲外の座標は論理比の算出で拒む。
  const count = ordered.length;
  const logRatios: number[] = [];
  const perCoord: PitchGridAssignCandidate[][] = [];
  const all: PitchGridAssignCandidate[] = [];
  for (let index = 0; index < count; index += 1) {
    const point = ordered[index];
    const ratio = logicalRatioFor(point, dimension);
    const logRatio = Math.log2(ratio.numerator) - Math.log2(ratio.denominator);
    logRatios.push(logRatio);
    const list: PitchGridAssignCandidate[] = [];
    for (const candidate of soundingCandidatesFor(point, dimension)) {
      const deviation = logRatio + candidate.k - CENTER_OFFSET_OCTAVES;
      const entry: PitchGridAssignCandidate = {
        coordIndex: index,
        k: candidate.k,
        frequency: candidate.frequency,
        logRatio,
        centerDeviationSquared: deviation * deviation,
        rank: -1,
      };
      list.push(entry);
      all.push(entry);
    }
    perCoord.push(list);
  }
  // 候補順は周波数昇順、同値なら固定座標順、さらに `k` 昇順とする。
  all.sort(
    (a, b) =>
      a.frequency - b.frequency || a.coordIndex - b.coordIndex || a.k - b.k,
  );
  for (let rank = 0; rank < all.length; rank += 1) {
    all[rank].rank = rank;
  }
  const total = all.length;
  const byRank: PitchGridAssignCandidate[] = [...all].sort((a, b) => a.rank - b.rank);

  // 候補対の隣接間隔を一度だけ計算し、両段で共有する。
  // 隣接間隔は論理比同士の比と両候補の `k` の差から求める対数間隔とし、
  // 絶対周波数同士の除算では求めない。
  // 将来同値の候補が出た場合は間隔ゼロとして評価し、一声にまとめない。
  // 遷移は順位の低い方から高い方への向きだけを使う。
  const gaps: number[][] = Array.from({ length: total }, () => new Array<number>(total).fill(0));
  for (let low = 0; low < total; low += 1) {
    const last = byRank[low];
    for (let high = low + 1; high < total; high += 1) {
      const next = byRank[high];
      gaps[low][high] =
        next.frequency === last.frequency
          ? 0
          : next.logRatio - last.logRatio + (next.k - last.k);
    }
  }

  // 経路の `k` 列を固定座標順に復元する。通常の比較では呼ばず、
  // 近さ・中央偏差が同値の経路の比較にだけ使う。
  const columnOf = (entry: PitchGridAssignEntry): number[] => {
    const column = new Array<number>(count).fill(Number.NaN);
    let current: PitchGridAssignEntry | null = entry;
    while (current !== null) {
      const candidate = byRank[current.rank];
      column[candidate.coordIndex] = candidate.k;
      current = current.prev;
    }
    return column;
  };
  // 比較順は近さ、中央偏差、固定座標順の `k` 列の辞書順（小さい方）とする。
  // 未選択の位置は両経路とも `NaN` であり、大小比較では等しく扱われる。
  const isBetter = (next: PitchGridAssignEntry, current: PitchGridAssignEntry): boolean => {
    if (next.closeness !== current.closeness) {
      return next.closeness < current.closeness;
    }
    if (next.center !== current.center) {
      return next.center < current.center;
    }
    const nextColumn = columnOf(next);
    const currentColumn = columnOf(current);
    for (let index = 0; index < count; index += 1) {
      if (nextColumn[index] < currentColumn[index]) {
        return true;
      }
      if (currentColumn[index] < nextColumn[index]) {
        return false;
      }
    }
    return false;
  };

  // 第一段：上限付き最短間隔の最大化。到達経路の最大ボトルネックを保持する。
  // 単一候補は `+∞` から開始し、遷移値は `min(現在値, gap)` とする。
  // 遷移先は必ず高い順位のため、順位の低い方から確定すれば到達値が出そろう。
  const bottleneckOf = new Map<number, number>();
  const bottleneckBuckets: PitchGridBottleneckState[][] = Array.from(
    { length: total },
    () => [],
  );
  for (const candidate of all) {
    const mask = 1 << candidate.coordIndex;
    bottleneckOf.set(mask * total + candidate.rank, Number.POSITIVE_INFINITY);
    bottleneckBuckets[candidate.rank].push({ mask, rank: candidate.rank });
  }
  const settledFirst = new Set<number>();
  for (let rank = 0; rank < total; rank += 1) {
    for (const state of bottleneckBuckets[rank]) {
      const key = state.mask * total + state.rank;
      if (settledFirst.has(key)) {
        continue;
      }
      settledFirst.add(key);
      const current = bottleneckOf.get(key);
      if (current === undefined) {
        continue;
      }
      for (let index = 0; index < count; index += 1) {
        if ((state.mask & (1 << index)) !== 0) {
          continue;
        }
        for (const next of perCoord[index]) {
          if (next.rank <= rank) {
            continue;
          }
          const value = Math.min(current, gaps[rank][next.rank]);
          const nextKey = (state.mask | (1 << index)) * total + next.rank;
          const kept = bottleneckOf.get(nextKey);
          if (kept === undefined || value > kept) {
            bottleneckOf.set(nextKey, value);
            bottleneckBuckets[next.rank].push({ mask: state.mask | (1 << index), rank: next.rank });
          }
        }
      }
    }
  }
  const fullMask = (1 << count) - 1;
  let bottleneckStar = Number.NEGATIVE_INFINITY;
  for (const candidate of all) {
    const value = bottleneckOf.get(fullMask * total + candidate.rank);
    if (value !== undefined && value > bottleneckStar) {
      bottleneckStar = value;
    }
  }
  if (bottleneckStar === Number.NEGATIVE_INFINITY) {
    throw new Error('発音配置が求まらない');
  }
  // 閾値は到達可能な最大の最短間隔と目標の小さい方とする。
  // 単音では隣接間隔がなく `+∞` のため目標そのものになる。
  const threshold = Math.min(bottleneckStar, TARGET_GAP_OCTAVES);

  const states = new Map<number, PitchGridAssignEntry>();
  const buckets: PitchGridAssignEntry[][] = Array.from({ length: total }, () => []);
  // 単一候補を初期状態とし、近さゼロ、中央偏差にその候補の
  // 中央からの偏差の平方を加える。
  for (const candidate of all) {
    const mask = 1 << candidate.coordIndex;
    const entry: PitchGridAssignEntry = {
      closeness: 0,
      center: candidate.centerDeviationSquared,
      prev: null,
      rank: candidate.rank,
      mask,
    };
    states.set(mask * total + candidate.rank, entry);
    buckets[candidate.rank].push(entry);
  }
  // 第二段：閾値を満たす遷移だけを許す加算の動的計画法。
  // 順位の低い方から遷移を確定する。遷移先は必ず高い順位のため、
  // その順位の処理時点では到達経路が出そろっている。
  for (let rank = 0; rank < total; rank += 1) {
    for (const entry of buckets[rank]) {
      if (states.get(entry.mask * total + entry.rank) !== entry) {
        continue;
      }
      for (let index = 0; index < count; index += 1) {
        if ((entry.mask & (1 << index)) !== 0) {
          continue;
        }
        for (const next of perCoord[index]) {
          if (next.rank <= rank) {
            continue;
          }
          const gap = gaps[rank][next.rank];
          if (gap < threshold) {
            continue;
          }
          const diff = gap - TARGET_GAP_OCTAVES;
          const mask = entry.mask | (1 << index);
          const key = mask * total + next.rank;
          const relaxed: PitchGridAssignEntry = {
            closeness: entry.closeness + diff * diff,
            center: entry.center + next.centerDeviationSquared,
            prev: entry,
            rank: next.rank,
            mask,
          };
          const current = states.get(key);
          if (current === undefined || isBetter(relaxed, current)) {
            states.set(key, relaxed);
            buckets[next.rank].push(relaxed);
          }
        }
      }
    }
  }
  let best: PitchGridAssignEntry | null = null;
  for (const entry of states.values()) {
    if (entry.mask !== fullMask) {
      continue;
    }
    if (best === null || isBetter(entry, best)) {
      best = entry;
    }
  }
  if (best === null) {
    throw new Error('発音配置が求まらない');
  }
  // 全座標を選んだ状態の経路は座標数と同じ段数であり、各座標の候補を一つずつ持つ。
  const picked = new Array<PitchGridAssignCandidate | undefined>(count);
  let current: PitchGridAssignEntry | null = best;
  while (current !== null) {
    const candidate = byRank[current.rank];
    picked[candidate.coordIndex] = candidate;
    current = current.prev;
  }
  return ordered.map((point, index) => {
    const candidate = picked[index];
    if (candidate === undefined) {
      throw new Error('発音配置の復元に失敗した');
    }
    return { key: pitchGridKey(point), frequency: candidate.frequency };
  });
}

/**
 * 格子15点のすべてを返す。
 *
 * @returns 上段・左から並んだ15点。中央 `(0, 0)` を含む。
 */
export function allPitchGridPoints(): PitchGridPoint[] {
  const points: PitchGridPoint[] = [];
  for (let y = PITCH_GRID_Y_MAX; y >= PITCH_GRID_Y_MIN; y -= 1) {
    for (let x = PITCH_GRID_X_MIN; x <= PITCH_GRID_X_MAX; x += 1) {
      points.push({ x, y });
    }
  }
  return points;
}

/**
 * 集合全体を平行移動した結果を返す。
 *
 * 移動先を先に判定し、一つでも格子外へ出る場合は集合全体を
 * 移動しない。重なった座標を固定点として特別扱いしない。
 * 空集合は移動しない。
 *
 * @param points - 移動前の集合。
 * @param dx - 横方向の移動量。`-1…1` の整数。
 * @param dy - 縦方向の移動量。`-1…1` の整数。両方が0ではならない。
 * @returns 全点が収まる場合は移動後の集合、格子外へ出る・空集合の場合は `null`。
 * @throws `RangeError` — 移動量が八方向のいずれでもない場合。
 */
export function shiftPitchGridPoints(
  points: readonly PitchGridPoint[],
  dx: number,
  dy: number,
): PitchGridPoint[] | null {
  if (!Number.isInteger(dx) || !Number.isInteger(dy) || dx < -1 || dx > 1 || dy < -1 || dy > 1) {
    throw new RangeError(`移動量は-1…1の整数であること: (${String(dx)}, ${String(dy)})`);
  }
  if (dx === 0 && dy === 0) {
    throw new RangeError('移動量が0の操作は八方向のいずれでもない');
  }
  if (points.length === 0) {
    return null;
  }
  const shifted = points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
  if (!shifted.every(isInPitchGrid)) {
    return null;
  }
  return shifted;
}

/** オン集合の快照。値は読み取り専用とする。 */
export interface PitchGridSnapshot {
  /** 選択次元。 */
  readonly dimension: PitchGridDimension;
  /** オンの座標。上段・左からの順序。 */
  readonly points: readonly PitchGridPoint[];
}

/** 選択次元とオン集合を所有する状態。音声への反映は担わない。 */
export interface PitchGridState {
  /** 現在の快照を返す。 */
  getSnapshot(): PitchGridSnapshot;
  /**
   * 指定した点のオン・オフを切り替える。
   *
   * @param point - 操作した格子点。範囲内であること。
   * @returns 切替後の快照。
   * @throws `Error` — 格子外の座標の場合。状態は変えない。
   */
  toggle(point: PitchGridPoint): PitchGridSnapshot;
  /**
   * オン集合全体を八方向へ1マス移動する。
   *
   * @param dx - 横方向の移動量。`-1…1` の整数。
   * @param dy - 縦方向の移動量。`-1…1` の整数。両方が0ではならない。
   * @returns 適用可否と移動後の快照。格子外へ出る・空集合の場合は適用せず、集合は変わらない。
   * @throws `RangeError` — 移動量が八方向のいずれでもない場合。状態は変えない。
   */
  move(dx: number, dy: number): { readonly applied: boolean; readonly snapshot: PitchGridSnapshot };
  /**
   * 縦軸の次元を選び直す。
   *
   * 切替ではオン集合を保ち、選択次元だけを更新する。
   * 同じ次元の選び直しは何もしない。
   *
   * @param dimension - 選択次元。
   * @returns 切替の有無と切替後の快照。
   * @throws `RangeError` — 選択次元でない場合。状態は変えない。
   */
  selectDimension(dimension: PitchGridDimension): {
    readonly changed: boolean;
    readonly snapshot: PitchGridSnapshot;
  };
}

function sortPoints(points: Iterable<PitchGridPoint>): PitchGridPoint[] {
  return [...points].sort((a, b) => b.y - a.y || a.x - b.x);
}

/**
 * 選択次元とオン集合を所有する状態を作る。
 *
 * 音声への反映は担わず、集合の意味だけを保つ。発音の有無の
 * 判断（空集合の無発音など）は反映側がこの結果に従う。
 *
 * @param initialDimension - 初期の選択次元。省略時は3次元。
 * @returns 親操作部品の存続中は使い回す状態。
 */
export function createPitchGridState(
  initialDimension: PitchGridDimension = 3,
): PitchGridState {
  if (!isPitchGridDimension(initialDimension)) {
    throw new RangeError(`縦軸の次元は3・4・5のいずれかであること: ${String(initialDimension)}`);
  }
  let dimension = initialDimension;
  const onPoints = new Map<string, PitchGridPoint>();

  const snapshot = (): PitchGridSnapshot => ({ dimension, points: sortPoints(onPoints.values()) });

  return {
    getSnapshot(): PitchGridSnapshot {
      return snapshot();
    },
    toggle(point: PitchGridPoint): PitchGridSnapshot {
      if (!isInPitchGrid(point)) {
        throw new Error(`格子外の座標である: (${String(point.x)}, ${String(point.y)})`);
      }
      const key = pitchGridKey(point);
      if (onPoints.has(key)) {
        onPoints.delete(key);
      } else {
        onPoints.set(key, { x: point.x, y: point.y });
      }
      return snapshot();
    },
    move(dx: number, dy: number): { readonly applied: boolean; readonly snapshot: PitchGridSnapshot } {
      const shifted = shiftPitchGridPoints([...onPoints.values()], dx, dy);
      if (shifted === null) {
        return { applied: false, snapshot: snapshot() };
      }
      onPoints.clear();
      for (const point of shifted) {
        onPoints.set(pitchGridKey(point), point);
      }
      return { applied: true, snapshot: snapshot() };
    },
    selectDimension(
      next: PitchGridDimension,
    ): { readonly changed: boolean; readonly snapshot: PitchGridSnapshot } {
      if (!isPitchGridDimension(next)) {
        throw new RangeError(`縦軸の次元は3・4・5のいずれかであること: ${String(next)}`);
      }
      if (next === dimension) {
        return { changed: false, snapshot: snapshot() };
      }
      dimension = next;
      return { changed: true, snapshot: snapshot() };
    },
  };
}
