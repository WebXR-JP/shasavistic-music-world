import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

export interface TextPlateProps {
  /** 1行または2行の表示文。 */
  readonly lines: readonly [string] | readonly [string, string];
  /** 銘板面の大きさ（幅・高さ）。 */
  readonly size: readonly [number, number];
  /** 銘板面の配置位置。 */
  readonly position: readonly [number, number, number];
  /**
   * 明るい背景に暗い文字にする（オン状態などの非色相の区別）。
   * 省略時は暗背景に明文字。
   */
  readonly light?: boolean;
  /** 選択中などの枠表示を付ける。 */
  readonly framed?: boolean;
  /** 大きな1字表示（矢印など）にする。 */
  readonly large?: boolean;
  /**
   * 小さい書体で長文を表示する（理論説明などの複数行パネル用）。
   * 省略時は既定の書体。描画方式と最大2行は変えない。
   */
  readonly small?: boolean;
}

/**
 * 描画面の幅（px）。CanvasTexture の貼付け面と対応する。
 */
export const PLATE_CANVAS_WIDTH = 512;

/**
 * 行文の左右に確保する余白（片側px）。
 * 枠線の内側に文字を収め、端での欠けを避ける。
 */
export const PLATE_TEXT_MARGIN_PX = 28;

/** 自動縮小の下限（px）。判読できる大きさに留める。 */
const PLATE_MIN_FONT_PX = 16;

/** 書体と行文から描画幅を返す測定口。Canvas の `measureText` を使う。 */
export type PlateTextWidth = (font: string, text: string) => number;

/**
 * 描画幅に収まる書体サイズを求める。
 *
 * 基の大きさで測った幅から線形に縮小し、切り捨てで収まる側に寄せる。
 * 収まる場合は基の大きさをそのまま返すため、既存パネルの見た目は変わらない。
 *
 * @param basePx - 基の書体サイズ（px）。
 * @param measuredWidthPx - 基の書体で測った行文の幅（px）。
 * @param maxWidthPx - 行文に使える幅（px）。省略時は描画面から左右余白を除いた幅。
 * @returns 描画に使う書体サイズ（px）。
 */
export function fitPlateFontPx(
  basePx: number,
  measuredWidthPx: number,
  maxWidthPx: number = PLATE_CANVAS_WIDTH - PLATE_TEXT_MARGIN_PX * 2,
): number {
  if (!(measuredWidthPx > maxWidthPx)) {
    return basePx;
  }
  const scaled = Math.floor((basePx * maxWidthPx) / measuredWidthPx);
  return Math.max(PLATE_MIN_FONT_PX, scaled);
}

/**
 * 一行分の書体を描画幅に合わせて選ぶ。
 *
 * 基の大きさで測り、収まらない場合だけ自動縮小する。CJK を含む行文も
 * `measureText` の実測で判定するため、字形ごとの送り幅の違いに依存しない。
 *
 * @param measure - 書体と行文から描画幅を返す測定口。
 * @param basePx - 基の書体サイズ（px）。
 * @param bold - 太字にするか。
 * @param text - 描画する一行。
 * @returns 描画に使う `font` 指定。
 */
export function selectPlateFont(measure: PlateTextWidth, basePx: number, bold: boolean, text: string): string {
  const prefix = bold ? 'bold ' : '';
  const base = `${prefix}${basePx}px sans-serif`;
  const fittedPx = fitPlateFontPx(basePx, measure(base, text));
  if (fittedPx === basePx) {
    return base;
  }
  return `${prefix}${fittedPx}px sans-serif`;
}

/**
 * 常時表示の文字銘板。
 *
 * CanvasTexture を貼った非操作の面であり、照準の当たり判定を遮らないよう
 * 光線追跡を受け付けない。操作対象の内側に置いた場合も、背後の立体への
 * 命中は同じ操作口に届く。drei の Text（Troika 系の Worker 同梱リスク）や
 * Html（DOM 専用）は使わず、依存を増やさない。表示方式の理由は廃止文書の
 * 記録（`harmonic-synth/sound-cubes.md`）を踏襲する。
 */
export function TextPlate({ lines, size, position, light = false, framed = false, large = false, small = false }: TextPlateProps): React.JSX.Element {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = PLATE_CANVAS_WIDTH;
    canvas.height = 256;
    const drawing = canvas.getContext('2d');
    if (drawing === null) {
      throw new Error('常時表示の描画面が作れない');
    }
    // 明暗の反転は色相に頼らない状態表示（オン・オフなど）に使う。
    drawing.fillStyle = light ? '#f2f4f8' : 'rgba(10, 12, 20, 0.78)';
    drawing.fillRect(0, 0, canvas.width, canvas.height);
    if (framed) {
      drawing.strokeStyle = light ? '#111111' : '#ffffff';
      drawing.lineWidth = 10;
      drawing.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
    }
    drawing.textAlign = 'center';
    drawing.textBaseline = 'middle';
    // 行文の幅を実測し、描画幅に収まらない場合だけ書体を自動縮小する。
    const measure: PlateTextWidth = (font, text) => {
      drawing.font = font;
      return drawing.measureText(text).width;
    };
    if (large) {
      drawing.fillStyle = light ? '#111111' : '#ffffff';
      drawing.font = selectPlateFont(measure, 150, true, lines[0]);
      drawing.fillText(lines[0], canvas.width / 2, canvas.height / 2);
    } else if (lines.length === 1) {
      drawing.fillStyle = light ? '#111111' : '#ffffff';
      drawing.font = selectPlateFont(measure, small ? 44 : 64, true, lines[0]);
      drawing.fillText(lines[0], canvas.width / 2, canvas.height / 2);
    } else {
      drawing.fillStyle = light ? '#111111' : '#ffffff';
      drawing.font = selectPlateFont(measure, small ? 40 : 60, true, lines[0]);
      drawing.fillText(lines[0], canvas.width / 2, 80);
      drawing.fillStyle = light ? '#333344' : '#cfe3ff';
      drawing.font = selectPlateFont(measure, small ? 34 : 48, false, lines[1]);
      drawing.fillText(lines[1], canvas.width / 2, 175);
    }
    const plateTexture = new THREE.CanvasTexture(canvas);
    plateTexture.colorSpace = THREE.SRGBColorSpace;
    plateTexture.anisotropy = 4;
    return plateTexture;
  }, [lines, light, framed, large, small]);

  useEffect(() => {
    return () => {
      texture.dispose();
    };
  }, [texture]);

  return (
    <mesh position={[position[0], position[1], position[2]]} raycast={() => null}>
      <planeGeometry args={[size[0], size[1]]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} depthWrite={false} />
    </mesh>
  );
}
