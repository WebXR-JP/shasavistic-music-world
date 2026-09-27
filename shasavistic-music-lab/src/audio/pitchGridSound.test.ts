/**
 * 格子の個別声と共有文脈の配線検査。
 *
 * ブラウザの音声文脈を使わず、生成口に差す代替物で次を確かめる。
 * 座標由来の鍵ごとの開始・終了、最大15声、他点を巻き込まない停止、
 * 停止後の消音予約、差分反映での継続、起動待ち・再開失敗・古い完了通知・
 * 破棄の競合を判定対象とする。利得の予約は順序だけでなく値と時刻まで
 * 照合し、呼び出し記録だけを合格証拠にしない。具体値はこの検査に置く。
 * 音声信号の採取は対象外とする。
 */

import { describe, expect, it } from 'vitest';
import {
  HARMONIC_ENVELOPE_DEFAULTS,
  envelopeGainAtTime,
  type HarmonicEnvelopeParam,
} from './harmonicEnvelope';
import {
  PITCH_GRID_MAX_VOICES,
  PITCH_GRID_VOICE_GAIN,
  createPitchGridSound,
  type PitchGridSoundContext,
  type PitchGridSoundGain,
  type PitchGridSoundOscillator,
} from './pitchGridSound';

/** 包絡の既定値。予約時刻と値の期待値の算出に使う。 */
const { attackTime: ATTACK_TIME, releaseTime: RELEASE_TIME } = HARMONIC_ENVELOPE_DEFAULTS;

/** 利得パラメータへの予約記録。順序・値・時刻の照合に使う。 */
interface GainEvent {
  readonly kind: 'setValue' | 'linearRamp' | 'cancelValues' | 'cancelAndHold';
  readonly value: number | null;
  readonly time: number;
}

interface FakeOscillator extends PitchGridSoundOscillator {
  readonly calls: string[];
  /** `stop` に渡した時刻の記録。未指定の即時停止は `undefined` になる。 */
  readonly stopTimes: Array<number | undefined>;
  /** 終了通知を発火させる。 */
  fireEnded(): void;
}

interface FakeGain extends PitchGridSoundGain {
  readonly calls: string[];
  readonly events: GainEvent[];
}

/** 時刻を操作でき、再開の振る舞いを差し替えられる検査用の文脈。 */
interface FakeContext extends PitchGridSoundContext {
  currentTime: number;
  readonly calls: string[];
  readonly oscillators: FakeOscillator[];
  readonly gains: FakeGain[];
  closeCalls: number;
}

/** 文脈生成を数え、再開の振る舞いを差し替えられる検査用の束。 */
interface Harness {
  readonly contexts: FakeContext[];
  readonly createContext: () => PitchGridSoundContext;
  enqueueResume(handler: () => Promise<void>): void;
  /** 再開を保留し、後から解決するための口を返す。 */
  holdResume(): () => void;
}

/** 非同期の継続を進める。固定時間の待ちではなく区切りのための譲歩である。 */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function createFakeOscillator(): FakeOscillator {
  const calls: string[] = [];
  const stopTimes: Array<number | undefined> = [];
  let ended: (() => void) | null = null;
  return {
    frequency: { value: 0 },
    type: 'sine',
    get onended(): (() => void) | null {
      return ended;
    },
    set onended(handler: (() => void) | null) {
      ended = handler;
    },
    calls,
    stopTimes,
    connect(): void {
      calls.push('connect');
    },
    disconnect(): void {
      calls.push('disconnect');
    },
    start(): void {
      calls.push('start');
    },
    stop(when?: number): void {
      calls.push('stop');
      stopTimes.push(when);
    },
    fireEnded(): void {
      ended?.();
    },
  };
}

function createFakeGain(cancelAndHold: boolean): FakeGain {
  const calls: string[] = [];
  const events: GainEvent[] = [];
  const param: HarmonicEnvelopeParam = {
    value: 0,
    setValueAtTime(value: number, startTime: number): void {
      events.push({ kind: 'setValue', value, time: startTime });
    },
    linearRampToValueAtTime(value: number, endTime: number): void {
      events.push({ kind: 'linearRamp', value, time: endTime });
    },
    cancelScheduledValues(cancelTime: number): void {
      events.push({ kind: 'cancelValues', value: null, time: cancelTime });
    },
    ...(cancelAndHold
      ? {
          cancelAndHoldAtTime(cancelTime: number): void {
            events.push({ kind: 'cancelAndHold', value: null, time: cancelTime });
          },
        }
      : {}),
  };
  return {
    gain: param,
    calls,
    events,
    connect(): void {
      calls.push('connect');
    },
    disconnect(): void {
      calls.push('disconnect');
    },
  };
}

function createHarness(
  options: { cancelAndHold: boolean } = { cancelAndHold: true },
): Harness {
  const contexts: FakeContext[] = [];
  const resumeQueue: Array<() => Promise<void>> = [];
  const heldResolvers: Array<() => void> = [];
  const createContext = (): PitchGridSoundContext => {
    const fake: FakeContext = {
      destination: {},
      currentTime: 0,
      state: 'suspended',
      calls: [],
      oscillators: [],
      gains: [],
      closeCalls: 0,
      resume(): Promise<void> {
        fake.calls.push('resume');
        const next = resumeQueue.shift();
        return next !== undefined ? next() : Promise.resolve();
      },
      close(): Promise<void> {
        fake.calls.push('close');
        fake.closeCalls += 1;
        return Promise.resolve();
      },
      createOscillator(): PitchGridSoundOscillator {
        const oscillator = createFakeOscillator();
        fake.oscillators.push(oscillator);
        return oscillator;
      },
      createGain(): PitchGridSoundGain {
        const gain = createFakeGain(options.cancelAndHold);
        fake.gains.push(gain);
        return gain;
      },
    };
    contexts.push(fake);
    return fake;
  };
  return {
    contexts,
    createContext,
    enqueueResume(handler: () => Promise<void>): void {
      resumeQueue.push(handler);
    },
    holdResume(): () => void {
      resumeQueue.push(
        () =>
          new Promise<void>((resolve) => {
            heldResolvers.push(resolve);
          }),
      );
      return (): void => {
        const resolvers = heldResolvers.splice(0);
        for (const resolve of resolvers) {
          resolve();
        }
      };
    },
  };
}

describe('格子の個別声と共有文脈', () => {
  it('鍵ごとの声を開始し波形と周波数を保つ', async () => {
    const harness = createHarness();
    const sound = createPitchGridSound(harness.createContext);
    await sound.setVoices([
      { key: '0,0', frequency: 220 },
      { key: '1,0', frequency: 330 },
    ]);
    const context = harness.contexts[0];
    expect(context?.oscillators).toHaveLength(2);
    for (const oscillator of context?.oscillators ?? []) {
      expect(oscillator.type).toBe('sawtooth');
    }
    expect(context?.oscillators.map((oscillator) => oscillator.frequency.value)).toEqual([
      220, 330,
    ]);
    expect(sound.voiceCount).toBe(2);
    await sound.dispose();
  });

  it('上限を超える集合は文脈を作らずに拒む', async () => {
    const harness = createHarness();
    const sound = createPitchGridSound(harness.createContext);
    const specs = Array.from({ length: PITCH_GRID_MAX_VOICES + 1 }, (_, index) => ({
      key: `over-${index}`,
      frequency: 220 + index,
    }));
    await expect(sound.setVoices(specs)).rejects.toThrow(RangeError);
    expect(harness.contexts).toHaveLength(0);
    expect(sound.voiceCount).toBe(0);
    await sound.dispose();
  });

  it('不正な周波数は文脈を作らずに拒む', async () => {
    const harness = createHarness();
    const sound = createPitchGridSound(harness.createContext);
    await expect(sound.setVoices([{ key: '0,0', frequency: 0 }])).rejects.toThrow(RangeError);
    await expect(sound.setVoices([{ key: '0,0', frequency: NaN }])).rejects.toThrow(RangeError);
    expect(harness.contexts).toHaveLength(0);
    await sound.dispose();
  });

  it('重複した鍵は拒む', async () => {
    const harness = createHarness();
    const sound = createPitchGridSound(harness.createContext);
    await expect(
      sound.setVoices([
        { key: '0,0', frequency: 220 },
        { key: '0,0', frequency: 330 },
      ]),
    ).rejects.toThrow();
    expect(harness.contexts).toHaveLength(0);
    await sound.dispose();
  });

  it('オフはその点だけを終了し他点を巻き込まない', async () => {
    const harness = createHarness();
    const sound = createPitchGridSound(harness.createContext);
    await sound.setVoices([
      { key: '0,0', frequency: 220 },
      { key: '1,0', frequency: 330 },
    ]);
    const context = harness.contexts[0];
    if (context === undefined) {
      throw new Error('検査用の文脈が作られていない');
    }
    context.currentTime = 1;
    await sound.setVoices([{ key: '1,0', frequency: 330 }]);
    const [first, second] = context.oscillators;
    if (first === undefined || second === undefined) {
      throw new Error('検査用の発振器が作られていない');
    }
    // 外れた点だけが減衰の予約と停止時刻の指定を受け、声は増えないこと。
    expect(context.oscillators).toHaveLength(2);
    expect(first.stopTimes).toEqual([1 + RELEASE_TIME]);
    expect(second.stopTimes).toEqual([]);
    // 終了通知で外れた声だけが切り離されること。
    first.fireEnded();
    expect(sound.voiceCount).toBe(1);
    expect(second.calls).not.toContain('disconnect');
    await sound.dispose();
  });

  it('停止後の消音予約は値と時刻を伴う', async () => {
    const harness = createHarness();
    const sound = createPitchGridSound(harness.createContext);
    await sound.setVoices([{ key: '0,0', frequency: 220 }]);
    const context = harness.contexts[0];
    if (context === undefined) {
      throw new Error('検査用の文脈が作られていない');
    }
    context.currentTime = 1;
    await sound.setVoices([]);
    const gain = context.gains[0];
    const oscillator = context.oscillators[0];
    if (gain === undefined || oscillator === undefined) {
      throw new Error('検査用の声が作られていない');
    }
    // 予約済みの将来値を保持付きで取り消し、無音への減衰を予約すること。
    expect(gain.events).toContainEqual({ kind: 'cancelAndHold', value: null, time: 1 });
    expect(gain.events).toContainEqual({ kind: 'linearRamp', value: 0, time: 1 + RELEASE_TIME });
    expect(oscillator.stopTimes).toEqual([1 + RELEASE_TIME]);
    await sound.dispose();
  });

  it('保持付き取消しがない環境では現在値の再設定で減衰を予約する', async () => {
    const harness = createHarness({ cancelAndHold: false });
    const sound = createPitchGridSound(harness.createContext);
    await sound.setVoices([{ key: '0,0', frequency: 220 }]);
    const context = harness.contexts[0];
    if (context === undefined) {
      throw new Error('検査用の文脈が作られていない');
    }
    // 立ち上がりの途中で終える。現在値は予約した線形区間から求まること。
    context.currentTime = ATTACK_TIME / 2;
    await sound.setVoices([]);
    const gain = context.gains[0];
    if (gain === undefined) {
      throw new Error('検査用の声が作られていない');
    }
    const currentGain = envelopeGainAtTime(
      0,
      ATTACK_TIME / 2,
      PITCH_GRID_VOICE_GAIN,
      HARMONIC_ENVELOPE_DEFAULTS,
    );
    expect(gain.events).toContainEqual({
      kind: 'cancelValues',
      value: null,
      time: ATTACK_TIME / 2,
    });
    expect(gain.events).toContainEqual({
      kind: 'setValue',
      value: currentGain,
      time: ATTACK_TIME / 2,
    });
    expect(gain.events).toContainEqual({
      kind: 'linearRamp',
      value: 0,
      time: ATTACK_TIME / 2 + RELEASE_TIME,
    });
    await sound.dispose();
  });

  it('移動の差分は重なりを継続し差分だけ操作する', async () => {
    const harness = createHarness();
    const sound = createPitchGridSound(harness.createContext);
    await sound.setVoices([
      { key: '0,0', frequency: 220 },
      { key: '1,0', frequency: 330 },
    ]);
    const context = harness.contexts[0];
    if (context === undefined) {
      throw new Error('検査用の文脈が作られていない');
    }
    const staying = context.oscillators[1];
    await sound.setVoices([
      { key: '1,0', frequency: 330 },
      { key: '2,0', frequency: 247.5 },
    ]);
    // 残る声は作り直さず、外れた声だけが減衰し、新しい声が増えること。
    expect(context.oscillators).toHaveLength(3);
    expect(context.oscillators[1]).toBe(staying);
    expect(staying?.stopTimes).toEqual([]);
    expect(context.oscillators[0]?.stopTimes).toHaveLength(1);
    expect(context.oscillators[2]?.frequency.value).toBe(247.5);
    expect(sound.voiceCount).toBe(3);
    await sound.dispose();
  });

  it('同一集合の再反映は声を作り直さない', async () => {
    const harness = createHarness();
    const sound = createPitchGridSound(harness.createContext);
    const specs = [
      { key: '0,0', frequency: 220 },
      { key: '1,0', frequency: 330 },
    ];
    await sound.setVoices(specs);
    await sound.setVoices(specs);
    expect(harness.contexts[0]?.oscillators).toHaveLength(2);
    expect(harness.contexts[0]?.oscillators.map((oscillator) => oscillator.stopTimes)).toEqual([
      [],
      [],
    ]);
    await sound.dispose();
  });

  it('同じ鍵で周波数が変わった場合は旧声を減衰させて新声を開始する', async () => {
    const harness = createHarness();
    const sound = createPitchGridSound(harness.createContext);
    await sound.setVoices([{ key: '0,0', frequency: 220 }]);
    const context = harness.contexts[0];
    if (context === undefined) {
      throw new Error('検査用の文脈が作られていない');
    }
    await sound.setVoices([{ key: '0,0', frequency: 330 }]);
    expect(context.oscillators).toHaveLength(2);
    expect(context.oscillators[0]?.stopTimes).toHaveLength(1);
    expect(context.oscillators[1]?.frequency.value).toBe(330);
    // 古い完了通知が新しい声を止めないこと。
    context.oscillators[0]?.fireEnded();
    expect(sound.voiceCount).toBe(1);
    expect(context.oscillators[1]?.calls).not.toContain('disconnect');
    await sound.dispose();
  });

  it('起動待ちの取消は声を即時に外す', async () => {
    const harness = createHarness();
    const sound = createPitchGridSound(harness.createContext);
    const release = harness.holdResume();
    const started = sound.setVoices([{ key: '0,0', frequency: 220 }]);
    sound.stopAll();
    const context = harness.contexts[0];
    if (context === undefined) {
      throw new Error('検査用の文脈が作られていない');
    }
    // 完了待ちの声は減衰を予約せず即時に止めること。
    expect(sound.voiceCount).toBe(0);
    expect(context.oscillators[0]?.stopTimes).toEqual([undefined]);
    expect(
      context.gains[0]?.events.some(
        (event) => event.kind === 'linearRamp' && event.value === 0,
      ),
    ).toBe(false);
    release();
    await started;
    await flush();
    expect(sound.voiceCount).toBe(0);
    await sound.dispose();
  });

  it('再開の失敗は開始した声を外して文脈を保つ', async () => {
    const harness = createHarness();
    const sound = createPitchGridSound(harness.createContext);
    harness.enqueueResume(() => Promise.reject(new Error('再開失敗')));
    await expect(sound.setVoices([{ key: '0,0', frequency: 220 }])).rejects.toThrow('再開失敗');
    expect(sound.voiceCount).toBe(0);
    // 文脈は閉じず、再試行では同じ文脈を使うこと。
    expect(harness.contexts[0]?.closeCalls).toBe(0);
    await sound.setVoices([{ key: '1,0', frequency: 330 }]);
    expect(harness.contexts).toHaveLength(1);
    expect(sound.voiceCount).toBe(1);
    await sound.dispose();
  });

  it('全停止は発音中の声に減衰を予約し文脈を保つ', async () => {
    const harness = createHarness();
    const sound = createPitchGridSound(harness.createContext);
    await sound.setVoices([
      { key: '0,0', frequency: 220 },
      { key: '1,0', frequency: 330 },
    ]);
    const context = harness.contexts[0];
    if (context === undefined) {
      throw new Error('検査用の文脈が作られていない');
    }
    context.currentTime = 2;
    sound.stopAll();
    for (const oscillator of context.oscillators) {
      expect(oscillator.stopTimes).toEqual([2 + RELEASE_TIME]);
    }
    expect(context.closeCalls).toBe(0);
    // 停止後も同じ文脈で鳴らし直せること。
    await sound.setVoices([{ key: '0,1', frequency: 275 }]);
    expect(harness.contexts).toHaveLength(1);
    await sound.dispose();
  });

  it('破棄は全声を即時停止し文脈を一度だけ閉じる', async () => {
    const harness = createHarness();
    const sound = createPitchGridSound(harness.createContext);
    await sound.setVoices([
      { key: '0,0', frequency: 220 },
      { key: '1,0', frequency: 330 },
    ]);
    const context = harness.contexts[0];
    if (context === undefined) {
      throw new Error('検査用の文脈が作られていない');
    }
    context.currentTime = 1;
    await sound.setVoices([{ key: '0,0', frequency: 220 }]);
    // 減衰の予約済みの声は停止呼び出しを重ねず、終了通知を取り消して切り離すこと。
    await sound.dispose();
    expect(context.oscillators[1]?.stopTimes).toEqual([1 + RELEASE_TIME]);
    expect(context.oscillators[0]?.stopTimes).toEqual([undefined]);
    expect(context.closeCalls).toBe(1);
    await sound.dispose();
    expect(context.closeCalls).toBe(1);
    await expect(sound.setVoices([{ key: '0,0', frequency: 220 }])).rejects.toThrow();
  });

  it('破棄後の非同期完了は声を残さない', async () => {
    const harness = createHarness();
    const sound = createPitchGridSound(harness.createContext);
    const release = harness.holdResume();
    const started = sound.setVoices([{ key: '0,0', frequency: 220 }]);
    await sound.dispose();
    release();
    await started;
    await flush();
    expect(sound.voiceCount).toBe(0);
  });

  it('起動前に破棄した場合は文脈を作らない', async () => {
    const harness = createHarness();
    const sound = createPitchGridSound(harness.createContext);
    await sound.dispose();
    expect(harness.contexts).toHaveLength(0);
  });
});

describe('格子の次元切替の専用境界', () => {
  it('切替境界は保持した全声を新規開始する', async () => {
    const harness = createHarness();
    const sound = createPitchGridSound(harness.createContext);
    await sound.setVoices([
      { key: '0,0', frequency: 220 },
      { key: '1,0', frequency: 330 },
    ]);
    const context = harness.contexts[0];
    if (context === undefined) {
      throw new Error('検査用の文脈が作られていない');
    }
    await sound.switchDimension([
      { key: '0,0', frequency: 275 },
      { key: '1,0', frequency: 412.5 },
    ]);
    // 旧声は即時に止めて切り離し、全座標に新声を作ること。
    expect(context.oscillators).toHaveLength(4);
    expect(context.oscillators[0]?.stopTimes).toEqual([undefined]);
    expect(context.oscillators[1]?.stopTimes).toEqual([undefined]);
    expect(context.oscillators.map((oscillator) => oscillator.frequency.value)).toEqual([
      220, 330, 275, 412.5,
    ]);
    expect(sound.voiceCount).toBe(2);
    await sound.dispose();
  });

  it('減衰予約済みの同鍵・同周波数も再生成し旧通知が新声に作用しない', async () => {
    const harness = createHarness();
    const sound = createPitchGridSound(harness.createContext);
    await sound.setVoices([{ key: '0,0', frequency: 220 }]);
    const context = harness.contexts[0];
    if (context === undefined) {
      throw new Error('検査用の文脈が作られていない');
    }
    // 旧声を減衰予約のまま残す。停止と集合反映の単純な重ね合わせでは
    // この旧声を使い回して無音になり得る。
    await sound.setVoices([]);
    // 中央行など周波数が変わらない鍵でも新声を開始すること。
    await sound.switchDimension([{ key: '0,0', frequency: 220 }]);
    expect(context.oscillators).toHaveLength(2);
    expect(context.oscillators[1]?.frequency.value).toBe(220);
    expect(sound.voiceCount).toBe(1);
    // 旧声の終了通知は所有照合で無視し、新声を止めないこと。
    context.oscillators[0]?.fireEnded();
    expect(sound.voiceCount).toBe(1);
    expect(context.oscillators[1]?.calls).not.toContain('disconnect');
    expect(context.oscillators[1]?.stopTimes).toEqual([]);
    await sound.dispose();
  });

  it('操作直後の切替で古い再開が新声に作用しない', async () => {
    const harness = createHarness();
    const sound = createPitchGridSound(harness.createContext);
    const release = harness.holdResume();
    const pending = sound.setVoices([{ key: '0,0', frequency: 220 }]);
    const context = harness.contexts[0];
    if (context === undefined) {
      throw new Error('検査用の文脈が作られていない');
    }
    await sound.switchDimension([{ key: '0,0', frequency: 275 }]);
    // 起動待ちは取り消して即時に外すこと。
    expect(context.oscillators[0]?.stopTimes).toEqual([undefined]);
    expect(sound.voiceCount).toBe(1);
    // 古い再開の完了は所有照合で無視し、新声を作り直さないこと。
    release();
    await pending;
    await flush();
    expect(context.oscillators).toHaveLength(2);
    expect(sound.voiceCount).toBe(1);
    expect(context.oscillators[1]?.frequency.value).toBe(275);
    await sound.dispose();
  });

  it('連続切替で古い再開失敗が新声を外さない', async () => {
    const harness = createHarness();
    const sound = createPitchGridSound(harness.createContext);
    harness.enqueueResume(() => Promise.reject(new Error('切替失敗')));
    const first = sound.switchDimension([{ key: '0,0', frequency: 220 }]);
    const second = sound.switchDimension([{ key: '0,0', frequency: 330 }]);
    // 古い切替の失敗は所有が移っているため静かに終えること。
    await first;
    await second;
    const context = harness.contexts[0];
    if (context === undefined) {
      throw new Error('検査用の文脈が作られていない');
    }
    expect(sound.voiceCount).toBe(1);
    expect(context.oscillators).toHaveLength(2);
    expect(context.oscillators[1]?.frequency.value).toBe(330);
    // 古い声の終了通知も新声に作用しないこと。
    context.oscillators[0]?.fireEnded();
    expect(sound.voiceCount).toBe(1);
    expect(context.oscillators[1]?.calls).not.toContain('disconnect');
    await sound.dispose();
  });

  it('空集合の切替は旧声を止め文脈を作らない', async () => {
    const harness = createHarness();
    const sound = createPitchGridSound(harness.createContext);
    await sound.switchDimension([]);
    expect(harness.contexts).toHaveLength(0);
    expect(sound.voiceCount).toBe(0);
    await sound.setVoices([{ key: '0,0', frequency: 220 }]);
    const context = harness.contexts[0];
    if (context === undefined) {
      throw new Error('検査用の文脈が作られていない');
    }
    await sound.switchDimension([]);
    expect(context.oscillators[0]?.stopTimes).toEqual([undefined]);
    expect(sound.voiceCount).toBe(0);
    expect(context.oscillators).toHaveLength(1);
    await sound.dispose();
  });

  it('不正な切替は文脈を作らずに拒む', async () => {
    const harness = createHarness();
    const sound = createPitchGridSound(harness.createContext);
    await expect(
      sound.switchDimension([
        { key: '0,0', frequency: 220 },
        { key: '0,0', frequency: 330 },
      ]),
    ).rejects.toThrow();
    await expect(sound.switchDimension([{ key: '0,0', frequency: 0 }])).rejects.toThrow(
      RangeError,
    );
    expect(harness.contexts).toHaveLength(0);
    expect(sound.voiceCount).toBe(0);
    await sound.dispose();
  });
});
