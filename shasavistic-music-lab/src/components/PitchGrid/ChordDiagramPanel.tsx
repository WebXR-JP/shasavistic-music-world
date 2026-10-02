/**
 * 和音図の線構造プレビューのパネル。
 *
 * 純粋変換（`chordDiagramLayout`）の出力を Canvas 2D に描き、
 * `CanvasTexture` を貼った非操作の面として置く。描画の流儀は
 * `SoundingPiano` に倣う（静的な面と動的な面の分離、内容の署名での再生成、
 * 古い描画資源の破棄、光線追跡の無効化）。
 *
 * 方式の正本は `workflow/design/shasavistic-music-lab/pitch-grid/chord-diagram.md`
 * とし、周波数の数値・鍵名は出さない。データ源は共有意図
 * （`onPoints`・`dimension`・`functionalRootKey`）であり、発音成立の声ではない。
 *
 * @packageDocumentation
 */

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import {
  isPitchGridDimension,
  pitchGridKey,
  pitchGridPointFromKey,
  type PitchGridDimension,
  type PitchGridPoint,
} from '../../audio/pitchGrid';
import {
  chordDiagramSegmentSide,
  layoutChordDiagram,
  type ChordDiagramAxis,
  type ChordDiagramLayout,
} from './chordDiagramLayout';
import { selectPlateFont, type PlateTextWidth } from './plates';

/**
 * 和音図パネルの中心（部品内座標）。
 *
 * 鳴り中音高パネル（`SOUNDING_PIANO_POSITION`）・格子最上段の銘板・
 * 移動パッド・次元釦・理論説明パネルと重ねない初期候補である。
 * 座標・寸法と可読性はXR実画面の確認で決めること。
 */
export const CHORD_DIAGRAM_POSITION: readonly [number, number, number] = [1.95, 3.05, 0];

/**
 * 和音図パネルの大きさ（幅・高さ）。
 *
 * 横長の面とする初期候補である。実画面の確認で決めること。
 */
export const CHORD_DIAGRAM_SIZE: readonly [number, number] = [2.0, 1.25];

/** 描画面の幅（px）。面の縦横比（2.0×1.25）と一致させる。 */
const CHORD_DIAGRAM_CANVAS_WIDTH = 1024;

/** 描画面の高さ（px）。面の縦横比（2.0×1.25）と一致させる。 */
const CHORD_DIAGRAM_CANVAS_HEIGHT = 640;

/** 描画域の左端（px）。 */
const CHORD_DIAGRAM_PLOT_LEFT = 70;

/** 描画域の右端（px）。 */
const CHORD_DIAGRAM_PLOT_RIGHT = 954;

/** 描画域の上端（px）。見出し行と重ねない。 */
const CHORD_DIAGRAM_PLOT_TOP = 120;

/** 描画域の下端（px）。凡例行と重ねない。 */
const CHORD_DIAGRAM_PLOT_BOTTOM = 520;

/** 見出し行の中心高さ（px）。初期候補であり実画面の確認で決めること。 */
const CHORD_DIAGRAM_TITLE_Y = 56;

/** 凡例行の中心高さ（px）。初期候補であり実画面の確認で決めること。 */
const CHORD_DIAGRAM_FOOTER_Y = 584;

/** 未成立表示の中心高さ（px）。初期候補であり実画面の確認で決めること。 */
const CHORD_DIAGRAM_NOTICE_Y = 320;

/** 主音線の色。最前面の太い線に使う。初期候補であり実画面で決めること。 */
const CHORD_DIAGRAM_MAIN_COLOR = '#ffffff';

/** 音高線の色。オン点ごとの線に使う。初期候補であり実画面で決めること。 */
const CHORD_DIAGRAM_PITCH_COLOR = '#ff7043';

/** 譜線の色。1次元譜・2次元譜で共通にし、線種（実線・破線）で区別する。 */
const CHORD_DIAGRAM_STAFF_COLOR = '#7d8aa0';

/**
 * 次元ごとの次元線の色（2次元=朱・3次元=緑・4次元=青・5次元=紫）。
 *
 * 人間承認の配色の初期候補であり、XR実画面の確認で変えてよい。
 * `x` 軸区間は2次元の色、`y` 軸区間は選択次元の色で描く。
 */
const CHORD_DIAGRAM_DIMENSION_COLORS: Readonly<Record<2 | PitchGridDimension, string>> = {
  2: '#c62828',
  3: '#43a047',
  4: '#1976d2',
  5: '#7b1fa2',
};

/**
 * 次元線区間の描画色を求める。
 *
 * `x` 軸区間（2次元線）は2次元の色、`y` 軸区間（選択次元線）は
 * 選択次元の色とする。次元ごとに色を変える方式の描画側の境界とする。
 *
 * @param axis - 次元線区間の軸。
 * @param dimension - 選択次元。3・4・5次元のいずれか。
 * @returns 描画色の指定。
 * @throws `RangeError` — 選択次元でない場合。
 */
export function chordDiagramSegmentColor(
  axis: ChordDiagramAxis,
  dimension: PitchGridDimension,
): string {
  if (axis === 'x') {
    return CHORD_DIAGRAM_DIMENSION_COLORS[2];
  }
  if (!isPitchGridDimension(dimension)) {
    throw new RangeError(`縦軸の次元は3・4・5のいずれかであること: ${String(dimension)}`);
  }
  return CHORD_DIAGRAM_DIMENSION_COLORS[dimension];
}

/** 音高線を譜線より短くする両端の詰め量（px）。初期候補であり実画面の確認で決めること。 */
const CHORD_DIAGRAM_PITCH_INSET = 140;

/**
 * 選択次元座標が0でない音高線の左端の短縮量（px）。
 *
 * 左だけ短くし、右端は他の音高線と揃える。初期候補であり実画面の確認で決めること。
 */
const CHORD_DIAGRAM_LEFT_SHORTEN = 36;

/** 機能根の目印の色。根の音高線の左端の菱形に使う。 */
const CHORD_DIAGRAM_ROOT_MARK_COLOR = '#ffd54f';

export interface ChordDiagramPanelProps {
  /** 選択次元。共有意図の `dimension` を渡す。 */
  readonly dimension: PitchGridDimension;
  /** オン点の座標列。共有意図の `onPoints` を座標へ戻したものを渡す。 */
  readonly points: readonly PitchGridPoint[];
  /** 機能根の座標鍵。共有意図の `functionalRootKey` を渡す。未指定時は `null`。 */
  readonly functionalRootKey: string | null;
  /** パネル面の配置位置。省略時は格子右上の初期候補。 */
  readonly position?: readonly [number, number, number];
  /** パネル面の大きさ。省略時は横長の面の初期候補。 */
  readonly size?: readonly [number, number];
}

/**
 * パネル内容の安定した署名を作る。
 *
 * 親は共有快照の変化ごとに新しい配列を渡すため、参照の比較では
 * 内容不変の再通知と内容変化を区別できない。鍵順に揃えた署名の比較で
 * 内容変化だけを捉える。`SoundingPiano` の声の署名と同じ扱いである。
 *
 * @param dimension - 選択次元。
 * @param onKeys - オン点の座標鍵の列。順序は署名に影響しない。
 * @param functionalRootKey - 機能根の座標鍵。未指定時は `null`。
 * @returns 内容変化の検出に使う署名。
 */
export function chordDiagramPanelSignature(
  dimension: PitchGridDimension,
  onKeys: readonly string[],
  functionalRootKey: string | null,
): string {
  const ordered = [...onKeys].sort();
  return `${dimension}|${ordered.join(',')}|${functionalRootKey ?? '-'}`;
}

// 論理高さの写像域を求める。主音線（h=0）を常に域内に含める。
// 0点の写像域と単一高さの微小な広がりは描画面の破綻を避けるための
// 譲歩であり、論理高さ・譜の区間・線の順序は変えない。
function chordDiagramPlotDomain(layout: ChordDiagramLayout): {
  readonly lower: number;
  readonly upper: number;
} {
  if (layout.range === null) {
    return { lower: -1, upper: 1 };
  }
  if (layout.range.lower === layout.range.upper) {
    const center = layout.range.lower;
    return { lower: Math.min(center, 0) - 0.25, upper: Math.max(center, 0) + 0.25 };
  }
  return { lower: Math.min(layout.range.lower, 0), upper: Math.max(layout.range.upper, 0) };
}

// 論理高さを描画面の縦位置（px）へ写す。上方向正のため反転する。
function chordDiagramPlotY(
  height: number,
  domain: { readonly lower: number; readonly upper: number },
): number {
  const span = domain.upper - domain.lower;
  return (
    CHORD_DIAGRAM_PLOT_BOTTOM -
    ((height - domain.lower) / span) * (CHORD_DIAGRAM_PLOT_BOTTOM - CHORD_DIAGRAM_PLOT_TOP)
  );
}

// 静的部分を描く。背景・見出し・譜線（1次元譜は実線、2次元譜は破線）・凡例だけを担う。
// 主音線はレイヤ順（譜線→次元線→音高線・主音線）を面の前後で守るため
// 前面の動的部分に描き、ここには含めない。
function drawStaticChordDiagram(drawing: CanvasRenderingContext2D, layout: ChordDiagramLayout): void {
  const width = CHORD_DIAGRAM_CANVAS_WIDTH;
  const height = CHORD_DIAGRAM_CANVAS_HEIGHT;
  const domain = chordDiagramPlotDomain(layout);
  const measure: PlateTextWidth = (font, text) => {
    drawing.font = font;
    return drawing.measureText(text).width;
  };
  drawing.fillStyle = 'rgba(10, 12, 20, 0.85)';
  drawing.fillRect(0, 0, width, height);

  // 見出し。線構造のプレビューであることを文言で示し、色だけに頼らない。
  drawing.textAlign = 'left';
  drawing.textBaseline = 'middle';
  drawing.fillStyle = '#ffffff';
  drawing.font = selectPlateFont(measure, 34, true, '和音図（線構造）');
  drawing.fillText('和音図（線構造）', CHORD_DIAGRAM_PLOT_LEFT, CHORD_DIAGRAM_TITLE_Y);
  drawing.textAlign = 'right';
  drawing.fillStyle = '#cfe3ff';
  drawing.font = selectPlateFont(
    measure,
    28,
    false,
    layout.chordUnformed ? '和音未成立' : '和音成立',
  );
  drawing.fillText(
    layout.chordUnformed ? '和音未成立' : '和音成立',
    CHORD_DIAGRAM_PLOT_RIGHT,
    CHORD_DIAGRAM_TITLE_Y,
  );

  // 1次元譜線は実線、2次元譜線は破線とし、線種で読み分ける。
  // h=0 は純粋変換が両譜から除いており、主音線を優先する。
  drawing.strokeStyle = CHORD_DIAGRAM_STAFF_COLOR;
  drawing.lineWidth = 2;
  drawing.setLineDash([]);
  drawing.beginPath();
  for (const line of layout.staffLines1D) {
    const y = chordDiagramPlotY(line.height, domain);
    drawing.moveTo(CHORD_DIAGRAM_PLOT_LEFT, y);
    drawing.lineTo(CHORD_DIAGRAM_PLOT_RIGHT, y);
  }
  drawing.stroke();
  drawing.setLineDash([12, 9]);
  drawing.beginPath();
  for (const line of layout.staffLines2D) {
    const y = chordDiagramPlotY(line.height, domain);
    drawing.moveTo(CHORD_DIAGRAM_PLOT_LEFT, y);
    drawing.lineTo(CHORD_DIAGRAM_PLOT_RIGHT, y);
  }
  drawing.stroke();
  drawing.setLineDash([]);

  // 凡例。周波数の数値・鍵名は出さず、線種と左右の対応だけを示す。
  drawing.textAlign = 'center';
  drawing.fillStyle = '#cfe3ff';
  drawing.font = selectPlateFont(
    measure,
    22,
    false,
    '白太線:主音線 橙線:音高線 灰線:譜線(実線1次元・破線2次元) 縦線:次元線(左2次元・右選択次元)',
  );
  drawing.fillText(
    '白太線:主音線 橙線:音高線 灰線:譜線(実線1次元・破線2次元) 縦線:次元線(左2次元・右選択次元)',
    width / 2,
    CHORD_DIAGRAM_FOOTER_Y,
  );
}

// 動的部分を描く。背景は透明とし、静的部分の面に重ねる。
// レイヤ順を守るため次元線→音高線→主音線の順に描く。h=0 では
// 主音線を最後に描いて優先する。機能根の区別は線の左端の菱形の
// 目印で行い、周波数の数値・鍵名は出さない。
// 音高線は譜線より短く左右を揃え、次元線はその両端（x軸=左端・y軸=右端）の
// 縦線で結ぶ。選択次元座標が0でない音高線は左端だけ短くする。
function drawDynamicChordDiagram(
  drawing: CanvasRenderingContext2D,
  layout: ChordDiagramLayout,
): void {
  const width = CHORD_DIAGRAM_CANVAS_WIDTH;
  const height = CHORD_DIAGRAM_CANVAS_HEIGHT;
  const domain = chordDiagramPlotDomain(layout);
  const measure: PlateTextWidth = (font, text) => {
    drawing.font = font;
    return drawing.measureText(text).width;
  };
  drawing.clearRect(0, 0, width, height);
  const pitchLeft = CHORD_DIAGRAM_PLOT_LEFT + CHORD_DIAGRAM_PITCH_INSET;
  const pitchRight = CHORD_DIAGRAM_PLOT_RIGHT - CHORD_DIAGRAM_PITCH_INSET;

  // 次元線。各区間を始点高さから終点高さまでの縦線で結ぶ。
  // 横位置は音高線の両端に固定し、色は次元ごとに変える。
  drawing.lineWidth = 3;
  for (const side of ['left', 'right'] as const) {
    drawing.strokeStyle =
      side === 'left'
        ? chordDiagramSegmentColor('x', layout.dimension)
        : chordDiagramSegmentColor('y', layout.dimension);
    drawing.beginPath();
    for (const segment of layout.dimensionSegments) {
      if (chordDiagramSegmentSide(segment.axis) !== side) {
        continue;
      }
      const x = side === 'left' ? pitchLeft : pitchRight;
      drawing.moveTo(x, chordDiagramPlotY(segment.fromHeight, domain));
      drawing.lineTo(x, chordDiagramPlotY(segment.toHeight, domain));
    }
    drawing.stroke();
  }

  // 音高線。各オン点の論理高さに左右を揃えた短い横線を引く。
  // 選択次元座標が0でない線だけ左端を少し内側に詰める。
  drawing.strokeStyle = CHORD_DIAGRAM_PITCH_COLOR;
  drawing.lineWidth = 5;
  drawing.beginPath();
  for (const line of layout.pitchLines) {
    const y = chordDiagramPlotY(line.height, domain);
    const left = line.isLeftShortened
      ? pitchLeft + CHORD_DIAGRAM_LEFT_SHORTEN
      : pitchLeft;
    drawing.moveTo(left, y);
    drawing.lineTo(pitchRight, y);
  }
  drawing.stroke();

  // 機能根の目印。根の音高線の左端（短縮時は詰めた位置）に菱形を置く。
  for (const line of layout.pitchLines) {
    if (!line.isRoot) {
      continue;
    }
    const y = chordDiagramPlotY(line.height, domain);
    const x =
      (line.isLeftShortened
        ? pitchLeft + CHORD_DIAGRAM_LEFT_SHORTEN
        : pitchLeft) + 18;
    const radius = 14;
    drawing.beginPath();
    drawing.moveTo(x, y - radius);
    drawing.lineTo(x + radius, y);
    drawing.lineTo(x, y + radius);
    drawing.lineTo(x - radius, y);
    drawing.closePath();
    drawing.fillStyle = CHORD_DIAGRAM_ROOT_MARK_COLOR;
    drawing.fill();
    drawing.lineWidth = 3;
    drawing.strokeStyle = '#111111';
    drawing.stroke();
  }

  // 主音線。h=0 に最も太い線を最後に描き、譜線・音高線より優先する。
  const mainY = chordDiagramPlotY(layout.mainLine.height, domain);
  drawing.strokeStyle = CHORD_DIAGRAM_MAIN_COLOR;
  drawing.lineWidth = 7;
  drawing.beginPath();
  drawing.moveTo(CHORD_DIAGRAM_PLOT_LEFT, mainY);
  drawing.lineTo(CHORD_DIAGRAM_PLOT_RIGHT, mainY);
  drawing.stroke();

  // 和音未成立の表示。2点でも両譜は引いたうえで併示する。
  // 0〜1点では純粋変換が譜を引かないため、主音線・音高線だけになる。
  if (layout.chordUnformed) {
    drawing.textAlign = 'center';
    drawing.textBaseline = 'middle';
    drawing.fillStyle = '#ffffff';
    drawing.font = selectPlateFont(measure, 44, true, '和音未成立（3点以上で成立）');
    drawing.fillText('和音未成立（3点以上で成立）', width / 2, CHORD_DIAGRAM_NOTICE_Y);
  }
  // 次元線は機能根があるときだけ引き、既定根でも引く。引かないのは
  // オン点がないときだけであり、そのときは空状態の説明として示す。
  // 描画側が独自に推定根を決めることはしない。
  if (layout.pitchLines.length === 0) {
    drawing.textAlign = 'center';
    drawing.fillStyle = '#cfe3ff';
    drawing.font = selectPlateFont(measure, 24, false, 'オン点なしのため次元線なし');
    drawing.fillText('オン点なしのため次元線なし', width / 2, CHORD_DIAGRAM_NOTICE_Y + 56);
  }
}

/**
 * 和音図の線構造プレビューのパネル。
 *
 * 共有意図（オン点・選択次元・機能根）を純粋変換で論理区間に直し、
 * 譜線の静的な面と音高線・次元線・主音線の動的な面の2枚に分けて描く。
 * 非操作の固定面であり、照準の当たり判定を遮らない。既存の `TextPlate` は
 * 使わず、方式と見た目を変えない。可読性はXR実画面の確認で決める。
 */
export function ChordDiagramPanel({
  dimension,
  points,
  functionalRootKey,
  position = CHORD_DIAGRAM_POSITION,
  size = CHORD_DIAGRAM_SIZE,
}: ChordDiagramPanelProps): React.JSX.Element {
  // 共有値は境界で確かめてから純粋変換へ渡す。鍵でない・格子外の根は
  // 未指定として扱い、描画を破綻させない。
  const functionalRoot =
    functionalRootKey === null ? null : pitchGridPointFromKey(functionalRootKey);
  const signature = chordDiagramPanelSignature(
    dimension,
    points.map(pitchGridKey),
    functionalRootKey,
  );
  // 内容の署名が変わったときだけ配置を求め直す。署名が内容を表すため
  // 配列自体は依存に含めない（`SoundingPiano` の声の署名と同じ扱い）。
  const layout = useMemo(
    () => layoutChordDiagram(dimension, points, functionalRoot),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature],
  );
  const staticSignature = JSON.stringify({
    dimension: layout.dimension,
    range: layout.range,
    staff1D: layout.staffLines1D,
    staff2D: layout.staffLines2D,
    unformed: layout.chordUnformed,
  });
  const dynamicSignature = JSON.stringify({
    dimension: layout.dimension,
    range: layout.range,
    pitches: layout.pitchLines,
    segments: layout.dimensionSegments,
    unformed: layout.chordUnformed,
    rootSpecified: layout.rootSpecified,
  });

  const staticTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = CHORD_DIAGRAM_CANVAS_WIDTH;
    canvas.height = CHORD_DIAGRAM_CANVAS_HEIGHT;
    const drawing = canvas.getContext('2d');
    if (drawing === null) {
      throw new Error('和音図の譜面が作れない');
    }
    drawStaticChordDiagram(drawing, layout);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staticSignature]);

  const dynamicTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = CHORD_DIAGRAM_CANVAS_WIDTH;
    canvas.height = CHORD_DIAGRAM_CANVAS_HEIGHT;
    const drawing = canvas.getContext('2d');
    if (drawing === null) {
      throw new Error('和音図の線描画面が作れない');
    }
    drawDynamicChordDiagram(drawing, layout);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dynamicSignature]);

  // 静的な面と動的な面を別々に破棄する。動的な面の作り直しで
  // 静的な面の描画資源を使い回す。
  useEffect(() => {
    return () => {
      staticTexture.dispose();
    };
  }, [staticTexture]);
  useEffect(() => {
    return () => {
      dynamicTexture.dispose();
    };
  }, [dynamicTexture]);

  return (
    <group position={[position[0], position[1], position[2]]}>
      <mesh position={[0, 0, 0]} raycast={() => null}>
        <planeGeometry args={[size[0], size[1]]} />
        <meshBasicMaterial map={staticTexture} transparent toneMapped={false} depthWrite={false} />
      </mesh>
      {/* 音高線・次元線・主音線の動的部分。静的部分の手前に重ね、変更時のみ描き直す。 */}
      <mesh position={[0, 0, 0.005]} raycast={() => null}>
        <planeGeometry args={[size[0], size[1]]} />
        <meshBasicMaterial map={dynamicTexture} transparent toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  );
}
