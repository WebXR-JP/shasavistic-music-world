import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import {
  THEORY_INTRO_BODY_LINE_HEIGHT,
  THEORY_INTRO_CANVAS_HEIGHT,
  THEORY_INTRO_CANVAS_WIDTH,
  THEORY_INTRO_MARGIN_PX,
  THEORY_INTRO_PARAGRAPH_GAP_PX,
  THEORY_INTRO_ROTATION,
  THEORY_INTRO_TITLE_BODY_GAP_PX,
  THEORY_INTRO_TITLE_LINE_HEIGHT,
  layoutTheoryIntro,
  theoryBodyFont,
  theoryTitleFont,
  type PitchGridIntro,
  type TheoryTextWidth,
} from './theoryPanel';

export interface TheoryIntroPanelProps {
  /** 理論説明の文章。静的 import で読む bundled データを渡す。 */
  readonly intro: PitchGridIntro;
  /** パネル面の配置位置（ワールド座標）。 */
  readonly position: readonly [number, number, number];
  /** パネル面の大きさ（幅・高さ）。 */
  readonly size: readonly [number, number];
  /** パネル面の向き。省略時は訪問者側の +z へ向ける。 */
  readonly rotation?: readonly [number, number, number];
}

/**
 * 理論説明専用の非操作の1枚パネル。
 *
 * 見出しと全段落を一つの描画面に描き、一つの面として置く。既存の
 * `TextPlate`（最大2行の銘板用）は使わず、方式と見た目を変えない。
 * 照準の当たり判定を遮らないよう光線追跡を受け付けない。
 * 文章が一枚に収まらない場合は描かずに失敗させ、黙って欠落しない。
 */
export function TheoryIntroPanel({
  intro,
  position,
  size,
  rotation = THEORY_INTRO_ROTATION,
}: TheoryIntroPanelProps): React.JSX.Element {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = THEORY_INTRO_CANVAS_WIDTH;
    canvas.height = THEORY_INTRO_CANVAS_HEIGHT;
    const drawing = canvas.getContext('2d');
    if (drawing === null) {
      throw new Error('理論説明の描画面が作れない');
    }
    drawing.fillStyle = 'rgba(10, 12, 20, 0.85)';
    drawing.fillRect(0, 0, canvas.width, canvas.height);
    drawing.textAlign = 'center';
    drawing.textBaseline = 'middle';
    const measure: TheoryTextWidth = (font, text) => {
      drawing.font = font;
      return drawing.measureText(text).width;
    };
    const layout = layoutTheoryIntro(measure, intro);
    if (!layout.fits) {
      throw new Error(`理論説明が一枚に収まらない: ${layout.overflowReason ?? 'unknown'}`);
    }
    let cursorY = THEORY_INTRO_MARGIN_PX;
    drawing.fillStyle = '#ffffff';
    drawing.font = theoryTitleFont(layout.titleFontPx);
    for (const row of layout.titleLines) {
      cursorY += (layout.titleFontPx * THEORY_INTRO_TITLE_LINE_HEIGHT) / 2;
      drawing.fillText(row, canvas.width / 2, cursorY);
      cursorY += (layout.titleFontPx * THEORY_INTRO_TITLE_LINE_HEIGHT) / 2;
    }
    cursorY += THEORY_INTRO_TITLE_BODY_GAP_PX;
    drawing.fillStyle = '#cfe3ff';
    drawing.font = theoryBodyFont(layout.bodyFontPx);
    layout.paragraphLines.forEach((rows, paragraphIndex) => {
      if (paragraphIndex > 0) {
        cursorY += THEORY_INTRO_PARAGRAPH_GAP_PX;
      }
      for (const row of rows) {
        cursorY += (layout.bodyFontPx * THEORY_INTRO_BODY_LINE_HEIGHT) / 2;
        drawing.fillText(row, canvas.width / 2, cursorY);
        cursorY += (layout.bodyFontPx * THEORY_INTRO_BODY_LINE_HEIGHT) / 2;
      }
    });
    const panelTexture = new THREE.CanvasTexture(canvas);
    panelTexture.colorSpace = THREE.SRGBColorSpace;
    panelTexture.anisotropy = 4;
    return panelTexture;
  }, [intro]);

  useEffect(() => {
    return () => {
      texture.dispose();
    };
  }, [texture]);

  return (
    <mesh position={[position[0], position[1], position[2]]} rotation={[rotation[0], rotation[1], rotation[2]]} raycast={() => null}>
      <planeGeometry args={[size[0], size[1]]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} depthWrite={false} />
    </mesh>
  );
}
