import { Interactable } from '@xrift/world-components';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  allPitchGridPoints,
  PITCH_GRID_VERTICAL_PRIMES,
  pitchGridKey,
  type PitchGridDimension,
  type PitchGridPoint,
} from '../../audio/pitchGrid';
import {
  createPitchGridController,
  type PitchGridController,
  type PitchGridControllerSnapshot,
} from '../../audio/pitchGridController';
import { TextPlate } from './plates';
import { SOUNDING_PIANO_POSITION, SOUNDING_PIANO_SIZE, SoundingPiano } from './SoundingPiano';

export interface PitchGridProps {
  /** 格子操作全体の基準位置。ワールド側は配置だけを担う。 */
  readonly position?: readonly [number, number, number];
}

/** 格子 Cube の一辺の長さ。 */
const GRID_CUBE_SIZE = 0.45;

/** 格子 Cube の中心間隔。照準を合わせられる間隔にする。 */
const GRID_SPACING = 0.72;

/**
 * 格子面の中心（部品内座標）。
 * 中段を開発環境の目線高（約1.44m）に置き、左右の視線・平行移動だけで
 * 中段の5点へ照準を合わせられるようにする。上段・下段は視線の俯仰で操作する。
 */
const GRID_CENTER_X = -0.85;
const GRID_CENTER_Y = 1.44;

/**
 * 格子 Cube の上の銘板の大きさ（幅・高さ）。
 * 上下の段の Cube と重ならない寸法にし、同一面の重なりによる欠けを避ける。
 */
const GRID_LABEL_SIZE: readonly [number, number] = [0.52, 0.24];

/**
 * 格子 Cube 中心から銘板中心までの高さ。
 * 自段の Cube の上端と上段の Cube の下端の間に収める。
 */
const GRID_LABEL_HEIGHT = 0.34;

/** オン状態の Cube の色。選択意図の色相の合図に使う。発音中の断定には使わない。 */
const GRID_ON_COLOR = '#ff7043';

/** オフ状態の Cube の色。非選択の色相の合図に使う。発音中の断定には使わない。 */
const GRID_OFF_COLOR = '#4caf50';

/** 移動操作釦の一辺の長さ。 */
const MOVE_BUTTON_SIZE = 0.34;

/** 移動操作釦の中心間隔。 */
const MOVE_SPACING = 0.52;

/**
 * 移動パッドの中心（部品内座標）。
 * 格子の右側に3×3正方で置き、矢印の並びが八方向の写像になるようにする。
 * 横一列ではなく正方配置にする理由は、斜め移動の向きを位置で示すためである。
 * 中段を目線高の近くに置き、水平の視線の走査で中段へ到達できるようにする。
 */
const MOVE_CENTER_X = 1.75;
const MOVE_CENTER_Y = 1.53;

/** 次元選択釦の一辺の長さ。 */
const DIM_BUTTON_SIZE = 0.38;

/** 次元選択釦の中心間隔。 */
const DIM_SPACING = 0.6;

/**
 * 次元選択列の中心（部品内座標）。
 * 移動パッドの下に横一列で置き、左から3・4・5次元の順に並べる。
 */
const DIM_CENTER_X = 1.75;
const DIM_CENTER_Y = 0.55;

/** 移動操作釦の色。格子 Cube とは別の操作対象であることの色相の合図に使う。 */
const MOVE_BUTTON_COLOR = '#5c7cfa';

/** 次元選択釦の色。選択中かは銘板の文言と枠で示し、色だけに頼らない。 */
const DIM_BUTTON_COLOR = '#78909c';

/** 選択できる縦軸の次元。左から3・4・5次元の順に並べる。 */
const DIMENSIONS: readonly PitchGridDimension[] = [3, 4, 5];

/** 八方向の移動操作の定義。右・上を正とする。 */
const MOVE_DIRECTIONS: readonly {
  readonly dx: number;
  readonly dy: number;
  readonly arrow: string;
  readonly name: string;
}[] = [
  { dx: -1, dy: 1, arrow: '↖', name: '左上' },
  { dx: 0, dy: 1, arrow: '↑', name: '上' },
  { dx: 1, dy: 1, arrow: '↗', name: '右上' },
  { dx: -1, dy: 0, arrow: '←', name: '左' },
  { dx: 1, dy: 0, arrow: '→', name: '右' },
  { dx: -1, dy: -1, arrow: '↙', name: '左下' },
  { dx: 0, dy: -1, arrow: '↓', name: '下' },
  { dx: 1, dy: -1, arrow: '↘', name: '右下' },
];

/** 格子点の表示名。軸の向きを座標で示し、色だけに頼らない。 */
function pointLabel(point: PitchGridPoint): string {
  return `(${point.x},${point.y})`;
}

/**
 * 15 Cube による音高格子の操作部品。
 *
 * 格子15点・八方向移動・次元選択の操作を一つの制御器へ集める。制御器と
 * 音声文脈はこの部品の存続中は一つだけ保ち、Cube ごとに作らない。文脈を
 * 閉じるのはこの部品の破棄時に一度だけである。オン・オフ、軸、操作対象は
 * 銘板の文言と明暗・枠でも示し、色だけに頼らない。ワールド側は配置だけを担う。
 */
export function PitchGrid({ position = [0, 0, 5] }: PitchGridProps): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<PitchGridControllerSnapshot>(() => ({
    dimension: 3,
    points: [],
    voiceCount: 0,
    soundingVoices: [],
  }));
  // 親操作部品の存続に対応する制御器。演奏口の生成は初回の発音まで遅らせる。
  const controllerRef = useRef<PitchGridController | null>(null);

  useEffect(() => {
    const controller = createPitchGridController({
      notify: () => {
        setSnapshot(controller.getSnapshot());
      },
    });
    controllerRef.current = controller;
    setSnapshot(controller.getSnapshot());
    return () => {
      controllerRef.current = null;
      void controller.dispose();
    };
  }, []);

  const handleToggle = useCallback((point: PitchGridPoint) => {
    controllerRef.current?.toggle(point);
  }, []);

  const handleMove = useCallback((dx: number, dy: number) => {
    controllerRef.current?.move(dx, dy);
  }, []);

  const handleSelectDimension = useCallback((dimension: PitchGridDimension) => {
    controllerRef.current?.selectDimension(dimension);
  }, []);

  const onKeys = new Set(snapshot.points.map((point) => pitchGridKey(point)));
  const verticalPrime = PITCH_GRID_VERTICAL_PRIMES[snapshot.dimension];

  return (
    <group position={[position[0], position[1], position[2]]}>
      {/* ========== 鳴り中音高のピアノ対照表示。格子内の固定の非操作面 ========== */}
      {/* 座標・寸法は格子上方の初期候補であり、実画面の確認で決める。 */}
      {/* 格子最上段の銘板・移動パッド・次元釦・奥側の理論説明とは重ねない。 */}
      <SoundingPiano
        voices={snapshot.soundingVoices}
        position={SOUNDING_PIANO_POSITION}
        size={SOUNDING_PIANO_SIZE}
      />

      {/* ========== 格子15点（横5×縦3）。各点のオン・オフを切り替える ========== */}
      {allPitchGridPoints().map((point) => {
        const key = pitchGridKey(point);
        const on = onKeys.has(key);
        const label = pointLabel(point);
        return (
          <group
            key={key}
            position={[GRID_CENTER_X + point.x * GRID_SPACING, GRID_CENTER_Y + point.y * GRID_SPACING, 0]}
          >
            <Interactable
              id={`pitch-grid-${point.x}-${point.y}`}
              type="button"
              onInteract={() => {
                handleToggle(point);
              }}
              interactionText={on ? `止める ${label}` : `鳴らす ${label}`}
            >
              <mesh position={[0, 0, 0]} castShadow>
                <boxGeometry args={[GRID_CUBE_SIZE, GRID_CUBE_SIZE, GRID_CUBE_SIZE]} />
                <meshStandardMaterial color={on ? GRID_ON_COLOR : GRID_OFF_COLOR} />
              </mesh>
            </Interactable>
            {/* 状態は銘板の文言と明暗でも示し、色だけに頼らない。オンは選択意図であり発音中の断定には使わない。 */}
            <TextPlate
              lines={[label, on ? 'ON' : 'OFF']}
              size={GRID_LABEL_SIZE}
              position={[0, GRID_LABEL_HEIGHT, 0]}
              light={on}
            />
          </group>
        );
      })}

      {/* ========== 軸の表示。横軸は素数3、縦軸は選択次元の素数 ========== */}
      <TextPlate
        lines={['横軸 素数3', '左← →右']}
        size={[1.6, 0.3]}
        position={[GRID_CENTER_X, 0.22, 0]}
      />
      <TextPlate
        lines={[`縦軸 素数${verticalPrime}`, `${snapshot.dimension}次元を選択中`]}
        size={[1.1, 0.5]}
        position={[-3.0, GRID_CENTER_Y, 0]}
      />

      {/* ========== 八方向の移動操作。格子とは別の操作対象として配置 ========== */}
      {MOVE_DIRECTIONS.map((direction) => (
        <group
          key={`${direction.dx},${direction.dy}`}
          position={[
            MOVE_CENTER_X + direction.dx * MOVE_SPACING,
            MOVE_CENTER_Y + direction.dy * MOVE_SPACING,
            0,
          ]}
        >
          <Interactable
            id={`pitch-grid-move-${direction.dx}-${direction.dy}`}
            type="button"
            onInteract={() => {
              handleMove(direction.dx, direction.dy);
            }}
            interactionText={`移動 ${direction.name} ${direction.arrow}`}
          >
            <mesh position={[0, 0, 0]} castShadow>
              <boxGeometry args={[MOVE_BUTTON_SIZE, MOVE_BUTTON_SIZE, MOVE_BUTTON_SIZE]} />
              <meshStandardMaterial color={MOVE_BUTTON_COLOR} />
            </mesh>
          </Interactable>
          {/* 矢印は釦の正面に置き、向きを位置と字形で示す。当たり判定は背後の釦に届く。 */}
          <TextPlate
            lines={[direction.arrow, direction.name]}
            size={[MOVE_BUTTON_SIZE, MOVE_BUTTON_SIZE]}
            position={[0, 0, MOVE_BUTTON_SIZE / 2 + 0.01]}
          />
        </group>
      ))}
      {/* パッド中央の非操作の銘板。八方向の操作対象であることを示す。 */}
      <TextPlate lines={['移動', '8方向']} size={[0.4, 0.34]} position={[MOVE_CENTER_X, MOVE_CENTER_Y, 0.18]} />

      {/* ========== 縦軸の次元選択。選択中は文言と枠でも示す ========== */}
      {DIMENSIONS.map((dimension, index) => {
        const selected = snapshot.dimension === dimension;
        const prime = PITCH_GRID_VERTICAL_PRIMES[dimension];
        const offset = (index - (DIMENSIONS.length - 1) / 2) * DIM_SPACING;
        return (
          <group key={dimension} position={[DIM_CENTER_X + offset, DIM_CENTER_Y, 0]}>
            <Interactable
              id={`pitch-grid-dim-${dimension}`}
              type="button"
              onInteract={() => {
                handleSelectDimension(dimension);
              }}
              interactionText={selected ? `選択中 ${dimension}次元 素数${prime}` : `縦軸を${dimension}次元 素数${prime}に切替`}
            >
              <mesh position={[0, 0, 0]} castShadow>
                <boxGeometry args={[DIM_BUTTON_SIZE, DIM_BUTTON_SIZE, DIM_BUTTON_SIZE]} />
                <meshStandardMaterial color={DIM_BUTTON_COLOR} />
              </mesh>
            </Interactable>
            <TextPlate
              lines={selected ? [`▼${dimension}次元`, `選択中 素数${prime}`] : [`${dimension}次元`, `素数${prime}`]}
              size={[DIM_BUTTON_SIZE + 0.06, DIM_BUTTON_SIZE + 0.06]}
              position={[0, 0, DIM_BUTTON_SIZE / 2 + 0.01]}
              light={selected}
              framed={selected}
            />
          </group>
        );
      })}
    </group>
  );
}
