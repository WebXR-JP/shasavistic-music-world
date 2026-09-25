/**
 * 調波スペクトル単音の生成・停止・資源解放。
 *
 * 係数計算は `harmonicSpectrum` が担い、このモジュールは文脈・声・資源の
 * 寿命だけを担う。描画や操作の記述は混ぜない。既存の `singleTone` とは
 * 別の演奏口であり、移行が判定できるまで両方を残す。
 *
 * @packageDocumentation
 */

import { createPeriodicWaveCoefficients } from './harmonicSpectrum';
import type { HarmonicPreset } from './harmonicPresets';
import { toSpectrumParams } from './harmonicPresets';

/** 既定の発振周波数（Hz）。基準音高のA4に相当する。 */
export const HARMONIC_TONE_FREQUENCY_HZ = 440;

/**
 * 出力ゲインの固定値。
 *
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
 * `OscillatorNode` はこの形を満たす。
 */
export interface HarmonicToneOscillator {
  frequency: { value: number };
  setPeriodicWave(wave: object): void;
  connect(destination: object): void;
  disconnect(): void;
  start(): void;
  stop(): void;
}

/**
 * 調波単音生成に必要な利得器の最小口。
 *
 * `GainNode` はこの形を満たす。
 */
export interface HarmonicToneGain {
  gain: { value: number };
  connect(destination: object): void;
  disconnect(): void;
}

/**
 * 操作口の存続に対応する調波単音の演奏口。
 *
 * 音声文脈は操作口の存続中は一つだけ保つ。停止では声（発振器と利得器）だけを
 * 止めて切り離し、文脈は閉じない。再操作では同じ文脈に新しい声を作る。
 * 実物の発振器は停止後に再始動できないため、再操作では声を作り直す。
 * 文脈を閉じるのは破棄時の一度だけとする。
 */
export interface HarmonicToneSession {
  /** 発音中なら `true`。起動の完了待ちの間は `false` のままである。 */
  readonly playing: boolean;
  /**
   * 発音を始める。
   *
   * 文脈がなければ操作由来の呼び出しの中で初めて作る。起動の完了待ちの間の
   * 重ね呼び出しは束ねて一つの起動にまとめる。発音中の呼び出しは何もしない。
   * プリセットや周波数の切替えは停止後の再操作で行い、新しい声と周期波で
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
   * 発音を止める。
   *
   * @remarks
   * 声だけを止めて切り離し、音声文脈は閉じない。複数回呼んでも
   * 声の停止と切断は一度だけ行う。実物の発振器は二度目の停止呼び出しを
   * 拒むため、呼び出し側での重複を吸収する。
   */
  stop(): void;
  /**
   * 発音を止めて音声文脈を閉じる。
   *
   * @remarks
   * 複数回呼んでも音声文脈の close は一度だけ行う。起動前に呼んだ場合は
   * 文脈を作らずに終える。
   */
  dispose(): Promise<void>;
}

/**
 * 操作口の存続に対応する調波単音の演奏口を作る。
 *
 * 呼び出し側は自動再生方針に従い、利用者の操作処理の中から `start()` を呼ぶ。
 * 生成直後が一時停止状態の場合に備え、操作由来の再開として `resume()` を続ける。
 *
 * @param createContext - 音声文脈の生成口。省略時は `AudioContext` を直接使う。
 * @returns 操作口の存続中は使い回す演奏口。
 */
export function createHarmonicToneSession(
  createContext: () => HarmonicToneContext = () => new AudioContext(),
): HarmonicToneSession {
  let context: HarmonicToneContext | null = null;
  let oscillator: HarmonicToneOscillator | null = null;
  let gain: HarmonicToneGain | null = null;
  let playing = false;
  let disposed = false;
  // 起動の完了待ちを取り消すための世代。停止と破棄で進め、起動は開始時の値を掴む。
  let generation = 0;
  let pending: Promise<void> | null = null;
  let pendingGeneration = -1;
  let disposePromise: Promise<void> | null = null;
  let contextClosed = false;

  // 所有する声があれば一度だけ止めて切り離す。文脈には触れない。
  const detachVoice = (): void => {
    const currentOscillator = oscillator;
    const currentGain = gain;
    oscillator = null;
    gain = null;
    playing = false;
    if (currentOscillator !== null) {
      currentOscillator.stop();
      currentOscillator.disconnect();
    }
    if (currentGain !== null) {
      currentGain.disconnect();
    }
  };

  const session: HarmonicToneSession = {
    get playing(): boolean {
      return playing;
    },
    async start(options: StartHarmonicToneOptions = {}): Promise<void> {
      const frequency = options.frequency ?? HARMONIC_TONE_FREQUENCY_HZ;
      if (!Number.isFinite(frequency) || frequency <= 0) {
        throw new RangeError(`周波数は正の有限値であること: ${frequency}`);
      }
      if (disposed) {
        throw new Error('破棄後の演奏口は使えない');
      }
      if (playing) {
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
      try {
        nextGain.gain.value = HARMONIC_TONE_OUTPUT_GAIN;
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
              detachVoice();
            }
            return;
          }
          if (oscillator === next) {
            detachVoice();
          }
          throw error;
        }
        if (myGeneration !== generation || disposed) {
          if (pending === task) {
            pending = null;
          }
          if (oscillator === next) {
            detachVoice();
          }
          return;
        }
        if (pending === task) {
          pending = null;
        }
        // 所有する声が残っている場合だけ発音中とする。
        // 停止で外れていれば世代が進むためここには届かない。
        if (oscillator === next) {
          playing = true;
        }
      })();
      pending = task;
      pendingGeneration = myGeneration;
      return task;
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
      detachVoice();
    },
    async dispose(): Promise<void> {
      if (disposePromise !== null) {
        return disposePromise;
      }
      disposed = true;
      generation += 1;
      detachVoice();
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
