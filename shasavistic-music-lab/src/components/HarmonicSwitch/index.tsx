import { Interactable } from '@xrift/world-components';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { HARMONIC_CHORD_SETS, formatHarmonicRatioLabel } from './chordSets';
import {
  createHarmonicCubeSwitch,
  type HarmonicCubeSnapshot,
  type HarmonicCubeSwitch,
} from './cubeSwitch';

export interface HarmonicSwitchProps {
  /** 4 Cube の列の中心位置。ワールド側は配置だけを担う。 */
  readonly position?: readonly [number, number, number];
}

/** 停止時の Cube の基本色。 */
const CUBE_BASE_COLOR = '#4caf50';

/** 発音中の Cube の強調色。 */
const CUBE_PLAYING_COLOR = '#ff7043';

/** 減衰中・切替待ちの Cube の中間色。 */
const CUBE_RELEASING_COLOR = '#ffab91';

/** 再操作待ちの Cube の色。無音であり成功表示にしない。 */
const CUBE_RETRY_COLOR = '#90a4af';

/** Cube の一辺の長さ。 */
const CUBE_SIZE = 0.6;

/** 隣り合う Cube の中心間隔。照準を合わせられる間隔にする。 */
const CUBE_SPACING = 1.0;

/** ラベル面の大きさ（幅・高さ）。隣の Cube の表示と重ならない幅にする。 */
const LABEL_SIZE: readonly [number, number] = [1.0, 0.5];

/** Cube 中心からラベル面中心までの高さ。 */
const LABEL_HEIGHT = 0.85;

/**
 * Cube の上に置く常時表示のラベル。
 *
 * CanvasTexture を貼った非操作の面であり、組合せの名前と比率の2行を示す。
 * drei の Text（Troika 系の Worker 同梱リスク）や Html（DOM 専用）は使わず、
 * 依存を増やさない。照準の当たり判定を遮らないよう光線追跡を受け付けない。
 */
function CubeLabel({
  name,
  ratioLine,
  position,
}: {
  /** 組合せの表示名。 */
  readonly name: string;
  /** 比率の短い1行（例: `1/1 5/4 3/2`）。 */
  readonly ratioLine: string;
  /** ラベル面の配置位置。 */
  readonly position: readonly [number, number, number];
}): React.JSX.Element {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const drawing = canvas.getContext('2d');
    if (drawing === null) {
      throw new Error('常時表示の描画面が作れない');
    }
    drawing.fillStyle = 'rgba(10, 12, 20, 0.78)';
    drawing.fillRect(0, 0, canvas.width, canvas.height);
    drawing.textAlign = 'center';
    drawing.textBaseline = 'middle';
    drawing.fillStyle = '#ffffff';
    drawing.font = 'bold 60px sans-serif';
    drawing.fillText(name, canvas.width / 2, 80);
    drawing.fillStyle = '#cfe3ff';
    drawing.font = '48px sans-serif';
    drawing.fillText(ratioLine, canvas.width / 2, 175);
    const labelTexture = new THREE.CanvasTexture(canvas);
    labelTexture.colorSpace = THREE.SRGBColorSpace;
    labelTexture.anisotropy = 4;
    return labelTexture;
  }, [name, ratioLine]);

  useEffect(() => {
    return () => {
      texture.dispose();
    };
  }, [texture]);

  return (
    <mesh position={[position[0], position[1], position[2]]} raycast={() => null}>
      <planeGeometry args={[LABEL_SIZE[0], LABEL_SIZE[1]]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} depthWrite={false} />
    </mesh>
  );
}

/**
 * Cube ごとの色と操作文を求める。
 *
 * 状態は色だけでなく操作文でも区別する。起動の完了待ちは減衰・切替待ちと
 * 同じ中間表示にし、古い選択の表示が残らないよう快照だけに従う。
 *
 * @param cubeId - 対象の Cube の選択 ID。
 * @param snapshot - 制御器の現在の快照。
 * @returns Cube の色と操作文。
 */
function cubeVisual(
  cubeId: string,
  name: string,
  snapshot: HarmonicCubeSnapshot,
): { color: string; interactionText: string } {
  if (snapshot.activeId === cubeId) {
    if (snapshot.status === 'playing') {
      return { color: CUBE_PLAYING_COLOR, interactionText: `音を止める: ${name}` };
    }
    return { color: CUBE_RELEASING_COLOR, interactionText: `減衰中…: ${name}` };
  }
  if (snapshot.pendingId === cubeId) {
    return { color: CUBE_RELEASING_COLOR, interactionText: `切替待ち: ${name}` };
  }
  if (snapshot.status === 'needsRetry' && snapshot.retryId === cubeId) {
    return { color: CUBE_RETRY_COLOR, interactionText: `再操作が必要: ${name}` };
  }
  return { color: CUBE_BASE_COLOR, interactionText: `鳴らす: ${name}` };
}

/**
 * 4 Cube による調波和音の選択と常時表示の親操作部品。
 *
 * 4 つの Cube で1つの演奏口と1つの音声文脈を共有する。Cube ごとに演奏口や
 * 文脈を作らず、文脈を閉じるのはこの部品の破棄時に一度だけである。
 * 選択世代と起動待ちは制御器（`cubeSwitch`）で一元管理し、起動待ち・失敗・
 * 破棄後の非同期完了が古い選択を再生しない。ワールド側は配置だけを担う。
 */
export function HarmonicSwitch({ position = [0, 1.3, 5] }: HarmonicSwitchProps): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<HarmonicCubeSnapshot>(() => ({
    status: 'stopped',
    activeId: null,
    pendingId: null,
    retryId: null,
  }));
  // 親操作部品の存続に対応する制御器。演奏口の生成は初回の操作まで遅らせる。
  const switchRef = useRef<HarmonicCubeSwitch | null>(null);

  useEffect(() => {
    let controller!: HarmonicCubeSwitch;
    controller = createHarmonicCubeSwitch({
      notify: () => {
        setSnapshot(controller.getSnapshot());
      },
    });
    switchRef.current = controller;
    setSnapshot(controller.getSnapshot());
    return () => {
      switchRef.current = null;
      void controller.dispose();
    };
  }, []);

  const handleCubeInteract = useCallback((cubeId: string) => {
    switchRef.current?.interact(cubeId);
  }, []);

  return (
    <group position={[position[0], position[1], position[2]]}>
      {HARMONIC_CHORD_SETS.map((chordSet, index) => {
        // 列の中心を基準に等間隔で並べ、組合せ列と配置の対応を添字で保つ。
        const offset = (index - (HARMONIC_CHORD_SETS.length - 1) / 2) * CUBE_SPACING;
        const visual = cubeVisual(chordSet.id, chordSet.name, snapshot);
        return (
          <group key={chordSet.id} position={[offset, 0, 0]}>
            <Interactable
              id={`harmonic-cube-${chordSet.id}`}
              type="button"
              onInteract={() => {
                handleCubeInteract(chordSet.id);
              }}
              interactionText={visual.interactionText}
            >
              <mesh position={[0, 0, 0]} castShadow>
                <boxGeometry args={[CUBE_SIZE, CUBE_SIZE, CUBE_SIZE]} />
                <meshStandardMaterial color={visual.color} />
              </mesh>
            </Interactable>
            <CubeLabel
              name={chordSet.name}
              ratioLine={formatHarmonicRatioLabel(chordSet.ratios)}
              position={[0, LABEL_HEIGHT, 0]}
            />
          </group>
        );
      })}
    </group>
  );
}
