/**
 * 意味論和音の専用発音口の session の単体検査。
 *
 * 代替の発音口で次を確かめる。解決から実仕様までの接続・検査失敗時に
 * 発音口を生成・更新しないこと・同一次元の反映と次元切替の使い分け・
 * 停止と破棄・失敗の伝達・上限超過の拒否。具体値はこの検査に置く。
 * 意味論解決の保証は `semanticChord.test.ts` が所有し、複製しない。
 * ブラウザの音声文脈を使わない。
 */

import { describe, expect, it } from 'vitest';
import {
  PITCH_GRID_MAX_VOICES,
  type PitchGridSound,
  type PitchGridSoundingVoice,
  type PitchGridVoiceSpec,
} from './pitchGridSound';
import { type SemanticChord } from './semanticChord';
import { createSemanticChordSoundSession } from './semanticChordSound';

/** 呼び出し記録だけを行う検査用の発音口。 */
interface FakeSound extends PitchGridSound {
  /** `setVoices` に渡した声仕様の記録。 */
  readonly setCalls: Array<readonly PitchGridVoiceSpec[]>;
  /** `switchDimension` に渡した声仕様の記録。 */
  readonly switchCalls: Array<readonly PitchGridVoiceSpec[]>;
  /** `stopAll` の呼び出し回数。 */
  readonly stopCalls: number;
  /** `dispose` の呼び出し回数。 */
  readonly disposeCalls: number;
  /** 次の生成・更新をこの失敗で拒む。一度だけ使う。 */
  failNextWith(error: unknown): void;
}

function createFakeSound(): FakeSound {
  const setCalls: Array<readonly PitchGridVoiceSpec[]> = [];
  const switchCalls: Array<readonly PitchGridVoiceSpec[]> = [];
  const queued: Array<{ readonly error: unknown }> = [];
  let stopCalls = 0;
  let disposeCalls = 0;
  const consumeFailure = (): { readonly error: unknown } | undefined => queued.shift();
  const sound: FakeSound = {
    get voiceCount(): number {
      return 0;
    },
    get soundingVoices(): readonly PitchGridSoundingVoice[] {
      return [];
    },
    subscribeSounding(): () => void {
      return (): void => {};
    },
    async setVoices(specs: readonly PitchGridVoiceSpec[]): Promise<void> {
      setCalls.push([...specs]);
      const next = consumeFailure();
      if (next !== undefined) {
        throw next.error;
      }
    },
    async switchDimension(specs: readonly PitchGridVoiceSpec[]): Promise<void> {
      switchCalls.push([...specs]);
      const next = consumeFailure();
      if (next !== undefined) {
        throw next.error;
      }
    },
    stopAll(): void {
      stopCalls += 1;
    },
    async dispose(): Promise<void> {
      disposeCalls += 1;
    },
    get setCalls(): Array<readonly PitchGridVoiceSpec[]> {
      return setCalls;
    },
    get switchCalls(): Array<readonly PitchGridVoiceSpec[]> {
      return switchCalls;
    },
    get stopCalls(): number {
      return stopCalls;
    },
    get disposeCalls(): number {
      return disposeCalls;
    },
    failNextWith(error: unknown): void {
      queued.push({ error });
    },
  };
  return sound;
}

/** 生成を数えられる検査用の束。 */
interface Harness {
  /** 生成した代替物の記録。 */
  readonly sounds: FakeSound[];
  /** session に渡す生成口。 */
  createSound(): PitchGridSound;
}

function createHarness(): Harness {
  const sounds: FakeSound[] = [];
  return {
    sounds,
    createSound(): PitchGridSound {
      const sound = createFakeSound();
      sounds.push(sound);
      return sound;
    },
  };
}

/** 三次元の二声の和音。解音 440Hz で 440Hz と 1320Hz になる。 */
function twoVoiceChord(): SemanticChord {
  return {
    primaryDimension: 3,
    functionalRootOffset: { primeExponents: {} },
    toneOffsets: [{ primeExponents: { 3: 1 } }],
  };
}

/** 四次元の二声の和音。解音 440Hz で 440Hz と 3080Hz になる。 */
function fourthDimensionChord(): SemanticChord {
  return {
    primaryDimension: 4,
    functionalRootOffset: { primeExponents: {} },
    toneOffsets: [{ primeExponents: { 7: 1 } }],
  };
}

describe('解決から実仕様までの接続', () => {
  it('初回の反映まで発音口を作らず解決結果を声仕様で届ける', async () => {
    const harness = createHarness();
    const session = createSemanticChordSoundSession({ createSound: harness.createSound });

    // 遅延生成のため、反映までは発音口を作らないこと。
    expect(harness.sounds).toHaveLength(0);
    await session.reflect(twoVoiceChord(), 440);

    expect(harness.sounds).toHaveLength(1);
    const sound = harness.sounds[0];
    if (sound === undefined) {
      throw new Error('検査用の発音口が作られていない');
    }
    expect(sound.setCalls).toEqual([
      [
        { key: 'semantic:root:1/1', frequency: 440 },
        { key: 'semantic:tone:3/1', frequency: 1320 },
      ],
    ]);
    expect(sound.switchCalls).toEqual([]);
    await session.dispose();
  });
});

describe('検査失敗時の扱い', () => {
  it('上限超過は拒み発音口を更新せず既存の声を保つ', async () => {
    const harness = createHarness();
    const session = createSemanticChordSoundSession({ createSound: harness.createSound });
    await session.reflect(twoVoiceChord(), 440);
    const sound = harness.sounds[0];
    if (sound === undefined) {
      throw new Error('検査用の発音口が作られていない');
    }
    // 機能根に上限と同数の構成音を足し、一声だけ上限を超える。
    const oversized: SemanticChord = {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: {} },
      toneOffsets: Array.from({ length: PITCH_GRID_MAX_VOICES }, (_, index) => ({
        primeExponents: { 3: index + 1 },
      })),
    };

    await expect(session.reflect(oversized, 440)).rejects.toThrow(RangeError);

    // 新しい反映を行わず、既存の声を勝手に止めないこと。
    expect(harness.sounds).toHaveLength(1);
    expect(sound.setCalls).toHaveLength(1);
    expect(sound.switchCalls).toEqual([]);
    expect(sound.stopCalls).toBe(0);
    await session.dispose();
  });

  it('上限超過の初回反映では発音口を作らない', async () => {
    const harness = createHarness();
    const session = createSemanticChordSoundSession({ createSound: harness.createSound });
    const oversized: SemanticChord = {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: {} },
      toneOffsets: Array.from({ length: PITCH_GRID_MAX_VOICES }, (_, index) => ({
        primeExponents: { 3: index + 1 },
      })),
    };

    await expect(session.reflect(oversized, 440)).rejects.toThrow(RangeError);

    expect(harness.sounds).toHaveLength(0);
    await session.dispose();
  });

  it('不正な解音と和音は発音口を作らずに拒む', async () => {
    const harness = createHarness();
    const session = createSemanticChordSoundSession({ createSound: harness.createSound });

    await expect(session.reflect(twoVoiceChord(), 0)).rejects.toThrow(RangeError);
    await expect(
      session.reflect(
        { ...twoVoiceChord(), primaryDimension: 2 } as unknown as SemanticChord,
        440,
      ),
    ).rejects.toThrow(RangeError);

    expect(harness.sounds).toHaveLength(0);
    await session.dispose();
  });

  it('失敗した反映は次元判定を動かさない', async () => {
    const harness = createHarness();
    const session = createSemanticChordSoundSession({ createSound: harness.createSound });
    await session.reflect(twoVoiceChord(), 440);
    await expect(session.reflect(fourthDimensionChord(), 0)).rejects.toThrow(RangeError);

    // 直近の主要次元は三次元のままのため、四次元の反映は切替になること。
    await session.reflect(fourthDimensionChord(), 440);

    const sound = harness.sounds[0];
    if (sound === undefined) {
      throw new Error('検査用の発音口が作られていない');
    }
    expect(sound.switchCalls).toHaveLength(1);
    expect(sound.switchCalls[0]).toEqual([
      { key: 'semantic:root:1/1', frequency: 440 },
      { key: 'semantic:tone:7/1', frequency: 3080 },
    ]);
    await session.dispose();
  });
});

describe('次元による使い分け', () => {
  it('同一次元は通常反映し次元変更だけを切替で行う', async () => {
    const harness = createHarness();
    const session = createSemanticChordSoundSession({ createSound: harness.createSound });

    await session.reflect(twoVoiceChord(), 440);
    await session.reflect(twoVoiceChord(), 220);
    await session.reflect(fourthDimensionChord(), 440);
    await session.reflect(fourthDimensionChord(), 220);

    const sound = harness.sounds[0];
    if (sound === undefined) {
      throw new Error('検査用の発音口が作られていない');
    }
    // 同一次元の反映は `setVoices` を三度、次元変更は `switchDimension` を一度使うこと。
    expect(sound.setCalls).toHaveLength(3);
    expect(sound.switchCalls).toHaveLength(1);
    expect(sound.switchCalls[0]).toEqual([
      { key: 'semantic:root:1/1', frequency: 440 },
      { key: 'semantic:tone:7/1', frequency: 3080 },
    ]);
    // 同じ発音口を使い回すこと。
    expect(harness.sounds).toHaveLength(1);
    await session.dispose();
  });
});

describe('停止と破棄', () => {
  it('反映前の停止は何も作らず何もしない', () => {
    const harness = createHarness();
    const session = createSemanticChordSoundSession({ createSound: harness.createSound });

    session.stop();

    expect(harness.sounds).toHaveLength(0);
  });

  it('停止は発音口の全声停止に届ける', async () => {
    const harness = createHarness();
    const session = createSemanticChordSoundSession({ createSound: harness.createSound });
    await session.reflect(twoVoiceChord(), 440);

    session.stop();

    const sound = harness.sounds[0];
    if (sound === undefined) {
      throw new Error('検査用の発音口が作られていない');
    }
    expect(sound.stopCalls).toBe(1);
    expect(harness.sounds).toHaveLength(1);
    await session.dispose();
  });

  it('破棄は発音口を一度だけ破棄する', async () => {
    const harness = createHarness();
    const session = createSemanticChordSoundSession({ createSound: harness.createSound });
    await session.reflect(twoVoiceChord(), 440);

    await session.dispose();
    await session.dispose();

    const sound = harness.sounds[0];
    if (sound === undefined) {
      throw new Error('検査用の発音口が作られていない');
    }
    expect(sound.disposeCalls).toBe(1);
  });

  it('破棄後の反映は拒む', async () => {
    const harness = createHarness();
    const session = createSemanticChordSoundSession({ createSound: harness.createSound });
    await session.reflect(twoVoiceChord(), 440);
    await session.dispose();
    const sound = harness.sounds[0];
    if (sound === undefined) {
      throw new Error('検査用の発音口が作られていない');
    }

    await expect(session.reflect(twoVoiceChord(), 440)).rejects.toThrow();

    expect(sound.setCalls).toHaveLength(1);
  });
});

describe('失敗の伝達', () => {
  it('発音口の失敗を握り潰さず返す', async () => {
    const harness = createHarness();
    const session = createSemanticChordSoundSession({ createSound: harness.createSound });
    await session.reflect(twoVoiceChord(), 440);
    const sound = harness.sounds[0];
    if (sound === undefined) {
      throw new Error('検査用の発音口が作られていない');
    }
    sound.failNextWith(new Error('発音失敗'));

    await expect(session.reflect(twoVoiceChord(), 440)).rejects.toThrow('発音失敗');

    await session.dispose();
  });
});

describe('ベースを含む上限境界', () => {
  // 主要次元3の許す鍵（素数2・3・5）だけを使い、素数2の指数を変えて
  // 比率の重複を避ける。素数3・5の指数は1に固定し、周波数が正の有限値に
  // 収まる範囲（解音440Hzで約0.8Hz〜6600Hz）に収める。
  function bassBoundaryChord(toneCount: number): SemanticChord {
    return {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: {} },
      toneOffsets: Array.from({ length: toneCount }, (_, index) => {
        const primeExponents: Record<number, number> = { 3: 1, 5: 1 };
        if (index !== 0) {
          primeExponents[2] = -index;
        }
        return { primeExponents };
      }),
      bass: { primeExponents: { 5: 1 } },
    };
  }

  it('機能根・構成音・ベースの合計が16のときは拒み既存の声を保つ', async () => {
    const harness = createHarness();
    const session = createSemanticChordSoundSession({ createSound: harness.createSound });
    await session.reflect(twoVoiceChord(), 440);
    const sound = harness.sounds[0];
    if (sound === undefined) {
      throw new Error('検査用の発音口が作られていない');
    }
    // 機能根1＋異なる構成音14＋ベース1の16声で上限（15）を超える。
    await expect(session.reflect(bassBoundaryChord(14), 440)).rejects.toThrow(RangeError);

    // 新しい反映を行わず、既存の声を勝手に止めないこと。
    expect(harness.sounds).toHaveLength(1);
    expect(sound.setCalls).toHaveLength(1);
    expect(sound.switchCalls).toEqual([]);
    expect(sound.stopCalls).toBe(0);
    await session.dispose();
  });

  it('機能根・構成音・ベースの合計が15のときは15声を届ける', async () => {
    const harness = createHarness();
    const session = createSemanticChordSoundSession({ createSound: harness.createSound });

    // 機能根1＋異なる構成音13＋ベース1の15声で上限ちょうどになる。
    await session.reflect(bassBoundaryChord(13), 440);

    expect(harness.sounds).toHaveLength(1);
    const sound = harness.sounds[0];
    if (sound === undefined) {
      throw new Error('検査用の発音口が作られていない');
    }
    expect(sound.setCalls).toHaveLength(1);
    expect(sound.setCalls[0]).toHaveLength(PITCH_GRID_MAX_VOICES);
    await session.dispose();
  });
});
