/**
 * 格子点の座標・論理比・発音周波数とオン集合の状態遷移。
 *
 * 横 `-2…2`・縦 `-1…1` の15点を範囲とし、横軸の素数を `3`、
 * 縦軸の素数を選択次元に応じ `5`・`7`・`11` とする。
 * 座標 `(x, y)` の論理比 `3^x p^y` は関係として保持し、
 * 発音周波数は基準周波数からの比を2の整数冪だけ移して
 * `[220, 440) Hz` に収める。論理比と発音用配置を混同しない。
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

/** 発音周波数の収容区間の上端（Hz）。この値は含まない。 */
export const PITCH_GRID_SOUND_HIGH_HZ = 440;

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
 * 座標の発音周波数を返す。
 *
 * 基準周波数に論理比を掛けた値を2の整数冪だけ移し、
 * `[220, 440) Hz` に収める。論理比そのものは変えず、
 * 発音用配置だけを求める。
 *
 * @param point - 格子点。範囲内であること。
 * @param dimension - 選択次元。
 * @param baseFrequency - 基準周波数（Hz）。正の有限値。省略時は暫定設計値。
 * @returns 収容区間に収めた発音周波数（Hz）。
 * @throws `Error` — 格子外の座標の場合。
 * @throws `RangeError` — 選択次元でない、基準周波数が正の有限値でない場合。
 */
export function soundingFrequencyFor(
  point: PitchGridPoint,
  dimension: PitchGridDimension,
  baseFrequency: number = PITCH_GRID_BASE_FREQUENCY_HZ,
): number {
  const ratio = logicalRatioFor(point, dimension);
  if (!Number.isFinite(baseFrequency) || baseFrequency <= 0) {
    throw new RangeError(`基準周波数は正の有限値であること: ${String(baseFrequency)}`);
  }
  let frequency = (baseFrequency * ratio.numerator) / ratio.denominator;
  while (frequency < PITCH_GRID_SOUND_LOW_HZ) {
    frequency *= 2;
  }
  while (frequency >= PITCH_GRID_SOUND_HIGH_HZ) {
    frequency /= 2;
  }
  return frequency;
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
