/**
 * 共有快照のローカル音声への反映の配線検査。
 *
 * ブラウザの音声文脈を使わず、演奏口の代替物で次を確かめる。
 * オン・オフと移動の集合反映、空集合での無生成、次元切替の
 * 集合保持と新次元での鳴らし直し、空集合の切替での無生成、
 * 切替失敗後の再反映での回復、破棄後の無受付を判定対象とする。
 * 呼び出し記録だけでなく周波数と鍵の対応まで照合し、
 * 呼び出し回数だけを合格証拠にしない。具体値はこの検査に置く。
 */

import { describe, expect, it } from 'vitest';
import {
  createPitchGridSoundReflector,
  type PitchGridSoundSnapshot,
} from './pitchGridController';
import {
  assignPitchGridFrequencies,
  movePitchGridIntent,
  pitchGridSnapshotFromIntent,
  selectPitchGridDimensionIntent,
  togglePitchGridIntent,
  PITCH_GRID_INITIAL_INTENT,
} from './pitchGrid';
import type {
  PitchGridSound,
  PitchGridSoundingVoice,
  PitchGridVoiceSpec,
} from './pitchGridSound';

/** 演奏口の代替物。集合の反映と切替の呼び出しを記録する。 */
class FakePitchGridSound implements PitchGridSound {
  /** `setVoices` に渡された声の記録。順序と対応付けの照合に使う。 */
  readonly voiceCalls: PitchGridVoiceSpec[][] = [];

  /** `switchDimension` に渡された声の記録。順序と対応付けの照合に使う。 */
  readonly switchCalls: PitchGridVoiceSpec[][] = [];

  stopAllCalls = 0;

  disposeCalls = 0;

  voiceCount = 0;

  /** 次の切替だけ再開失敗として扱う。再反映での回復を確かめるために使う。 */
  failNextSwitch = false;

  private disposed = false;

  /** 表示用の保持中一覧。検査用の設定口で差し替える。 */
  private sounding: PitchGridSoundingVoice[] = [];

  private readonly soundingListeners = new Set<() => void>();

  get soundingVoices(): readonly PitchGridSoundingVoice[] {
    return [...this.sounding];
  }

  subscribeSounding(listener: () => void): () => void {
    this.soundingListeners.add(listener);
    return (): void => {
      this.soundingListeners.delete(listener);
    };
  }

  /**
   * 検査用に表示用の保持中一覧を差し替えて購読者へ知らせる。
   *
   * 音声側の再開成立・リリースなどの内容変化を模す。集合の反映では
   * 自動で変えず、選択意図と表示の食い違いを確かめられるようにする。
   *
   * @param voices - 差し替える保持中一覧。
   */
  setSoundingForTest(voices: readonly PitchGridSoundingVoice[]): void {
    this.sounding = [...voices];
    for (const listener of [...this.soundingListeners]) {
      listener();
    }
  }

  soundingListenerCountForTest(): number {
    return this.soundingListeners.size;
  }

  async setVoices(specs: readonly PitchGridVoiceSpec[]): Promise<void> {
    if (this.disposed) {
      throw new Error('破棄後の演奏口は使えない');
    }
    this.voiceCalls.push([...specs]);
    this.voiceCount = specs.length;
  }

  async switchDimension(specs: readonly PitchGridVoiceSpec[]): Promise<void> {
    if (this.disposed) {
      throw new Error('破棄後の演奏口は使えない');
    }
    this.switchCalls.push([...specs]);
    if (this.failNextSwitch) {
      this.failNextSwitch = false;
      this.voiceCount = 0;
      throw new Error('再開失敗');
    }
    this.voiceCount = specs.length;
  }

  stopAll(): void {
    this.stopAllCalls += 1;
  }

  async dispose(): Promise<void> {
    this.disposeCalls += 1;
    this.disposed = true;
    this.voiceCount = 0;
    this.sounding = [];
  }
}

/** 非同期の継続を進める。固定時間の待ちではなく区切りのための譲歩である。 */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * 発音口へ渡す全声仕様の期待値を作る。
 *
 * 配置結果の `k` は発音口へ渡さず、鍵と周波数の写像だけを渡す。
 * 比較もその写像で行い、配置指数の有無で合否を変えない。
 */
function voiceSpecsOf(
  points: readonly { x: number; y: number }[],
  dimension: 3 | 4 | 5,
): { key: string; frequency: number }[] {
  return assignPitchGridFrequencies(points, dimension).map(({ key, frequency }) => ({
    key,
    frequency,
  }));
}

function createReflector(): {
  reflector: ReturnType<typeof createPitchGridSoundReflector>;
  sound: FakePitchGridSound;
  notified: () => number;
  createdSounds: () => number;
} {
  const sound = new FakePitchGridSound();
  let created = 0;
  let notifyCalls = 0;
  const reflector = createPitchGridSoundReflector({
    createSound: () => {
      created += 1;
      return sound;
    },
    notify: () => {
      notifyCalls += 1;
    },
  });
  return { reflector, sound, notified: () => notifyCalls, createdSounds: () => created };
}

function expectSoundSnapshot(
  snapshot: PitchGridSoundSnapshot,
  voiceCount: number,
  soundingVoices: readonly PitchGridSoundingVoice[],
): void {
  expect(snapshot.voiceCount).toBe(voiceCount);
  expect(snapshot.soundingVoices).toEqual(soundingVoices);
}

describe('共有快照のローカル音声への反映', () => {
  it('点のオンを声の集合へ反映する', () => {
    const { reflector, sound } = createReflector();
    const intent = togglePitchGridIntent(PITCH_GRID_INITIAL_INTENT, { x: 0, y: 0 });
    reflector.reflect(pitchGridSnapshotFromIntent(intent));
    expect(sound.voiceCalls).toHaveLength(1);
    // 配置関数の結果をそのまま全声仕様として渡すこと。
    expect(sound.voiceCalls[0]).toEqual(voiceSpecsOf([{ x: 0, y: 0 }], 3));
    expectSoundSnapshot(reflector.getSnapshot(), 1, []);
  });

  it('点のオフを声の集合へ反映する', () => {
    const { reflector, sound } = createReflector();
    const turnedOn = togglePitchGridIntent(PITCH_GRID_INITIAL_INTENT, { x: 0, y: 0 });
    reflector.reflect(pitchGridSnapshotFromIntent(turnedOn));
    const turnedOff = togglePitchGridIntent(turnedOn, { x: 0, y: 0 });
    reflector.reflect(pitchGridSnapshotFromIntent(turnedOff));
    expect(sound.voiceCalls).toHaveLength(2);
    expect(sound.voiceCalls[1]).toEqual([]);
    expectSoundSnapshot(reflector.getSnapshot(), 0, []);
  });

  it('遠隔の共有快照を自端末の音へ反映する', () => {
    // 他端末が書いた意図値をそのまま受け取った想定で、共有値から
    // 読み替えた快照を反映し、自端末の音へ届けること。
    const { reflector, sound } = createReflector();
    const remoteIntent = togglePitchGridIntent(PITCH_GRID_INITIAL_INTENT, { x: 1, y: 0 });
    const received: unknown = JSON.parse(JSON.stringify(remoteIntent));
    reflector.reflect(pitchGridSnapshotFromIntent(received));
    expect(sound.voiceCalls).toEqual([voiceSpecsOf([{ x: 1, y: 0 }], 3)]);
  });

  it('移動は差分として一括反映する', () => {
    const { reflector, sound } = createReflector();
    let intent = togglePitchGridIntent(PITCH_GRID_INITIAL_INTENT, { x: 0, y: 0 });
    intent = togglePitchGridIntent(intent, { x: 1, y: 0 });
    reflector.reflect(pitchGridSnapshotFromIntent(intent));
    const callsBefore = sound.voiceCalls.length;
    const moved = movePitchGridIntent(intent, 1, 1);
    reflector.reflect(pitchGridSnapshotFromIntent(moved));
    // 移動後の集合を一度だけ反映すること。
    expect(sound.voiceCalls).toHaveLength(callsBefore + 1);
    expect(sound.voiceCalls[callsBefore]).toEqual(
      voiceSpecsOf(
        [
          { x: 1, y: 1 },
          { x: 2, y: 1 },
        ],
        3,
      ),
    );
  });

  it('空集合の反映では文脈を作らない', () => {
    const { reflector, sound, createdSounds } = createReflector();
    reflector.reflect(pitchGridSnapshotFromIntent(PITCH_GRID_INITIAL_INTENT));
    expect(createdSounds()).toBe(0);
    expect(sound.voiceCalls).toHaveLength(0);
    expect(sound.switchCalls).toHaveLength(0);
    expectSoundSnapshot(reflector.getSnapshot(), 0, []);
  });

  it('次元切替はオン集合を保ち新次元で鳴らし直す', () => {
    const { reflector, sound } = createReflector();
    let intent = togglePitchGridIntent(PITCH_GRID_INITIAL_INTENT, { x: 0, y: 0 });
    intent = togglePitchGridIntent(intent, { x: 1, y: 0 });
    reflector.reflect(pitchGridSnapshotFromIntent(intent));
    const voiceCallsBefore = sound.voiceCalls.length;
    const switched = selectPitchGridDimensionIntent(intent, 4);
    reflector.reflect(pitchGridSnapshotFromIntent(switched));
    // 保持した全座標を新次元の周波数で鳴らし直すこと。旧音の停止は切替境界が担い、
    // 通常の停止と差分反映の重ね呼び出しはしないこと。
    expect(sound.switchCalls).toHaveLength(1);
    expect(sound.switchCalls[0]).toEqual(
      voiceSpecsOf(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        4,
      ),
    );
    expect(sound.stopAllCalls).toBe(0);
    expect(sound.voiceCalls).toHaveLength(voiceCallsBefore);
  });

  it('空集合の切替では文脈を作らず発音もしない', () => {
    const { reflector, sound, createdSounds } = createReflector();
    const switched = selectPitchGridDimensionIntent(PITCH_GRID_INITIAL_INTENT, 4);
    reflector.reflect(pitchGridSnapshotFromIntent(switched));
    expect(createdSounds()).toBe(0);
    expect(sound.switchCalls).toHaveLength(0);
    expect(sound.voiceCalls).toHaveLength(0);
    expect(sound.stopAllCalls).toBe(0);
  });

  it('同じ次元の再反映は切替へ寄せない', () => {
    const { reflector, sound } = createReflector();
    const turnedOn = togglePitchGridIntent(PITCH_GRID_INITIAL_INTENT, { x: 0, y: 0 });
    reflector.reflect(pitchGridSnapshotFromIntent(turnedOn));
    const added = togglePitchGridIntent(turnedOn, { x: 1, y: 0 });
    reflector.reflect(pitchGridSnapshotFromIntent(added));
    expect(sound.voiceCalls).toHaveLength(2);
    expect(sound.switchCalls).toHaveLength(0);
  });

  it('同値の再反映は抑止せず音声側へ渡す', () => {
    // 同値の抑止は共有側に設けず、音声側の継続分岐に寄せる。
    // 同じ快照の反映は通常反映として渡し、切替には寄せないこと。
    const { reflector, sound } = createReflector();
    const intent = togglePitchGridIntent(PITCH_GRID_INITIAL_INTENT, { x: 0, y: 0 });
    const snapshot = pitchGridSnapshotFromIntent(intent);
    reflector.reflect(snapshot);
    reflector.reflect(pitchGridSnapshotFromIntent(intent));
    expect(sound.voiceCalls).toHaveLength(2);
    expect(sound.switchCalls).toHaveLength(0);
  });

  it('切替の再開失敗後も再反映で鳴らし直せる', async () => {
    const { reflector, sound } = createReflector();
    const turnedOn = togglePitchGridIntent(PITCH_GRID_INITIAL_INTENT, { x: 0, y: 0 });
    reflector.reflect(pitchGridSnapshotFromIntent(turnedOn));
    sound.failNextSwitch = true;
    const switched = selectPitchGridDimensionIntent(turnedOn, 4);
    reflector.reflect(pitchGridSnapshotFromIntent(switched));
    await flush();
    // 声だけが外れた状態になること。
    expect(sound.voiceCount).toBe(0);
    // 次の反映で鳴らし直せること。次元は追跡済みのため通常反映に寄せる。
    const voiceCallsBefore = sound.voiceCalls.length;
    const added = togglePitchGridIntent(switched, { x: 1, y: 0 });
    reflector.reflect(pitchGridSnapshotFromIntent(added));
    expect(sound.voiceCalls).toHaveLength(voiceCallsBefore + 1);
    expect(sound.voiceCalls[voiceCallsBefore]).toEqual(
      voiceSpecsOf(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        4,
      ),
    );
    expect(sound.switchCalls).toHaveLength(1);
  });

  it('破棄後は反映を受け付けず文脈を一度だけ閉じる', async () => {
    const { reflector, sound, notified } = createReflector();
    const intent = togglePitchGridIntent(PITCH_GRID_INITIAL_INTENT, { x: 0, y: 0 });
    reflector.reflect(pitchGridSnapshotFromIntent(intent));
    await flush();
    await reflector.dispose();
    await reflector.dispose();
    expect(sound.disposeCalls).toBe(1);
    const callsBefore = sound.voiceCalls.length;
    const added = togglePitchGridIntent(intent, { x: 1, y: 0 });
    reflector.reflect(pitchGridSnapshotFromIntent(added));
    expect(sound.voiceCalls).toHaveLength(callsBefore);
    expect(sound.stopAllCalls).toBe(0);
    expect(notified()).toBeGreaterThan(0);
  });

  it('起動前に破棄した場合は文脈を作らない', async () => {
    let created = 0;
    const reflector = createPitchGridSoundReflector({
      createSound: () => {
        created += 1;
        return new FakePitchGridSound();
      },
    });
    await reflector.dispose();
    expect(created).toBe(0);
  });
});

describe('反射器の表示用保持中一覧', () => {
  it('快照の表示用一覧は音声側の保持一覧を反映する', () => {
    const { reflector, sound } = createReflector();
    const intent = togglePitchGridIntent(PITCH_GRID_INITIAL_INTENT, { x: 0, y: 0 });
    reflector.reflect(pitchGridSnapshotFromIntent(intent));
    // 音声側の再開成立を模し、表示用の保持中一覧だけを差し替えること。
    const [assigned] = assignPitchGridFrequencies([{ x: 0, y: 0 }], 3);
    const frequency = assigned.frequency;
    sound.setSoundingForTest([{ key: '0,0', frequency }]);
    expect(reflector.getSnapshot().soundingVoices).toEqual([{ key: '0,0', frequency }]);
  });

  it('選択意図と表示一覧が食い違っても混同しない', () => {
    const { reflector, sound } = createReflector();
    let intent = togglePitchGridIntent(PITCH_GRID_INITIAL_INTENT, { x: 0, y: 0 });
    intent = togglePitchGridIntent(intent, { x: 1, y: 0 });
    reflector.reflect(pitchGridSnapshotFromIntent(intent));
    // 再開未成立を模し、表示一覧は空のままにすること。表示一覧の
    // 再計算や声数の推定で埋めないこと。
    expect(reflector.getSnapshot().soundingVoices).toEqual([]);
    expect(sound.voiceCount).toBe(2);
  });

  it('音声側の内容変化通知を既存の通知へ届ける', () => {
    const { reflector, sound, notified } = createReflector();
    const intent = togglePitchGridIntent(PITCH_GRID_INITIAL_INTENT, { x: 0, y: 0 });
    reflector.reflect(pitchGridSnapshotFromIntent(intent));
    const callsBefore = notified();
    const [assigned] = assignPitchGridFrequencies([{ x: 0, y: 0 }], 3);
    const frequency = assigned.frequency;
    sound.setSoundingForTest([{ key: '0,0', frequency }]);
    // 音声側の購読が反射器の既存通知へ転送され、快照が新しい一覧を返すこと。
    expect(notified()).toBeGreaterThan(callsBefore);
    expect(reflector.getSnapshot().soundingVoices).toEqual([{ key: '0,0', frequency }]);
  });

  it('破棄後は音声側の内容変化通知を届けない', async () => {
    const { reflector, sound, notified } = createReflector();
    const intent = togglePitchGridIntent(PITCH_GRID_INITIAL_INTENT, { x: 0, y: 0 });
    reflector.reflect(pitchGridSnapshotFromIntent(intent));
    await reflector.dispose();
    const callsBefore = notified();
    sound.setSoundingForTest([{ key: '0,0', frequency: 220 }]);
    expect(notified()).toBe(callsBefore);
    expect(sound.soundingListenerCountForTest()).toBe(0);
  });
});
