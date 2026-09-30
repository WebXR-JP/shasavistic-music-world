/**
 * 和音図の線構造プレビューのための純粋な表示写像。
 *
 * オン集合の論理高さ（オクターブ単位・折り返しなし）から、主音線・
 * 1次元譜線・2次元譜線・各オン点の音高線・機能根からの次元線区間までを
 * 論理区間として求める。区間の軸と音高線の左短縮識別は、描画側の
 * 左右端割当てと左短縮の根拠とする。Canvas・React・音声・
 * THREE に依存しない。発音周波数と2の冪の折り返しは扱わない。
 *
 * 方式の正本は `workflow/design/shasavistic-music-lab/pitch-grid/chord-diagram.md`
 * とし、具体値と合否は `chordDiagramLayout.test.ts` に置く。
 *
 * @packageDocumentation
 */

import {
  isInPitchGrid,
  isPitchGridDimension,
  pitchGridKey,
  type PitchGridDimension,
  type PitchGridPoint,
} from '../../audio/pitchGrid';

/** 横一歩の論理高さ `a = log2(3/2)`（オクターブ単位）。 */
export const CHORD_DIAGRAM_HORIZONTAL_STEP = Math.log2(3 / 2);

/**
 * 次元ごとの縦一歩の論理高さ（オクターブ単位）。
 *
 * 3次元は `log2(5/4)`、4次元は `log2(7/4)`、5次元は `log2(11/8)` とする。
 */
export const CHORD_DIAGRAM_VERTICAL_STEPS: Readonly<Record<PitchGridDimension, number>> = {
  3: Math.log2(5 / 4),
  4: Math.log2(7 / 4),
  5: Math.log2(11 / 8),
};

/**
 * 次元の縦一歩の論理高さを返す。
 *
 * @param dimension - 選択次元。3・4・5次元のいずれか。
 * @returns 対応する縦一歩（オクターブ単位）。
 * @throws `RangeError` — 選択次元でない場合。
 */
export function chordDiagramVerticalStepFor(dimension: PitchGridDimension): number {
  if (!isPitchGridDimension(dimension)) {
    throw new RangeError(`縦軸の次元は3・4・5のいずれかであること: ${String(dimension)}`);
  }
  return CHORD_DIAGRAM_VERTICAL_STEPS[dimension];
}

/**
 * 座標の論理高さ（オクターブ単位）を返す。
 *
 * `h_d(x,y) = x·a + y·b_d` とし、一歩ずつ足して最後に折り返さない。
 * 主音線を `h=0`、上方向正とする。
 *
 * @param point - 格子点。範囲内であること。
 * @param dimension - 選択次元。
 * @returns 論理高さ（オクターブ単位）。
 * @throws `Error` — 格子外の座標の場合。
 * @throws `RangeError` — 選択次元でない場合。
 */
export function chordDiagramHeight(
  point: PitchGridPoint,
  dimension: PitchGridDimension,
): number {
  if (!isInPitchGrid(point)) {
    throw new Error(`格子外の座標である: (${String(point.x)}, ${String(point.y)})`);
  }
  const verticalStep = chordDiagramVerticalStepFor(dimension);
  return point.x * CHORD_DIAGRAM_HORIZONTAL_STEP + point.y * verticalStep;
}

/** 次元線の軸。`x` は横（素数3方向・低次元）、`y` は縦（次元素数方向）。 */
export type ChordDiagramAxis = 'x' | 'y';

/**
 * 次元線の描画側の端。`x` 軸区間（2次元線）は音高線の左端、
 * `y` 軸区間（選択次元線）は音高線の右端に置く。
 */
export type ChordDiagramSegmentSide = 'left' | 'right';

/**
 * 次元線区間の軸から描画側の端を求める。
 *
 * 音高線の左右位置を上下で揃え、次元線を両端に固定する方式の根拠とする。
 *
 * @param axis - 次元線区間の軸。
 * @returns `x` 軸なら `'left'`、`y` 軸なら `'right'`。
 */
export function chordDiagramSegmentSide(axis: ChordDiagramAxis): ChordDiagramSegmentSide {
  return axis === 'x' ? 'left' : 'right';
}

/** 主音線。常に `h=0` に置き、中央基準は固定のため座標を持たない。 */
export interface ChordDiagramMainLine {
  /** 論理高さ。常に `0`。 */
  readonly height: 0;
}

/** 譜線1本。1次元譜と2次元譜で共通の形。 */
export interface ChordDiagramStaffLine {
  /** 目盛りの番号。1次元譜は整数 `n`、2次元譜は整数 `m`。 */
  readonly index: number;
  /** 論理高さ。1次元譜は `n`、2次元譜は `m·a`。 */
  readonly height: number;
}

/** オン点1点分の音高線。 */
export interface ChordDiagramPitchLine {
  /** 座標の鍵（`x,y` 形式）。 */
  readonly key: string;
  /** 格子点。 */
  readonly point: PitchGridPoint;
  /** 論理高さ（オクターブ単位）。 */
  readonly height: number;
  /** `h=0` で主音線と重なる場合だけ `true`。 */
  readonly overlapsMain: boolean;
  /** 機能根そのものである場合だけ `true`。根未指定時はすべて `false`。 */
  readonly isRoot: boolean;
  /**
   * 選択次元座標が0でない場合だけ `true`。
   * 描画側はこの音高線の左端を少し内側に詰める。機能根の有無・
   * 次元線区間の端点かは問わない。
   */
  readonly isLeftShortened: boolean;
}

/** 機能根からの次元線の区間1本。 */
export interface ChordDiagramSegment {
  /**
   * 安定した区間識別子。端点と軸だけから作り、入力順に依存しない。
   * 形式は `軸:始点鍵>終点鍵`（例: `x:0,0>2,0`）。
   */
  readonly id: string;
  /** 次元の軸。低次元優先の標準経路では `x` を先に進む。 */
  readonly axis: ChordDiagramAxis;
  /** 方向符号。軸の正方向へ進む場合 `1`、負方向へ進む場合 `-1`。 */
  readonly direction: 1 | -1;
  /** 歩数。1以上の整数。非隣接は分割せず長さ比例の一本にまとめる。 */
  readonly steps: number;
  /** 始点。根に近い側の端点。 */
  readonly from: PitchGridPoint;
  /** 終点。根から遠い側の端点。 */
  readonly to: PitchGridPoint;
  /** 始点の論理高さ（オクターブ単位）。 */
  readonly fromHeight: number;
  /** 終点の論理高さ（オクターブ単位）。 */
  readonly toHeight: number;
  /** 根からの順。根に近い区間から0始まりの連番。描画順の安定に使う。 */
  readonly orderFromRoot: number;
}

/** 和音図の線構造の配置結果。値は読み取り専用とする。 */
export interface ChordDiagramLayout {
  /** 選択次元。 */
  readonly dimension: PitchGridDimension;
  /** 横一歩の論理高さ `a`。 */
  readonly horizontalStep: number;
  /** 選択次元の縦一歩の論理高さ `b_d`。 */
  readonly verticalStep: number;
  /** 主音線。常に `h=0`。 */
  readonly mainLine: ChordDiagramMainLine;
  /**
   * 音高線高さの閉区間 `[L,U]`。オン点がない場合は `null`
   * （主音線のみを示す）。
   */
  readonly range: { readonly lower: number; readonly upper: number } | null;
  /** 1次元譜線。`h=0` を除き高さ昇順。オン点2つ未満では空。 */
  readonly staffLines1D: readonly ChordDiagramStaffLine[];
  /** 2次元譜線。`h=0` を除き高さ昇順。オン点2つ未満では空。 */
  readonly staffLines2D: readonly ChordDiagramStaffLine[];
  /** 各オン点の音高線。固定座標順（`y` 降順、次いで `x` 昇順）。 */
  readonly pitchLines: readonly ChordDiagramPitchLine[];
  /**
   * 次元線区間。根に近い順。機能根がない場合は空。
   * 共通区間は重複せず、根から根への自己区間は含まない。
   */
  readonly dimensionSegments: readonly ChordDiagramSegment[];
  /** 入力の機能根の写し。未指定時は `null`。 */
  readonly functionalRoot: PitchGridPoint | null;
  /** 機能根の指定有無。 */
  readonly rootSpecified: boolean;
  /**
   * 指定根がオン集合に含まれるか。未指定時は `false`。
   * 描画側は未指定（`rootSpecified` が `false`）と未接続
   * （指定ありで `rootOnPoint` が `false`）を区別する。
   */
  readonly rootOnPoint: boolean;
  /** オン点が0〜2点の場合だけ `true` の和音未成立判定。 */
  readonly chordUnformed: boolean;
}

/** 単位辺の内部表現。同じ辺の重複集計を除くために使う。 */
interface ChordDiagramUnitEdge {
  /** 次元の軸。 */
  readonly axis: ChordDiagramAxis;
  /** 軸に直交する座標（`x` 辺は `y`、`y` 辺は `x`）。 */
  readonly line: number;
  /** 辺の始点の軸方向座標。 */
  readonly start: number;
  /** 方向符号。 */
  readonly direction: 1 | -1;
}

/** 軸・直交座標・方向ごとの単位辺の集まりの内部表現。 */
interface ChordDiagramEdgeGroup {
  /** 次元の軸。 */
  readonly axis: ChordDiagramAxis;
  /** 軸に直交する座標。 */
  readonly line: number;
  /** 方向符号。 */
  readonly direction: 1 | -1;
  /** 辺の始点の軸方向座標の一覧。 */
  readonly starts: number[];
}

/** 順序付け前の区間の内部表現。 */
interface ChordDiagramRawSegment {
  /** 次元の軸。 */
  readonly axis: ChordDiagramAxis;
  /** 方向符号。 */
  readonly direction: 1 | -1;
  /** 始点。根に近い側の端点。 */
  readonly from: PitchGridPoint;
  /** 終点。根から遠い側の端点。 */
  readonly to: PitchGridPoint;
}

/**
 * 和音図の線構造の配置を求める。
 *
 * 入力は選択次元・オン点・任意の機能根とし、主音線・両譜線・各音高線・
 * 次元線区間の論理区間までを求める。区間の軸は描画側の左右端割当て
 * （`x` 軸=左端・`y` 軸=右端）の根拠とし、各音高線には選択次元座標が
 * 0でないかの識別（描画側の左短縮の根拠）を含める。
 * 中央基準は常に `(0,0)` 固定のため入力化しない。
 *
 * 次元線は機能根があるときだけ求め、根から各オン点へまず `x` 軸を
 * 必要歩数、次に `y` 軸の順（低次元優先）の標準経路とする。経路上の
 * 別のオン点で区切り、中間のオフ点は通す。連続同次元区間は一本にまとめ、
 * 共通区間は重複させない。
 *
 * @param dimension - 選択次元。3・4・5次元のいずれか。
 * @param onPoints - オン点の座標列。順序は結果に影響しない。
 * @param functionalRoot - 機能根。未指定時は `null`。
 * @returns 線構造の配置結果。
 * @throws `Error` — 格子外の座標や重複した座標、格子外の機能根がある場合。
 * @throws `RangeError` — 選択次元でない場合。
 */
export function layoutChordDiagram(
  dimension: PitchGridDimension,
  onPoints: readonly PitchGridPoint[],
  functionalRoot: PitchGridPoint | null,
): ChordDiagramLayout {
  const verticalStep = chordDiagramVerticalStepFor(dimension);
  const ordered = sortChordPoints(onPoints);
  if (functionalRoot !== null && !isInPitchGrid(functionalRoot)) {
    throw new Error(
      `格子外の機能根である: (${String(functionalRoot.x)}, ${String(functionalRoot.y)})`,
    );
  }
  const root = functionalRoot === null ? null : { x: functionalRoot.x, y: functionalRoot.y };
  const rootKey = root === null ? null : pitchGridKey(root);
  const onKeys = new Set(ordered.map(pitchGridKey));

  const heightOf = (point: PitchGridPoint): number =>
    point.x * CHORD_DIAGRAM_HORIZONTAL_STEP + point.y * verticalStep;

  const dimensionSegments =
    root === null ? [] : collectDimensionSegments(ordered, root, heightOf);

  // ADR: 選択次元座標（y）が 0 でないオン点だけを左短縮の対象とする。
  // y≠0 は選択次元の移動で到達した音と同義であり、次元線区間の端点か・
  // 機能根の有無は問わない。y=0 の点はフルサイズとする。
  const pitchLines: ChordDiagramPitchLine[] = ordered.map((point) => {
    const height = heightOf(point);
    const key = pitchGridKey(point);
    return {
      key,
      point,
      height,
      // ADR: 厳密な整数高さは (0,0) の h=0 だけであり（素因数分解の一意性による）、
      // 浮動小数点の丸めで他の点がちょうど 0 になることはないため、
      // 任意のしきい値による「ほぼ 0」判定は設けず厳密比較とする。
      overlapsMain: height === 0,
      isRoot: rootKey !== null && key === rootKey,
      isLeftShortened: point.y !== 0,
    };
  });

  let range: ChordDiagramLayout['range'] = null;
  if (pitchLines.length > 0) {
    let lower = pitchLines[0]?.height ?? 0;
    let upper = pitchLines[0]?.height ?? 0;
    for (const line of pitchLines) {
      lower = Math.min(lower, line.height);
      upper = Math.max(upper, line.height);
    }
    range = { lower, upper };
  }

  // ADR: 厳密な整数・a 倍数境界は h=0（(0,0)）だけであり、譜番号の
  // ceil/floor が浮動小数点の丸めでずれることはないため、補正は設けない。
  // h=0 は主音線を優先し、両譜から除く。
  let staffLines1D: ChordDiagramStaffLine[] = [];
  let staffLines2D: ChordDiagramStaffLine[] = [];
  if (range !== null && pitchLines.length >= 2) {
    const lower = range.lower;
    const upper = range.upper;
    const primaries: ChordDiagramStaffLine[] = [];
    for (let n = Math.ceil(lower); n <= Math.floor(upper); n += 1) {
      if (n !== 0) {
        primaries.push({ index: n, height: n });
      }
    }
    const secondaries: ChordDiagramStaffLine[] = [];
    for (
      let m = Math.ceil(lower / CHORD_DIAGRAM_HORIZONTAL_STEP);
      m <= Math.floor(upper / CHORD_DIAGRAM_HORIZONTAL_STEP);
      m += 1
    ) {
      if (m !== 0) {
        secondaries.push({ index: m, height: m * CHORD_DIAGRAM_HORIZONTAL_STEP });
      }
    }
    staffLines1D = primaries;
    staffLines2D = secondaries;
  }

  return {
    dimension,
    horizontalStep: CHORD_DIAGRAM_HORIZONTAL_STEP,
    verticalStep,
    mainLine: { height: 0 },
    range,
    staffLines1D,
    staffLines2D,
    pitchLines,
    dimensionSegments,
    functionalRoot: root,
    rootSpecified: root !== null,
    rootOnPoint: rootKey !== null && onKeys.has(rootKey),
    chordUnformed: ordered.length <= 2,
  };
}

/**
 * 次元線区間の一覧を求める。
 *
 * 各オン点への低次元優先の標準経路を単位辺に分解し、軸・直交座標・方向
 * ごとに束ねて区間にまとめる。束ねた区間をオン点で区切るため、経路の
 * 共有部分は重複しない。同じ単位辺を逆向きに通る経路は単一の根からは
 * 生じない（`x` 辺は根の `y` 上で根の両側に分かれ、`y` 辺は角の `x` と
 * 向きが一致する）が、念のため辺の向きも識別子に含める。
 *
 * @param ordered - 固定座標順のオン点列。
 * @param root - 機能根。格子内であること。
 * @param heightOf - 論理高さの算出関数。
 * @returns 根に近い順の次元線区間。
 */
function collectDimensionSegments(
  ordered: readonly PitchGridPoint[],
  root: PitchGridPoint,
  heightOf: (point: PitchGridPoint) => number,
): ChordDiagramSegment[] {
  const edges = new Map<string, ChordDiagramUnitEdge>();
  const addEdge = (axis: ChordDiagramAxis, line: number, start: number, direction: 1 | -1): void => {
    const key = `${axis}:${line}:${start}:${direction}`;
    if (!edges.has(key)) {
      edges.set(key, { axis, line, start, direction });
    }
  };
  for (const target of ordered) {
    // 根から根への自己区間は出さない。
    if (target.x === root.x && target.y === root.y) {
      continue;
    }
    if (target.x !== root.x) {
      const direction: 1 | -1 = target.x > root.x ? 1 : -1;
      for (let x = root.x; x !== target.x; x += direction) {
        addEdge('x', root.y, x, direction);
      }
    }
    if (target.y !== root.y) {
      const direction: 1 | -1 = target.y > root.y ? 1 : -1;
      for (let y = root.y; y !== target.y; y += direction) {
        addEdge('y', target.x, y, direction);
      }
    }
  }

  const groups = new Map<string, ChordDiagramEdgeGroup>();
  for (const edge of edges.values()) {
    const key = `${edge.axis}:${edge.line}:${edge.direction}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, {
        axis: edge.axis,
        line: edge.line,
        direction: edge.direction,
        starts: [edge.start],
      });
    } else {
      group.starts.push(edge.start);
    }
  }

  const raw: ChordDiagramRawSegment[] = [];
  const groupKeys = [...groups.keys()].sort();
  for (const key of groupKeys) {
    const group = groups.get(key);
    if (group === undefined) {
      continue;
    }
    // 単位辺を座標区間に直す（+1 方向は [start, start+1]、-1 方向は [start-1, start]）。
    // 座標順に連続した区間を一つの区間にまとめ、オン点で区切る。
    const intervals = group.starts
      .map((start) =>
        group.direction === 1 ? ([start, start + 1] as const) : ([start - 1, start] as const),
      )
      .sort((a, b) => a[0] - b[0]);
    let runLow = intervals[0]?.[0] ?? 0;
    let runHigh = intervals[0]?.[1] ?? 0;
    const flush = (low: number, high: number): void => {
      const cuts = onCoordsOnLine(ordered, group.axis, group.line, low, high);
      const bounds = [low, ...cuts, high];
      for (let index = 0; index + 1 < bounds.length; index += 1) {
        const first = bounds[index] ?? low;
        const second = bounds[index + 1] ?? high;
        if (first === second) {
          continue;
        }
        // 始点は根に近い側、終点は根から遠い側にそろえる。
        const near = group.direction === 1 ? first : second;
        const far = group.direction === 1 ? second : first;
        raw.push({
          axis: group.axis,
          direction: group.direction,
          from: group.axis === 'x' ? { x: near, y: group.line } : { x: group.line, y: near },
          to: group.axis === 'x' ? { x: far, y: group.line } : { x: group.line, y: far },
        });
      }
    };
    for (let index = 1; index < intervals.length; index += 1) {
      const interval = intervals[index] ?? [0, 0];
      if (interval[0] <= runHigh) {
        runHigh = Math.max(runHigh, interval[1]);
      } else {
        flush(runLow, runHigh);
        runLow = interval[0];
        runHigh = interval[1];
      }
    }
    flush(runLow, runHigh);
  }

  // 根からの順は、根に近い側の端点までの歩数（x 歩数と y 歩数の和）で定め、
  // 同値は低次元（x 軸）を先にする。入力順に依存しない安定順である。
  const distanceFromRoot = (segment: ChordDiagramRawSegment): number =>
    segment.axis === 'x'
      ? Math.abs(segment.from.x - root.x)
      : Math.abs(segment.from.x - root.x) + Math.abs(segment.from.y - root.y);
  const orderedRaw = [...raw].sort((a, b) => {
    const distance = distanceFromRoot(a) - distanceFromRoot(b);
    if (distance !== 0) {
      return distance;
    }
    if (a.axis !== b.axis) {
      return a.axis === 'x' ? -1 : 1;
    }
    if (a.direction !== b.direction) {
      return a.direction === 1 ? -1 : 1;
    }
    return b.from.y - a.from.y || a.from.x - b.from.x;
  });
  return orderedRaw.map((segment, orderFromRoot) => ({
    id: `${segment.axis}:${pitchGridKey(segment.from)}>${pitchGridKey(segment.to)}`,
    axis: segment.axis,
    direction: segment.direction,
    steps: Math.abs(segment.to.x - segment.from.x) + Math.abs(segment.to.y - segment.from.y),
    from: segment.from,
    to: segment.to,
    fromHeight: heightOf(segment.from),
    toHeight: heightOf(segment.to),
    orderFromRoot,
  }));
}

/**
 * 指定の直交線上で覆う座標区間の内側にあるオン点の軸方向座標を返す。
 *
 * @param ordered - 固定座標順のオン点列。
 * @param axis - 次元の軸。
 * @param line - 軸に直交する座標。
 * @param low - 覆う座標区間の下端（区間に含む）。
 * @param high - 覆う座標区間の上端（区間に含む）。
 * @returns 内側（両端を除く）の座標の昇順一覧。重複を含まない。
 */
function onCoordsOnLine(
  ordered: readonly PitchGridPoint[],
  axis: ChordDiagramAxis,
  line: number,
  low: number,
  high: number,
): number[] {
  const coords = new Set<number>();
  for (const point of ordered) {
    if (axis === 'x' ? point.y === line : point.x === line) {
      const coord = axis === 'x' ? point.x : point.y;
      if (coord > low && coord < high) {
        coords.add(coord);
      }
    }
  }
  return [...coords].sort((a, b) => a - b);
}

/**
 * オン点列を検証し固定座標順（`y` 降順、次いで `x` 昇順）に並べる。
 *
 * 順序は共有意図の正規化と同じにし、処理順・操作履歴が結果を変えない
 * ようにする。
 *
 * @param points - オン点の座標列。
 * @returns 固定座標順に並べた座標列。
 * @throws `Error` — 格子外の座標や重複した座標がある場合。
 */
function sortChordPoints(points: readonly PitchGridPoint[]): PitchGridPoint[] {
  const ordered = [...points].sort((a, b) => b.y - a.y || a.x - b.x);
  const keys = new Set<string>();
  const result: PitchGridPoint[] = [];
  for (const point of ordered) {
    if (!isInPitchGrid(point)) {
      throw new Error(`格子外の座標である: (${String(point.x)}, ${String(point.y)})`);
    }
    const key = pitchGridKey(point);
    if (keys.has(key)) {
      throw new Error(`重複した座標である: ${key}`);
    }
    keys.add(key);
    result.push({ x: point.x, y: point.y });
  }
  return result;
}
