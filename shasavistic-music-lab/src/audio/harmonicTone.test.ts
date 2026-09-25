/**
 * 調波単音の生成・停止・解放の配線検査。
 *
 * ブラウザの音声文脈を使わず、生成口に差す代替物で呼び出しの有無と順序、
 * 設定値、不正入力の拒否を確かめる。音声信号の採取は対象外とし、
 * 未実装の受入れ条件は一時的な検証計画に置く。
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
import { HARMONIC_PRESETS } from './harmonicPresets';

interface FakeOscillator extends HarmonicToneOscillator {
  readonly calls: string[];
  wave: object | null;
}

interface FakeGain extends HarmonicToneGain {
  readonly calls: string[];
}

interface FakeContext extends HarmonicToneContext {
  readonly calls: string[];
  readonly oscillators: FakeOscillator[];
  readonly gains: FakeGain[];
  readonly waves: Array<{ real: Float32Array; imag: Float32Array; disableNormalization: boolean }>;
}

/** 文脈生成を数え、再開の振る舞いを差し替えられる検査用の束。 */
interface Harness {
  readonly contexts: FakeContext[];
  readonly createContext: () => HarmonicToneContext;
  enqueueResume(handler: () => Promise<void>): void;
}

function createHarness(sampleRate = 48000): Harness {
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
        const gainNode: FakeGain = {
          gain: { value: 0 },
          calls: gainCalls,
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
        const oscillator: FakeOscillator = {
          frequency: { value: 0 },
          wave: null,
          calls: oscillatorCalls,
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
          stop(): void {
            // 実物の発振器は二度目の停止を拒むため、重複呼び出しは検査で検出する。
            if (oscillatorCalls.filter((call) => call === 'stop').length > 0) {
              throw new Error('二重停止');
            }
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
  it('既定の調波単音で声と周期波を生成して再開する', async () => {
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
    // 過大振幅を抑える固定ゲインを声に載せることを保証する。
    expect(context.gains[0].gain.value).toBe(HARMONIC_TONE_OUTPUT_GAIN);
    expect(context.gains[0].calls).toEqual(['connect']);
    expect(context.calls).toEqual([
      'createPeriodicWave',
      'createGain',
      'createOscillator',
      'resume',
    ]);
    expect(session.playing).toBe(true);
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

describe('調波単音の停止と文脈の寿命', () => {
  it('停止では音声文脈を閉じず声だけを止める', async () => {
    const harness = createHarness();
    const session = createHarmonicToneSession(harness.createContext);
    await session.start({});

    session.stop();

    const context = harness.contexts[0];
    expect(session.playing).toBe(false);
    expect(context.oscillators[0].calls).toEqual([
      'setPeriodicWave',
      'connect',
      'start',
      'stop',
      'disconnect',
    ]);
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

  it('発音中の再操作は何も作り直さない', async () => {
    const harness = createHarness();
    const session = createHarmonicToneSession(harness.createContext);
    await session.start({});

    await session.start({});

    const context = harness.contexts[0];
    expect(context.oscillators).toHaveLength(1);
    expect(context.waves).toHaveLength(1);
    expect(context.calls).toEqual([
      'createPeriodicWave',
      'createGain',
      'createOscillator',
      'resume',
    ]);
    expect(session.playing).toBe(true);
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
});
