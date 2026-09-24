/**
 * 単一発振音の生成・停止・資源解放。
 *
 * 音の生成と停止、資源の解放はこのモジュールが担い、ワールド側は操作起点での
 * 呼び出しと破棄時の解放だけを担う。描画や操作の記述は混ぜない。
 *
 * @packageDocumentation
 */

/** 既定の発振周波数（Hz）。基準音高のA4に相当する。 */
export const SINGLE_TONE_FREQUENCY_HZ = 440;

/** 単音生成を開始するときの設定。 */
export interface StartSingleToneOptions {
  /**
   * 発振周波数（Hz）。正の有限値。
   *
   * @defaultValue `SINGLE_TONE_FREQUENCY_HZ`（省略時に開始処理が適用）。
   */
  readonly frequency?: number;
  /**
   * 発振波形。
   *
   * @defaultValue `'sine'`（省略時に開始処理が適用）。
   */
  readonly type?: OscillatorType;
}

/**
 * 単音生成に必要な音声文脈の最小口。
 *
 * `AudioContext` はこの形を満たす。検査では配線の記録だけを行う
 * 代替物で差し替え、ブラウザの音声文脈を要しない。
 */
export interface SingleToneContext {
  readonly destination: object;
  readonly state: string;
  resume(): Promise<void>;
  close(): Promise<void>;
  createOscillator(): SingleToneOscillator;
}

/**
 * 単音生成に必要な発振器の最小口。
 *
 * `OscillatorNode` はこの形を満たす。
 */
export interface SingleToneOscillator {
  frequency: { value: number };
  type: OscillatorType;
  connect(destination: object): void;
  disconnect(): void;
  start(): void;
  stop(): void;
}

/**
 * 操作口の存続に対応する単音の演奏口。
 *
 * 音声文脈は操作口の存続中は一つだけ保つ。停止では発振器だけを止めて切り離し、
 * 文脈は閉じない。再操作では同じ文脈に新しい発振器を作る。実物の発振器は
 * 停止後に再始動できないため、再操作では発振器を作り直す。文脈を閉じるのは
 * 破棄時の一度だけとする。
 */
export interface SingleToneSession {
  /** 発音中なら `true`。起動の完了待ちの間は `false` のままである。 */
  readonly playing: boolean;
  /**
   * 発音を始める。
   *
   * 文脈がなければ操作由来の呼び出しの中で初めて作る。起動の完了待ちの間の
   * 重ね呼び出しは束ねて一つの起動にまとめる。発音中の呼び出しは何もしない。
   *
   * @param options - 周波数と波形。省略時は既定の単音。
   * @throws `RangeError` — 周波数が正の有限値でない場合。音声文脈は生成しない。
   * @throws `Error` — 破棄後に呼び出した場合。
   * @remarks
   * 再開の失敗時は発振器だけを外して文脈は保つ。再試行では同じ文脈を使う。
   * 停止や破棄で取り消された起動は失敗として扱わず、静かに終える。
   */
  start(options?: StartSingleToneOptions): Promise<void>;
  /**
   * 発音を止める。
   *
   * @remarks
   * 発振器だけを止めて切り離し、音声文脈は閉じない。複数回呼んでも
   * 発振器の停止と切断は一度だけ行う。実物の発振器は二度目の停止呼び出しを
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
 * 操作口の存続に対応する単音の演奏口を作る。
 *
 * 呼び出し側は自動再生方針に従い、利用者の操作処理の中から `start()` を呼ぶ。
 * 生成直後が一時停止状態の場合に備え、操作由来の再開として `resume()` を続ける。
 *
 * @param createContext - 音声文脈の生成口。省略時は `AudioContext` を直接使う。
 * @returns 操作口の存続中は使い回す演奏口。
 */
export function createSingleToneSession(
  createContext: () => SingleToneContext = () => new AudioContext(),
): SingleToneSession {
  let context: SingleToneContext | null = null;
  let oscillator: SingleToneOscillator | null = null;
  let playing = false;
  let disposed = false;
  // 起動の完了待ちを取り消すための世代。停止と破棄で進め、起動は開始時の値を掴む。
  let generation = 0;
  let pending: Promise<void> | null = null;
  let pendingGeneration = -1;
  let disposePromise: Promise<void> | null = null;
  let contextClosed = false;

  // 所有する発振器があれば一度だけ止めて切り離す。文脈には触れない。
  const detachOscillator = (): void => {
    const current = oscillator;
    oscillator = null;
    playing = false;
    if (current !== null) {
      current.stop();
      current.disconnect();
    }
  };

  const session: SingleToneSession = {
    get playing(): boolean {
      return playing;
    },
    async start(options: StartSingleToneOptions = {}): Promise<void> {
      const frequency = options.frequency ?? SINGLE_TONE_FREQUENCY_HZ;
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
      const next = activeContext.createOscillator();
      try {
        next.type = options.type ?? 'sine';
        next.frequency.value = frequency;
        next.connect(activeContext.destination);
        next.start();
      } catch (error) {
        // 接続や始動に失敗した作りかけは切り離して文脈は保つ。
        try {
          next.disconnect();
        } catch {
          // 切断の失敗は生成失敗の後始末を超えないため無視する。
        }
        throw error;
      }
      oscillator = next;

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
              detachOscillator();
            }
            return;
          }
          if (oscillator === next) {
            detachOscillator();
          }
          throw error;
        }
        if (myGeneration !== generation || disposed) {
          if (pending === task) {
            pending = null;
          }
          if (oscillator === next) {
            detachOscillator();
          }
          return;
        }
        if (pending === task) {
          pending = null;
        }
        // 所有する発振器が残っている場合だけ発音中とする。
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
      // 発振器だけを外し、文脈は操作口の存続中は保つ。
      detachOscillator();
    },
    async dispose(): Promise<void> {
      if (disposePromise !== null) {
        return disposePromise;
      }
      disposed = true;
      generation += 1;
      detachOscillator();
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
