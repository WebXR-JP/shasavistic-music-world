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
export function TextPlate({ lines, size, position, light = false, framed = false, large = false }: TextPlateProps): React.JSX.Element {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
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
    if (large) {
      drawing.fillStyle = light ? '#111111' : '#ffffff';
      drawing.font = 'bold 150px sans-serif';
      drawing.fillText(lines[0], canvas.width / 2, canvas.height / 2);
    } else if (lines.length === 1) {
      drawing.fillStyle = light ? '#111111' : '#ffffff';
      drawing.font = 'bold 64px sans-serif';
      drawing.fillText(lines[0], canvas.width / 2, canvas.height / 2);
    } else {
      drawing.fillStyle = light ? '#111111' : '#ffffff';
      drawing.font = 'bold 60px sans-serif';
      drawing.fillText(lines[0], canvas.width / 2, 80);
      drawing.fillStyle = light ? '#333344' : '#cfe3ff';
      drawing.font = '48px sans-serif';
      drawing.fillText(lines[1], canvas.width / 2, 175);
    }
    const plateTexture = new THREE.CanvasTexture(canvas);
    plateTexture.colorSpace = THREE.SRGBColorSpace;
    plateTexture.anisotropy = 4;
    return plateTexture;
  }, [lines, light, framed, large]);

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
