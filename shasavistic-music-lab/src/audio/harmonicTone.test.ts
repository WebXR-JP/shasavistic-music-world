/**
 * 調波単音の生成・包絡・停止・解放の配線検査。
 *
 * ブラウザの音声文脈を使わず、生成口に差す代替物で呼び出しの有無と順序、
 * 設定値、不正入力の拒否を確かめる。利得の予約は順序だけでなく値と時刻まで
 * 照合し、呼び出し記録だけを合格証拠にしない。具体値はこの検査に置く。
 * 音声信号の採取は対象外とし、未実装の受入れ条件は一時的な検証計画に置く。
 *
 * 公開口の意味はノートオン（`start`）・ノートオフ（`noteOff`。減衰の予約で
 * 減衰中も音は鳴る）・即時の中断（`stop`。減衰を待たない緊急用）・解放
 * （`dispose`。中断と文脈閉鎖）とし、従来の即時停止を無条件にノートオフと
 * 読み替えない。操作側は通常の終了に `noteOff` を使う。
 */

import { describe, expect, it } from 'vitest';
import {
  HARMONIC_TONE_FREQUENCY_HZ,
  HARMONIC_TONE_OUTPUT_GAIN,
  type HarmonicToneContext,
  type HarmonicToneGain,
  type HarmonicToneOscillator,
  createHarmonicToneSession,
} from './harmonicTone';
import { HARMONIC_ENVELOPE_DEFAULTS, envelopeGainAtTime } from './harmonicEnvelope';
import { HARMONIC_PRESETS } from './harmonicPresets';

/** 包絡の既定値。予約時刻と値の期待値の算出に使う。 */
const { attackTime: ATTACK_TIME, decayTime: DECAY_TIME } = HARMONIC_ENVELOPE_DEFAULTS;
const { sustainLevel: SUSTAIN_LEVEL, releaseTime: RELEASE_TIME } = HARMONIC_ENVELOPE_DEFAULTS;

/** 最大利得（アタックの到達点）。 */
const PEAK_GAIN = HARMONIC_TONE_OUTPUT_GAIN;

/** サステイン利得（最大利得に対する割合）。 */
const SUSTAIN_GAIN = PEAK_GAIN * SUSTAIN_LEVEL;

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
            // 利得器の接続先が生成に使った文脈の出力先であることを保証する。
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
            // 発振器の接続先が同じ声の利得器であることを保証する。
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
            // 減衰の予約済みは停止時刻の予約であり、即時の中断側で重ねない。
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

describe('調波単音の生成', () => {
  it('既定の調波単音で声と周期波を生成し包絡を予約して再開する', async () => {
    const harness = createHarness();
    const session = createHarmonicToneSession(harness.createContext);

    await session.start({});

    const context = harness.contexts[0];
    expect(context.oscillators).toHaveLength(1);
    expect(context.gains).toHaveLength(1);
    expect(context.waves).toHaveLength(1);
    const oscillator = context.oscillators[0];
    // 正規化の無効化を意図どおり渡すことを保証する。
    expect(context.waves[0].disableNormalization).toBe(true);
    // 既定の基音振幅が周期波の虚部に載ることを保証する。
    expect(context.waves[0].imag[1]).toBeCloseTo(1, 5);
    expect(oscillator.wave).toBe(context.waves[0]);
    expect(oscillator.frequency.value).toBe(HARMONIC_TONE_FREQUENCY_HZ);
    expect(oscillator.calls).toEqual(['setPeriodicWave', 'connect', 'start']);
    // 声の利得は発音前に無音とし、無音→最大→持続の順に予約することを保証する。
    const gain = context.gains[0];
    expect(gain.gain.value).toBe(0);
    expect(gain.events.map((event) => event.kind)).toEqual([
      'setValue',
      'linearRamp',
      'linearRamp',
    ]);
    expect(gain.events[0].value).toBe(0);
    expect(gain.events[0].time).toBe(0);
    expect(gain.events[1].value).toBeCloseTo(PEAK_GAIN, 10);
    expect(gain.events[1].time).toBeCloseTo(ATTACK_TIME, 10);
    expect(gain.events[2].value).toBeCloseTo(SUSTAIN_GAIN, 10);
    expect(gain.events[2].time).toBeCloseTo(ATTACK_TIME + DECAY_TIME, 10);
    expect(gain.calls).toEqual(['connect']);
    expect(context.calls).toEqual([
      'createPeriodicWave',
      'createGain',
      'createOscillator',
      'resume',
    ]);
    expect(session.playing).toBe(true);
    expect(session.releasing).toBe(false);
    await session.dispose();
  });

  it('指定した周波数とプリセットで生成する', async () => {
    const harness = createHarness();
    const session = createHarmonicToneSession(harness.createContext);

    await session.start({ frequency: 660, preset: HARMONIC_PRESETS[2] });

    const context = harness.contexts[0];
    expect(context.oscillators[0].frequency.value).toBe(660);
    // Septimal の7次倍音が重みで持ち上がることを保証する。
    expect(context.waves[0].imag[7]).toBeCloseTo(
      context.waves[0].imag[5] * (7 / 5) ** -1.5 * 2,
      4,
    );
    expect(session.playing).toBe(true);
    expect(session.releasing).toBe(false);
    await session.dispose();
  });

  it('正でない周波数の生成を音声文脈を作らずに拒む', async () => {
    const harness = createHarness();
    const session = createHarmonicToneSession(harness.createContext);

    await expect(session.start({ frequency: 0 })).rejects.toBeInstanceOf(RangeError);
    await expect(session.start({ frequency: -440 })).rejects.toBeInstanceOf(RangeError);
    await expect(session.start({ frequency: Number.NaN })).rejects.toBeInstanceOf(RangeError);
    await expect(
      session.start({ frequency: Number.POSITIVE_INFINITY }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(harness.contexts).toHaveLength(0);
    await session.dispose();
  });
});

describe('包絡の時点利得計算', () => {
  it('予約した折れ線と同じ時点利得を返す', () => {
    const noteOnTime = 10;
    // 開始前は無音であること。
    expect(envelopeGainAtTime(noteOnTime, noteOnTime, PEAK_GAIN)).toBe(0);
    expect(envelopeGainAtTime(noteOnTime, noteOnTime - 1, PEAK_GAIN)).toBe(0);
    // 立ち上がりの途中は最大への線形途中であること。
    expect(envelopeGainAtTime(noteOnTime, noteOnTime + ATTACK_TIME / 2, PEAK_GAIN)).toBeCloseTo(
      PEAK_GAIN / 2,
      10,
    );
    // 減衰の途中は最大から持続への線形途中であること。
    expect(
      envelopeGainAtTime(noteOnTime, noteOnTime + ATTACK_TIME + DECAY_TIME / 2, PEAK_GAIN),
    ).toBeCloseTo((PEAK_GAIN + SUSTAIN_GAIN) / 2, 10);
    // 減衰の完了後は持続利得に留まること。
    expect(
      envelopeGainAtTime(noteOnTime, noteOnTime + ATTACK_TIME + DECAY_TIME, PEAK_GAIN),
    ).toBeCloseTo(SUSTAIN_GAIN, 10);
    expect(
      envelopeGainAtTime(noteOnTime, noteOnTime + ATTACK_TIME + DECAY_TIME + 5, PEAK_GAIN),
    ).toBeCloseTo(SUSTAIN_GAIN, 10);
  });
});

describe('調波単音のノートオフと減衰', () => {
  it('ノートオフで減衰を予約し減衰中も発音中として次の声を重ねない', async () => {
    const harness = createHarness();
    const session = createHarmonicToneSession(harness.createContext);
    await session.start({});

    // 持続に達した後にノートオフする。
    const noteOffTime = ATTACK_TIME + DECAY_TIME + 1;
    harness.contexts[0].currentTime = noteOffTime;
    session.noteOff();

    // 減衰中も音は鳴るため発音中のまま減衰中になる。
    expect(session.playing).toBe(true);
    expect(session.releasing).toBe(true);
    const context = harness.contexts[0];
    const gain = context.gains[0];
    const oscillator = context.oscillators[0];
    // 保持付き取消しで値を保ち、無音への減衰だけを足すことを保証する。
    // 値の再設定は行わず、進行中のランプをつなぐ。
    expect(gain.events.map((event) => event.kind)).toEqual([
      'setValue',
      'linearRamp',
      'linearRamp',
      'cancelAndHold',
      'linearRamp',
    ]);
    expect(gain.events[3].time).toBeCloseTo(noteOffTime, 10);
    expect(gain.events[4].value).toBe(0);
    expect(gain.events[4].time).toBeCloseTo(noteOffTime + RELEASE_TIME, 10);
    // 減衰終了時刻に停止を予約することを保証する。
    expect(oscillator.stopTimes).toHaveLength(1);
    expect(oscillator.stopTimes[0]).toBeCloseTo(noteOffTime + RELEASE_TIME, 10);
    expect(oscillator.onended).not.toBeNull();

    // 減衰中のノートオフの重複と開始では予約も声も重ねない。
    const eventCount = gain.events.length;
    session.noteOff();
    await session.start({ frequency: 660 });
    expect(gain.events).toHaveLength(eventCount);
    expect(oscillator.stopTimes).toHaveLength(1);
    expect(context.oscillators).toHaveLength(1);
    expect(context.waves).toHaveLength(1);
    expect(session.playing).toBe(true);
    expect(session.releasing).toBe(true);
    await session.dispose();
  });

  it('立ち上がり途中のノートオフを保持付き取消しで滑らかにつなぐ', async () => {
    const harness = createHarness();
    const session = createHarmonicToneSession(harness.createContext);
    await session.start({});

    // 立ち上がりの半ばでノートオフする。
    const noteOffTime = ATTACK_TIME / 2;
    harness.contexts[0].currentTime = noteOffTime;
    session.noteOff();

    const gain = harness.contexts[0].gains[0];
    // 保持でつなぐため値の再設定は行わないことを保証する。
    expect(gain.events.map((event) => event.kind)).toEqual([
      'setValue',
      'linearRamp',
      'linearRamp',
      'cancelAndHold',
      'linearRamp',
    ]);
    expect(gain.events[4].value).toBe(0);
    expect(gain.events[4].time).toBeCloseTo(noteOffTime + RELEASE_TIME, 10);
    expect(session.playing).toBe(true);
    expect(session.releasing).toBe(true);

    // 減衰終了の通知で声だけを切り離し、文脈は保つ。
    const oscillator = harness.contexts[0].oscillators[0];
    oscillator.onended?.();
    expect(session.playing).toBe(false);
    expect(session.releasing).toBe(false);
    expect(oscillator.calls).toEqual(['setPeriodicWave', 'connect', 'start', 'stop', 'disconnect']);
    // 停止予約の一度きりを超える停止呼び出しがないことを保証する。
    expect(oscillator.stopTimes).toHaveLength(1);
    expect(harness.contexts[0].calls).not.toContain('close');
    await session.dispose();
  });

  it('未対応環境では線形区間から求めた現在値で取消しと再設定を行う', async () => {
    const harness = createHarness(48000, { cancelAndHold: false });
    const session = createHarmonicToneSession(harness.createContext);
    await session.start({});

    // 立ち上がりの半ばでノートオフする。
    const noteOffTime = ATTACK_TIME / 2;
    harness.contexts[0].currentTime = noteOffTime;
    session.noteOff();

    const gain = harness.contexts[0].gains[0];
    // 取消しと現在値の再設定でつなぐことを保証する。
    expect(gain.events.map((event) => event.kind)).toEqual([
      'setValue',
      'linearRamp',
      'linearRamp',
      'cancelValues',
      'setValue',
      'linearRamp',
    ]);
    expect(gain.events[3].time).toBeCloseTo(noteOffTime, 10);
    // 立ち上がり半ばの現在値は最大の半分であること。
    expect(gain.events[4].value).toBeCloseTo(PEAK_GAIN / 2, 6);
    expect(gain.events[4].time).toBeCloseTo(noteOffTime, 10);
    expect(gain.events[5].value).toBe(0);
    expect(gain.events[5].time).toBeCloseTo(noteOffTime + RELEASE_TIME, 10);
    await session.dispose();
  });

  it('減衰途中のノートオフで減衰区間の現在値から減衰する', async () => {
    const harness = createHarness(48000, { cancelAndHold: false });
    const session = createHarmonicToneSession(harness.createContext);
    await session.start({});

    // 減衰の半ばでノートオフする。
    const noteOffTime = ATTACK_TIME + DECAY_TIME / 2;
    harness.contexts[0].currentTime = noteOffTime;
    session.noteOff();

    const gain = harness.contexts[0].gains[0];
    const reset = gain.events.find(
      (event, index) => event.kind === 'setValue' && index > 0 && event.time === noteOffTime,
    );
    // 減衰半ばの現在値は最大と持続の中間であること。
    expect(reset?.value).toBeCloseTo((PEAK_GAIN + SUSTAIN_GAIN) / 2, 6);
    await session.dispose();
  });

  it('減衰完了で発振器を止めて声だけを切り離し文脈を保つ', async () => {
    const harness = createHarness();
    const session = createHarmonicToneSession(harness.createContext);
    await session.start({});
    harness.contexts[0].currentTime = ATTACK_TIME + DECAY_TIME + 1;
    session.noteOff();

    // 減衰終了前は発音中のままであること。
    expect(session.playing).toBe(true);
    const oscillator = harness.contexts[0].oscillators[0];
    oscillator.onended?.();

    expect(session.playing).toBe(false);
    expect(session.releasing).toBe(false);
    expect(oscillator.calls).toEqual(['setPeriodicWave', 'connect', 'start', 'stop', 'disconnect']);
    expect(harness.contexts[0].gains[0].calls).toEqual(['connect', 'disconnect']);
    expect(harness.contexts[0].calls).toEqual([
      'createPeriodicWave',
      'createGain',
      'createOscillator',
      'resume',
    ]);
    await session.dispose();
  });

  it('減衰完了後の再操作では同じ文脈に新しい声を作る', async () => {
    const harness = createHarness();
    const session = createHarmonicToneSession(harness.createContext);
    await session.start({});
    harness.contexts[0].currentTime = ATTACK_TIME + DECAY_TIME + 1;
    session.noteOff();
    harness.contexts[0].oscillators[0].onended?.();

    harness.contexts[0].currentTime = ATTACK_TIME + DECAY_TIME + RELEASE_TIME + 2;
    await session.start({ frequency: 660 });

    // 文脈の再生成が起きると代替物の個数が増えるため、寿命の破れを検出する。
    expect(harness.contexts).toHaveLength(1);
    const context = harness.contexts[0];
    expect(context.oscillators).toHaveLength(2);
    expect(context.oscillators[0]).not.toBe(context.oscillators[1]);
    expect(context.oscillators[1].frequency.value).toBe(660);
    expect(session.playing).toBe(true);
    expect(session.releasing).toBe(false);
    await session.dispose();
  });

  it('声がないときのノートオフでは文脈を作らず何もしない', async () => {
    const harness = createHarness();
    const session = createHarmonicToneSession(harness.createContext);

    session.noteOff();

    expect(harness.contexts).toHaveLength(0);
    expect(session.playing).toBe(false);
    expect(session.releasing).toBe(false);

    // 減衰完了後（待機中）のノートオフも何もしない。
    await session.start({});
    harness.contexts[0].currentTime = ATTACK_TIME + DECAY_TIME + 1;
    session.noteOff();
    harness.contexts[0].oscillators[0].onended?.();
    const calls = [...harness.contexts[0].calls];
    session.noteOff();
    expect(harness.contexts[0].calls).toEqual(calls);
    await session.dispose();
  });
});

describe('調波単音の即時停止と文脈の寿命', () => {
  it('停止では音声文脈を閉じず声だけを止める', async () => {
    const harness = createHarness();
    const session = createHarmonicToneSession(harness.createContext);
    await session.start({});

    session.stop();

    const context = harness.contexts[0];
    expect(session.playing).toBe(false);
    expect(session.releasing).toBe(false);
    expect(context.oscillators[0].calls).toEqual([
      'setPeriodicWave',
      'connect',
      'start',
      'stop',
      'disconnect',
    ]);
    // 即時の中断は停止時刻の指定なしで止めることを保証する。
    expect(context.oscillators[0].stopTimes).toEqual([undefined]);
    expect(context.gains[0].calls).toEqual(['connect', 'disconnect']);
    expect(context.calls).toEqual(['createPeriodicWave', 'createGain', 'createOscillator', 'resume']);
    await session.dispose();
  });

  it('停止後の再操作では同じ文脈に新しい声を作る', async () => {
    const harness = createHarness();
    const session = createHarmonicToneSession(harness.createContext);
    await session.start({});
    session.stop();

    await session.start({ frequency: 660 });

    // 文脈の再生成が起きると代替物の個数が増えるため、寿命の破れを検出する。
    expect(harness.contexts).toHaveLength(1);
    const context = harness.contexts[0];
    expect(context.oscillators).toHaveLength(2);
    expect(context.oscillators[0]).not.toBe(context.oscillators[1]);
    expect(context.oscillators[0].calls).toEqual([
      'setPeriodicWave',
      'connect',
      'start',
      'stop',
      'disconnect',
    ]);
    expect(context.oscillators[1].frequency.value).toBe(660);
    expect(context.oscillators[1].calls).toEqual(['setPeriodicWave', 'connect', 'start']);
    expect(context.calls).toEqual([
      'createPeriodicWave',
      'createGain',
      'createOscillator',
      'resume',
      'createPeriodicWave',
      'createGain',
      'createOscillator',
      'resume',
    ]);
    expect(session.playing).toBe(true);
    await session.dispose();
  });

  it('周波数変更時は周期波を作り直す', async () => {
    const harness = createHarness();
    const session = createHarmonicToneSession(harness.createContext);
    await session.start({ frequency: 440 });
    session.stop();

    await session.start({ frequency: 880 });

    // 同じ文脈の標本化周波数でも基音が変われば係数列が変わることを保証する。
    const context = harness.contexts[0];
    expect(context.waves).toHaveLength(2);
    expect(context.waves[0]).not.toBe(context.waves[1]);
    expect(context.waves[0].imag.length).not.toBe(context.waves[1].imag.length);
    await session.dispose();
  });

  it('発音中と減衰中の再操作は何も作り直さない', async () => {
    const harness = createHarness();
    const session = createHarmonicToneSession(harness.createContext);
    await session.start({});

    await session.start({});

    const context = harness.contexts[0];
    expect(context.oscillators).toHaveLength(1);
    expect(context.waves).toHaveLength(1);

    // 減衰中の開始では次の声を重ねない。
    harness.contexts[0].currentTime = ATTACK_TIME + DECAY_TIME + 1;
    session.noteOff();
    await session.start({ frequency: 660 });
    expect(context.oscillators).toHaveLength(1);
    expect(context.waves).toHaveLength(1);
    expect(context.calls).toEqual([
      'createPeriodicWave',
      'createGain',
      'createOscillator',
      'resume',
    ]);
    expect(session.playing).toBe(true);
    expect(session.releasing).toBe(true);
    await session.dispose();
  });

  it('停止の重複で声の停止を繰り返さない', async () => {
    const harness = createHarness();
    const session = createHarmonicToneSession(harness.createContext);
    await session.start({});

    // 二度目の stop() が素通りすると代替物が例外を投げる。
    session.stop();
    session.stop();

    const context = harness.contexts[0];
    expect(context.oscillators[0].calls).toEqual([
      'setPeriodicWave',
      'connect',
      'start',
      'stop',
      'disconnect',
    ]);
    expect(context.gains[0].calls).toEqual(['connect', 'disconnect']);
    expect(context.calls).toEqual([
      'createPeriodicWave',
      'createGain',
      'createOscillator',
      'resume',
    ]);
    await session.dispose();
  });

  it('減衰中の停止は予約を待たず声を止めて再操作できる', async () => {
    const harness = createHarness();
    const session = createHarmonicToneSession(harness.createContext);
    await session.start({});
    harness.contexts[0].currentTime = ATTACK_TIME + DECAY_TIME + 1;
    session.noteOff();

    session.stop();

    const context = harness.contexts[0];
    expect(session.playing).toBe(false);
    expect(session.releasing).toBe(false);
    // 予約済みの停止に重ねて止めないことを保証する。
    expect(context.oscillators[0].stopTimes).toHaveLength(1);
    expect(context.oscillators[0].calls).toEqual([
      'setPeriodicWave',
      'connect',
      'start',
      'stop',
      'disconnect',
    ]);
    expect(context.calls).toEqual([
      'createPeriodicWave',
      'createGain',
      'createOscillator',
      'resume',
    ]);

    await session.start({ frequency: 660 });
    expect(context.oscillators).toHaveLength(2);
    expect(session.playing).toBe(true);
    await session.dispose();
  });
});

describe('調波単音の破棄', () => {
  it('破棄で発音を止めて音声文脈を閉じる', async () => {
    const harness = createHarness();
    const session = createHarmonicToneSession(harness.createContext);
    await session.start({});

    await session.dispose();

    const context = harness.contexts[0];
    expect(session.playing).toBe(false);
    expect(context.oscillators[0].calls).toEqual([
      'setPeriodicWave',
      'connect',
      'start',
      'stop',
      'disconnect',
    ]);
    expect(context.calls).toEqual([
      'createPeriodicWave',
      'createGain',
      'createOscillator',
      'resume',
      'close',
    ]);
  });

  it('破棄の重複で音声文脈を二重に閉じない', async () => {
    const harness = createHarness();
    const session = createHarmonicToneSession(harness.createContext);
    await session.start({});

    await session.dispose();
    await session.dispose();

    expect(harness.contexts[0].calls).toEqual([
      'createPeriodicWave',
      'createGain',
      'createOscillator',
      'resume',
      'close',
    ]);
  });

  it('起動前の破棄で文脈を作らずに終える', async () => {
    const harness = createHarness();
    const session = createHarmonicToneSession(harness.createContext);

    await session.dispose();

    expect(harness.contexts).toHaveLength(0);
  });

  it('破棄後の開始を拒み文脈を作り直さない', async () => {
    const harness = createHarness();
    const session = createHarmonicToneSession(harness.createContext);
    await session.start({});
    await session.dispose();

    await expect(session.start({})).rejects.toBeInstanceOf(Error);

    expect(harness.contexts).toHaveLength(1);
    expect(harness.contexts[0].calls).toEqual([
      'createPeriodicWave',
      'createGain',
      'createOscillator',
      'resume',
      'close',
    ]);
  });

  it('減衰中の破棄で停止を重ねず文脈を一度だけ閉じ旧通知を無視する', async () => {
    const harness = createHarness();
    const session = createHarmonicToneSession(harness.createContext);
    await session.start({});
    harness.contexts[0].currentTime = ATTACK_TIME + DECAY_TIME + 1;
    session.noteOff();
    const oscillator = harness.contexts[0].oscillators[0];
    const ended = oscillator.onended;

    await session.dispose();

    const context = harness.contexts[0];
    expect(session.playing).toBe(false);
    expect(session.releasing).toBe(false);
    // 予約済みの停止に重ねて止めないことを保証する。
    expect(oscillator.stopTimes).toHaveLength(1);
    expect(oscillator.calls).toEqual(['setPeriodicWave', 'connect', 'start', 'stop', 'disconnect']);
    expect(context.calls).toEqual([
      'createPeriodicWave',
      'createGain',
      'createOscillator',
      'resume',
      'close',
    ]);

    // 破棄後の非同期完了（旧声の終了通知）は何もしない。
    ended?.();
    expect(oscillator.calls).toEqual(['setPeriodicWave', 'connect', 'start', 'stop', 'disconnect']);
    await session.dispose();
    expect(context.calls).toEqual([
      'createPeriodicWave',
      'createGain',
      'createOscillator',
      'resume',
      'close',
    ]);
  });
});

describe('調波単音の非同期の競合と失敗', () => {
  it('起動の完了待ちの連打を一つの起動に束ねる', async () => {
    const harness = createHarness();
    let release!: () => void;
    harness.enqueueResume(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const session = createHarmonicToneSession(harness.createContext);

    const first = session.start({});
    const second = session.start({});
    // 束ねた二つ目の起動が別文脈や別声を作ると個数が増える。
    expect(harness.contexts).toHaveLength(1);
    expect(harness.contexts[0].oscillators).toHaveLength(1);
    release();
    await first;
    await second;

    expect(session.playing).toBe(true);
    expect(harness.contexts[0].oscillators).toHaveLength(1);
    expect(harness.contexts[0].calls).toEqual([
      'createPeriodicWave',
      'createGain',
      'createOscillator',
      'resume',
    ]);
    await session.dispose();
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
    const session = createHarmonicToneSession(harness.createContext);

    const pending = session.start({});
    expect(session.playing).toBe(false);
    session.stop();
    release();
    // 取り消された起動は失敗として扱わず静かに終える。
    await pending;

    const context = harness.contexts[0];
    expect(session.playing).toBe(false);
    expect(context.oscillators).toHaveLength(1);
    expect(context.oscillators[0].calls).toEqual([
      'setPeriodicWave',
      'connect',
      'start',
      'stop',
      'disconnect',
    ]);

    // 停止後の再操作では同じ文脈に新しい声を作る。
    await session.start({});
    expect(harness.contexts).toHaveLength(1);
    expect(context.oscillators).toHaveLength(2);
    expect(session.playing).toBe(true);
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
    const session = createHarmonicToneSession(harness.createContext);

    const pending = session.start({});
    const disposing = session.dispose();
    release();
    await pending;
    await disposing;

    const context = harness.contexts[0];
    expect(session.playing).toBe(false);
    expect(context.oscillators[0].calls).toEqual([
      'setPeriodicWave',
      'connect',
      'start',
      'stop',
      'disconnect',
    ]);
    expect(context.calls).toEqual([
      'createPeriodicWave',
      'createGain',
      'createOscillator',
      'resume',
      'close',
    ]);
    await session.dispose();
    expect(context.calls).toEqual([
      'createPeriodicWave',
      'createGain',
      'createOscillator',
      'resume',
      'close',
    ]);
  });

  it('再開の失敗で声を外して文脈を保ち再試行できる', async () => {
    const harness = createHarness();
    harness.enqueueResume(() => Promise.reject(new Error('再開失敗')));
    const session = createHarmonicToneSession(harness.createContext);

    await expect(session.start({})).rejects.toThrow('再開失敗');

    // 失敗した声が残ると二つ目の起動と重なるため、後始末を確かめる。
    const context = harness.contexts[0];
    expect(session.playing).toBe(false);
    expect(context.oscillators[0].calls).toEqual([
      'setPeriodicWave',
      'connect',
      'start',
      'stop',
      'disconnect',
    ]);
    expect(context.calls).toEqual([
      'createPeriodicWave',
      'createGain',
      'createOscillator',
      'resume',
    ]);

    await session.start({});
    expect(harness.contexts).toHaveLength(1);
    expect(context.oscillators).toHaveLength(2);
    expect(session.playing).toBe(true);
    await session.dispose();
    expect(context.calls).toEqual([
      'createPeriodicWave',
      'createGain',
      'createOscillator',
      'resume',
      'createPeriodicWave',
      'createGain',
      'createOscillator',
      'resume',
      'close',
    ]);
  });

  it('再開待ち中のノートオフで減衰を予約し旧処理が後続の声を止めない', async () => {
    const harness = createHarness();
    let release!: () => void;
    harness.enqueueResume(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const session = createHarmonicToneSession(harness.createContext);

    const pending = session.start({});
    // 完了待ちの間に立ち上がり半ばでノートオフする。
    harness.contexts[0].currentTime = ATTACK_TIME / 2;
    session.noteOff();
    expect(session.playing).toBe(false);
    expect(session.releasing).toBe(true);
    release();
    await pending;

    // 再開の完了で減衰中の声として発音中になる。
    expect(session.playing).toBe(true);
    expect(session.releasing).toBe(true);
    const context = harness.contexts[0];
    expect(context.oscillators).toHaveLength(1);
    const ended = context.oscillators[0].onended;
    expect(ended).not.toBeNull();
    ended?.();
    expect(session.playing).toBe(false);

    // 減衰完了後の再操作では同じ文脈に新しい声を作る。
    await session.start({});
    expect(harness.contexts).toHaveLength(1);
    expect(context.oscillators).toHaveLength(2);
    expect(session.playing).toBe(true);

    // 旧声の終了通知が残っていても後続の声を止めない。
    ended?.();
    expect(session.playing).toBe(true);
    expect(context.oscillators[1].calls).toEqual(['setPeriodicWave', 'connect', 'start']);
    await session.dispose();
  });

  it('再開待ち中のノートオフ後に再開が失敗したら声を外して再試行できる', async () => {
    const harness = createHarness();
    harness.enqueueResume(() => Promise.reject(new Error('再開失敗')));
    const session = createHarmonicToneSession(harness.createContext);

    const pending = session.start({});
    harness.contexts[0].currentTime = ATTACK_TIME / 2;
    session.noteOff();
    await expect(pending).rejects.toThrow('再開失敗');

    // 予約済みの停止に重ねて止めず、声だけを外して文脈は保つ。
    const context = harness.contexts[0];
    expect(session.playing).toBe(false);
    expect(session.releasing).toBe(false);
    expect(context.oscillators[0].stopTimes).toHaveLength(1);
    expect(context.oscillators[0].calls).toEqual([
      'setPeriodicWave',
      'connect',
      'start',
      'stop',
      'disconnect',
    ]);

    await session.start({});
    expect(harness.contexts).toHaveLength(1);
    expect(context.oscillators).toHaveLength(2);
    expect(session.playing).toBe(true);
    await session.dispose();
  });
});
