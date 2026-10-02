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
 * 音声文脈や声の寿命は扱わず、発音側（`pitchGridSound`）や
 * 操作の組み立てから分離する。
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
  // 論理比が1の点では `-logRatio` が `-0` になり `Math.ceil` が `-0` を返すため、
  // 整数の配置指数に `-0` が混ざらないよう `+0` に正規化する（`k === 0` は `-0` でも真）。
  const startK = minK === 0 ? 0 : minK;
  for (let k = startK; k <= maxK; k += 1) {
    const frequency =
      ((PITCH_GRID_BASE_FREQUENCY_HZ * ratio.numerator) / ratio.denominator) * 2 ** k;
    if (frequency >= PITCH_GRID_SOUND_LOW_HZ && frequency <= PITCH_GRID_SOUND_HIGH_HZ) {
      candidates.push({ key, k, frequency });
    }
  }
  return candidates;
}

/**
 * 集合単位の配置結果の1声分。鍵と発音周波数と配置指数の組。
 *
 * 全声仕様を作る材料であり、声の寿命や利得は含まない。
 * `k` は復元済みの選択候補の値をそのまま返し、再計算しない。
 */
export interface PitchGridAssignedVoice {
  /** 座標の鍵（`x,y` 形式）。 */
  readonly key: string;
  /** 配置で選ばれた発音周波数（Hz）。発音域に収まる。 */
  readonly frequency: number;
  /** 素数2の指数の整数。候補列挙の `k` をそのまま返す。 */
  readonly k: number;
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
    // 配置指数は復元済みの選択候補の値をそのまま返し、逆算や選び直しはしない。
    return { key: pitchGridKey(point), frequency: candidate.frequency, k: candidate.k };
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

/**
 * 機能根の由来。操作意図の履歴であり、音高の意味ではない。
 *
 * `default` は初回オン・選び直しによる既定根、`visitor` は訪問者の明示指定、
 * `unknown` は由来がない旧値を読んだときの補完である。通常操作では生成しない。
 * 空集合では根と由来を持たないため `null` とする。
 */
export type PitchGridFunctionalRootSource = 'default' | 'visitor' | 'unknown';

/**
 * 共有する演奏意図。選択次元・オンの格子点集合・機能根の座標鍵と由来を載せる。
 *
 * 発振器や実際に鳴っている声は載せず、各端末に残す。
 * `onPoints` は重複を除き固定座標順（`y` 降順、次いで `x` 昇順）に
 * 正規化した座標鍵（`x,y` 形式）の配列とし、直列化できる形にする。
 * `Map` は載せない。`functionalRootKey` はオン点のいずれかの座標鍵だけを
 * 取り、空のときだけ未指定（`null`）とする。オン集合が空でない間は
 * 機能根を常に定める。`functionalRootSource` は根の由来であり、
 * 空のときだけ `null` とする。由来は表示だけに使い、
 * `SemanticChord` には入れない。指定モード（選択中であること）は
 * 各端末に置き、確定した根の座標鍵と由来だけを共有する。
 */
export interface PitchGridIntent {
  /** 選択次元。 */
  readonly dimension: PitchGridDimension;
  /** 正規化した座標鍵の配列。固定座標順に並ぶ。 */
  readonly onPoints: readonly string[];
  /** 機能根の座標鍵。空のときだけ `null`。 */
  readonly functionalRootKey: string | null;
  /** 根の由来。空のときだけ `null`。 */
  readonly functionalRootSource: PitchGridFunctionalRootSource | null;
}

/**
 * 共有意図の状態識別子。ワールド・インスタンス内で一意にする。
 *
 * 格子15点分の識別子に分けず、一つの識別子に選択次元とオン点列を載せる。
 */
export const PITCH_GRID_INTENT_STATE_ID = 'pitch-grid-intent';

/** 共有意図の初期値。何も選んでいない3次元の状態。 */
export const PITCH_GRID_INITIAL_INTENT: PitchGridIntent = {
  dimension: 3,
  onPoints: [],
  functionalRootKey: null,
  functionalRootSource: null,
};

/**
 * 座標鍵を格子点へ読み替える。
 *
 * @param key - 判定対象。共有機構から届いた値も受け付ける。
 * @returns 範囲内の整数座標を表す場合だけ格子点、そうでなければ `null`。
 */
export function pitchGridPointFromKey(key: unknown): PitchGridPoint | null {
  if (typeof key !== 'string' || !/^-?\d+,-?\d+$/.test(key)) {
    return null;
  }
  const separator = key.indexOf(',');
  const point = { x: Number(key.slice(0, separator)), y: Number(key.slice(separator + 1)) };
  return isInPitchGrid(point) ? point : null;
}

function sortPoints(points: Iterable<PitchGridPoint>): PitchGridPoint[] {
  return [...points].sort((a, b) => b.y - a.y || a.x - b.x);
}

// 座標鍵の列を正規化する。鍵でない要素と格子外の座標を落とし、
// 重複を除き固定座標順に並べる。共有値の読み替えと遷移の前提整えで共有し、
// 処理順・操作履歴が結果を変えないようにする。
function normalizePitchGridKeys(keys: readonly unknown[]): string[] {
  const points = new Map<string, PitchGridPoint>();
  for (const key of keys) {
    const point = pitchGridPointFromKey(key);
    if (point === null) {
      continue;
    }
    const canonical = pitchGridKey(point);
    if (!points.has(canonical)) {
      points.set(canonical, point);
    }
  }
  return sortPoints(points.values()).map(pitchGridKey);
}

/**
 * 機能根の由来として扱える値を判定する。
 *
 * @param value - 判定対象。共有機構から届いた値も受け付ける。
 * @returns `default`・`visitor`・`unknown` のいずれかの場合だけ `true`。
 */
function isFunctionalRootSource(value: unknown): value is PitchGridFunctionalRootSource {
  return value === 'default' || value === 'visitor' || value === 'unknown';
}

/**
 * 共有機構から届いた値を演奏意図として読み替える。
 *
 * 共有値は他端末の書き込みであり、型どおりとは限らないため、
 * 境界で実行時に確かめて正規化する。次元が不正なら初期次元（3次元）に倒し、
 * 鍵でない要素と格子外の座標は落とす。非空で根が欠落・不正・集合外なら
 * 正規化したオン列の先頭を由来 `default` として補完し、根は有効だが
 * 由来がない旧値は `unknown` として補完する。空なら根と由来を除く。
 * 読み替えだけを行い、共有値への書き戻しはしない。
 *
 * @param value - 共有機構から届いた値。
 * @returns 正規化した演奏意図。
 */
export function resolvePitchGridIntent(value: unknown): PitchGridIntent {
  if (typeof value !== 'object' || value === null) {
    return { ...PITCH_GRID_INITIAL_INTENT };
  }
  const record = value as {
    readonly dimension?: unknown;
    readonly onPoints?: unknown;
    readonly functionalRootKey?: unknown;
    readonly functionalRootSource?: unknown;
  };
  const dimension = isPitchGridDimension(record.dimension) ? record.dimension : 3;
  const raw = Array.isArray(record.onPoints) ? record.onPoints : [];
  const onPoints = normalizePitchGridKeys(raw);
  if (onPoints.length === 0) {
    return { dimension, onPoints, functionalRootKey: null, functionalRootSource: null };
  }
  // 鍵生成は点→鍵の既存の扱いに寄せ、独自形式を新設しない。
  const rootPoint = pitchGridPointFromKey(record.functionalRootKey);
  const rootKey = rootPoint === null ? null : pitchGridKey(rootPoint);
  if (rootKey !== null && onPoints.includes(rootKey)) {
    // 根は有効だが由来がない旧値は `unknown` とし、通常操作では生成しない。
    const source = isFunctionalRootSource(record.functionalRootSource)
      ? record.functionalRootSource
      : 'unknown';
    return { dimension, onPoints, functionalRootKey: rootKey, functionalRootSource: source };
  }
  const head = onPoints[0] ?? null;
  if (head === null) {
    return { dimension, onPoints, functionalRootKey: null, functionalRootSource: null };
  }
  return { dimension, onPoints, functionalRootKey: head, functionalRootSource: 'default' };
}

/**
 * 演奏意図を表示・反映用の快照へ読み替える。
 *
 * 共有値は境界で確かめて正規化してから座標へ戻す。座標の順序は
 * 固定座標順（`y` 降順、次いで `x` 昇順）になる。
 *
 * @param value - 共有機構から届いた値または演奏意図。
 * @returns 選択次元とオンの座標列。
 */
export function pitchGridSnapshotFromIntent(value: unknown): PitchGridSnapshot {
  const intent = resolvePitchGridIntent(value);
  const points: PitchGridPoint[] = [];
  for (const key of intent.onPoints) {
    const point = pitchGridPointFromKey(key);
    if (point !== null) {
      points.push(point);
    }
  }
  return { dimension: intent.dimension, points };
}

/**
 * 共有値への純粋な切替遷移。
 *
 * `useInstanceState` の関数型更新へ渡す。前提が正規化されていない場合も
 * 読み替えてから遷移し、同時操作の取りこぼし（後に届いた書き込みが残る）は
 * 許容する。発音の有無の判断（空集合の無発音など）は反映側が結果に従う。
 * 空集合から点をオンにしたらその点を既定根（由来 `default`）とし、
 * 根以外のオン・オフでは現在の根と由来を保ち、根をオフにし残りがある
 * 場合は残りの先頭を既定根とし、最後の点をオフにしたら根と由来を除く。
 * 解除操作は設けず、選び直しはこの遷移が担う。
 *
 * @param prev - 遷移前の共有値。正規化されていない場合も読み替える。
 * @param point - 操作した格子点。範囲内であること。
 * @returns 切替後の演奏意図。
 * @throws `Error` — 格子外の座標の場合。共有値は変えない。
 */
export function togglePitchGridIntent(
  prev: PitchGridIntent,
  point: PitchGridPoint,
): PitchGridIntent {
  if (!isInPitchGrid(point)) {
    throw new Error(`格子外の座標である: (${String(point.x)}, ${String(point.y)})`);
  }
  const base = resolvePitchGridIntent(prev);
  const key = pitchGridKey(point);
  const next = base.onPoints.includes(key)
    ? base.onPoints.filter((entry) => entry !== key)
    : [...base.onPoints, key];
  const onPoints = normalizePitchGridKeys(next);
  if (onPoints.length === 0) {
    return { dimension: base.dimension, onPoints, functionalRootKey: null, functionalRootSource: null };
  }
  if (base.onPoints.length === 0) {
    return {
      dimension: base.dimension,
      onPoints,
      functionalRootKey: key,
      functionalRootSource: 'default',
    };
  }
  if (
    base.functionalRootKey !== null &&
    base.functionalRootSource !== null &&
    onPoints.includes(base.functionalRootKey)
  ) {
    return {
      dimension: base.dimension,
      onPoints,
      functionalRootKey: base.functionalRootKey,
      functionalRootSource: base.functionalRootSource,
    };
  }
  const head = onPoints[0] ?? null;
  if (head === null) {
    return { dimension: base.dimension, onPoints, functionalRootKey: null, functionalRootSource: null };
  }
  return {
    dimension: base.dimension,
    onPoints,
    functionalRootKey: head,
    functionalRootSource: 'default',
  };
}

/**
 * 共有値への純粋な八方向移動遷移。
 *
 * `useInstanceState` の関数型更新へ渡す。移動先を先に判定し、一つでも
 * 格子外へ出る場合と空集合の場合は遷移前の値をそのまま返し、
 * 共有値を実質的に変えない。重なった座標を固定点として特別扱いしない。
 * 機能根の座標鍵も集合と同じだけ移動し、由来は保つ。移動は集合全体で行うか
 * 行わないかのいずれかのため、移動後の根は常にオン集合内に収まる。
 *
 * @param prev - 遷移前の共有値。正規化されていない場合も読み替える。
 * @param dx - 横方向の移動量。`-1…1` の整数。
 * @param dy - 縦方向の移動量。`-1…1` の整数。両方が0ではならない。
 * @returns 移動後の演奏意図。適用できない場合は遷移前の値そのもの。
 * @throws `RangeError` — 移動量が八方向のいずれでもない場合。共有値は変えない。
 */
export function movePitchGridIntent(
  prev: PitchGridIntent,
  dx: number,
  dy: number,
): PitchGridIntent {
  const base = resolvePitchGridIntent(prev);
  // 正規化済みの鍵は読み替えが必ず成功する。不正な共有値は
  // `resolvePitchGridIntent` が先に落としており、ここに残らない。
  const points: PitchGridPoint[] = [];
  for (const key of base.onPoints) {
    const point = pitchGridPointFromKey(key);
    if (point !== null) {
      points.push(point);
    }
  }
  const shifted = shiftPitchGridPoints(points, dx, dy);
  if (shifted === null) {
    return prev;
  }
  const rootPoint =
    base.functionalRootKey === null ? null : pitchGridPointFromKey(base.functionalRootKey);
  return {
    dimension: base.dimension,
    onPoints: normalizePitchGridKeys(shifted.map(pitchGridKey)),
    functionalRootKey:
      rootPoint === null ? null : pitchGridKey({ x: rootPoint.x + dx, y: rootPoint.y + dy }),
    functionalRootSource: rootPoint === null ? null : base.functionalRootSource,
  };
}

/**
 * 共有値への純粋な次元選択遷移。
 *
 * `useInstanceState` の関数型更新へ渡す。切替ではオン点列と機能根の
 * 座標鍵と由来を保ち、選択次元だけを更新する。保つのは選ばれたオン点の座標と
 * 役割であり、周波数や音程意味の不変性ではない。全員の選択次元を変える
 * 一括操作であり、座標ごとの所有は持たない。同じ次元の選び直しは
 * 遷移前の値をそのまま返す。
 *
 * @param prev - 遷移前の共有値。正規化されていない場合も読み替える。
 * @param dimension - 選択次元。
 * @returns 切替後の演奏意図。同じ次元の場合は遷移前の値そのもの。
 * @throws `RangeError` — 選択次元でない場合。共有値は変えない。
 */
export function selectPitchGridDimensionIntent(
  prev: PitchGridIntent,
  dimension: PitchGridDimension,
): PitchGridIntent {
  if (!isPitchGridDimension(dimension)) {
    throw new RangeError(`縦軸の次元は3・4・5のいずれかであること: ${String(dimension)}`);
  }
  const base = resolvePitchGridIntent(prev);
  if (base.dimension === dimension) {
    return prev;
  }
  return {
    dimension,
    onPoints: base.onPoints,
    functionalRootKey: base.functionalRootKey,
    functionalRootSource: base.functionalRootSource,
  };
}

/**
 * 共有値への純粋な機能根指定遷移。
 *
 * `useInstanceState` の関数型更新へ渡す。オン点のいずれかの座標鍵だけを
 * 指定でき、由来を `visitor` とする。既定根と同じ点の再指定でも `visitor`
 * とする。同じ指定根の選び直しは遷移前の値をそのまま返す。
 *
 * @param prev - 遷移前の共有値。正規化されていない場合も読み替える。
 * @param point - 機能根にする格子点。オンの点であること。
 * @returns 指定後の演奏意図。同じ指定根の場合は遷移前の値そのもの。
 * @throws `Error` — 格子外の座標の場合。共有値は変えない。
 * @throws `Error` — オンでない点の場合。共有値は変えない。
 */
export function specifyFunctionalRootIntent(
  prev: PitchGridIntent,
  point: PitchGridPoint,
): PitchGridIntent {
  if (!isInPitchGrid(point)) {
    throw new Error(`格子外の座標である: (${String(point.x)}, ${String(point.y)})`);
  }
  const base = resolvePitchGridIntent(prev);
  const key = pitchGridKey(point);
  if (!base.onPoints.includes(key)) {
    throw new Error(`オンでない点は機能根に指定できない: ${key}`);
  }
  if (base.functionalRootKey === key && base.functionalRootSource === 'visitor') {
    return prev;
  }
  return {
    dimension: base.dimension,
    onPoints: base.onPoints,
    functionalRootKey: key,
    functionalRootSource: 'visitor',
  };
}
