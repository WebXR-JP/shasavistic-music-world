/**
 * 一つの和音を所有する調波演奏口。
 *
 * 現行の調波単音の演奏口を和音へ広げたものであり、別の汎用の複数声シンセは
 * 作らない。各声は単音の演奏口が持ち、和音側は声の所有、まとめての
 * ノートオン・ノートオフ、終了と破棄を担う。各声は発振器ノードから
 * 声ごとの利得ノード（共通包絡）を経て出力先へつなぎ、音声文脈を共有する。
 * 係数計算と包絡手順の責務は変えず、声ごとの周波数と波形・包絡は
 * 単音側が用意する。
 *
 * 声の区別はノートオン（発音開始）・ノートオフ（減衰の予約。減衰中も音は
 * 鳴る）・停止（減衰終了時の発振器停止）・解放（破棄。緊急の後始末で
 * 減衰を待たない）とし、単音側と同じ意味で使う。和音全体がリリースを
 * 終えるまで次の和音を重ねない。
 *
 * @packageDocumentation
 */

import type { HarmonicPreset } from './harmonicPresets';
import type { HarmonicRatioInput } from './harmonicRatio';
import { resolveHarmonicVoices } from './harmonicRatio';
import {
  HARMONIC_TONE_FREQUENCY_HZ,
  HARMONIC_TONE_OUTPUT_GAIN,
  createHarmonicToneContext,
  createHarmonicToneSession,
  type HarmonicToneContext,
  type HarmonicToneOscillator,
  type HarmonicToneSession,
} from './harmonicTone';

/**
 * 和音の総利得予算。
 *
 * 単音で妥当だった現行の出力利得定数を総枠とし、有効な声数で分配する。
 * 単声では従来の水準を維持する。これは過大振幅を避ける設計上の上限であり、
 * 音量や破綻防止の保証ではない。実際の合成波形はブラウザで採取して判断する。
 */
export const HARMONIC_CHORD_TOTAL_GAIN = HARMONIC_TONE_OUTPUT_GAIN;

/**
 * 同時発音の上限（声数）。
 *
 * 今回用意する有限の和音定義に含まれる声数を上限とする。無制限の追加、
 * 声の奪取・使い回しは設けない。具体値は聴き比べの入力を定める実装段階の
 * 決定であり、理論が唯一規定する値ではない。
 */
export const HARMONIC_CHORD_MAX_VOICES = 3;

/**
 * 既定の比率集合。単声であり、受入れ済みの調波単音に相当する。
 */
export const HARMONIC_CHORD_DEFAULT_RATIOS: readonly HarmonicRatioInput[] = [
  { numerator: 1, denominator: 1 },
];

/** 和音生成を開始するときの設定。 */
export interface StartHarmonicChordOptions {
  /**
   * 基準周波数（Hz）。正の有限値。各声はこの値と比率の積で生成する。
   * 現行の既定基音を引き継ぐ。
   *
   * @defaultValue `HARMONIC_TONE_FREQUENCY_HZ`（省略時に開始処理が適用）。
   */
  readonly baseFrequency?: number;
  /**
   * 鳴らすプリセット。全声に共通とし、声ごとに変えない。
   * 省略時は減衰既定・重みなし・上限なしの標準波形。
   */
  readonly preset?: HarmonicPreset;
  /**
   * 音程比の集合。約分と重複排除の後の有効な声が同時発音の上限を超えないこと。
   *
   * @defaultValue 単声の既定比率（省略時に開始処理が適用）。
   */
  readonly ratios?: readonly HarmonicRatioInput[];
}

/**
 * 操作口の存続に対応する和音の演奏口。
 *
 * 音声文脈は操作口の存続中は一つだけ保ち、全声で共有する。ノートオフでは
 * 全声に減衰だけを予約し、各声の減衰終了時に止めて切り離す。全声の終了で
 * 再操作可能になる。文脈を閉じるのは破棄時の一度だけとする。
 */
export interface HarmonicChordSession {
  /**
   * いずれかの声が発音中なら `true`。減衰の予約後も全声の終了までは
   * `true` のままである。起動の完了待ちの間は `false` のままである。
   */
  readonly playing: boolean;
  /** いずれかの声が減衰の予約後、終了までは `true`。 */
  readonly releasing: boolean;
  /**
   * 和音の発音を始める（ノートオン）。
   *
   * 文脈がなければ操作由来の呼び出しの中で初めて作る。起動の完了待ちの間の
   * 重ね呼び出しは束ねて一つの起動にまとめる。発音中と減衰中の呼び出しは
   * 次の和音を重ねないため何もしない。
   * 比率やプリセットの切替えは全声の減衰完了後の再操作で行い、新しい声で
   * 鳴らす（発音中の差替えは含まない）。
   *
   * @param options - 基準周波数とプリセットと比率集合。省略時は既定の調波単音。
   * @throws `RangeError` — 基準周波数が正の有限値でない、比率集合が空・不正・
   * 上限超過の場合。音声文脈は生成しない。
   * @throws `Error` — 破棄後に呼び出した場合。
   * @remarks
   * 一部の声の再開に失敗した場合は残りの声も止めて文脈は保つ。再試行では
   * 同じ文脈を使う。停止や破棄で取り消された起動は失敗として扱わず、
   * 静かに終える。
   */
  start(options?: StartHarmonicChordOptions): Promise<void>;
  /**
   * 全声に減衰を予約する（ノートオフ）。
   *
   * 声ごとの利得から無音への減衰を予約し、終了時刻に発振器を止めて
   * 声を切り離す。減衰中も音は鳴る。減衰中の重ね呼び出しは何もしない。
   * 声がなければ何もしない。
   */
  noteOff(): void;
  /**
   * 全声の終了を待つ（使い捨ての待機口）。
   *
   * 既存の声の終了処理（各声の減衰終了時の所有照合による切断）を正本とし、
   * 固定時間の待ちは行わない。待機中に全声が終われば解決し、呼び出し時点で
   * 既に静止（発音も減衰も起動待ちもなし）なら即時に解決する。破棄後は
   * 声が残らないため即時に解決する。
   *
   * @remarks
   * 常設の購読口は作らず、呼び出しごとの使い捨てとする。複数の待機は
   * すべて同じ終了で解決する。停止や起動の取消しで静止に戻った場合も解決する。
   */
  waitForAllVoicesEnded(): Promise<void>;
  /**
   * 和音を減衰を待たずに止める（緊急の中断）。
   *
   * @remarks
   * 楽曲的な終了には `noteOff()` を使い、この口は破棄前の後始末など
   * 減衰を待てない場合に使う。全声だけを止めて切り離し、音声文脈は閉じない。
   */
  stop(): void;
  /**
   * 和音を止めて音声文脈を閉じる。
   *
   * @remarks
   * 緊急の後始末として減衰を待たない。複数回呼んでも音声文脈の close は
   * 一度だけ行う。起動前に呼んだ場合は文脈を作らずに終える。
   */
  dispose(): Promise<void>;
}

/**
 * 操作口の存続に対応する和音の演奏口を作る。
 *
 * 呼び出し側は自動再生方針に従い、利用者の操作処理の中から `start()` を呼ぶ。
 * 生成直後が一時停止状態の場合に備え、各声が操作由来の再開として
 * `resume()` を続ける（単音側の手順に従う）。
 *
 * @param createContext - 音声文脈の生成口。省略時は `AudioContext` を包絡の最小口へ読み替える。
 * @returns 操作口の存続中は使い回す演奏口。
 */
export function createHarmonicChordSession(
  createContext: () => HarmonicToneContext = createHarmonicToneContext,
): HarmonicChordSession {
  let shared: HarmonicToneContext | null = null;
  // 所有する声。各声の寿命管理は単音側が担い、和音側は束ねるだけにする。
  // 汎用の複数声管理（奪取・使い回し）は設けない。
  let voices: HarmonicToneSession[] = [];
  let disposed = false;
  // 起動の完了待ちを取り消すための世代。停止と破棄で進め、起動は開始時の値を掴む。
  // ノートオフは同じ声の継続のため世代を進めない。
  let generation = 0;
  let pending: Promise<void> | null = null;
  let pendingGeneration = -1;
  let disposePromise: Promise<void> | null = null;
  let contextClosed = false;
  // 全声終了の使い捨て待機の解決口。常設の購読口は作らず、終了のたびに空にする。
  let idleWaiters: Array<() => void> = [];

  const stopVoices = (targets: readonly HarmonicToneSession[]): void => {
    for (const voice of targets) {
      voice.stop();
    }
  };

  // 声が一つも残らなければ待機をすべて解決する。起動の完了待ちがある間は
  // 静止とみなさない。古い声の遅延終了は全体の静止検査で吸収し、後続の声が
  // 鳴っている間は解決しない。
  const notifyIfIdle = (): void => {
    if (pending !== null) {
      return;
    }
    if (voices.some((voice) => voice.playing) || voices.some((voice) => voice.releasing)) {
      return;
    }
    if (idleWaiters.length === 0) {
      return;
    }
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) {
      resolve();
    }
  };

  // 声の終了通知を和音側の待機へつなぐ読み替え。単音側の所有照合による切断は
  // そのまま保ち、後始末の完了後に全体の静止だけを確かめる。寿命（close）は
  // 和音側が担い、ここでは触れない。
  const wrapContextForIdle = (base: HarmonicToneContext): HarmonicToneContext => ({
    destination: base.destination,
    sampleRate: base.sampleRate,
    get currentTime(): number {
      return base.currentTime;
    },
    get state(): string {
      return base.state;
    },
    resume: (): Promise<void> => base.resume(),
    close: (): Promise<void> => base.close(),
    createPeriodicWave: (
      real: Float32Array,
      imag: Float32Array,
      constraints: { disableNormalization: boolean },
    ): object => base.createPeriodicWave(real, imag, constraints),
    createGain: () => base.createGain(),
    createOscillator: (): HarmonicToneOscillator => {
      const inner = base.createOscillator();
      let userHandler: (() => void) | null = null;
      const port: HarmonicToneOscillator = {
        frequency: inner.frequency,
        get onended(): (() => void) | null {
          return userHandler;
        },
        set onended(handler: (() => void) | null) {
          userHandler = handler;
          if (handler === null) {
            inner.onended = null;
          } else {
            const active: () => void = handler;
            inner.onended = (): void => {
              try {
                active();
              } finally {
                notifyIfIdle();
              }
            };
          }
        },
        setPeriodicWave: (wave: object): void => {
          inner.setPeriodicWave(wave);
        },
        connect: (target: object): void => {
          inner.connect(target);
        },
        disconnect: (): void => {
          inner.disconnect();
        },
        start: (): void => {
          inner.start();
        },
        stop: (when?: number): void => {
          inner.stop(when);
        },
      };
      return port;
    },
  });

  const session: HarmonicChordSession = {
    get playing(): boolean {
      return voices.some((voice) => voice.playing);
    },
    get releasing(): boolean {
      return voices.some((voice) => voice.releasing);
    },
    async start(options: StartHarmonicChordOptions = {}): Promise<void> {
      const baseFrequency = options.baseFrequency ?? HARMONIC_TONE_FREQUENCY_HZ;
      const ratios = options.ratios ?? HARMONIC_CHORD_DEFAULT_RATIOS;
      // 比率の正規化・重複排除・周波数変換は文脈生成の前に済ませ、
      // 不正入力では音声文脈を作らない。判定は単音側と同じ順序に従う。
      const resolved = resolveHarmonicVoices(ratios, baseFrequency);
      if (resolved.length > HARMONIC_CHORD_MAX_VOICES) {
        throw new RangeError(
          `和音の声数は同時発音の上限以下であること: ${resolved.length} > ${HARMONIC_CHORD_MAX_VOICES}`,
        );
      }
      if (disposed) {
        throw new Error('破棄後の演奏口は使えない');
      }
      if (session.playing || session.releasing) {
        return;
      }
      // 完了待ちの起動が取り消されていない場合は束ねて二重生成しない。
      if (pending !== null && pendingGeneration === generation) {
        return pending;
      }
      const myGeneration = generation;
      if (shared === null) {
        shared = createContext();
      }
      const activeContext = shared;
      const { preset } = options;
      // ADR: 総利得予算を有効声数で等分し、各声の最大利得として渡す。
      // 単声では除数が1のため従来水準を維持する。等分は過大振幅を避ける
      // 設計上限であり、等ラウドネスや破綻防止の保証ではない。
      const voiceGain = HARMONIC_CHORD_TOTAL_GAIN / resolved.length;
      // ADR: 声の実体には単音の演奏口そのままを使い、汎用の複数声管理は作らない。
      // 文脈の生成口は共有文脈を返すだけにし、寿命（close）は和音側が担う。
      // 単音側の破棄口は文脈を閉じるため、和音側の停止と破棄では使わない。
      // 声と周波数の対応付けは添字ではなく束で持ち、取り違えない。
      // 発振器の終了通知だけを待機へつなぐ読み替えを挟み、声の所有と寿命は変えない。
      const voiceContext = wrapContextForIdle(activeContext);
      const nextPairs = resolved.map((voice) => ({
        session: createHarmonicToneSession(() => voiceContext),
        frequency: voice.frequency,
      }));
      const nextVoices = nextPairs.map((pair) => pair.session);
      voices = nextVoices;

      // 自身への参照は完了後の後始末の照合に使う。非同期の継続が動く時点では
      // 代入済みのため、初期値付きで宣言して確定割り当て診断を避ける。
      let task: Promise<void> | null = null;
      task = (async (): Promise<void> => {
        try {
          await Promise.all(
            nextPairs.map((pair) =>
              pair.session.start({
                frequency: pair.frequency,
                preset,
                outputGain: voiceGain,
              }),
            ),
          );
        } catch (error) {
          if (pending === task) {
            pending = null;
          }
          // 失敗した声以外が残ると重なって鳴るため、取り消しと失敗のいずれでも止める。
          // 取り消された起動は失敗として扱わず、静かに終える。
          stopVoices(nextVoices);
          notifyIfIdle();
          if (myGeneration !== generation || disposed) {
            return;
          }
          throw error;
        }
        if (myGeneration !== generation || disposed) {
          if (pending === task) {
            pending = null;
          }
          stopVoices(nextVoices);
          notifyIfIdle();
          return;
        }
        if (pending === task) {
          pending = null;
        }
        notifyIfIdle();
        // 発音中の有無は各声が持つ。停止で外れていれば世代が進むためここには届かない。
      })();
      pending = task;
      pendingGeneration = myGeneration;
      return task;
    },
    noteOff(): void {
      if (disposed) {
        return;
      }
      for (const voice of voices) {
        voice.noteOff();
      }
    },
    stop(): void {
      if (disposed) {
        return;
      }
      if (pending === null && !session.playing && !session.releasing) {
        return;
      }
      generation += 1;
      // 声だけを外し、文脈は操作口の存続中は保つ。
      stopVoices(voices);
      notifyIfIdle();
    },
    waitForAllVoicesEnded(): Promise<void> {
      if (disposed) {
        return Promise.resolve();
      }
      if (pending === null && !session.playing && !session.releasing) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        idleWaiters.push(resolve);
      });
    },
    async dispose(): Promise<void> {
      if (disposePromise !== null) {
        return disposePromise;
      }
      disposed = true;
      generation += 1;
      stopVoices(voices);
      // 破棄で声は止まるため、残っている終了待機を解決する。
      if (idleWaiters.length > 0) {
        const waiters = idleWaiters;
        idleWaiters = [];
        for (const resolve of waiters) {
          resolve();
        }
      }
      if (shared === null || contextClosed) {
        disposePromise = Promise.resolve();
        return disposePromise;
      }
      contextClosed = true;
      const activeContext = shared;
      shared = null;
      // ADR: 単音側の破棄口は共有文脈を閉じるため使わない。
      // 和音側が全声を止めたうえで文脈を一度だけ閉じる。
      disposePromise = activeContext.close();
      return disposePromise;
    },
  };

  return session;
}
