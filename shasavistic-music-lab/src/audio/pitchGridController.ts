/**
 * 格子操作の単一制御器。
 *
 * 選択次元とオンの座標集合を所有し、各Cubeの操作、八方向操作、
 * 次元選択をこの制御器へ集める。状態の所有と受付はここが担い、
 * 音声側（`pitchGridSound`）は座標集合の反映だけを担う。
 * 音声側が格子範囲や移動可否を再判定することはない。
 *
 * 移動は移動先を先に判定し、全点が収まる場合だけ集合全体を
 * 一度に更新する。次元切替では選択次元だけを更新してオン集合を保ち、
 * 保持した全座標を新次元の周波数で鳴らし直す。空集合の切替では発音も
 * 文脈生成もしない。UI接続は次の増分であり、ここでは操作口と
 * 快照だけを用意する。旧4 Cubeの置換は含まない。
 *
 * @packageDocumentation
 */

import {
  createPitchGridSound,
  type PitchGridSound,
  type PitchGridSoundingVoice,
  type PitchGridVoiceSpec,
} from './pitchGridSound';
import {
  assignPitchGridFrequencies,
  createPitchGridState,
  type PitchGridDimension,
  type PitchGridPoint,
} from './pitchGrid';

/** 操作側が画面へ渡す快照。値は読み取り専用とする。 */
export interface PitchGridControllerSnapshot {
  /** 選択次元。 */
  readonly dimension: PitchGridDimension;
  /** オンの座標。上段・左からの順序。 */
  readonly points: readonly PitchGridPoint[];
  /** 音声側が所有する声の数。減衰の予約後と起動の完了待ちを含む。 */
  readonly voiceCount: number;
  /**
   * 音声側で保持中かつ再開成立した声の鍵と周波数（表示用）。
   *
   * 選択意図の `points` から周波数を再計算したものではなく、音声側の
   * 表示一覧をそのまま載せる。再開未成立・再開失敗・減衰中の声は含まない。
   */
  readonly soundingVoices: readonly PitchGridSoundingVoice[];
}

/** 制御器の生成条件。 */
export interface PitchGridControllerOptions {
  /**
   * 演奏口の生成口。省略時は実物の個別声演奏口を使う。
   * 検査では声の対応を数えられる代替物で差し替える。
   */
  readonly createSound?: () => PitchGridSound;
  /** 状態が変わったときの通知口。省略時は通知しない。 */
  readonly notify?: () => void;
}

/** 格子操作の単一制御器。 */
export interface PitchGridController {
  /** 現在の快照を返す。 */
  getSnapshot(): PitchGridControllerSnapshot;
  /**
   * 指定した点のオン・オフを切り替える。
   *
   * @param point - 操作した格子点。範囲内であること。
   * @throws `Error` — 格子外の座標の場合。音声文脈は生成しない。
   */
  toggle(point: PitchGridPoint): void;
  /**
   * オン集合全体を八方向へ1マス移動する。
   *
   * 格子外へ出る・空集合の場合は集合全体について行わず、音声へも触れない。
   *
   * @param dx - 横方向の移動量。`-1…1` の整数。
   * @param dy - 縦方向の移動量。`-1…1` の整数。両方が0ではならない。
   * @returns 集合全体を更新した場合は `true`。
   * @throws `RangeError` — 移動量が八方向のいずれでもない場合。音声へは触れない。
   */
  move(dx: number, dy: number): boolean;
  /**
   * 縦軸の次元を選び直す。
   *
   * 切替ではオン集合を保ち、選択次元だけを更新する。空集合の切替では
   * 発音も文脈生成もしない。同じ次元の選び直しは何もしない。
   * 再開に失敗しても集合と新次元は巻き戻さず、声だけを失敗扱いとして
   * 次の操作で鳴らし直せるようにする。
   *
   * @param dimension - 選択次元。
   * @throws `RangeError` — 選択次元でない場合。音声へは触れない。
   */
  selectDimension(dimension: PitchGridDimension): void;
  /**
   * 演奏口を止めて音声文脈を閉じる。
   *
   * @remarks
   * 複数回呼んでも文脈の close は一度だけ行う。起動前に呼んだ場合は
   * 文脈を作らずに終える。破棄後の操作は受け付けない。
   */
  dispose(): Promise<void>;
}

/**
 * 格子操作の単一制御器を作る。
 *
 * 呼び出し側は利用者の操作処理の中から操作口を呼ぶ。
 * 演奏口の生成は初回の発音まで遅らせる。
 *
 * @param options - 演奏口の生成口と状態通知口。
 * @returns 親操作部品の存続中は使い回す制御器。
 */
export function createPitchGridController(
  options: PitchGridControllerOptions = {},
): PitchGridController {
  const createSound = options.createSound ?? createPitchGridSound;
  const notify = options.notify ?? ((): void => {});
  const state = createPitchGridState();
  let sound: PitchGridSound | null = null;
  let disposed = false;
  let disposePromise: Promise<void> | null = null;
  // 音声側の表示内容変化の購読解除口。演奏口の生成時に購読し、破棄時に外す。
  let unsubscribeSounding: (() => void) | null = null;

  // 発音配置の算出は担わず、所有する集合と次元を配置関数へ渡すだけとする。
  // その結果から全声仕様を作る。呼び出し口の構造は変えない。
  const specsOf = (
    dimension: PitchGridDimension,
    points: readonly PitchGridPoint[],
  ): PitchGridVoiceSpec[] =>
    assignPitchGridFrequencies(points, dimension).map(
      (assigned): PitchGridVoiceSpec => ({ key: assigned.key, frequency: assigned.frequency }),
    );

  // 演奏口の生成は初回の発音まで遅らせる。生成時に音声側の表示内容変化を
  // 購読し、制御器の既存通知へ転送する。表示の快照取得と通知の接続だけが
  // 目的であり、音声資源の読出しには使わない。
  const ensureSound = (): PitchGridSound => {
    if (sound === null) {
      const created = createSound();
      unsubscribeSounding = created.subscribeSounding(() => {
        if (!disposed) {
          notify();
        }
      });
      sound = created;
    }
    return sound;
  };

  // 現在の集合を音声側へ反映する。差分の取捨は音声側が担う。
  // 再開の失敗時は声だけが外れ、状態の意図は保つ。再操作で鳴らし直せる。
  const reflect = (dimension: PitchGridDimension, points: readonly PitchGridPoint[]): void => {
    if (sound === null || disposed) {
      return;
    }
    const active = sound;
    const specs = specsOf(dimension, points);
    void active
      .setVoices(specs)
      .then(() => {
        if (!disposed) {
          notify();
        }
      })
      .catch(() => {
        if (!disposed) {
          notify();
        }
      });
  };

  const controller: PitchGridController = {
    getSnapshot(): PitchGridControllerSnapshot {
      const snapshot = state.getSnapshot();
      return {
        dimension: snapshot.dimension,
        points: snapshot.points,
        voiceCount: sound === null ? 0 : sound.voiceCount,
        soundingVoices: sound === null ? [] : sound.soundingVoices,
      };
    },
    toggle(point: PitchGridPoint): void {
      if (disposed) {
        return;
      }
      // 格子外の座標では文脈を作らずに拒む。対応付けの破れを表面化させる。
      const snapshot = state.toggle(point);
      if (snapshot.points.length > 0) {
        ensureSound();
      }
      reflect(snapshot.dimension, snapshot.points);
      notify();
    },
    move(dx: number, dy: number): boolean {
      if (disposed) {
        return false;
      }
      // 移動量の検証は状態側が担い、不正時は音声へ触れずに投げる。
      const result = state.move(dx, dy);
      if (!result.applied) {
        return false;
      }
      reflect(result.snapshot.dimension, result.snapshot.points);
      notify();
      return true;
    },
    selectDimension(dimension: PitchGridDimension): void {
      if (disposed) {
        return;
      }
      // 次元の検証は状態側が担い、不正時は音声へ触れずに投げる。
      const result = state.selectDimension(dimension);
      if (!result.changed) {
        return;
      }
      // 空集合の切替では発音も文脈生成もしない。次元の更新だけを保つ。
      if (result.snapshot.points.length === 0) {
        notify();
        return;
      }
      const created = ensureSound();
      // 切替専用の境界で旧声を止め、保持した全座標を新次元で鳴らし直す。
      // 再開の失敗時は声だけが外れ、集合と新次元は保つ。再操作で鳴らし直せる。
      const specs = specsOf(result.snapshot.dimension, result.snapshot.points);
      void created
        .switchDimension(specs)
        .then(() => {
          if (!disposed) {
            notify();
          }
        })
        .catch(() => {
          if (!disposed) {
            notify();
          }
        });
      notify();
    },
    dispose(): Promise<void> {
      if (disposePromise !== null) {
        const pending = disposePromise;
        return pending;
      }
      disposed = true;
      const active = sound;
      sound = null;
      const unsubscribe = unsubscribeSounding;
      unsubscribeSounding = null;
      unsubscribe?.();
      if (active === null) {
        disposePromise = Promise.resolve();
        return disposePromise;
      }
      disposePromise = active.dispose();
      return disposePromise;
    },
  };

  return controller;
}
