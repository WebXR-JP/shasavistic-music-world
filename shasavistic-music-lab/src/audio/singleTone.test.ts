/**
 * 単一発振音の生成・停止・解放の配線検査。
 *
 * ブラウザの音声文脈を使わず、生成口に差す代替物で呼び出しの有無と順序、
 * 設定値、不正入力の拒否を確かめる。音声信号の採取は対象外とし、
 * 未実装の受入れ条件は一時的な検証計画に置く。
 */

import { describe, expect, it } from 'vitest';
import {
  SINGLE_TONE_FREQUENCY_HZ,
  type SingleToneContext,
  type SingleToneOscillator,
  createSingleToneSession,
} from './singleTone';

interface FakeOscillator extends SingleToneOscillator {
  readonly calls: string[];
}

interface FakeContext extends SingleToneContext {
  readonly calls: string[];
  readonly oscillators: FakeOscillator[];
}

/** 文脈生成を数え、再開の振る舞いを差し替えられる検査用の束。 */
interface Harness {
  readonly contexts: FakeContext[];
  readonly createContext: () => SingleToneContext;
  enqueueResume(handler: () => Promise<void>): void;
}

function createHarness(): Harness {
  const contexts: FakeContext[] = [];
  const resumeQueue: Array<() => Promise<void>> = [];

  const createContext = (): SingleToneContext => {
    const destination = {};
    const contextCalls: string[] = [];
    const oscillators: FakeOscillator[] = [];
    const context: FakeContext = {
      destination,
      state: 'suspended',
      calls: contextCalls,
      oscillators,
      resume(): Promise<void> {
        contextCalls.push('resume');
        const next = resumeQueue.shift();
        return next !== undefined ? next() : Promise.resolve();
      },
      close(): Promise<void> {
        contextCalls.push('close');
        return Promise.resolve();
      },
      createOscillator(): SingleToneOscillator {
        contextCalls.push('createOscillator');
        const oscillatorCalls: string[] = [];
        const oscillator: FakeOscillator = {
          frequency: { value: 0 },
          type: 'sine',
          calls: oscillatorCalls,
          connect(target: object): void {
            // 接続先が生成に使った文脈の出力先であることを保証する。
            expect(target).toBe(destination);
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

describe('単一発振音の生成', () => {
  it('既定の単音で発振器を生成して再開する', async () => {
    const harness = createHarness();
    const session = createSingleToneSession(harness.createContext);

    await session.start({});

    const context = harness.contexts[0];
    expect(context.oscillators).toHaveLength(1);
    expect(context.oscillators[0].type).toBe('sine');
    expect(context.oscillators[0].frequency.value).toBe(SINGLE_TONE_FREQUENCY_HZ);
    expect(context.oscillators[0].calls).toEqual(['connect', 'start']);
    expect(context.calls).toEqual(['createOscillator', 'resume']);
    expect(session.playing).toBe(true);
    await session.dispose();
  });

  it('指定した周波数と波形で生成する', async () => {
    const harness = createHarness();
    const session = createSingleToneSession(harness.createContext);

    await session.start({ frequency: 660, type: 'triangle' });

    const context = harness.contexts[0];
    expect(context.oscillators[0].type).toBe('triangle');
    expect(context.oscillators[0].frequency.value).toBe(660);
    expect(session.playing).toBe(true);
    await session.dispose();
  });

  it('正でない周波数の生成を音声文脈を作らずに拒む', async () => {
    const harness = createHarness();
    const session = createSingleToneSession(harness.createContext);

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

describe('単一発振音の停止と文脈の寿命', () => {
  it('停止では音声文脈を閉じず発振器だけを止める', async () => {
    const harness = createHarness();
    const session = createSingleToneSession(harness.createContext);
    await session.start({});

    session.stop();

    const context = harness.contexts[0];
    expect(session.playing).toBe(false);
    expect(context.oscillators[0].calls).toEqual(['connect', 'start', 'stop', 'disconnect']);
    expect(context.calls).toEqual(['createOscillator', 'resume']);
    await session.dispose();
  });

  it('停止後の再操作では同じ文脈に新しい発振器を作る', async () => {
    const harness = createHarness();
    const session = createSingleToneSession(harness.createContext);
    await session.start({});
    session.stop();

    await session.start({ frequency: 660 });

    // 文脈の再生成が起きると代替物の個数が増えるため、寿命の破れを検出する。
    expect(harness.contexts).toHaveLength(1);
    const context = harness.contexts[0];
    expect(context.oscillators).toHaveLength(2);
    expect(context.oscillators[0]).not.toBe(context.oscillators[1]);
    expect(context.oscillators[0].calls).toEqual(['connect', 'start', 'stop', 'disconnect']);
    expect(context.oscillators[1].frequency.value).toBe(660);
    expect(context.oscillators[1].calls).toEqual(['connect', 'start']);
    expect(context.calls).toEqual([
      'createOscillator',
      'resume',
      'createOscillator',
      'resume',
    ]);
    expect(session.playing).toBe(true);
    await session.dispose();
  });

  it('発音中の再操作は何も作り直さない', async () => {
    const harness = createHarness();
    const session = createSingleToneSession(harness.createContext);
    await session.start({});

    await session.start({});

    const context = harness.contexts[0];
    expect(context.oscillators).toHaveLength(1);
    expect(context.calls).toEqual(['createOscillator', 'resume']);
    expect(session.playing).toBe(true);
    await session.dispose();
  });

  it('停止の重複で発振器の停止を繰り返さない', async () => {
    const harness = createHarness();
    const session = createSingleToneSession(harness.createContext);
    await session.start({});

    // 二度目の stop() が素通りすると代替物が例外を投げる。
    session.stop();
    session.stop();

    const context = harness.contexts[0];
    expect(context.oscillators[0].calls).toEqual(['connect', 'start', 'stop', 'disconnect']);
    expect(context.calls).toEqual(['createOscillator', 'resume']);
    await session.dispose();
  });
});

describe('単一発振音の破棄', () => {
  it('破棄で発音を止めて音声文脈を閉じる', async () => {
    const harness = createHarness();
    const session = createSingleToneSession(harness.createContext);
    await session.start({});

    await session.dispose();

    const context = harness.contexts[0];
    expect(session.playing).toBe(false);
    expect(context.oscillators[0].calls).toEqual(['connect', 'start', 'stop', 'disconnect']);
    expect(context.calls).toEqual(['createOscillator', 'resume', 'close']);
  });

  it('破棄の重複で音声文脈を二重に閉じない', async () => {
    const harness = createHarness();
    const session = createSingleToneSession(harness.createContext);
    await session.start({});

    await session.dispose();
    await session.dispose();

    expect(harness.contexts[0].calls).toEqual(['createOscillator', 'resume', 'close']);
  });

  it('起動前の破棄で文脈を作らずに終える', async () => {
    const harness = createHarness();
    const session = createSingleToneSession(harness.createContext);

    await session.dispose();

    expect(harness.contexts).toHaveLength(0);
  });

  it('破棄後の開始を拒み文脈を作り直さない', async () => {
    const harness = createHarness();
    const session = createSingleToneSession(harness.createContext);
    await session.start({});
    await session.dispose();

    await expect(session.start({})).rejects.toBeInstanceOf(Error);

    expect(harness.contexts).toHaveLength(1);
    expect(harness.contexts[0].calls).toEqual(['createOscillator', 'resume', 'close']);
  });
});

describe('単一発振音の非同期の競合と失敗', () => {
  it('起動の完了待ちの連打を一つの起動に束ねる', async () => {
    const harness = createHarness();
    let release!: () => void;
    harness.enqueueResume(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const session = createSingleToneSession(harness.createContext);

    const first = session.start({});
    const second = session.start({});
    // 束ねた二つ目の起動が別文脈や別発振器を作ると個数が増える。
    expect(harness.contexts).toHaveLength(1);
    expect(harness.contexts[0].oscillators).toHaveLength(1);
    release();
    await first;
    await second;

    expect(session.playing).toBe(true);
    expect(harness.contexts[0].oscillators).toHaveLength(1);
    expect(harness.contexts[0].calls).toEqual(['createOscillator', 'resume']);
    await session.dispose();
  });

  it('起動待ちの停止で発振器の漏れと二重再生を起こさない', async () => {
    const harness = createHarness();
    let release!: () => void;
    harness.enqueueResume(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const session = createSingleToneSession(harness.createContext);

    const pending = session.start({});
    expect(session.playing).toBe(false);
    session.stop();
    release();
    // 取り消された起動は失敗として扱わず静かに終える。
    await pending;

    const context = harness.contexts[0];
    expect(session.playing).toBe(false);
    expect(context.oscillators).toHaveLength(1);
    expect(context.oscillators[0].calls).toEqual(['connect', 'start', 'stop', 'disconnect']);

    // 停止後の再操作では同じ文脈に新しい発振器を作る。
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
    const session = createSingleToneSession(harness.createContext);

    const pending = session.start({});
    const disposing = session.dispose();
    release();
    await pending;
    await disposing;

    const context = harness.contexts[0];
    expect(session.playing).toBe(false);
    expect(context.oscillators[0].calls).toEqual(['connect', 'start', 'stop', 'disconnect']);
    expect(context.calls).toEqual(['createOscillator', 'resume', 'close']);
    await session.dispose();
    expect(context.calls).toEqual(['createOscillator', 'resume', 'close']);
  });

  it('再開の失敗で発振器を外して文脈を保ち再試行できる', async () => {
    const harness = createHarness();
    harness.enqueueResume(() => Promise.reject(new Error('再開失敗')));
    const session = createSingleToneSession(harness.createContext);

    await expect(session.start({})).rejects.toThrow('再開失敗');

    // 失敗した発振器が残ると二つ目の起動と重なるため、後始末を確かめる。
    const context = harness.contexts[0];
    expect(session.playing).toBe(false);
    expect(context.oscillators[0].calls).toEqual(['connect', 'start', 'stop', 'disconnect']);
    expect(context.calls).toEqual(['createOscillator', 'resume']);

    await session.start({});
    expect(harness.contexts).toHaveLength(1);
    expect(context.oscillators).toHaveLength(2);
    expect(session.playing).toBe(true);
    await session.dispose();
    expect(context.calls).toEqual([
      'createOscillator',
      'resume',
      'createOscillator',
      'resume',
      'close',
    ]);
  });
});
