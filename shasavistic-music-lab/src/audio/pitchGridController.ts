/**
 * 共有意図の快照をローカル音声へ反映する役。
 *
 * 意図状態の所有は担わない。所有者は共有機構（`useInstanceState`）に置き、
 * この口は共有快照の変化を自端末の音へ反映するだけである。
 * `AudioContext` と発音中の声は各端末ローカルのまま保ち、共有しない。
 *
 * 点の変更は既存の点反映（`setVoices`）、次元変更は切替の専用境界
 * （`switchDimension`）で鳴らし直す。同値の再反映の抑止は共有側に設けず、
 * 音声側の継続分岐（同鍵・同周波数は継続）に寄せる。
 * 実際に鳴った声の数と一覧表示は各端末で鳴った声の表示として保つ。
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
  type PitchGridDimension,
  type PitchGridPoint,
  type PitchGridSnapshot,
} from './pitchGrid';

/** 反射器が画面へ渡す快照。実際に鳴った声だけを載せる。値は読み取り専用とする。 */
export interface PitchGridSoundSnapshot {
  /** 音声側が所有する声の数。減衰の予約後と起動の完了待ちを含む。 */
  readonly voiceCount: number;
  /**
   * 音声側で保持中かつ再開成立した声の鍵と周波数（表示用）。
   *
   * 選択意図の座標から周波数を再計算したものではなく、音声側の
   * 表示一覧をそのまま載せる。再開未成立・再開失敗・減衰中の声は含まない。
   */
  readonly soundingVoices: readonly PitchGridSoundingVoice[];
}

/** 反射器の生成条件。 */
export interface PitchGridSoundReflectorOptions {
  /**
   * 演奏口の生成口。省略時は実物の個別声演奏口を使う。
   * 検査では声の対応を数えられる代替物で差し替える。
   */
  readonly createSound?: () => PitchGridSound;
  /** 状態が変わったときの通知口。省略時は通知しない。 */
  readonly notify?: () => void;
}

/** 共有快照をローカル音声へ反映する口。 */
export interface PitchGridSoundReflector {
  /** ローカル音声の表示用快照を返す。 */
  getSnapshot(): PitchGridSoundSnapshot;
  /**
   * 共有意図の快照を自端末の音へ反映する。
   *
   * 自分の操作による変化と遠隔の変化を区別せず、同じ一経路で反映する。
   * 空集合の反映では文脈を作らず発音もしない。次元が変わった反映だけ
   * 切替境界で鳴らし直し、それ以外は通常反映に寄せる。
   * 同値の再反映も抑止せず音声側へ渡す。
   *
   * @param snapshot - 共有機構から読み替えた選択次元とオンの座標列。
   */
  reflect(snapshot: PitchGridSnapshot): void;
  /**
   * 演奏口を止めて音声文脈を閉じる。
   *
   * @remarks
   * 複数回呼んでも文脈の close は一度だけ行う。起動前に呼んだ場合は
   * 文脈を作らずに終える。破棄後の反映は受け付けない。
   */
  dispose(): Promise<void>;
}

/**
 * 共有快照をローカル音声へ反映する口を作る。
 *
 * 呼び出し側は共有快照の変化時に反映口を呼ぶ。
 * 演奏口の生成は初回の発音まで遅らせる。
 *
 * @param options - 演奏口の生成口と状態通知口。
 * @returns 親操作部品の存続中は使い回す反射器。
 */
export function createPitchGridSoundReflector(
  options: PitchGridSoundReflectorOptions = {},
): PitchGridSoundReflector {
  const createSound = options.createSound ?? createPitchGridSound;
  const notify = options.notify ?? ((): void => {});
  let sound: PitchGridSound | null = null;
  let disposed = false;
  let disposePromise: Promise<void> | null = null;
  // 音声側の表示内容変化の購読解除口。演奏口の生成時に購読し、破棄時に外す。
  let unsubscribeSounding: (() => void) | null = null;
  // 直近に反映した選択次元。次元が変わった反映だけ切替境界へ寄せる。
  let lastDimension: PitchGridDimension | null = null;

  // 発音配置の算出は担わず、共有快照の集合と次元を配置関数へ渡すだけとする。
  // その結果から全声仕様を作る。呼び出し口の構造は変えない。
  const specsOf = (
    dimension: PitchGridDimension,
    points: readonly PitchGridPoint[],
  ): PitchGridVoiceSpec[] =>
    assignPitchGridFrequencies(points, dimension).map(
      (assigned): PitchGridVoiceSpec => ({ key: assigned.key, frequency: assigned.frequency }),
    );

  // 演奏口の生成は初回の発音まで遅らせる。生成時に音声側の表示内容変化を
  // 購読し、反射器の既存通知へ転送する。表示の快照取得と通知の接続だけが
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

  const reflector: PitchGridSoundReflector = {
    getSnapshot(): PitchGridSoundSnapshot {
      return {
        voiceCount: sound === null ? 0 : sound.voiceCount,
        soundingVoices: sound === null ? [] : sound.soundingVoices,
      };
    },
    reflect(snapshot: PitchGridSnapshot): void {
      if (disposed) {
        return;
      }
      // 空集合の反映では文脈を作らず発音もしない。次元の追跡だけ進める。
      if (snapshot.points.length === 0 && sound === null) {
        lastDimension = snapshot.dimension;
        return;
      }
      const active = ensureSound();
      const specs = specsOf(snapshot.dimension, snapshot.points);
      // 次元が変わった反映だけ切替境界で鳴らし直す。同値・同一次元の
      // 再反映の抑止は設けず、音声側の継続分岐に寄せる。
      const task =
        lastDimension !== null && snapshot.dimension !== lastDimension
          ? active.switchDimension(specs)
          : active.setVoices(specs);
      lastDimension = snapshot.dimension;
      // 再開の失敗時は声だけが外れ、共有の意図は保つ。再反映で鳴らし直せる。
      void task
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

  return reflector;
}
