import { Interactable, useInstanceState } from '@xrift/world-components';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  allPitchGridPoints,
  isInPitchGrid,
  isPitchGridDimension,
  movePitchGridIntent,
  PITCH_GRID_INITIAL_INTENT,
  PITCH_GRID_INTENT_STATE_ID,
  PITCH_GRID_VERTICAL_PRIMES,
  pitchGridKey,
  pitchGridSnapshotFromIntent,
  resolvePitchGridIntent,
  selectPitchGridDimensionIntent,
  shiftPitchGridPoints,
  specifyFunctionalRootIntent,
  togglePitchGridIntent,
  type PitchGridDimension,
  type PitchGridIntent,
  type PitchGridPoint,
} from '../../audio/pitchGrid';
import {
  createPitchGridSemanticSoundReflector,
  type PitchGridSemanticSoundReflector,
  type PitchGridSemanticSoundSnapshot,
} from '../../audio/pitchGridSemanticController';
import {
  CHORD_DIAGRAM_POSITION,
  CHORD_DIAGRAM_SIZE,
  ChordDiagramPanel,
} from './ChordDiagramPanel';
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

/**
 * 機能根の指定モード切替釦の中心（部品内座標）。
 * 次元選択列の右側に縦一列で置く初期候補である。部品形状は未確定であり、
 * XR実画面の確認で決めること。移動パッド・次元釦・和音図パネルとは重ねない。
 */
const ROOT_MODE_CENTER_X = 3.0;

/** 指定モード切替釦の中心高さ（部品内座標）。 */
const ROOT_MODE_CENTER_Y = 0.95;

/**
 * 機能根の状態銘板の中心（部品内座標）。
 * 切替釦の上に置く初期候補である。指定モードと確定した根の有無を
 * 文言で示し、色だけに頼らない。
 */
const ROOT_STATUS_CENTER_Y = 1.5;

/**
 * 機能根の操作釦の一辺の長さ。
 * 次元選択釦と同じ寸法の初期候補である。部品形状は未確定であり、
 * XR実画面の確認で決めること。
 */
const ROOT_BUTTON_SIZE = 0.38;

/** 機能根の操作釦の色。格子 Cube とは別の操作対象であることの色相の合図に使う。 */
const ROOT_BUTTON_COLOR = '#ab47bc';

/** 機能根の状態銘板の大きさ（幅・高さ）。 */
const ROOT_STATUS_SIZE: readonly [number, number] = [0.9, 0.42];

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
 * 演奏意図の唯一の所有者は共有機構（`useInstanceState`）に置き、
 * 格子15点・八方向移動・次元選択の操作は純粋な遷移として関数型更新へ渡す。
 * 音声文脈と発音中の声は各端末ローカルのまま反射器で保ち、
 * 共有快照の変化を自端末の音へ反映する。実際に鳴った声の表示も端末内に保つ。
 * オン・オフ、軸、操作対象は銘板の文言と明暗・枠でも示し、色だけに頼らない。
 * ワールド側は配置だけを担う。
 */
export function PitchGrid({ position = [0, 0, 5] }: PitchGridProps): React.JSX.Element {
  // 演奏意図の所有者は共有機構に置く。同時操作の取りこぼし
  // （後に届いた書き込みが残る）は許容する。
  const [intent, setIntent] = useInstanceState<PitchGridIntent>(
    PITCH_GRID_INTENT_STATE_ID,
    PITCH_GRID_INITIAL_INTENT,
  );
  // 共有値は境界で確かめてから表示と反映に使う。
  const snapshot = useMemo(() => pitchGridSnapshotFromIntent(intent), [intent]);
  // 確定した機能根の座標鍵だけを共有意図から読む。指定モード
  // （選択中であること）は各端末の操作状態とし、共有しない。
  const resolvedIntent = useMemo(() => resolvePitchGridIntent(intent), [intent]);
  const functionalRootKey = resolvedIntent.functionalRootKey;
  const functionalRootSource = resolvedIntent.functionalRootSource;
  // 機能根の指定モード。各端末の操作状態であり、共有意図には載せない。
  const [specifyMode, setSpecifyMode] = useState(false);
  // 実際に鳴った声の表示は各端末ローカルに保つ。意図の共有と発音成立は別物とする。
  const [soundSnapshot, setSoundSnapshot] = useState<PitchGridSemanticSoundSnapshot>(() => ({
    voiceCount: 0,
    soundingVoices: [],
    failureMessage: null,
  }));
  // 親操作部品の存続に対応する反射器。意味論 session を専有する単一経路であり、
  // 発音口の生成は初回の発音まで遅らせる。
  const reflectorRef = useRef<PitchGridSemanticSoundReflector | null>(null);

  useEffect(() => {
    const reflector = createPitchGridSemanticSoundReflector({
      notify: () => {
        setSoundSnapshot({ ...reflector.getSnapshot() });
      },
    });
    reflectorRef.current = reflector;
    return () => {
      reflectorRef.current = null;
      void reflector.dispose();
    };
  }, []);

  // 共有意図の変化を自端末の音へ反映する。自分の操作と遠隔の変化を区別せず、
  // 同じ一経路に寄せて二重発火を作らない。機能根を含む共有意図そのものを渡し、
  // 選び直しは反射器・描画側で行わない。同値の再反映の抑止は設けず、
  // session・音声側の継続分岐に寄せる。
  useEffect(() => {
    const reflector = reflectorRef.current;
    if (reflector === null) {
      return;
    }
    reflector.reflect(intent);
    setSoundSnapshot({ ...reflector.getSnapshot() });
  }, [intent]);

  const handleToggle = useCallback(
    (point: PitchGridPoint) => {
      // 格子外は共有へ送らず同期的に拒む。更新口の中での投げでは到達が遅れるため先に確かめる。
      if (!isInPitchGrid(point)) {
        throw new Error(`格子外の座標である: (${String(point.x)}, ${String(point.y)})`);
      }
      setIntent((prev) => togglePitchGridIntent(prev, point));
    },
    [setIntent],
  );

  const handleMove = useCallback(
    (dx: number, dy: number) => {
      // 移動量の正当性はここで同期的に確かめ、不正時は共有へ送らずに投げる。
      // 空集合・格子外への移動は共有へ書かず、音声へも触れない。
      const shifted = shiftPitchGridPoints(snapshot.points, dx, dy);
      if (shifted === null) {
        return;
      }
      setIntent((prev) => movePitchGridIntent(prev, dx, dy));
    },
    [setIntent, snapshot],
  );

  const handleSelectDimension = useCallback(
    (dimension: PitchGridDimension) => {
      if (!isPitchGridDimension(dimension)) {
        throw new RangeError(`縦軸の次元は3・4・5のいずれかであること: ${String(dimension)}`);
      }
      if (dimension === snapshot.dimension) {
        return;
      }
      setIntent((prev) => selectPitchGridDimensionIntent(prev, dimension));
    },
    [setIntent, snapshot],
  );

  const handleSpecifyRoot = useCallback(
    (point: PitchGridPoint) => {
      // オンでない点は機能根に指定できないため、共有へ送らず無視する。
      // 共有値の変化との競合は取りこぼしとして許容する。
      const key = pitchGridKey(point);
      if (!snapshot.points.some((entry) => pitchGridKey(entry) === key)) {
        return;
      }
      setIntent((prev) => specifyFunctionalRootIntent(prev, point));
    },
    [setIntent, snapshot],
  );

  const handleCubeTap = useCallback(
    (point: PitchGridPoint) => {
      // 指定モード中だけ立方体タップを機能根の指定に使い、通常の
      // オン・オフ操作と競合させない。既存の操作は変えない。
      if (specifyMode) {
        handleSpecifyRoot(point);
        return;
      }
      handleToggle(point);
    },
    [specifyMode, handleSpecifyRoot, handleToggle],
  );

  const handleToggleSpecifyMode = useCallback(() => {
    setSpecifyMode((prev) => !prev);
  }, []);

  const onKeys = new Set(snapshot.points.map((point) => pitchGridKey(point)));
  const verticalPrime = PITCH_GRID_VERTICAL_PRIMES[snapshot.dimension];

  return (
    <group position={[position[0], position[1], position[2]]}>
      {/* ========== 鳴り中音高のピアノ対照表示。格子内の固定の非操作面 ========== */}
      {/* 座標・寸法は格子上方の初期候補であり、実画面の確認で決める。 */}
      {/* 格子最上段の銘板・移動パッド・次元釦・奥側の理論説明とは重ねない。 */}
      <SoundingPiano
        voices={soundSnapshot.soundingVoices}
        position={SOUNDING_PIANO_POSITION}
        size={SOUNDING_PIANO_SIZE}
      />

      {/* ========== 格子15点（横5×縦3）。各点のオン・オフを切り替える ========== */}
      {/* 指定モード中だけ立方体タップを機能根の指定に使う。 */}
      {allPitchGridPoints().map((point) => {
        const key = pitchGridKey(point);
        const on = onKeys.has(key);
        const isRoot = functionalRootKey === key;
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
                handleCubeTap(point);
              }}
              interactionText={
                specifyMode ? (on ? `根に指定 ${label}` : `指定不可 ${label}`) : on ? `止める ${label}` : `鳴らす ${label}`
              }
            >
              <mesh position={[0, 0, 0]} castShadow>
                <boxGeometry args={[GRID_CUBE_SIZE, GRID_CUBE_SIZE, GRID_CUBE_SIZE]} />
                <meshStandardMaterial color={on ? GRID_ON_COLOR : GRID_OFF_COLOR} />
              </mesh>
            </Interactable>
            {/* 状態は銘板の文言と明暗でも示し、色だけに頼らない。オンは選択意図であり発音中の断定には使わない。 */}
            {/* 機能根の点は枠と文言で示す。指定モードの操作状態は銘板の対象外とする。 */}
            <TextPlate
              lines={[label, isRoot ? '根 ON' : on ? 'ON' : 'OFF']}
              size={GRID_LABEL_SIZE}
              position={[0, GRID_LABEL_HEIGHT, 0]}
              light={on}
              framed={isRoot}
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
      {/* ========== 和音図の線構造プレビュー。共有意図の非操作面 ========== */}
      {/* 座標・寸法は格子右上の初期候補であり、実画面の確認で決める。 */}
      {/* 鳴り中音高パネル・移動パッド・次元釦・格子とは重ねない。 */}
      <ChordDiagramPanel
        dimension={snapshot.dimension}
        points={snapshot.points}
        functionalRootKey={functionalRootKey}
        position={CHORD_DIAGRAM_POSITION}
        size={CHORD_DIAGRAM_SIZE}
      />

      {/* ========== 機能根の指定モード切替。共有するのは確定した根と由来だけ ========== */}
      {/* 部品形状は未確定であり、妥当な初期形として次元選択の流儀の釦と状態銘板を置く。 */}
      {/* 指定モードは端末ごとの操作状態とし、共有意図には載せない。解除操作は設けない。 */}
      <group position={[ROOT_MODE_CENTER_X, ROOT_MODE_CENTER_Y, 0]}>
        <Interactable
          id="pitch-grid-root-mode"
          type="button"
          onInteract={() => {
            handleToggleSpecifyMode();
          }}
          interactionText={specifyMode ? '根指定モードを終える' : '根指定モードに入る'}
        >
          <mesh position={[0, 0, 0]} castShadow>
            <boxGeometry args={[ROOT_BUTTON_SIZE, ROOT_BUTTON_SIZE, ROOT_BUTTON_SIZE]} />
            <meshStandardMaterial color={ROOT_BUTTON_COLOR} />
          </mesh>
        </Interactable>
        <TextPlate
          lines={specifyMode ? ['根指定', '指定中'] : ['根指定', 'OFF']}
          size={[ROOT_BUTTON_SIZE + 0.06, ROOT_BUTTON_SIZE + 0.06]}
          position={[0, 0, ROOT_BUTTON_SIZE / 2 + 0.01]}
          light={specifyMode}
          framed={specifyMode}
        />
      </group>
      {/* 指定モードと確定した根の由来を文言で示し、色だけに頼らない。オン点なしのときは根を示さない。 */}
      <TextPlate
        lines={[
          specifyMode ? '根指定中' : '根指定OFF',
          snapshot.points.length === 0
            ? 'オン点なし'
            : functionalRootSource === 'visitor'
              ? `指定根 ${functionalRootKey ?? ''}`
              : functionalRootSource === 'unknown'
                ? `根〈由来不明〉 ${functionalRootKey ?? ''}`
                : `既定根 ${functionalRootKey ?? ''}`,
        ]}
        size={ROOT_STATUS_SIZE}
        position={[ROOT_MODE_CENTER_X, ROOT_STATUS_CENTER_Y, 0]}
        light={specifyMode}
      />
    </group>
  );
}
