import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { PitchGridSoundingVoice } from '../../audio/pitchGridSound';
import {
  doPianoSemitone,
  layoutSoundingDots,
  pianoKeyboardLayout,
} from './soundingPianoLayout';

/**
 * 鳴り中音高パネルの中心（部品内座標）。
 *
 * 格子の上方に置く初期候補である。格子最上段の銘板・移動パッド・次元釦・
 * 奥側の理論説明とは重ならないこと、座標・寸法と可読性は実画面の確認で
 * 決めること。
 */
export const SOUNDING_PIANO_POSITION: readonly [number, number, number] = [-0.85, 3.18, 0];

/**
 * 鳴り中音高パネルの大きさ（幅・高さ）。
 *
 * 横長の面とする初期候補である。実画面の確認で決めること。
 */
export const SOUNDING_PIANO_SIZE: readonly [number, number] = [3.5, 0.72];

/** 描画面の幅（px）。面の縦横比（3.5×0.72）と一致させる。 */
const SOUNDING_PIANO_CANVAS_WIDTH = 1050;

/** 描画面の高さ（px）。面の縦横比（3.5×0.72）と一致させる。 */
const SOUNDING_PIANO_CANVAS_HEIGHT = 216;

/**
 * 凡例行の中心高さ（px）。
 *
 * 初期候補であり、実画面の確認で決めること。
 */
const SOUNDING_PIANO_LEGEND_Y = 24;

/**
 * 鍵盤域の上端（px）。
 *
 * 初期候補であり、実画面の確認で決めること。
 */
const SOUNDING_PIANO_KEYBOARD_TOP = 56;

/**
 * 点の基準高さ（px）。鍵盤域の中央付近に置く。
 *
 * 初期候補であり、実画面の確認で決めること。
 */
const SOUNDING_PIANO_DOT_BASE_Y = 136;

/**
 * 点の半径（px）。
 *
 * 初期候補であり、実画面の確認で決めること。
 */
const SOUNDING_PIANO_DOT_RADIUS = 13;

/**
 * レーン1段あたりの上下間隔（px）。
 *
 * 初期候補であり、実画面の確認で決めること。
 */
const SOUNDING_PIANO_ROW_STEP = 30;

/**
 * レーン1段あたりの左右間隔（px）。
 *
 * 初期候補であり、実画面の確認で決めること。
 */
const SOUNDING_PIANO_COLUMN_STEP = 22;

/**
 * 横位置の両端余白（px）。両端の丸の欠けを避ける。
 *
 * 初期候補であり、実画面の確認で決めること。
 */
const SOUNDING_PIANO_EDGE_PAD = 16;

/**
 * 黒鍵の高さ（px）。白鍵の上部に重ねる。
 *
 * 初期候補であり、実画面の確認で決めること。
 */
const SOUNDING_PIANO_BLACK_KEY_HEIGHT = 92;

/** 点の塗り色。凡例の丸と共通にする。初期候補であり実画面で決めること。 */
const SOUNDING_PIANO_DOT_FILL = '#ffe082';

/** 周波数位置を指す細い線の色。初期候補であり実画面で決めること。 */
const SOUNDING_PIANO_STEM_COLOR = 'rgba(255, 255, 255, 0.75)';

export interface SoundingPianoProps {
  /** 保持中かつ再開成立した声（表示用）。減衰中の尾音は含まない。 */
  readonly voices: readonly PitchGridSoundingVoice[];
  /** パネル面の配置位置。省略時は格子上方の初期候補。 */
  readonly position?: readonly [number, number, number];
  /** パネル面の大きさ。省略時は横長の面の初期候補。 */
  readonly size?: readonly [number, number];
}

// 声の内容（鍵と周波数の組）の安定した署名を作る。親は通知ごとに新しい
// 配列を渡すため、参照の比較では内容不変の再通知と内容変化を区別できない。
// 鍵順に揃えた署名の比較で内容変化だけを捉える。
function soundingVoicesSignature(voices: readonly PitchGridSoundingVoice[]): string {
  return voices
    .map((voice) => `${voice.key}@${voice.frequency}`)
    .sort()
    .join('|');
}

// 鍵盤の静的部分を描く。A3 … A6 の通常の並びとし、C4 をド・C4 として示す。
// 点の動的部分は別描画とする。
function drawStaticKeyboard(drawing: CanvasRenderingContext2D): void {
  const width = SOUNDING_PIANO_CANVAS_WIDTH;
  const height = SOUNDING_PIANO_CANVAS_HEIGHT;
  const keyboardTop = SOUNDING_PIANO_KEYBOARD_TOP;
  drawing.fillStyle = 'rgba(10, 12, 20, 0.85)';
  drawing.fillRect(0, 0, width, height);

  // 凡例。保持中の音高であること、減衰中の尾音は含まないことを文言で示し、
  // 色だけに頼らない。丸の見本は点と同じ塗りと輪郭にする。
  drawing.textAlign = 'left';
  drawing.textBaseline = 'middle';
  drawing.beginPath();
  drawing.arc(30, SOUNDING_PIANO_LEGEND_Y, 10, 0, Math.PI * 2);
  drawing.fillStyle = SOUNDING_PIANO_DOT_FILL;
  drawing.fill();
  drawing.lineWidth = 3;
  drawing.strokeStyle = '#111111';
  drawing.stroke();
  drawing.fillStyle = '#ffffff';
  drawing.font = 'bold 28px sans-serif';
  drawing.fillText('保持中の音高', 50, SOUNDING_PIANO_LEGEND_Y);
  drawing.textAlign = 'right';
  drawing.fillStyle = '#cfe3ff';
  drawing.font = '22px sans-serif';
  drawing.fillText('減衰中の尾音は含まない', width - 24, SOUNDING_PIANO_LEGEND_Y);

  // 白鍵22鍵を全幅に並べる。C4 だけはド・C4 と記し、他は鍵名を小さく添える。
  const doSemitone = doPianoSemitone();
  for (const key of pianoKeyboardLayout()) {
    if (key.black) {
      continue;
    }
    const x = key.x0 * width;
    const keyWidth = (key.x1 - key.x0) * width;
    drawing.fillStyle = '#f2f4f8';
    drawing.fillRect(x, keyboardTop, keyWidth, height - keyboardTop);
    drawing.strokeStyle = '#111111';
    drawing.lineWidth = 2;
    drawing.strokeRect(x, keyboardTop, keyWidth, height - keyboardTop);
    drawing.textAlign = 'center';
    if (key.semitone === doSemitone) {
      drawing.fillStyle = '#111111';
      drawing.font = 'bold 30px sans-serif';
      drawing.fillText('ド／C4', x + keyWidth / 2, height - 26);
    } else {
      drawing.fillStyle = '#5a5a6a';
      drawing.font = '22px sans-serif';
      drawing.fillText(key.name, x + keyWidth / 2, height - 24);
    }
  }

  // 黒鍵15鍵を白鍵の上部に重ねる。
  for (const key of pianoKeyboardLayout()) {
    if (!key.black) {
      continue;
    }
    drawing.fillStyle = '#16181f';
    drawing.fillRect(
      key.x0 * width,
      keyboardTop,
      (key.x1 - key.x0) * width,
      SOUNDING_PIANO_BLACK_KEY_HEIGHT,
    );
    drawing.strokeStyle = '#000000';
    drawing.lineWidth = 2;
    drawing.strokeRect(
      key.x0 * width,
      keyboardTop,
      (key.x1 - key.x0) * width,
      SOUNDING_PIANO_BLACK_KEY_HEIGHT,
    );
  }

  // A6 端の終端目盛り。発音域の上端を含む。
  drawing.fillStyle = '#ffffff';
  drawing.fillRect(width - 5, keyboardTop, 5, height - keyboardTop);
}

// 点の動的部分を描く。背景は透明とし、鍵盤の静的部分の面に重ねる。
// 丸の中心はずれ後の位置に置き、周波数位置には細い線を残す。
function drawDynamicDots(
  drawing: CanvasRenderingContext2D,
  voices: readonly PitchGridSoundingVoice[],
): void {
  const width = SOUNDING_PIANO_CANVAS_WIDTH;
  const height = SOUNDING_PIANO_CANVAS_HEIGHT;
  drawing.clearRect(0, 0, width, height);
  for (const dot of layoutSoundingDots(voices)) {
    const exactX = SOUNDING_PIANO_EDGE_PAD + dot.x * (width - SOUNDING_PIANO_EDGE_PAD * 2);
    const centerX = exactX + dot.column * SOUNDING_PIANO_COLUMN_STEP;
    const centerY = SOUNDING_PIANO_DOT_BASE_Y + dot.row * SOUNDING_PIANO_ROW_STEP;
    // 周波数位置を指す細い線。重なりで丸がずれても位置を示す。
    drawing.strokeStyle = SOUNDING_PIANO_STEM_COLOR;
    drawing.lineWidth = 2;
    drawing.beginPath();
    drawing.moveTo(exactX, SOUNDING_PIANO_KEYBOARD_TOP);
    drawing.lineTo(exactX, height);
    drawing.stroke();
    // 保持中の声の塗りつぶし丸。凡例の見本と同じ塗りと輪郭にする。
    drawing.beginPath();
    drawing.arc(centerX, centerY, SOUNDING_PIANO_DOT_RADIUS, 0, Math.PI * 2);
    drawing.fillStyle = SOUNDING_PIANO_DOT_FILL;
    drawing.fill();
    drawing.lineWidth = 3;
    drawing.strokeStyle = '#111111';
    drawing.stroke();
  }
}

/**
 * 鳴り中音高のピアノ対照表示パネル。
 *
 * 鍵盤をプログラム描画し（画像同梱なし）、保持中かつ再開成立した各声を
 * 塗りつぶし丸で示す。減衰中の尾音は点に含まない。鍵盤の静的部分と点の
 * 動的部分を別の面・描画に分け、声の変化時のみ動的部分を更新する。
 * 非操作の固定面であり、照準の当たり判定を遮らない。既存の `TextPlate` は
 * 使わず、方式と見た目を変えない。
 */
export function SoundingPiano({
  voices,
  position = SOUNDING_PIANO_POSITION,
  size = SOUNDING_PIANO_SIZE,
}: SoundingPianoProps): React.JSX.Element {
  const staticTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = SOUNDING_PIANO_CANVAS_WIDTH;
    canvas.height = SOUNDING_PIANO_CANVAS_HEIGHT;
    const drawing = canvas.getContext('2d');
    if (drawing === null) {
      throw new Error('鳴り中音高の鍵盤面が作れない');
    }
    drawStaticKeyboard(drawing);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }, []);

  // 内容の署名が変わったときだけ点の動的部分を作り直す。同じ内容の再通知では
  // 前の面を使い回し、破棄もしない。署名が内容を表すため配列自体は依存に含めない。
  const voicesSignature = soundingVoicesSignature(voices);
  const dynamicTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = SOUNDING_PIANO_CANVAS_WIDTH;
    canvas.height = SOUNDING_PIANO_CANVAS_HEIGHT;
    const drawing = canvas.getContext('2d');
    if (drawing === null) {
      throw new Error('鳴り中音高の点描画面が作れない');
    }
    drawDynamicDots(drawing, voices);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }, [voicesSignature]);

  useEffect(() => {
    return () => {
      staticTexture.dispose();
      dynamicTexture.dispose();
    };
  }, [staticTexture, dynamicTexture]);

  return (
    <group position={[position[0], position[1], position[2]]}>
      <mesh position={[0, 0, 0]} raycast={() => null}>
        <planeGeometry args={[size[0], size[1]]} />
        <meshBasicMaterial map={staticTexture} transparent toneMapped={false} depthWrite={false} />
      </mesh>
      {/* 点の動的部分。静的部分の手前に重ね、変更時のみ描き直す。 */}
      <mesh position={[0, 0, 0.005]} raycast={() => null}>
        <planeGeometry args={[size[0], size[1]]} />
        <meshBasicMaterial map={dynamicTexture} transparent toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  );
}
