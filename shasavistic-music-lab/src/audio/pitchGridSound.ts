/**
 * 格子のオン集合を個別の声で鳴らす音声側。
 *
 * 一つの音声文脈を格子操作部品の存続中に共有し、座標由来の鍵で
 * 最大15の活動声を管理する。オンでその点の声を開始し、オフで
 * その点だけを終了して他点を巻き込まない。移動時は新旧集合の
 * 差分を一括反映する。次元切替は専用の境界で旧声の所有を切り離し、
 * 保持した全座標に新声を作る一まとまりとする。
 *
 * 格子範囲や移動可否は再判定しない（操作側の責務）。鍵は不透明な
 * 文字列として扱い、座標の意味は解釈しない。常設診断口は作らない。
 *
 * 波形は Web Audio の固定 `sawtooth` を使う。音色プリセットや
 * 周期波の既定設定をノコギリ波と呼び替えない。包絡の時間と予約手順、
 * 終了通知と破棄の競合の扱いは `harmonicEnvelope` と単一声側の手順を
 * 流用する。声数上限3で和音全体を所有する `harmonicChord` や、
 * 排他切替の `cubeSwitch` に15点の個別操作は継ぎ足さない。
 *
 * @packageDocumentation
 */

import {
  HARMONIC_ENVELOPE_DEFAULTS,
  envelopeGainAtTime,
  scheduleNoteOn,
  scheduleRelease,
  type HarmonicEnvelopeParam,
} from './harmonicEnvelope';

/**
 * 同時発音の上限（声数）。
 *
 * 格子点数に等しい。無制限の追加、声の奪取・使い回しは設けない。
 */
export const PITCH_GRID_MAX_VOICES = 15;

/**
 * 声ごとの固定利得。
 *
 * 15声合成を前提にした安全側の暫定設計値である。単音の出力利得定数を
 * 総枠とみなし、15声の同相加算でも頂上が1を下回る余裕（15倍で0.45）を
 * 保つ水準に固定する。単声の聴取可能性と過大振幅は実Chromeとホストで
 * 確認して再調整する。
 */
export const PITCH_GRID_VOICE_GAIN = 0.03;

/** 音声側へ反映する一つの声。鍵は座標由来の不透明な文字列。 */
export interface PitchGridVoiceSpec {
  /** 声の鍵。座標由来の文字列。空にしない。 */
  readonly key: string;
  /** 発音周波数（Hz）。正の有限値。 */
  readonly frequency: number;
}

/**
 * 保持中かつ再開成立した一つの声（表示用）。
 *
 * 実音高の対照表示だけに使い、発振器などの音声資源は含まない。
 * 再開未成立・再開失敗で外れた声、減衰の予約後に終了した声は含まない。
 */
export interface PitchGridSoundingVoice {
  /** 声の鍵。座標由来の文字列。 */
  readonly key: string;
  /** 発音周波数（Hz）。 */
  readonly frequency: number;
}

/**
 * 格子の個別声に必要な音声文脈の最小口。
 *
 * `AudioContext` はこの形を満たす。検査では配線の記録だけを行う
 * 代替物で差し替え、ブラウザの音声文脈を要しない。
 */
export interface PitchGridSoundContext {
  readonly destination: object;
  /** 音声文脈の現在時刻（秒）。包絡の予約基準に使う。 */
  readonly currentTime: number;
  readonly state: string;
  resume(): Promise<void>;
  close(): Promise<void>;
  createOscillator(): PitchGridSoundOscillator;
  createGain(): PitchGridSoundGain;
}

/**
 * 格子の個別声に必要な発振器の最小口。
 *
 * `OscillatorNode` はこの形を満たす。波形は固定 `sawtooth` で使い、
 * 呼び出し側で変えない。減衰終了時刻の停止予約のため、停止時刻の
 * 指定と終了通知を受け付ける。
 */
export interface PitchGridSoundOscillator {
  frequency: { value: number };
  type: OscillatorType;
  /** 減衰終了時の後始末を受け付ける通知口。 */
  onended: (() => void) | null;
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
 * 格子の個別声に必要な利得器の最小口。
 *
 * `GainNode` はこの形を満たす。利得値は包絡の予約で動かすため、
 * 発音前の無音から始めて直接の値の書き換えは行わない。
 */
export interface PitchGridSoundGain {
  gain: HarmonicEnvelopeParam;
  connect(destination: object): void;
  disconnect(): void;
}

/**
 * 操作口の存続に対応する格子の個別声の演奏口。
 *
 * 音声文脈は操作口の存続中は一つだけ保ち、全声で共有する。
 * オフ・移動での除外は減衰の予約（減衰中も音は鳴る）とし、
 * 減衰終了時に止めて切り離す。文脈を閉じるのは破棄時の一度だけとする。
 * 実物の発振器は停止後に再始動できないため、再開では声を作り直す。
 */
export interface PitchGridSound {
  /**
   * 所有する声の数。減衰の予約後も終了までは数え、起動の完了待ちも数える。
   * 終了・取消し・破棄で外れた声は数えない。
   */
  readonly voiceCount: number;
  /**
   * 保持中かつ再開成立した声の読み取り専用一覧（表示用）。
   *
   * 実音高の対照表示の表示源であり、再開未成立・再開失敗で外れた声と
   * 減衰中の尾音は含まない。発振器などの音声資源は公開しない。
   * 順序は鍵順に揃え、所有の挿入順には依存しない。
   */
  readonly soundingVoices: readonly PitchGridSoundingVoice[];
  /**
   * 表示内容が変わったときだけ呼ぶ購読口（表示用）。
   *
   * 声の再開成立、リリース予約、再開失敗での切離し、次元切替の一括切離しと
   * 新声の再開成立、破棄のうち、一覧の内容が変わる場合に限って購読者へ
   * 知らせる。内容が変わらない再反映や減衰終了では呼ばない。
   * 毎フレームの読み出しの代わりに使う。任意の音声資源を読む診断口にはしない。
   *
   * @param listener - 一覧の内容変化時の通知口。同期的に呼ぶ。
   * @returns 購読解除口。解除後は呼ばない。
   */
  subscribeSounding(listener: () => void): () => void;
  /**
   * 座標集合を声へ反映する（差分の一括反映）。
   *
   * 集合にない声はその声だけ減衰を予約し、集合にない鍵は新声を開始する。
   * 同じ鍵・同じ周波数に残る保持中の声は開始し直さない。
   * 同じ鍵で周波数が変わった保持中の声は、発振器と利得ノードを保ち、
   * 周波数を段階的に変えずその時点で新値へ切り替え、ADSRを再始動しない。
   * リリース予約済みの声は再利用せず新声を開始する。
   *
   * @param specs - 鳴らす声の鍵と周波数。鍵の重複・空鍵・上限超過を含まないこと。
   * @returns 共有文脈の再開完了で解決する約束。起動前に取り消された場合は
   * 静かに終える。再開の失敗時は開始した声だけを外して文脈は保ち、失敗を伝える。
   * @throws `RangeError` — 周波数が正の有限値でない、声数が上限を超える場合。音声文脈は生成しない。
   * @throws `Error` — 鍵が重複・空、破棄後に呼び出した場合。
   * @remarks
   * 一つの声の生成失敗は他の声を取り消さない。声は独立に寿命を持つ。
   */
  setVoices(specs: readonly PitchGridVoiceSpec[]): Promise<void>;
  /**
   * 次元切替の専用境界として保持した全座標を鳴らし直す。
   *
   * 通常の `setVoices` の同鍵・同周波数の再利用分岐を通さず、起動待ちを
   * 取り消し、旧声の所有を切り離してから、保持した全座標に新声を作る
   * 一まとまりとする。既存の停止処理は同鍵の声を減衰予約のまま保持する
   * ため、停止と集合反映を単純に重ねると周波数が変わらない鍵（中央行など）
   * では旧声を使い回して無音になり得る。切替では同鍵・同周波数の再利用を
   * せず、全座標の新声を開始する。通常のオフ・移動の減衰処理は変えない。
   *
   * @param specs - 鳴らし直す声の鍵と周波数。鍵の重複・空鍵・上限超過を含まないこと。
   * 空集合の場合は旧声の停止だけを行い、音声文脈は生成しない。
   * @returns 共有文脈の再開完了で解決する約束。再開の失敗時は開始した声だけを
   * 外して文脈は保ち、失敗を伝える。
   * @throws `RangeError` — 周波数が正の有限値でない、声数が上限を超える場合。音声文脈は生成しない。
   * @throws `Error` — 鍵が重複・空、破棄後に呼び出した場合。
   * @remarks
   * 連続切替、操作直後の切替、再開の遅延・失敗、破棄との競合では、声の実体照合に
   * より古い完了通知が新声を止めたり復活させたりしない。クロスフェードや汎用音声
   * 制御基盤は設けない。
   */
  switchDimension(specs: readonly PitchGridVoiceSpec[]): Promise<void>;
  /**
   * 全声を止める。
   *
   * 起動の完了待ちは取り消して即時に外し、発音中の声は減衰を予約する。
   * 音声文脈は操作口の存続中は保つ。
   */
  stopAll(): void;
  /**
   * 全声を止めて音声文脈を閉じる。
   *
   * @remarks
   * 緊急の後始末として減衰を待たない。複数回呼んでも音声文脈の close は
   * 一度だけ行う。起動前に呼んだ場合は文脈を作らずに終える。
   */
  dispose(): Promise<void>;
}

/** 所有する一つの声。終了通知の照合はこの実体で行う。 */
interface ActiveVoice {
  readonly key: string;
  /**
   * 発音周波数（Hz）。
   *
   * 通常反映の再調律で同鍵・異周波数の保持中声を即時切替するため可変とする。
   * 発振器の現在値と一致させて保ち、表示用の快照はこの値を読む。
   */
  frequency: number;
  readonly oscillator: PitchGridSoundOscillator;
  readonly gain: PitchGridSoundGain;
  /** ノートオン時刻（音声文脈の時刻基準）。途中終了の開始値の算出に使う。 */
  readonly noteOnTime: number;
  /** 発音中は `false`、減衰の予約後は `true`。 */
  released: boolean;
  /** 再開の完了後は `true`。完了待ちの取消し判定に使う。 */
  settled: boolean;
}

/**
 * 実物の `AudioContext` を個別声の最小口へ読み替える。
 *
 * 実物の終了通知口は事象を受け取る形のため、引数なしの後始末口で包んで
 * 受け渡す。読替えの対応付けだけを行い、信号や予約内容には触れない。
 * 波形は固定 `sawtooth` で使い、周期波は作らない。
 *
 * @returns 操作口の存続中は使い回す音声文脈。
 */
export function createPitchGridContext(): PitchGridSoundContext {
  const context = new AudioContext();
  // ADR: 代替物の接続先を実ノードへ読み替える対応付け。声の利得器は代替物であり
  // 実ノードではないため、発振器側の接続で実体へ読み替える。出力先は実ノードとして
  // 作るため、そのまま渡す読み替えが成立する。外部からの任意の値は渡さない。
  const nodeOf = new WeakMap<object, AudioNode>();
  const resolveNode = (target: object): AudioNode =>
    nodeOf.get(target) ?? (target as AudioNode);
  return {
    destination: context.destination,
    get currentTime(): number {
      return context.currentTime;
    },
    get state(): string {
      return context.state;
    },
    resume: (): Promise<void> => context.resume(),
    close: (): Promise<void> => context.close(),
    createOscillator: (): PitchGridSoundOscillator => {
      const oscillator = context.createOscillator();
      let ended: (() => void) | null = null;
      const port: PitchGridSoundOscillator = {
        frequency: oscillator.frequency,
        get type(): OscillatorType {
          return oscillator.type;
        },
        set type(value: OscillatorType) {
          oscillator.type = value;
        },
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
    createGain: (): PitchGridSoundGain => {
      const gainNode = context.createGain();
      const port: PitchGridSoundGain = {
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
  };
}

/**
 * 操作口の存続に対応する格子の個別声の演奏口を作る。
 *
 * 呼び出し側は自動再生方針に従い、利用者の操作処理の中から
 * 集合の反映を呼ぶ。生成直後が一時停止状態の場合に備え、
 * 操作由来の再開として `resume()` を続ける。
 *
 * 移動で同じ鍵に声が残る場合は開始し直さない。集合の意味上は
 * 移動済みだが、同じ鍵・同じ周波数の音を途切れさせないためである。
 * 切替ではこの再利用を通さず、専用の境界で全座標に新声を作る。
 *
 * @param createContext - 音声文脈の生成口。省略時は `AudioContext` を最小口へ読み替える。
 * @returns 操作口の存続中は使い回す演奏口。
 */
export function createPitchGridSound(
  createContext: () => PitchGridSoundContext = createPitchGridContext,
): PitchGridSound {
  let context: PitchGridSoundContext | null = null;
  // 所有する声。鍵は座標由来の不透明な文字列であり、格子の意味は解釈しない。
  // 汎用の複数声管理（奪取・使い回し）は設けない。
  const voices = new Map<string, ActiveVoice>();
  let disposed = false;
  let disposePromise: Promise<void> | null = null;
  let contextClosed = false;
  // 表示用の購読者。発振器などの音声資源は渡さず、内容変化時の合図だけに使う。
  const soundingListeners = new Set<() => void>();
  // 直近に通知した表示内容の照合鍵。内容不変の再反映では通知しないために保つ。
  let lastSoundingKey = '';

  // 保持中かつ再開成立した声だけを表示用に抜き出す。順序は鍵順に揃える。
  const snapshotSoundingVoices = (): PitchGridSoundingVoice[] => {
    const sounding: PitchGridSoundingVoice[] = [];
    for (const voice of voices.values()) {
      if (!voice.released && voice.settled) {
        sounding.push({ key: voice.key, frequency: voice.frequency });
      }
    }
    sounding.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return sounding;
  };

  // 表示内容が変わったときだけ購読者へ知らせる。減衰終了など表示外の
  // 所有変化では照合鍵が変わらず、呼ばない。
  const emitSoundingIfChanged = (): void => {
    const sounding = snapshotSoundingVoices();
    const soundingKey = sounding.map((voice) => `${voice.key}@${voice.frequency}`).join('|');
    if (soundingKey === lastSoundingKey) {
      return;
    }
    lastSoundingKey = soundingKey;
    for (const listener of [...soundingListeners]) {
      listener();
    }
  };

  // 所有する声があれば即時に止めて切り離す。文脈には触れない。
  // 減衰の予約済みで停止時刻が予約済みの場合は、停止呼び出しを重ねず
  // 終了通知を取り消して切り離す。予約済みの停止は文脈側で実行されるが、
  // 所有照合で無視するため後続の声を止めない。
  const detachVoiceImmediate = (voice: ActiveVoice): void => {
    if (voices.get(voice.key) !== voice) {
      return;
    }
    voices.delete(voice.key);
    if (voice.released) {
      voice.oscillator.onended = null;
    } else {
      voice.oscillator.stop();
    }
    voice.oscillator.disconnect();
    voice.gain.disconnect();
    // 保持中の表示声の切離しは表示内容の変化であり、減衰済みや起動待ちの
    // 切離しは表示外のため照合で通知しない。
    emitSoundingIfChanged();
  };

  // 減衰終了時の後始末。停止は予約済みで実行済みのため切断だけ行う。
  // 所有する声と一致する場合だけ切り離し、後続の声を止めない。
  const detachVoiceOnEnded = (voice: ActiveVoice): void => {
    if (voices.get(voice.key) !== voice) {
      return;
    }
    voices.delete(voice.key);
    voice.oscillator.disconnect();
    voice.gain.disconnect();
    // 終了する声は減衰の予約時に表示から外れているため、照合で通知しない。
    emitSoundingIfChanged();
  };

  // 一つの保持中声を新しい周波数へ即時に切り替える。
  // ADR: 通常反映の再調律では発振器と利得ノードを保ち、周波数を段階的に
  // 変えずその時点で新値へ切り替える。ADSRは再始動しない（包絡の再予約・
  // 停止予約を行わない）。リリース予約済みの声には使わず、新声を作る。
  // 切替時のクリックや聴感は未検証であり、滑らかさは保証しない。
  const retuneVoice = (voice: ActiveVoice, frequency: number): void => {
    voice.oscillator.frequency.value = frequency;
    voice.frequency = frequency;
    // 保持中かつ再開成立の声は表示内容が変わるため、内容変化時のみ通知する。
    // 起動待ちの声は表示外のため照合で通知しない。
    emitSoundingIfChanged();
  };

  // 一つの声に減衰を予約する。予約済みの再呼び出しは何もしない。
  const releaseVoice = (voice: ActiveVoice): void => {
    if (voice.released) {
      return;
    }
    const activeContext = context;
    if (activeContext === null) {
      return;
    }
    voice.released = true;
    const noteOffTime = activeContext.currentTime;
    // 保持付き取消しがない環境の再設定値として、予約した線形区間から現在値を求める。
    const currentGain = envelopeGainAtTime(
      voice.noteOnTime,
      noteOffTime,
      PITCH_GRID_VOICE_GAIN,
      HARMONIC_ENVELOPE_DEFAULTS,
    );
    const releaseEnd = scheduleRelease(
      voice.gain.gain,
      noteOffTime,
      currentGain,
      HARMONIC_ENVELOPE_DEFAULTS,
    );
    voice.oscillator.stop(releaseEnd);
    voice.oscillator.onended = (): void => {
      detachVoiceOnEnded(voice);
    };
    // 保持から外れた声は表示から外れる。起動待ちの声の予約は表示外のため
    // 照合で通知しない。
    emitSoundingIfChanged();
  };

  // 反映する声の並びを検証する。不正入力では音声文脈を作らない。
  // 判定は生成の前に済ませる。比率の正規化と同様、生成前の検査である。
  const validateSpecs = (specs: readonly PitchGridVoiceSpec[]): void => {
    const seen = new Set<string>();
    for (const spec of specs) {
      if (typeof spec.key !== 'string' || spec.key === '') {
        throw new Error('声の鍵は空でない文字列であること');
      }
      if (seen.has(spec.key)) {
        throw new Error(`重複した声の鍵である: ${spec.key}`);
      }
      seen.add(spec.key);
      if (!Number.isFinite(spec.frequency) || spec.frequency <= 0) {
        throw new RangeError(`声の周波数は正の有限値であること: ${String(spec.frequency)}`);
      }
    }
    if (specs.length > PITCH_GRID_MAX_VOICES) {
      throw new RangeError(
        `格子の声数は同時発音の上限以下であること: ${specs.length} > ${PITCH_GRID_MAX_VOICES}`,
      );
    }
  };

  // 一つの新声を開始して所有に登録する。
  // ADR: 声は独立に寿命を持つため、一つの声の生成失敗は他の声を取り消さない。
  // 失敗した鍵は所有に戻さず、成功した声は鳴らし続ける。
  const startVoice = (
    activeContext: PitchGridSoundContext,
    key: string,
    frequency: number,
  ): ActiveVoice => {
    const nextGain = activeContext.createGain();
    const next = activeContext.createOscillator();
    const startTime = activeContext.currentTime;
    // 声の利得は発音前に無音とし、現在時刻を基準に包絡を予約する。
    // 波形は固定 `sawtooth` で使い、周期波は作らない。
    nextGain.gain.value = 0;
    scheduleNoteOn(nextGain.gain, startTime, PITCH_GRID_VOICE_GAIN);
    next.type = 'sawtooth';
    next.frequency.value = frequency;
    next.connect(nextGain);
    nextGain.connect(activeContext.destination);
    next.start();
    const voice: ActiveVoice = {
      key,
      frequency,
      oscillator: next,
      gain: nextGain,
      noteOnTime: startTime,
      released: false,
      settled: false,
    };
    voices.set(key, voice);
    return voice;
  };

  // 文脈の再開完了まで開始した声を追う。所有の照合は声の実体で行い、
  // 世代番号は設けない。古い完了通知が新声を止めたり復活させたりしない。
  const trackStartedVoices = (
    started: readonly ActiveVoice[],
    resumeTask: Promise<void>,
  ): Promise<void> => {
    if (started.length === 0) {
      return Promise.resolve();
    }
    // 自身への参照は完了後の後始末の照合に使う。
    return resumeTask.then(
      () => {
        for (const voice of started) {
          if (disposed || voices.get(voice.key) !== voice) {
            continue;
          }
          voice.settled = true;
        }
        // 再開成立した声だけが表示に加わる。取り消された起動は所有外の
        // ため照合で通知しない。
        emitSoundingIfChanged();
      },
      (error: unknown) => {
        // 取り消された起動は失敗として扱わず、静かに終える。
        if (disposed) {
          for (const voice of started) {
            detachVoiceImmediate(voice);
          }
          return;
        }
        let owned = false;
        for (const voice of started) {
          if (voices.get(voice.key) === voice) {
            owned = true;
            break;
          }
        }
        if (!owned) {
          return;
        }
        // 再開の失敗時は開始した声だけを外して文脈は保つ。
        for (const voice of started) {
          detachVoiceImmediate(voice);
        }
        throw error;
      },
    );
  };

  const sound: PitchGridSound = {
    get voiceCount(): number {
      return voices.size;
    },
    get soundingVoices(): readonly PitchGridSoundingVoice[] {
      return snapshotSoundingVoices();
    },
    subscribeSounding(listener: () => void): () => void {
      soundingListeners.add(listener);
      return (): void => {
        soundingListeners.delete(listener);
      };
    },
    async setVoices(specs: readonly PitchGridVoiceSpec[]): Promise<void> {
      validateSpecs(specs);
      if (disposed) {
        throw new Error('破棄後の演奏口は使えない');
      }
      if (context === null) {
        context = createContext();
      }
      const activeContext = context;
      const desired = new Map(specs.map((spec) => [spec.key, spec.frequency] as const));

      // 集合から外れた声はその声だけ減衰を予約し、他点を巻き込まない。
      for (const voice of [...voices.values()]) {
        if (!desired.has(voice.key)) {
          releaseVoice(voice);
        }
      }

      // ADR: 同じ鍵・同じ周波数に残る保持中の声は開始し直さない。集合の意味上は
      // 移動済みだが、同じ音を途切れさせず、発振器の作り直しも避ける。
      // 同じ鍵で周波数が変わった保持中の声は即時に切り替え、ADSRは再始動しない。
      // リリース予約済みの声は再利用せず新声を作る（所有照合で古い完了通知が
      // 新声を止めたり復活させたりしない）。
      const started: ActiveVoice[] = [];
      for (const spec of specs) {
        const owned = voices.get(spec.key);
        if (owned !== undefined && !owned.released) {
          if (owned.frequency === spec.frequency) {
            continue;
          }
          retuneVoice(owned, spec.frequency);
          continue;
        }
        started.push(startVoice(activeContext, spec.key, spec.frequency));
      }
      return trackStartedVoices(started, activeContext.resume());
    },
    async switchDimension(specs: readonly PitchGridVoiceSpec[]): Promise<void> {
      validateSpecs(specs);
      if (disposed) {
        throw new Error('破棄後の演奏口は使えない');
      }
      // 切替専用の境界として、通常の差分反映の再利用分岐を通さない。
      // 減衰予約済みの旧声を使い回すと周波数が変わらない鍵では無音になるため、
      // 起動待ちを取り消し、旧声の所有を切り離してから全座標に新声を作る。
      for (const voice of [...voices.values()]) {
        detachVoiceImmediate(voice);
      }
      if (specs.length === 0) {
        return;
      }
      if (context === null) {
        context = createContext();
      }
      const activeContext = context;
      const started = specs.map((spec) => startVoice(activeContext, spec.key, spec.frequency));
      return trackStartedVoices(started, activeContext.resume());
    },
    stopAll(): void {
      if (disposed) {
        return;
      }
      for (const voice of [...voices.values()]) {
        if (voice.settled) {
          releaseVoice(voice);
        } else {
          // 起動の完了待ちは減衰を予約せず取り消す。文脈は保つ。
          detachVoiceImmediate(voice);
        }
      }
    },
    async dispose(): Promise<void> {
      if (disposePromise !== null) {
        return disposePromise;
      }
      disposed = true;
      for (const voice of [...voices.values()]) {
        detachVoiceImmediate(voice);
      }
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

  return sound;
}
