/**
 * 一つの和音を所有する演奏口の配線検査。
 *
 * ブラウザの音声文脈を使わず、生成口に差す代替物で声ごとの周波数と波形・包絡、
 * 同一文脈、全声ノートオフ、個別終了後と全終了後の状態、声数上限、再開失敗・
 * 破棄・遅延した終了通知の所有競合を確かめる。各声の寿命管理は単音側が担うため、
 * 利得の予約は順序だけでなく値と時刻まで照合し、呼び出し記録だけを合格証拠に
 * しない。具体値はこの検査に置く。音声信号の採取は対象外とし、未実装の
 * 受入れ条件は一時的な検証計画に置く。
 *
 * 公開口の意味はノートオン（`start`）・ノートオフ（`noteOff`。全声の減衰の予約で
 * 減衰中も音は鳴る）・即時の中断（`stop`。減衰を待たない緊急用）・解放
 * （`dispose`。中断と文脈閉鎖）とし、単音側と同じ意味で使う。操作側は通常の
 * 終了に `noteOff` を使う。
 */

import { describe, expect, it } from 'vitest';
import {
  HARMONIC_CHORD_MAX_VOICES,
  HARMONIC_CHORD_TOTAL_GAIN,
  createHarmonicChordSession,
} from './harmonicChord';
import { HARMONIC_ENVELOPE_DEFAULTS } from './harmonicEnvelope';
import {
  HARMONIC_TONE_FREQUENCY_HZ,
  HARMONIC_TONE_OUTPUT_GAIN,
  type HarmonicToneContext,
  type HarmonicToneGain,
  type HarmonicToneOscillator,
} from './harmonicTone';

/** 包絡の既定値。予約時刻と値の期待値の算出に使う。 */
const { attackTime: ATTACK_TIME, decayTime: DECAY_TIME } = HARMONIC_ENVELOPE_DEFAULTS;
const { sustainLevel: SUSTAIN_LEVEL, releaseTime: RELEASE_TIME } = HARMONIC_ENVELOPE_DEFAULTS;

/** 利得パラメータへの予約記録。順序・値・時刻の照合に使う。 */
interface GainEvent {
  readonly kind: 'setValue' | 'linearRamp' | 'cancelValues' | 'cancelAndHold';
  readonly value: number | null;
  readonly time: number;
}

interface FakeOscillator extends HarmonicToneOscillator {
  readonly calls: string[];
  /** `stop` に渡した時刻の記録。未指定の即時停止は `undefined` になる。 */
  readonly stopTimes: Array<number | undefined>;
  wave: object | null;
}

interface FakeGain extends HarmonicToneGain {
  readonly calls: string[];
  readonly events: GainEvent[];
}

/** 時刻を操作できる検査用の文脈。現在時刻は可変とし、それ以外は最小口に従う。 */
interface FakeContext {
  readonly destination: object;
  readonly sampleRate: number;
  currentTime: number;
  readonly state: string;
  readonly calls: string[];
  readonly oscillators: FakeOscillator[];
  readonly gains: FakeGain[];
  readonly waves: Array<{ real: Float32Array; imag: Float32Array; disableNormalization: boolean }>;
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

/** 文脈生成を数え、再開の振る舞いを差し替えられる検査用の束。 */
interface Harness {
  readonly contexts: FakeContext[];
  readonly createContext: () => HarmonicToneContext;
  enqueueResume(handler: () => Promise<void>): void;
}

function createHarness(
  sampleRate = 48000,
  options: { cancelAndHold: boolean } = { cancelAndHold: true },
): Harness {
  const contexts: FakeContext[] = [];
  const resumeQueue: Array<() => Promise<void>> = [];

  const createContext = (): HarmonicToneContext => {
    const destination = {};
    const contextCalls: string[] = [];
    const oscillators: FakeOscillator[] = [];
    const gains: FakeGain[] = [];
    const waves: FakeContext['waves'] = [];
    const context: FakeContext = {
      destination,
      sampleRate,
      currentTime: 0,
      state: 'suspended',
      calls: contextCalls,
      oscillators,
      gains,
      waves,
      resume(): Promise<void> {
        contextCalls.push('resume');
        const next = resumeQueue.shift();
        return next !== undefined ? next() : Promise.resolve();
      },
      close(): Promise<void> {
        contextCalls.push('close');
        return Promise.resolve();
      },
      createPeriodicWave(
        real: Float32Array,
        imag: Float32Array,
        constraints: { disableNormalization: boolean },
      ): object {
        contextCalls.push('createPeriodicWave');
        const wave = { real, imag, disableNormalization: constraints.disableNormalization };
        waves.push(wave);
        return wave;
      },
      createGain(): HarmonicToneGain {
        contextCalls.push('createGain');
        const gainCalls: string[] = [];
        const events: GainEvent[] = [];
        let currentValue = 0;
        const gainNode: FakeGain = {
          gain: {
            get value(): number {
              return currentValue;
            },
            set value(next: number) {
              currentValue = next;
            },
            setValueAtTime(value: number, time: number): void {
              events.push({ kind: 'setValue', value, time });
              currentValue = value;
            },
            linearRampToValueAtTime(value: number, time: number): void {
              events.push({ kind: 'linearRamp', value, time });
            },
            cancelScheduledValues(time: number): void {
              events.push({ kind: 'cancelValues', value: null, time });
            },
            // 保持付き取消しは対応が限定的なため、harness の指定で有無を切り替える。
            ...(options.cancelAndHold
              ? {
                  cancelAndHoldAtTime(time: number): void {
                    events.push({ kind: 'cancelAndHold', value: null, time });
                  },
                }
              : {}),
          },
          calls: gainCalls,
          events,
          connect(target: object): void {
            // 声の利得器の接続先が生成に使った文脈の出力先であることを保証する。
            expect(target).toBe(destination);
            gainCalls.push('connect');
          },
          disconnect(): void {
            if (gainCalls.filter((call) => call === 'disconnect').length > 0) {
              throw new Error('二重切断');
            }
            gainCalls.push('disconnect');
          },
        };
        gains.push(gainNode);
        return gainNode;
      },
      createOscillator(): HarmonicToneOscillator {
        contextCalls.push('createOscillator');
        const oscillatorCalls: string[] = [];
        const stopTimes: Array<number | undefined> = [];
        let ended: (() => void) | null = null;
        const oscillator: FakeOscillator = {
          frequency: { value: 0 },
          get onended(): (() => void) | null {
            return ended;
          },
          set onended(handler: (() => void) | null) {
            ended = handler;
          },
          wave: null,
          calls: oscillatorCalls,
          stopTimes,
          setPeriodicWave(wave: object): void {
            oscillatorCalls.push('setPeriodicWave');
            oscillator.wave = wave;
          },
          connect(target: object): void {
            // 発振器の接続先が同じ文脈のいずれかの声の利得器であることを保証する。
            expect(gains).toContain(target);
            oscillatorCalls.push('connect');
          },
          disconnect(): void {
            oscillatorCalls.push('disconnect');
          },
          start(): void {
            oscillatorCalls.push('start');
          },
          stop(when?: number): void {
            // 実物の発振器は二度目の停止を拒むため、重複呼び出しは検査で検出する。
            if (stopTimes.length > 0) {
              throw new Error('二重停止');
            }
            stopTimes.push(when);
            oscillatorCalls.push('stop');
          },
        };
        oscillators.push(oscillator);
        return oscillator;
      },
    };
    contexts.push(context);
    return context;
  };

  return {
    contexts,
    createContext,
    enqueueResume(handler: () => Promise<void>): void {
      resumeQueue.push(handler);
    },
  };
}

describe('和音の生成', () => {
  it('既定では単声を従来水準の利得で一つの文脈に生成する', async () => {
    const harness = createHarness();
    const session = createHarmonicChordSession(harness.createContext);

    await session.start();

    // 文脈の再生成が起きると代替物の個数が増えるため、共有の破れを検出する。
    expect(harness.contexts).toHaveLength(1);
    const context = harness.contexts[0] as FakeContext;
    expect(context.oscillators).toHaveLength(1);
    expect(context.gains).toHaveLength(1);
    expect(context.waves).toHaveLength(1);
    expect(context.oscillators[0]?.frequency.value).toBe(HARMONIC_TONE_FREQUENCY_HZ);
    // 単声では総利得予算の全体が一つの声に渡り、従来水準を維持する。
    const gain = context.gains[0] as FakeGain;
    expect(gain.events[1]?.value).toBeCloseTo(HARMONIC_TONE_OUTPUT_GAIN, 10);
    expect(gain.events[1]?.time).toBeCloseTo(ATTACK_TIME, 10);
    expect(gain.events[2]?.value).toBeCloseTo(HARMONIC_TONE_OUTPUT_GAIN * SUSTAIN_LEVEL, 10);
    expect(gain.events[2]?.time).toBeCloseTo(ATTACK_TIME + DECAY_TIME, 10);
    expect(session.playing).toBe(true);
    expect(session.releasing).toBe(false);
    await session.dispose();
  });

  it('等価な比率を一つの声にまとめて有効な声だけを生成する', async () => {
    const harness = createHarness();
    const session = createHarmonicChordSession(harness.createContext);

    await session.start({
      ratios: [
        { numerator: 3, denominator: 2 },
        { numerator: 2, denominator: 2 },
        { numerator: 1, denominator: 1 },
        { numerator: 6, denominator: 4 },
      ],
    });

    expect(harness.contexts).toHaveLength(1);
    const context = harness.contexts[0] as FakeContext;
    expect(context.oscillators).toHaveLength(2);
    expect(context.gains).toHaveLength(2);
    expect(context.waves).toHaveLength(2);
    // 声は低い順に並ぶため、添字で周波数を対応付ける。
    expect(context.oscillators[0]?.frequency.value).toBe(440);
    expect(context.oscillators[1]?.frequency.value).toBe(660);
    await session.dispose();
  });

  it('声ごとに周波数と波形を用意し総利得予算を分配する', async () => {
    const harness = createHarness();
    const session = createHarmonicChordSession(harness.createContext);

    await session.start({
      baseFrequency: 440,
      ratios: [
        { numerator: 1, denominator: 1 },
        { numerator: 5, denominator: 4 },
        { numerator: 3, denominator: 2 },
      ],
    });

    const context = harness.contexts[0] as FakeContext;
    expect(context.oscillators).toHaveLength(3);
    expect(context.oscillators.map((oscillator) => oscillator.frequency.value)).toEqual([
      440, 550, 660,
    ]);
    // 周波数が変われば係数列が変わるため、波形を使い回さない。
    expect(context.waves).toHaveLength(3);
    expect(context.waves[0]?.imag.length).not.toBe(context.waves[1]?.imag.length);
    // 総利得予算を有効声数で等分し、各声にそのまま配らない。
    const voiceGain = HARMONIC_CHORD_TOTAL_GAIN / 3;
    for (const voiceGainNode of context.gains) {
      expect(voiceGainNode.events[1]?.value).toBeCloseTo(voiceGain, 10);
      expect(voiceGainNode.events[2]?.value).toBeCloseTo(voiceGain * SUSTAIN_LEVEL, 10);
    }
    // 各声の利得器が同じ文脈の出力先へつながることを保証する。
    expect(context.gains.map((voiceGainNode) => voiceGainNode.calls)).toEqual([
      ['connect'],
      ['connect'],
      ['connect'],
    ]);
    expect(session.playing).toBe(true);
    await session.dispose();
  });

  it('素数次元表示の入力を同じ声へ解決する', async () => {
    const harness = createHarness();
    const session = createHarmonicChordSession(harness.createContext);

    await session.start({
      ratios: [{ numerator: 1, denominator: 1 }, { primeExponents: { 3: 1, 2: -1 } }],
    });

    const context = harness.contexts[0] as FakeContext;
    expect(context.oscillators).toHaveLength(2);
    expect(context.oscillators.map((oscillator) => oscillator.frequency.value)).toEqual([
      440, 660,
    ]);
    await session.dispose();
  });

  it('不正入力を音声文脈を作らずに拒む', async () => {
    const harness = createHarness();
    const session = createHarmonicChordSession(harness.createContext);

    await expect(session.start({ baseFrequency: 0 })).rejects.toBeInstanceOf(RangeError);
    await expect(session.start({ baseFrequency: Number.NaN })).rejects.toBeInstanceOf(RangeError);
    await expect(session.start({ ratios: [] })).rejects.toBeInstanceOf(RangeError);
    await expect(
      session.start({ ratios: [{ numerator: 0, denominator: 1 }] }),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      session.start({ ratios: [{ numerator: 1, denominator: 0 }] }),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      session.start({ ratios: [{ primeExponents: { 4: 1 } }] }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(harness.contexts).toHaveLength(0);
    expect(session.playing).toBe(false);
    await session.dispose();
  });

  it('同時発音の上限を超える有効な声を拒む', async () => {
    const harness = createHarness();
    const session = createHarmonicChordSession(harness.createContext);

    await expect(
      session.start({
        ratios: [
          { numerator: 1, denominator: 1 },
          { numerator: 5, denominator: 4 },
          { numerator: 3, denominator: 2 },
          { numerator: 2, denominator: 1 },
        ],
      }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(harness.contexts).toHaveLength(0);

    // 入力の並びが多くても等価な比率は束ねるため、有効な声が上限以下なら鳴らす。
    await session.start({
      ratios: [
        { numerator: 1, denominator: 1 },
        { numerator: 2, denominator: 2 },
        { numerator: 3, denominator: 2 },
        { numerator: 6, denominator: 4 },
      ],
    });
    expect(harness.contexts).toHaveLength(1);
    expect((harness.contexts[0] as FakeContext).oscillators).toHaveLength(2);
    expect(HARMONIC_CHORD_MAX_VOICES).toBe(3);
    await session.dispose();
  });
});

describe('和音のノートオフと終了', () => {
  it('全声に減衰を予約し減衰中は次の和音を重ねない', async () => {
    const harness = createHarness();
    const session = createHarmonicChordSession(harness.createContext);
    await session.start({
      ratios: [
        { numerator: 1, denominator: 1 },
        { numerator: 3, denominator: 2 },
      ],
    });

    // 持続に達した後にノートオフする。
    const noteOffTime = ATTACK_TIME + DECAY_TIME + 1;
    (harness.contexts[0] as FakeContext).currentTime = noteOffTime;
    session.noteOff();

    // 減衰中も音は鳴るため発音中のまま減衰中になる。
    expect(session.playing).toBe(true);
    expect(session.releasing).toBe(true);
    const context = harness.contexts[0] as FakeContext;
    // 全声の減衰終了時刻に停止を予約することを保証する。
    for (const oscillator of context.oscillators) {
      expect(oscillator.stopTimes).toHaveLength(1);
      expect(oscillator.stopTimes[0]).toBeCloseTo(noteOffTime + RELEASE_TIME, 10);
      expect(oscillator.onended).not.toBeNull();
    }
    // 保持付き取消しで値を保ち、無音への減衰だけを足すことを保証する。
    for (const voiceGainNode of context.gains) {
      expect(voiceGainNode.events.map((event) => event.kind)).toEqual([
        'setValue',
        'linearRamp',
        'linearRamp',
        'cancelAndHold',
        'linearRamp',
      ]);
      expect(voiceGainNode.events[4]?.value).toBe(0);
    }

    // 減衰中の開始では次の和音を重ねない。
    await session.start({
      ratios: [
        { numerator: 1, denominator: 1 },
        { numerator: 5, denominator: 4 },
      ],
    });
    expect(context.oscillators).toHaveLength(2);
    expect(context.waves).toHaveLength(2);
    await session.dispose();
  });

  it('個別終了後も発音中とし全終了後に再操作できる', async () => {
    const harness = createHarness();
    const session = createHarmonicChordSession(harness.createContext);
    await session.start({
      ratios: [
        { numerator: 1, denominator: 1 },
        { numerator: 3, denominator: 2 },
      ],
    });
    (harness.contexts[0] as FakeContext).currentTime = ATTACK_TIME + DECAY_TIME + 1;
    session.noteOff();
    const context = harness.contexts[0] as FakeContext;
    const first = context.oscillators[0] as FakeOscillator;
    const second = context.oscillators[1] as FakeOscillator;

    // 一つの声の終了では残りの声が鳴るため発音中のままである。
    first.onended?.();
    expect(session.playing).toBe(true);
    expect(session.releasing).toBe(true);
    expect(first.calls).toEqual(['setPeriodicWave', 'connect', 'start', 'stop', 'disconnect']);

    // 全声の終了で再操作可能になる。
    second.onended?.();
    expect(session.playing).toBe(false);
    expect(session.releasing).toBe(false);

    // 減衰完了後の再操作では同じ文脈に新しい声を作る。
    await session.start({ baseFrequency: 330, ratios: [{ numerator: 1, denominator: 1 }] });
    expect(harness.contexts).toHaveLength(1);
    expect(context.oscillators).toHaveLength(3);
    expect(context.oscillators[2]?.frequency.value).toBe(330);
    expect(session.playing).toBe(true);

    // 旧声の終了通知が残っていても後続の声を止めない。
    first.onended?.();
    second.onended?.();
    expect(session.playing).toBe(true);
    await session.dispose();
  });

  it('声がないときのノートオフでは文脈を作らず何もしない', async () => {
    const harness = createHarness();
    const session = createHarmonicChordSession(harness.createContext);

    session.noteOff();

    expect(harness.contexts).toHaveLength(0);
    expect(session.playing).toBe(false);
    expect(session.releasing).toBe(false);
    await session.dispose();
  });
});

describe('和音の即時停止と破棄', () => {
  it('停止では音声文脈を閉じず全声だけを止める', async () => {
    const harness = createHarness();
    const session = createHarmonicChordSession(harness.createContext);
    await session.start({
      ratios: [
        { numerator: 1, denominator: 1 },
        { numerator: 3, denominator: 2 },
      ],
    });

    session.stop();

    const context = harness.contexts[0] as FakeContext;
    expect(session.playing).toBe(false);
    expect(session.releasing).toBe(false);
    for (const oscillator of context.oscillators) {
      // 即時の中断は停止時刻の指定なしで止めることを保証する。
      expect(oscillator.stopTimes).toEqual([undefined]);
    }
    expect(context.calls).not.toContain('close');
    await session.dispose();
  });

  it('破棄で全声を止めて音声文脈を一度だけ閉じ旧通知を無視する', async () => {
    const harness = createHarness();
    const session = createHarmonicChordSession(harness.createContext);
    await session.start({
      ratios: [
        { numerator: 1, denominator: 1 },
        { numerator: 3, denominator: 2 },
      ],
    });
    (harness.contexts[0] as FakeContext).currentTime = ATTACK_TIME + DECAY_TIME + 1;
    session.noteOff();
    const context = harness.contexts[0] as FakeContext;
    const endedHandlers = context.oscillators.map((oscillator) => oscillator.onended);

    await session.dispose();

    expect(session.playing).toBe(false);
    expect(session.releasing).toBe(false);
    // 予約済みの停止に重ねて止めないことを保証する。
    for (const oscillator of context.oscillators) {
      expect(oscillator.stopTimes).toHaveLength(1);
    }
    expect(context.calls.filter((call) => call === 'close')).toHaveLength(1);

    // 破棄後の非同期完了（旧声の終了通知）は何もしない。
    const callsBefore = context.oscillators.map((oscillator) => [...oscillator.calls]);
    for (const ended of endedHandlers) {
      ended?.();
    }
    expect(context.oscillators.map((oscillator) => [...oscillator.calls])).toEqual(callsBefore);
    await session.dispose();
    expect(context.calls.filter((call) => call === 'close')).toHaveLength(1);
  });

  it('起動前の破棄で文脈を作らず破棄後の開始を拒む', async () => {
    const harness = createHarness();
    const session = createHarmonicChordSession(harness.createContext);

    await session.dispose();
    expect(harness.contexts).toHaveLength(0);

    await expect(session.start()).rejects.toBeInstanceOf(Error);
    expect(harness.contexts).toHaveLength(0);
  });
});

describe('和音の非同期の競合と失敗', () => {
  it('再開の失敗で残りの声も止めて文脈を保ち再試行できる', async () => {
    const harness = createHarness();
    harness.enqueueResume(() => Promise.reject(new Error('再開失敗')));
    const session = createHarmonicChordSession(harness.createContext);

    await expect(
      session.start({
        ratios: [
          { numerator: 1, denominator: 1 },
          { numerator: 3, denominator: 2 },
        ],
      }),
    ).rejects.toThrow('再開失敗');

    // 失敗した声以外が残ると重なって鳴るため、全声の後始末を確かめる。
    const context = harness.contexts[0] as FakeContext;
    expect(session.playing).toBe(false);
    expect(session.releasing).toBe(false);
    for (const oscillator of context.oscillators) {
      expect(oscillator.calls.slice(-2)).toEqual(['stop', 'disconnect']);
    }
    expect(context.calls).not.toContain('close');

    await session.start({
      ratios: [
        { numerator: 1, denominator: 1 },
        { numerator: 3, denominator: 2 },
      ],
    });
    expect(harness.contexts).toHaveLength(1);
    expect(context.oscillators).toHaveLength(4);
    expect(session.playing).toBe(true);
    await session.dispose();
    expect(context.calls.filter((call) => call === 'close')).toHaveLength(1);
  });

  it('起動待ちの停止で声の漏れと二重再生を起こさない', async () => {
    const harness = createHarness();
    let release!: () => void;
    harness.enqueueResume(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const session = createHarmonicChordSession(harness.createContext);

    const pending = session.start({
      ratios: [
        { numerator: 1, denominator: 1 },
        { numerator: 3, denominator: 2 },
      ],
    });
    expect(session.playing).toBe(false);
    session.stop();
    release();
    // 取り消された起動は失敗として扱わず静かに終える。
    await pending;

    const context = harness.contexts[0] as FakeContext;
    expect(session.playing).toBe(false);
    expect(context.oscillators).toHaveLength(2);
    for (const oscillator of context.oscillators) {
      expect(oscillator.calls.slice(-2)).toEqual(['stop', 'disconnect']);
    }

    // 停止後の再操作では同じ文脈に新しい声を作る。
    await session.start({ ratios: [{ numerator: 1, denominator: 1 }] });
    expect(harness.contexts).toHaveLength(1);
    expect(context.oscillators).toHaveLength(3);
    expect(session.playing).toBe(true);
    await session.dispose();
  });

  it('起動の完了待ちの連打を一つの起動に束ねる', async () => {
    const harness = createHarness();
    let release!: () => void;
    harness.enqueueResume(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const session = createHarmonicChordSession(harness.createContext);

    const first = session.start({
      ratios: [
        { numerator: 1, denominator: 1 },
        { numerator: 3, denominator: 2 },
      ],
    });
    const second = session.start({
      ratios: [
        { numerator: 1, denominator: 1 },
        { numerator: 3, denominator: 2 },
      ],
    });
    // 束ねた二つ目の起動が別文脈や別声を作ると個数が増える。
    expect(harness.contexts).toHaveLength(1);
    expect((harness.contexts[0] as FakeContext).oscillators).toHaveLength(2);
    release();
    await first;
    await second;

    expect(session.playing).toBe(true);
    expect((harness.contexts[0] as FakeContext).oscillators).toHaveLength(2);
    await session.dispose();
  });

  it('起動待ちの破棄で文脈を一度だけ閉じる', async () => {
    const harness = createHarness();
    let release!: () => void;
    harness.enqueueResume(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const session = createHarmonicChordSession(harness.createContext);

    const pending = session.start({
      ratios: [
        { numerator: 1, denominator: 1 },
        { numerator: 3, denominator: 2 },
      ],
    });
    const disposing = session.dispose();
    release();
    await pending;
    await disposing;

    const context = harness.contexts[0] as FakeContext;
    expect(session.playing).toBe(false);
    expect(context.calls.filter((call) => call === 'close')).toHaveLength(1);
    await session.dispose();
    expect(context.calls.filter((call) => call === 'close')).toHaveLength(1);
  });
});
