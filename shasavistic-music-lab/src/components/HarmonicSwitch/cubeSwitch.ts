/**
 * 4 Cube の選択と切替を一元管理する操作側の制御器。
 *
 * 描画（React）と音声（`harmonicChord` の演奏口）の間に置き、次を担う。
 * 4 つの Cube で 1 つの演奏口と 1 つの音声文脈を共有し、Cube ごとに
 * 演奏口や文脈を作らない。文脈を閉じるのは破棄時に一度だけである。
 * 同一 Cube の再操作はノートオフして停止し、別 Cube の操作は現音へ
 * ノートオフして全声の終了後に選択した集合を開始する。重ねないし、
 * 即時切断もしない。減衰中の再選択は最後の一つだけを残し、同じ選択の
 * 連打は重複予約しない。選択世代と起動待ちをここで一元管理し、
 * 起動待ち・失敗・破棄後の非同期完了が古い選択を再生しない。
 *
 * 全声の終了判定は演奏口の待機口（既存の声の終了処理を正本とする）を
 * 使う。固定時間の待ちで次を起動しない。
 *
 * @packageDocumentation
 */

import {
  createHarmonicChordSession,
  type HarmonicChordSession,
} from '../../audio/harmonicChord';
import { HARMONIC_CHORD_SETS } from './chordSets';

/** Cube 操作の表示状態。停止・発音中・減衰や切替待ち・再操作待ちを区別する。 */
export type HarmonicCubeStatus = 'stopped' | 'playing' | 'releasing' | 'needsRetry';

/** 操作側が画面へ渡す快照。値は読み取り専用とする。 */
export interface HarmonicCubeSnapshot {
  /** 全体の表示状態。 */
  readonly status: HarmonicCubeStatus;
  /** 発音中または減衰中の集合 ID。停止時と再操作待ちでは `null`。 */
  readonly activeId: string | null;
  /** 減衰完了後に開始する選択 ID。なければ `null`。 */
  readonly pendingId: string | null;
  /** 再開失敗で再操作を待つ選択 ID。再操作待ち以外では `null`。 */
  readonly retryId: string | null;
}

/** 制御器の生成条件。 */
export interface HarmonicCubeSwitchOptions {
  /**
   * 演奏口の生成口。省略時は実物の和音演奏口を使う。
   * 検査では文脈の個数と声の対応を数えられる代替物で差し替える。
   */
  readonly createSession?: () => HarmonicChordSession;
  /** 状態が変わったときの通知口。省略時は通知しない。 */
  readonly notify?: () => void;
}

/** 4 Cube の選択と切替を担う制御器。 */
export interface HarmonicCubeSwitch {
  /** 現在の快照を返す。 */
  getSnapshot(): HarmonicCubeSnapshot;
  /**
   * 指定した Cube の操作を受け付ける。
   *
   * @param cubeId - 操作した Cube の選択 ID。4 件のいずれかであること。
   * @throws `Error` — 未知の選択 ID の場合。音声文脈は生成しない。
   */
  interact(cubeId: string): void;
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
 * 4 Cube の選択と切替を担う制御器を作る。
 *
 * 呼び出し側は利用者の操作処理の中から `interact()` を呼ぶ。
 * 演奏口の生成は初回の操作まで遅らせる。
 *
 * @param options - 演奏口の生成口と状態通知口。
 * @returns 親操作部品の存続中は使い回す制御器。
 */
export function createHarmonicCubeSwitch(options: HarmonicCubeSwitchOptions = {}): HarmonicCubeSwitch {
  const createSession = options.createSession ?? createHarmonicChordSession;
  const notify = options.notify ?? ((): void => {});
  let session: HarmonicChordSession | null = null;
  let disposed = false;
  // 選択世代。新しい起動で進め、非同期の完了が古い選択を再生しないようにする。
  // 減衰中の選択更新（最後の一つを残す）では進めない。
  let generation = 0;
  // 起動の完了待ちの選択 ID。完了待ちがなければ `null`。
  let startingId: string | null = null;
  let status: HarmonicCubeStatus = 'stopped';
  let activeId: string | null = null;
  let pendingId: string | null = null;
  let retryId: string | null = null;
  let disposePromise: Promise<void> | null = null;

  const snapshot = (): HarmonicCubeSnapshot => ({ status, activeId, pendingId, retryId });

  const findSet = (cubeId: string): (typeof HARMONIC_CHORD_SETS)[number] => {
    const found = HARMONIC_CHORD_SETS.find((candidate) => candidate.id === cubeId);
    if (found === undefined) {
      throw new Error(`未知の Cube 選択である: ${cubeId}`);
    }
    return found;
  };

  // 新しい集合の起動を始める。呼び出し時点で世代を進め、完了時に照合する。
  // 失敗（文脈の再開失敗など）は切替成功と表示せず、再操作待ちにする。
  const startNew = (cubeId: string): void => {
    const active = session;
    if (active === null || disposed) {
      return;
    }
    const chordSet = findSet(cubeId);
    generation += 1;
    const myGeneration = generation;
    startingId = cubeId;
    activeId = cubeId;
    pendingId = null;
    retryId = null;
    status = 'releasing';
    notify();
    void active
      .start({ preset: chordSet.preset, ratios: chordSet.ratios })
      .then(() => {
        if (disposed || myGeneration !== generation) {
          return;
        }
        if (startingId === cubeId) {
          startingId = null;
        }
        if (!active.playing) {
          activeId = null;
          status = 'stopped';
          notify();
          return;
        }
        if (active.releasing) {
          status = 'releasing';
          notify();
          return;
        }
        status = 'playing';
        notify();
      })
      .catch(() => {
        if (disposed || myGeneration !== generation) {
          return;
        }
        // 操作起点でない再開を強行せず、無音を切替成功と表示しない。
        startingId = null;
        activeId = null;
        pendingId = null;
        retryId = cubeId;
        status = 'needsRetry';
        notify();
      });
  };

  // 減衰完了後の振る舞いを決める。待機の解決時に世代が進んでいれば
  // 古い選択のため何もしない。最後に残った選択だけを開始する。
  const launchReleaseWaiter = (): void => {
    const active = session;
    if (active === null || disposed) {
      return;
    }
    const myGeneration = generation;
    status = 'releasing';
    notify();
    void active.waitForAllVoicesEnded().then(() => {
      if (disposed || myGeneration !== generation) {
        return;
      }
      if (active.playing || active.releasing) {
        // 空振りの解決では予約を落とさず、終了を待ち直す。
        // 世代は進めないため古い選択の再生にはならない。
        if (pendingId === null) {
          return;
        }
        launchReleaseWaiter();
        return;
      }
      const next = pendingId;
      pendingId = null;
      if (next === null) {
        activeId = null;
        status = 'stopped';
        notify();
        return;
      }
      startNew(next);
    });
  };

  const controller: HarmonicCubeSwitch = {
    getSnapshot(): HarmonicCubeSnapshot {
      return snapshot();
    },
    interact(cubeId: string): void {
      if (disposed) {
        return;
      }
      // 未知の選択では文脈を作らずに拒む。対応付けの破れを表面化させる。
      findSet(cubeId);
      if (session === null) {
        session = createSession();
      }
      const active = session;
      // 再操作待ちでは前回の失敗を捨て、今回の選択を起動する。
      if (status === 'needsRetry') {
        startNew(cubeId);
        return;
      }
      // 起動の完了待ちの間の連打は一つの起動に束ね、別選択だけが取り消して残る。
      if (startingId !== null) {
        if (cubeId === startingId) {
          return;
        }
        generation += 1;
        active.stop();
        startNew(cubeId);
        return;
      }
      if (active.playing && !active.releasing) {
        if (cubeId === activeId) {
          active.noteOff();
          launchReleaseWaiter();
          return;
        }
        active.noteOff();
        pendingId = cubeId;
        launchReleaseWaiter();
        return;
      }
      if (active.releasing) {
        // 同じ選択の連打は重複予約しない。停止中の同一 Cube の再操作も
        // 新しい選択とみなさず、減衰をそのまま進める。
        if (cubeId === pendingId) {
          return;
        }
        if (pendingId === null && cubeId === activeId) {
          return;
        }
        pendingId = cubeId;
        notify();
        return;
      }
      startNew(cubeId);
    },
    dispose(): Promise<void> {
      if (disposePromise !== null) {
        return disposePromise;
      }
      disposed = true;
      generation += 1;
      startingId = null;
      activeId = null;
      pendingId = null;
      retryId = null;
      status = 'stopped';
      const active = session;
      session = null;
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
