/**
 * 格子操作の単一制御器の配線検査。
 *
 * ブラウザの音声文脈を使わず、演奏口の代替物で次を確かめる。
 * オン・オフと移動の集合反映、空集合と端での無反映、次元切替の
 * 集合保持と新次元での鳴らし直し、空集合の切替での無生成、
 * 切替失敗時の非巻き戻し、破棄後の無受付を判定対象とする。
 * 呼び出し記録だけでなく周波数と鍵の対応まで照合し、
 * 呼び出し回数だけを合格証拠にしない。具体値はこの検査に置く。
 */

import { describe, expect, it } from 'vitest';
import {
  createPitchGridController,
  type PitchGridControllerSnapshot,
} from './pitchGridController';
import { assignPitchGridFrequencies } from './pitchGrid';
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

  /** 次の切替だけ再開失敗として扱う。再操作での回復を確かめるために使う。 */
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

function createController(): {
  controller: ReturnType<typeof createPitchGridController>;
  sound: FakePitchGridSound;
  notified: () => number;
  createdSounds: () => number;
} {
  const sound = new FakePitchGridSound();
  let created = 0;
  let notifyCalls = 0;
  const controller = createPitchGridController({
    createSound: () => {
      created += 1;
      return sound;
    },
    notify: () => {
      notifyCalls += 1;
    },
  });
  return { controller, sound, notified: () => notifyCalls, createdSounds: () => created };
}

function expectSnapshot(
  snapshot: PitchGridControllerSnapshot,
  dimension: 3 | 4 | 5,
  points: Array<{ x: number; y: number }>,
): void {
  expect(snapshot.dimension).toBe(dimension);
  expect(snapshot.points).toEqual(points);
}

describe('格子操作の単一制御器', () => {
  it('点のオン・オフを声の集合へ反映する', () => {
    const { controller, sound } = createController();
    controller.toggle({ x: 0, y: 0 });
    expect(sound.voiceCalls).toHaveLength(1);
    // 配置関数の結果をそのまま全声仕様として渡すこと。
    expect(sound.voiceCalls[0]).toEqual(assignPitchGridFrequencies([{ x: 0, y: 0 }], 3));
    expectSnapshot(controller.getSnapshot(), 3, [{ x: 0, y: 0 }]);
    controller.toggle({ x: 0, y: 0 });
    expect(sound.voiceCalls).toHaveLength(2);
    expect(sound.voiceCalls[1]).toEqual([]);
    expectSnapshot(controller.getSnapshot(), 3, []);
  });

  it('移動は差分として一括反映する', () => {
    const { controller, sound } = createController();
    controller.toggle({ x: 0, y: 0 });
    controller.toggle({ x: 1, y: 0 });
    const callsBefore = sound.voiceCalls.length;
    const applied = controller.move(1, 1);
    expect(applied).toBe(true);
    // 移動後の集合を一度だけ反映すること。
    expect(sound.voiceCalls).toHaveLength(callsBefore + 1);
    expect(sound.voiceCalls[callsBefore]).toEqual(
      assignPitchGridFrequencies(
        [
          { x: 1, y: 1 },
          { x: 2, y: 1 },
        ],
        3,
      ),
    );
    expectSnapshot(controller.getSnapshot(), 3, [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ]);
  });

  it('空集合の移動は音声へ触れない', () => {
    const { controller, sound } = createController();
    const applied = controller.move(1, 0);
    expect(applied).toBe(false);
    expect(sound.voiceCalls).toHaveLength(0);
  });

  it('端での拒否は音声へ触れず集合を保つ', () => {
    const { controller, sound } = createController();
    controller.toggle({ x: 2, y: 0 });
    const callsBefore = sound.voiceCalls.length;
    const applied = controller.move(1, 0);
    expect(applied).toBe(false);
    expect(sound.voiceCalls).toHaveLength(callsBefore);
    expectSnapshot(controller.getSnapshot(), 3, [{ x: 2, y: 0 }]);
  });

  it('次元切替はオン集合を保ち新次元で鳴らし直す', () => {
    const { controller, sound } = createController();
    controller.toggle({ x: 0, y: 0 });
    controller.toggle({ x: 1, y: 0 });
    const voiceCallsBefore = sound.voiceCalls.length;
    controller.selectDimension(4);
    // 保持した全座標を新次元の周波数で鳴らし直すこと。旧音の停止は切替境界が担い、
    // 通常の停止と差分反映の重ね呼び出しはしないこと。
    expect(sound.switchCalls).toHaveLength(1);
    expect(sound.switchCalls[0]).toEqual(
      assignPitchGridFrequencies(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        4,
      ),
    );
    expect(sound.stopAllCalls).toBe(0);
    expect(sound.voiceCalls).toHaveLength(voiceCallsBefore);
    expectSnapshot(controller.getSnapshot(), 4, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
  });

  it('空集合の切替では文脈を作らず発音もしない', () => {
    const { controller, sound, createdSounds } = createController();
    controller.selectDimension(4);
    expect(createdSounds()).toBe(0);
    expect(sound.switchCalls).toHaveLength(0);
    expect(sound.voiceCalls).toHaveLength(0);
    expect(sound.stopAllCalls).toBe(0);
    // 次元の更新だけは保つこと。
    expectSnapshot(controller.getSnapshot(), 4, []);
  });

  it('切替の再開失敗でも集合と新次元を保ち再操作で鳴らし直せる', async () => {
    const { controller, sound } = createController();
    controller.toggle({ x: 0, y: 0 });
    sound.failNextSwitch = true;
    controller.selectDimension(4);
    await flush();
    // 巻き戻さず、声だけが外れた状態になること。
    expectSnapshot(controller.getSnapshot(), 4, [{ x: 0, y: 0 }]);
    expect(sound.voiceCount).toBe(0);
    // 次の操作で鳴らし直せること。
    const voiceCallsBefore = sound.voiceCalls.length;
    controller.toggle({ x: 1, y: 0 });
    expect(sound.voiceCalls).toHaveLength(voiceCallsBefore + 1);
    expect(sound.voiceCalls[voiceCallsBefore]).toEqual(
      assignPitchGridFrequencies(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        4,
      ),
    );
    expectSnapshot(controller.getSnapshot(), 4, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
  });

  it('同じ次元の選び直しは停止も反映もしない', () => {
    const { controller, sound } = createController();
    controller.toggle({ x: 0, y: 0 });
    const callsBefore = sound.voiceCalls.length;
    controller.selectDimension(3);
    expect(sound.stopAllCalls).toBe(0);
    expect(sound.switchCalls).toHaveLength(0);
    expect(sound.voiceCalls).toHaveLength(callsBefore);
    expectSnapshot(controller.getSnapshot(), 3, [{ x: 0, y: 0 }]);
  });

  it('格子外の操作は文脈を作らずに拒む', () => {
    const { controller, sound } = createController();
    expect(() => controller.toggle({ x: 3, y: 0 })).toThrow();
    expect(sound.voiceCalls).toHaveLength(0);
    expect(() => controller.move(0, 0)).toThrow(RangeError);
    expect(() => controller.selectDimension(2 as never)).toThrow(RangeError);
    expect(sound.stopAllCalls).toBe(0);
  });

  it('破棄後は操作を受け付けず文脈を一度だけ閉じる', async () => {
    const { controller, sound, notified } = createController();
    controller.toggle({ x: 0, y: 0 });
    await controller.dispose();
    await controller.dispose();
    expect(sound.disposeCalls).toBe(1);
    const callsBefore = sound.voiceCalls.length;
    controller.toggle({ x: 1, y: 0 });
    expect(controller.move(1, 0)).toBe(false);
    controller.selectDimension(4);
    expect(sound.voiceCalls).toHaveLength(callsBefore);
    expect(sound.stopAllCalls).toBe(0);
    expect(notified()).toBeGreaterThan(0);
  });

  it('起動前に破棄した場合は文脈を作らない', async () => {
    let created = 0;
    const controller = createPitchGridController({
      createSound: () => {
        created += 1;
        return new FakePitchGridSound();
      },
    });
    await controller.dispose();
    expect(created).toBe(0);
  });
});

describe('格子操作の単一制御器の表示用保持中一覧', () => {
  it('快照の表示用一覧は音声側の保持一覧を反映する', () => {
    const { controller, sound } = createController();
    controller.toggle({ x: 0, y: 0 });
    // 音声側の再開成立を模し、表示用の保持中一覧だけを差し替えること。
    const [assigned] = assignPitchGridFrequencies([{ x: 0, y: 0 }], 3);
    const frequency = assigned.frequency;
    sound.setSoundingForTest([{ key: '0,0', frequency }]);
    expect(controller.getSnapshot().soundingVoices).toEqual([{ key: '0,0', frequency }]);
  });

  it('選択意図と表示一覧が食い違っても混同しない', () => {
    const { controller, sound } = createController();
    controller.toggle({ x: 0, y: 0 });
    controller.toggle({ x: 1, y: 0 });
    // 再開未成立を模し、表示一覧は空のままにすること。選択意図の座標集合は
    // 保ち、表示一覧の再計算や声数の推定で埋めないこと。
    expect(controller.getSnapshot().points).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    expect(controller.getSnapshot().soundingVoices).toEqual([]);
    expect(sound.voiceCount).toBe(2);
  });

  it('音声側の内容変化通知を既存の通知へ届ける', () => {
    const { controller, sound, notified } = createController();
    controller.toggle({ x: 0, y: 0 });
    const callsBefore = notified();
    const [assigned] = assignPitchGridFrequencies([{ x: 0, y: 0 }], 3);
    const frequency = assigned.frequency;
    sound.setSoundingForTest([{ key: '0,0', frequency }]);
    // 音声側の購読が制御器の既存通知へ転送され、快照が新しい一覧を返すこと。
    expect(notified()).toBeGreaterThan(callsBefore);
    expect(controller.getSnapshot().soundingVoices).toEqual([{ key: '0,0', frequency }]);
  });

  it('破棄後は音声側の内容変化通知を届けない', async () => {
    const { controller, sound, notified } = createController();
    controller.toggle({ x: 0, y: 0 });
    await controller.dispose();
    const callsBefore = notified();
    sound.setSoundingForTest([{ key: '0,0', frequency: 220 }]);
    expect(notified()).toBe(callsBefore);
    expect(sound.soundingListenerCountForTest()).toBe(0);
  });
});
