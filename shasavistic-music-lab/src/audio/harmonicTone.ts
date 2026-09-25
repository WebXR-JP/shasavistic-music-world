/**
 * 調波スペクトル単音の生成・包絡・停止・資源解放。
 *
 * 係数計算は `harmonicSpectrum` が担い、包絡の時間と予約手順は
 * `harmonicEnvelope` が担う。このモジュールは文脈・声・資源の
 * 寿命だけを担う。描画や操作の記述は混ぜない。
 *
 * 声の区別はノートオン（発音開始）・ノートオフ（減衰の予約。減衰中も音は
 * 鳴る）・停止（減衰終了時の発振器停止）・解放（破棄。緊急の後始末で
 * 減衰を待たない）とする。単一声だけを扱い、複数声は作らない。
 *
 * @packageDocumentation
 */

import { createPeriodicWaveCoefficients } from './harmonicSpectrum';
import type { HarmonicPreset } from './harmonicPresets';
import { toSpectrumParams } from './harmonicPresets';
import {
  HARMONIC_ENVELOPE_DEFAULTS,
  envelopeGainAtTime,
  scheduleNoteOn,
  scheduleRelease,
  type HarmonicEnvelopeParam,
} from './harmonicEnvelope';

/** 既定の発振周波数（Hz）。基準音高のA4に相当する。 */
export const HARMONIC_TONE_FREQUENCY_HZ = 440;

/**
 * 出力ゲインの固定値。
 *
 * 包絡の最大利得（アタックの到達点）の上限を兼ねる。サステイン利得は
 * この値に包絡のサステイン水準を掛けた値になる。
 * 周期波の既定の正規化は無効化し、音色間の音量比較を変えない。
 * 代わりにこの固定値で過大振幅を抑える。最も明るい条件（Bright・低音）の
 * 係数合計でも時系列の頂上が1を下回る余裕を持たせた値である。
 */
export const HARMONIC_TONE_OUTPUT_GAIN = 0.15;

/** 調波単音生成を開始するときの設定。 */
export interface StartHarmonicToneOptions {
  /**
   * 発振周波数（Hz）。正の有限値。
   *
   * @defaultValue `HARMONIC_TONE_FREQUENCY_HZ`（省略時に開始処理が適用）。
   */
  readonly frequency?: number;
  /**
   * 鳴らすプリセット。省略時は減衰既定・重みなし・上限なしの標準波形。
   */
  readonly preset?: HarmonicPreset;
  /**
   * 声の最大利得（アタックの到達点）。正の有限値。
   *
   * 和音側が有効声数で総利得予算を分配した値を渡すためにある。
   * 単独の利用では省略し、従来の固定値を保つ。
   *
   * @defaultValue `HARMONIC_TONE_OUTPUT_GAIN`（省略時に開始処理が適用）。
   */
  readonly outputGain?: number;
}

/**
 * 調波単音生成に必要な音声文脈の最小口。
 *
 * `AudioContext` はこの形を満たす。検査では配線の記録だけを行う
 * 代替物で差し替え、ブラウザの音声文脈を要しない。
 */
export interface HarmonicToneContext {
  readonly destination: object;
  readonly sampleRate: number;
  /** 音声文脈の現在時刻（秒）。包絡の予約基準に使う。 */
  readonly currentTime: number;
  readonly state: string;
  resume(): Promise<void>;
  close(): Promise<void>;
  createOscillator(): HarmonicToneOscillator;
  createGain(): HarmonicToneGain;
  createPeriodicWave(
    real: Float32Array,
    imag: Float32Array,
    constraints: { disableNormalization: boolean },
  ): object;
}

/**
 * 調波単音生成に必要な発振器の最小口。
 *
 * `OscillatorNode` はこの形を満たす。減衰終了時刻の停止予約のため、
 * 停止時刻の指定と終了通知を受け付ける。
 */
export interface HarmonicToneOscillator {
  frequency: { value: number };
  /** 減衰終了時の後始末を受け付ける通知口。 */
  onended: (() => void) | null;
  setPeriodicWave(wave: object): void;
  connect(destination: object): void;
  disconnect(): void;
  start(): void;
  /**
   * 発振器を止める。
   *
   * @param when - 停止時刻（秒）。省略時は即時に止める。
   */
  stop(when?: number): void;
}

/**
 * 調波単音生成に必要な利得器の最小口。
 *
 * `GainNode` はこの形を満たす。利得値は包絡の予約で動かすため、
 * 発音前の無音から始めて直接の値の書き換えは行わない。
 */
export interface HarmonicToneGain {
  gain: HarmonicEnvelopeParam;
  connect(destination: object): void;
  disconnect(): void;
}

/**
 * 操作口の存続に対応する調波単音の演奏口。
 *
 * 音声文脈は操作口の存続中は一つだけ保つ。ノートオフでは声（発振器と
 * 利得器）を残して減衰だけを予約し、減衰終了時に止めて切り離す。
 * 文脈を閉じるのは破棄時の一度だけとする。
 * 実物の発振器は停止後に再始動できないため、再操作では声を作り直す。
 */
export interface HarmonicToneSession {
  /**
   * 発音中なら `true`。減衰の予約後も終了までは `true` のままである。
   * 起動の完了待ちの間は `false` のままである。
   */
  readonly playing: boolean;
  /** 減衰の予約後、終了までは `true`。 */
  readonly releasing: boolean;
  /**
   * 発音を始める（ノートオン）。
   *
   * 文脈がなければ操作由来の呼び出しの中で初めて作る。起動の完了待ちの間の
   * 重ね呼び出しは束ねて一つの起動にまとめる。発音中と減衰中の呼び出しは
   * 次の声を重ねないため何もしない。
   * プリセットや周波数の切替えは減衰完了後の再操作で行い、新しい声と周期波で
   * 鳴らす（発音中の差替えは含まない）。
   *
   * @param options - 周波数とプリセット。省略時は既定の調波単音。
   * @throws `RangeError` — 周波数が正の有限値でない場合。音声文脈は生成しない。
   * @throws `Error` — 破棄後に呼び出した場合。
   * @remarks
   * 再開の失敗時は声だけを外して文脈は保つ。再試行では同じ文脈を使う。
   * 停止や破棄で取り消された起動は失敗として扱わず、静かに終える。
   */
  start(options?: StartHarmonicToneOptions): Promise<void>;
  /**
   * 減衰を予約する（ノートオフ）。
   *
   * その時点の利得から無音への減衰を予約し、終了時刻に発振器を止めて
   * 声を切り離す。減衰中も音は鳴る。減衰中の重ね呼び出しは何もしない。
   * 声がなければ何もしない。
   *
   * @remarks
   * 予約済みの将来値の取消しで進行中のランプが不連続にならないよう、
   * 保持付き取消しがある環境ではこれを用い、ない環境では保持している
   * 線形区間から求めた現在値で取消しと値の再設定を行う。
   */
  noteOff(): void;
  /**
   * 発音を減衰を待たずに止める（緊急の中断）。
   *
   * @remarks
   * 楽曲的な終了には `noteOff()` を使い、この口は破棄前の後始末など
   * 減衰を待てない場合に使う。声だけを止めて切り離し、音声文脈は閉じない。
   * 複数回呼んでも声の停止と切断は一度だけ行う。減衰の予約済みで停止時刻が
   * 予約済みの場合は停止呼び出しを重ねず、終了通知を取り消して切り離す。
   * 実物の発振器は二度目の停止呼び出しを拒むため、呼び出し側での重複を吸収する。
   */
  stop(): void;
  /**
   * 発音を止めて音声文脈を閉じる。
   *
   * @remarks
   * 緊急の後始末として減衰を待たない。複数回呼んでも音声文脈の close は
   * 一度だけ行う。起動前に呼んだ場合は文脈を作らずに終える。
   */
  dispose(): Promise<void>;
}

/**
 * 実物の `AudioContext` を包絡の最小口へ読み替える。
 *
 * 実物の終了通知口は事象を受け取る形のため、引数なしの後始末口で包んで
 * 受け渡す。読替えの対応付けだけを行い、信号や予約内容には触れない。
 * 和音側が複数の声で一つの文脈を共有するためにも使う。
 *
 * @returns 操作口の存続中は使い回す音声文脈。
 */
export function createHarmonicToneContext(): HarmonicToneContext {
  const context = new AudioContext();
  // ADR: 代替物の接続先を実ノードへ読み替える対応付け。声の利得器は代替物であり
  // 実ノードではないため、発振器側の接続で実体へ読み替える。出力先は実ノードとして
  // 作るため、そのまま渡す読み替えが成立する。外部からの任意の値は渡さない。
  const nodeOf = new WeakMap<object, AudioNode>();
  const resolveNode = (target: object): AudioNode =>
    nodeOf.get(target) ?? (target as AudioNode);
  return {
    destination: context.destination,
    sampleRate: context.sampleRate,
    get currentTime(): number {
      return context.currentTime;
    },
    get state(): string {
      return context.state;
    },
    resume: (): Promise<void> => context.resume(),
    close: (): Promise<void> => context.close(),
    createOscillator: (): HarmonicToneOscillator => {
      const oscillator = context.createOscillator();
      let ended: (() => void) | null = null;
      const port: HarmonicToneOscillator = {
        frequency: oscillator.frequency,
        get onended(): (() => void) | null {
          return ended;
        },
        set onended(handler: (() => void) | null) {
          ended = handler;
          if (handler === null) {
            oscillator.onended = null;
          } else {
            const active: () => void = handler;
            oscillator.onended = (): void => {
              active();
            };
          }
        },
        // ADR: 周期波は同じ文脈の生成口が作った実体であり、object 型で受けた
        // 最小口を実型へ読み替える。外部からの任意の値は渡さない。
        setPeriodicWave: (wave: object): void => {
          oscillator.setPeriodicWave(wave as PeriodicWave);
        },
        connect: (target: object): void => {
          oscillator.connect(resolveNode(target));
        },
        disconnect: (): void => {
          oscillator.disconnect();
        },
        start: (): void => {
          oscillator.start();
        },
        stop: (when?: number): void => {
          if (when === undefined) {
            oscillator.stop();
          } else {
            oscillator.stop(when);
          }
        },
      };
      nodeOf.set(port, oscillator);
      return port;
    },
    createGain: (): HarmonicToneGain => {
      const gainNode = context.createGain();
      const port: HarmonicToneGain = {
        gain: gainNode.gain,
        connect: (target: object): void => {
          gainNode.connect(resolveNode(target));
        },
        disconnect: (): void => {
          gainNode.disconnect();
        },
      };
      nodeOf.set(port, gainNode);
      return port;
    },
    createPeriodicWave: (
      real: Float32Array,
      imag: Float32Array,
      constraints: { disableNormalization: boolean },
    ): object => context.createPeriodicWave(real, imag, constraints),
  };
}

/**
 * 操作口の存続に対応する調波単音の演奏口を作る。
 *
 * 呼び出し側は自動再生方針に従い、利用者の操作処理の中から `start()` を呼ぶ。
 * 生成直後が一時停止状態の場合に備え、操作由来の再開として `resume()` を続ける。
 *
 * @param createContext - 音声文脈の生成口。省略時は `AudioContext` を包絡の最小口へ読み替える。
 * @returns 操作口の存続中は使い回す演奏口。
 */
export function createHarmonicToneSession(
  createContext: () => HarmonicToneContext = createHarmonicToneContext,
): HarmonicToneSession {
  let context: HarmonicToneContext | null = null;
  let oscillator: HarmonicToneOscillator | null = null;
  let gain: HarmonicToneGain | null = null;
  let playing = false;
  let releasing = false;
  // 所有する声のノートオン時刻（音声文脈の時刻基準）。途中ノートオフの開始値の算出に使う。
  let noteOnTime = 0;
  // 所有する声の最大利得。途中ノートオフの開始値の算出に使う。
  let voicePeakGain = HARMONIC_TONE_OUTPUT_GAIN;
  let disposed = false;
  // 起動の完了待ちを取り消すための世代。停止と破棄で進め、起動は開始時の値を掴む。
  // ノートオフは同じ声の継続のため世代を進めない。
  let generation = 0;
  let pending: Promise<void> | null = null;
  let pendingGeneration = -1;
  let disposePromise: Promise<void> | null = null;
  let contextClosed = false;

  // 所有する声があれば即時に止めて切り離す。文脈には触れない。
  // 減衰の予約済みで停止時刻が予約済みの場合は、停止呼び出しを重ねず
  // 終了通知を取り消して切り離す。予約済みの停止は文脈側で実行されるが、
  // 所有照合で無視するため後続の声を止めない。
  const detachVoiceImmediate = (): void => {
    const currentOscillator = oscillator;
    const currentGain = gain;
    const releaseScheduled = releasing;
    oscillator = null;
    gain = null;
    playing = false;
    releasing = false;
    if (currentOscillator !== null) {
      if (releaseScheduled) {
        currentOscillator.onended = null;
      } else {
        currentOscillator.stop();
      }
      currentOscillator.disconnect();
    }
    if (currentGain !== null) {
      currentGain.disconnect();
    }
  };

  // 減衰終了時の後始末。停止は予約済みで実行済みのため切断だけ行う。
  // 所有する声と一致する場合だけ切り離し、後続の声を止めない。
  const detachVoiceOnEnded = (
    voiceOscillator: HarmonicToneOscillator,
    voiceGain: HarmonicToneGain,
  ): void => {
    if (oscillator !== voiceOscillator) {
      return;
    }
    oscillator = null;
    gain = null;
    playing = false;
    releasing = false;
    voiceOscillator.disconnect();
    voiceGain.disconnect();
  };

  const session: HarmonicToneSession = {
    get playing(): boolean {
      return playing;
    },
    get releasing(): boolean {
      return releasing;
    },
    async start(options: StartHarmonicToneOptions = {}): Promise<void> {
      const frequency = options.frequency ?? HARMONIC_TONE_FREQUENCY_HZ;
      if (!Number.isFinite(frequency) || frequency <= 0) {
        throw new RangeError(`周波数は正の有限値であること: ${frequency}`);
      }
      const peakGain = options.outputGain ?? HARMONIC_TONE_OUTPUT_GAIN;
      if (!Number.isFinite(peakGain) || peakGain <= 0) {
        throw new RangeError(`声の最大利得は正の有限値であること: ${options.outputGain}`);
      }
      if (disposed) {
        throw new Error('破棄後の演奏口は使えない');
      }
      if (playing || releasing) {
        return;
      }
      // 完了待ちの起動が取り消されていない場合は束ねて二重生成しない。
      if (pending !== null && pendingGeneration === generation) {
        return pending;
      }
      const myGeneration = generation;
      if (context === null) {
        context = createContext();
      }
      const activeContext = context;
      const preset = options.preset;
      // 係数は文脈の標本化周波数で求める。周波数変更時はここで周期波を作り直す。
      // 周期波の利用だけを折返し防止とみなさず、係数打切りとの二段構えにする。
      const spectrum =
        preset === undefined
          ? createPeriodicWaveCoefficients({
              fundamentalFrequency: frequency,
              sampleRate: activeContext.sampleRate,
            })
          : createPeriodicWaveCoefficients(
              toSpectrumParams(preset, frequency, activeContext.sampleRate),
            );
      // 既定の正規化は音色間の音量比較を変えるため無効化し、固定ゲインで抑える。
      const wave = activeContext.createPeriodicWave(spectrum.real, spectrum.imag, {
        disableNormalization: true,
      });
      const nextGain = activeContext.createGain();
      const next = activeContext.createOscillator();
      const startTime = activeContext.currentTime;
      try {
        // 声の利得は発音前に無音とし、現在時刻を基準に包絡を予約する。
        nextGain.gain.value = 0;
        scheduleNoteOn(nextGain.gain, startTime, peakGain);
        next.setPeriodicWave(wave);
        next.frequency.value = frequency;
        next.connect(nextGain);
        nextGain.connect(activeContext.destination);
        next.start();
      } catch (error) {
        // 接続や始動に失敗した作りかけは切り離して文脈は保つ。
        try {
          next.disconnect();
        } catch {
          // 切断の失敗は生成失敗の後始末を超えないため無視する。
        }
        try {
          nextGain.disconnect();
        } catch {
          // 切断の失敗は生成失敗の後始末を超えないため無視する。
        }
        throw error;
      }
      oscillator = next;
      gain = nextGain;
      noteOnTime = startTime;
      voicePeakGain = peakGain;

      // 自身への参照は完了後の後始末の照合に使う。非同期の継続が動く時点では
      // 代入済みのため、初期値付きで宣言して確定割り当て診断を避ける。
      let task: Promise<void> | null = null;
      task = (async (): Promise<void> => {
        try {
          await activeContext.resume();
        } catch (error) {
          if (pending === task) {
            pending = null;
          }
          if (myGeneration !== generation || disposed) {
            if (oscillator === next) {
              detachVoiceImmediate();
            }
            return;
          }
          if (oscillator === next) {
            detachVoiceImmediate();
          }
          throw error;
        }
        if (myGeneration !== generation || disposed) {
          if (pending === task) {
            pending = null;
          }
          if (oscillator === next) {
            detachVoiceImmediate();
          }
          return;
        }
        if (pending === task) {
          pending = null;
        }
        // 所有する声が残っている場合だけ発音中とする。
        // 停止で外れていれば世代が進むためここには届かない。
        // 完了待ち中のノートオフで減衰の予約済みの場合は、減衰中として発音中にする。
        if (oscillator === next) {
          playing = true;
        }
      })();
      pending = task;
      pendingGeneration = myGeneration;
      return task;
    },
    noteOff(): void {
      if (disposed) {
        return;
      }
      const voiceOscillator = oscillator;
      const voiceGain = gain;
      if (voiceOscillator === null || voiceGain === null) {
        return;
      }
      if (releasing) {
        return;
      }
      const activeContext = context;
      if (activeContext === null) {
        return;
      }
      const noteOffTime = activeContext.currentTime;
      // 保持付き取消しがない環境の再設定値として、予約した線形区間から現在値を求める。
      const currentGain = envelopeGainAtTime(
        noteOnTime,
        noteOffTime,
        voicePeakGain,
        HARMONIC_ENVELOPE_DEFAULTS,
      );
      const releaseEnd = scheduleRelease(
        voiceGain.gain,
        noteOffTime,
        currentGain,
        HARMONIC_ENVELOPE_DEFAULTS,
      );
      releasing = true;
      voiceOscillator.stop(releaseEnd);
      voiceOscillator.onended = (): void => {
        detachVoiceOnEnded(voiceOscillator, voiceGain);
      };
    },
    stop(): void {
      if (disposed) {
        return;
      }
      if (oscillator === null && pending === null) {
        return;
      }
      generation += 1;
      // 声だけを外し、文脈は操作口の存続中は保つ。
      detachVoiceImmediate();
    },
    async dispose(): Promise<void> {
      if (disposePromise !== null) {
        return disposePromise;
      }
      disposed = true;
      generation += 1;
      detachVoiceImmediate();
      if (context === null || contextClosed) {
        disposePromise = Promise.resolve();
        return disposePromise;
      }
      contextClosed = true;
      const activeContext = context;
      context = null;
      disposePromise = activeContext.close();
      return disposePromise;
    },
  };

  return session;
}
