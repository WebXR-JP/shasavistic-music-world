/**
 * 正規化済み共有意図から session への意味論経路の配線検査。
 *
 * 代替の session で次を確かめる。他の発音口を生成せず単一 session を使うこと・空集合での
 * 無生成と停止・配置済み指数の伝達・解音周波数の明示・表示の実発音中継・
 * 上限拒否での部分反映なし・根と配置の変更・連続次元変更・再開失敗・
 * 停止と破棄の競合・声数を容量判定に使わないこと。具体値はこの検査に置く。
 * 意味論解決の保証は `semanticChord.test.ts` が、声仕様変換の保証は
 * `semanticChordVoices.test.ts` が、session の保証は
 * `semanticChordSound.test.ts` が所有し、複製しない。
 * ブラウザの音声文脈を使わない。
 */

import { describe, expect, it } from 'vitest';
import {
  PITCH_GRID_BASE_FREQUENCY_HZ,
  PITCH_GRID_INITIAL_INTENT,
  assignPitchGridFrequencies,
  pitchGridKey,
  pitchGridPointFromKey,
  selectPitchGridDimensionIntent,
  specifyFunctionalRootIntent,
  togglePitchGridIntent,
  type PitchGridIntent,
} from './pitchGrid';
import {
  createPitchGridSemanticSoundReflector,
  type PitchGridSemanticSoundReflector,
} from './pitchGridSemanticController';
import { toPitchGridSemanticChord } from './pitchGridSemanticChord';
import type { SemanticChordSoundSession } from './semanticChordSound';
import type { PitchGridSoundingVoice } from './pitchGridSound';
import type { SemanticChord } from './semanticChord';

/** session への反映呼び出し1件分の記録。 */
interface ReflectCall {
  /** 渡された意味論の和音。 */
  readonly chord: SemanticChord;
  /** 渡された解音周波数（Hz）。 */
  readonly frequency: number;
}

/** 保留中の反映の完了口。検査側で解決・拒否を操る。 */
interface PendingReflect {
  resolve(): void;
  reject(error: unknown): void;
}

/**
 * 検査用の session。発音口の生成・更新の有無と呼び出し内容を記録する。
 *
 * 未完了反映中の連続更新を再現するため、手動解決の待機列を持つ。
 * 失敗の再現のため、一度だけ拒む失敗も差せる。
 */
class FakeSemanticSession implements SemanticChordSoundSession {
  /** `reflect` に渡された和音と解音周波数の記録。 */
  readonly reflectCalls: ReflectCall[] = [];

  stopCalls = 0;

  disposeCalls = 0;

  /** 表示中継に載せる保持中一覧。 */
  sounding: PitchGridSoundingVoice[] = [];

  private readonly listeners = new Set<() => void>();

  private readonly pending: PendingReflect[] = [];

  private queuedFailure: unknown;

  private hasQueuedFailure = false;

  /** 手動解決の待機を使い、自動では完了させない。 */
  manual = false;

  get soundingVoices(): readonly PitchGridSoundingVoice[] {
    return [...this.sounding];
  }

  subscribeSounding(listener: () => void): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 検査用に表示用の保持中一覧を差し替えて購読者へ知らせる。
   *
   * session の再開成立・リリースなどの内容変化を模す。
   *
   * @param voices - 差し替える保持中一覧。
   */
  setSoundingForTest(voices: readonly PitchGridSoundingVoice[]): void {
    this.sounding = [...voices];
    for (const listener of [...this.listeners]) {
      listener();
    }
  }

  /** 次の反映だけこの失敗で拒む。一度だけ使う。 */
  failNextWith(error: unknown): void {
    this.queuedFailure = error;
    this.hasQueuedFailure = true;
  }

  /** 保留中の反映の完了口を古い順に返す。 */
  pendingForTest(): PendingReflect[] {
    return [...this.pending];
  }

  async reflect(chord: SemanticChord, resolutionToneFrequencyHz: number): Promise<void> {
    this.reflectCalls.push({ chord, frequency: resolutionToneFrequencyHz });
    if (this.hasQueuedFailure) {
      this.hasQueuedFailure = false;
      const failure = this.queuedFailure;
      this.queuedFailure = undefined;
      throw failure;
    }
    if (!this.manual) {
      return;
    }
    return new Promise<void>((resolve, reject) => {
      this.pending.push({
        resolve: () => {
          resolve();
        },
        reject: (error: unknown) => {
          reject(error);
        },
      });
    });
  }

  stop(): void {
    this.stopCalls += 1;
  }

  async dispose(): Promise<void> {
    this.disposeCalls += 1;
  }
}

/** 生成を数えられる検査用の束。 */
interface Harness {
  /** 反射器。 */
  readonly reflector: PitchGridSemanticSoundReflector;
  /** 差し替えた session。 */
  readonly session: FakeSemanticSession;
  /** session の生成回数。 */
  createdSessions(): number;
  /** 通知回数。 */
  notified(): number;
}

function createHarness(): Harness {
  const session = new FakeSemanticSession();
  let created = 0;
  let notifyCalls = 0;
  const reflector = createPitchGridSemanticSoundReflector({
    createSession: () => {
      created += 1;
      return session;
    },
    notify: () => {
      notifyCalls += 1;
    },
  });
  return {
    reflector,
    session,
    createdSessions: () => created,
    notified: () => notifyCalls,
  };
}

/** 非同期の継続を進める。固定時間の待ちではなく区切りのための譲歩である。 */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** 二点オンの共有意図。根は初回オン点の既定根になる。 */
function twoPointIntent(): PitchGridIntent {
  let intent = togglePitchGridIntent(PITCH_GRID_INITIAL_INTENT, { x: 0, y: 0 });
  intent = togglePitchGridIntent(intent, { x: 1, y: 0 });
  return intent;
}

/**
 * 共有意図から期待する意味論型を作る。
 *
 * 制御器と同じく配置関数の結果の `k` をそのまま使い、対応を照合する。
 */
function expectedChordOf(intent: PitchGridIntent): SemanticChord {
  const dimension = intent.dimension;
  const points = intent.onPoints.map((key) => {
    const point = pitchGridPointFromKey(key);
    if (point === null) {
      throw new Error(`検査用の意図に格子外の鍵がある: ${String(key)}`);
    }
    return point;
  });
  const assigned = assignPitchGridFrequencies(points, dimension);
  const kByKey = new Map(assigned.map((voice) => [voice.key, voice.k] as const));
  const rootPoint =
    intent.functionalRootKey === null ? null : pitchGridPointFromKey(intent.functionalRootKey);
  if (rootPoint === null) {
    throw new Error('検査用の意図に機能根がない');
  }
  return toPitchGridSemanticChord({
    dimension,
    points: points.map((point) => {
      const k = kByKey.get(pitchGridKey(point));
      if (k === undefined) {
        throw new Error(`検査用の配置に対応する点がない: ${pitchGridKey(point)}`);
      }
      return { ...point, k };
    }),
    functionalRoot: rootPoint,
  });
}

describe('経路の単一性', () => {
  it('他の発音口を作らず単一 session だけを使う', async () => {
    const { reflector, session, createdSessions } = createHarness();
    const intent = twoPointIntent();
    reflector.reflect(intent);
    await flush();

    // 反射器は session だけを使い、他の発音口の生成口を持たないこと。
    // session は反射器の生成時に一度だけ確保する。
    expect(createdSessions()).toBe(1);
    expect(session.reflectCalls).toHaveLength(1);
    expect(Object.keys(reflector).sort()).toEqual(
      ['dispose', 'getSnapshot', 'reflect', 'stop'].sort(),
    );
    // 発振器などの音声資源を公開しないこと。
    expect(Object.keys(reflector.getSnapshot()).sort()).toEqual(
      ['failureMessage', 'soundingVoices', 'voiceCount'].sort(),
    );
  });
});

describe('空集合の扱い', () => {
  it('空集合では発音口を生成せず停止する', () => {
    const { reflector, session, notified } = createHarness();
    reflector.reflect(PITCH_GRID_INITIAL_INTENT);

    // session への反映は行わず、停止だけを呼ぶこと。
    // session が発音口を遅延生成するため、発音口は作られない。
    expect(session.reflectCalls).toHaveLength(0);
    expect(session.stopCalls).toBe(1);
    expect(reflector.getSnapshot().soundingVoices).toEqual([]);
    expect(reflector.getSnapshot().failureMessage).toBeNull();
    expect(notified()).toBe(0);
  });

  it('発音後に空集合へ戻すと停止する', async () => {
    const { reflector, session } = createHarness();
    const intent = twoPointIntent();
    reflector.reflect(intent);
    await flush();
    expect(session.reflectCalls).toHaveLength(1);

    reflector.reflect(PITCH_GRID_INITIAL_INTENT);

    expect(session.reflectCalls).toHaveLength(1);
    expect(session.stopCalls).toBe(1);
  });
});

describe('組立てと解音周波数', () => {
  it('配置済みの指数を意味論型へ伝える', async () => {
    const { reflector, session } = createHarness();
    const intent = twoPointIntent();
    reflector.reflect(intent);
    await flush();

    expect(session.reflectCalls).toHaveLength(1);
    const call = session.reflectCalls[0];
    if (call === undefined) {
      throw new Error('検査用の反映記録がない');
    }
    // 配置関数の結果の `k` をそのまま組立てへ渡すこと。
    expect(call.chord).toEqual(expectedChordOf(intent));
  });

  it('解音周波数に全体音高基準を明示する', async () => {
    const { reflector, session } = createHarness();
    // 単点 `(1, 0)` の配置周波数は 660Hz であり、基準とは異なる。
    const intent = togglePitchGridIntent(PITCH_GRID_INITIAL_INTENT, { x: 1, y: 0 });
    const [assigned] = assignPitchGridFrequencies([{ x: 1, y: 0 }], 3);
    if (assigned === undefined || assigned.frequency === PITCH_GRID_BASE_FREQUENCY_HZ) {
      throw new Error('検査用の配置が基準と異なる周波数を選んでいない');
    }
    reflector.reflect(intent);
    await flush();

    expect(session.reflectCalls).toHaveLength(1);
    const call = session.reflectCalls[0];
    if (call === undefined) {
      throw new Error('検査用の反映記録がない');
    }
    // 配置が中央に選んだ周波数ではなく、全体音高基準を渡すこと。
    expect(call.frequency).toBe(PITCH_GRID_BASE_FREQUENCY_HZ);
  });

  it('共有意図を変更しない', async () => {
    const { reflector, session } = createHarness();
    const intent = twoPointIntent();
    const before = JSON.stringify(intent);
    reflector.reflect(intent);
    await flush();

    expect(session.reflectCalls).toHaveLength(1);
    expect(JSON.stringify(intent)).toBe(before);
  });
});

describe('表示中継', () => {
  it('表示は実発音一覧から更新される', async () => {
    const { reflector, session, notified } = createHarness();
    const intent = togglePitchGridIntent(PITCH_GRID_INITIAL_INTENT, { x: 0, y: 0 });
    reflector.reflect(intent);
    await flush();

    // session の再開成立を模し、実発音一覧だけを差し替えること。
    const [assigned] = assignPitchGridFrequencies([{ x: 0, y: 0 }], 3);
    if (assigned === undefined) {
      throw new Error('検査用の配置結果がない');
    }
    const callsBefore = notified();
    session.setSoundingForTest([
      { key: 'semantic:root:1/1', frequency: 440 },
      { key: 'semantic:tone:3/1', frequency: 1320 },
    ]);

    const snapshot = reflector.getSnapshot();
    expect(snapshot.soundingVoices).toEqual([
      { key: 'semantic:root:1/1', frequency: 440 },
      { key: 'semantic:tone:3/1', frequency: 1320 },
    ]);
    // 声数は一覧の長さから求める表示専用の値であること。
    expect(snapshot.voiceCount).toBe(2);
    expect(notified()).toBeGreaterThan(callsBefore);
  });

  it('選択意図と表示一覧が食い違っても混同しない', async () => {
    const { reflector, session } = createHarness();
    reflector.reflect(twoPointIntent());
    await flush();

    // 再開未成立を模し、表示一覧は空のままにすること。選択意図からの
    // 再計算や声数の推定で埋めないこと。
    expect(reflector.getSnapshot().soundingVoices).toEqual([]);
    expect(reflector.getSnapshot().voiceCount).toBe(0);
    expect(session.reflectCalls).toHaveLength(1);
  });
});

describe('上限拒否の扱い', () => {
  it('上限拒否では部分反映せず失敗を表示する', async () => {
    const { reflector, session, notified } = createHarness();
    const intent = twoPointIntent();
    reflector.reflect(intent);
    await flush();
    session.setSoundingForTest([{ key: 'semantic:root:1/1', frequency: 440 }]);
    const callsBefore = notified();

    // 上限超過の想定で session が拒む場合。新しい反映を行わず、
    // 既存の声を勝手に止めないこと。
    session.failNextWith(new RangeError('意味論の声数は同時発音の上限以下であること'));
    const added = togglePitchGridIntent(intent, { x: 0, y: 1 });
    const intentBefore = JSON.stringify(added);
    reflector.reflect(added);
    await flush();

    expect(session.reflectCalls).toHaveLength(2);
    expect(session.stopCalls).toBe(0);
    // 既存の実発音一覧は保つこと。
    expect(reflector.getSnapshot().soundingVoices).toEqual([
      { key: 'semantic:root:1/1', frequency: 440 },
    ]);
    // 失敗は握り潰さず表示へ載せて通知すること。共有意図は変えない。
    expect(reflector.getSnapshot().failureMessage).toContain('上限以下であること');
    expect(notified()).toBeGreaterThan(callsBefore);
    expect(JSON.stringify(added)).toBe(intentBefore);
  });

  it('拒否後の成功で失敗表示を消す', async () => {
    const { reflector, session } = createHarness();
    const intent = twoPointIntent();
    session.failNextWith(new RangeError('意味論の声数は同時発音の上限以下であること'));
    reflector.reflect(intent);
    await flush();
    expect(reflector.getSnapshot().failureMessage).not.toBeNull();

    reflector.reflect(intent);
    await flush();

    expect(reflector.getSnapshot().failureMessage).toBeNull();
  });
});

describe('根と配置の変更', () => {
  it('機能根の変更を組立てへ伝える', async () => {
    const { reflector, session } = createHarness();
    const intent = twoPointIntent();
    reflector.reflect(intent);
    await flush();
    const rooted = specifyFunctionalRootIntent(intent, { x: 1, y: 0 });
    reflector.reflect(rooted);
    await flush();

    expect(session.reflectCalls).toHaveLength(2);
    const first = session.reflectCalls[0];
    const second = session.reflectCalls[1];
    if (first === undefined || second === undefined) {
      throw new Error('検査用の反映記録がない');
    }
    // 同じ格子点でも根が変われば意味論型が変わること。
    expect(second.chord).toEqual(expectedChordOf(rooted));
    expect(second.chord).not.toEqual(first.chord);
    expect(second.frequency).toBe(PITCH_GRID_BASE_FREQUENCY_HZ);
  });

  it('オン点の変更で配置し直した指数を伝える', async () => {
    const { reflector, session } = createHarness();
    const intent = twoPointIntent();
    reflector.reflect(intent);
    await flush();
    const added = togglePitchGridIntent(intent, { x: 0, y: 1 });
    reflector.reflect(added);
    await flush();

    expect(session.reflectCalls).toHaveLength(2);
    const second = session.reflectCalls[1];
    if (second === undefined) {
      throw new Error('検査用の反映記録がない');
    }
    // 集合が変われば配置し直し、その `k` を組立てへ渡すこと。
    expect(second.chord).toEqual(expectedChordOf(added));
  });

  it('連続次元変更を session の切替に委ねて二重に判定しない', async () => {
    const { reflector, session } = createHarness();
    let intent = togglePitchGridIntent(PITCH_GRID_INITIAL_INTENT, { x: 0, y: 0 });
    reflector.reflect(intent);
    await flush();
    intent = selectPitchGridDimensionIntent(intent, 4);
    reflector.reflect(intent);
    await flush();
    intent = selectPitchGridDimensionIntent(intent, 5);
    reflector.reflect(intent);
    await flush();

    // 次元判定を制御器で二重に持たず、session への反映だけを行うこと。
    // 次元ごとの切替の使い分けは session が担う。
    expect(session.reflectCalls).toHaveLength(3);
    expect(session.reflectCalls.map((call) => call.chord.primaryDimension)).toEqual([3, 4, 5]);
    expect(session.stopCalls).toBe(0);
  });
});

describe('未完了反映中の連続更新', () => {
  it('古い成功が新しい判定と表示を上書きしない', async () => {
    const { reflector, session, notified } = createHarness();
    session.manual = true;
    const base = togglePitchGridIntent(PITCH_GRID_INITIAL_INTENT, { x: 0, y: 0 });
    reflector.reflect(base);
    const switched = selectPitchGridDimensionIntent(base, 4);
    reflector.reflect(switched);
    const pending = session.pendingForTest();
    expect(pending).toHaveLength(2);
    const [first, second] = pending;
    if (first === undefined || second === undefined) {
      throw new Error('検査用の保留中の反映がない');
    }

    // 新しい反映を先に完了させる。
    second.resolve();
    await flush();
    const callsAfterLatest = notified();
    expect(callsAfterLatest).toBeGreaterThan(0);
    expect(reflector.getSnapshot().failureMessage).toBeNull();

    // 古い反映の完了は新しい表示を上書きしないこと。
    first.resolve();
    await flush();
    expect(notified()).toBe(callsAfterLatest);
    expect(reflector.getSnapshot().failureMessage).toBeNull();
  });

  it('古い失敗が新しい判定と表示を上書きしない', async () => {
    const { reflector, session } = createHarness();
    session.manual = true;
    const base = togglePitchGridIntent(PITCH_GRID_INITIAL_INTENT, { x: 0, y: 0 });
    reflector.reflect(base);
    const switched = selectPitchGridDimensionIntent(base, 4);
    reflector.reflect(switched);
    const pending = session.pendingForTest();
    const [first, second] = pending;
    if (first === undefined || second === undefined) {
      throw new Error('検査用の保留中の反映がない');
    }

    second.resolve();
    await flush();
    expect(reflector.getSnapshot().failureMessage).toBeNull();

    // 古い反映の失敗は新しい判定を汚さないこと。
    first.reject(new Error('古い反映の失敗'));
    await flush();
    expect(reflector.getSnapshot().failureMessage).toBeNull();
  });

  it('新しい失敗は古い成功で消さない', async () => {
    const { reflector, session } = createHarness();
    session.manual = true;
    const base = togglePitchGridIntent(PITCH_GRID_INITIAL_INTENT, { x: 0, y: 0 });
    reflector.reflect(base);
    const switched = selectPitchGridDimensionIntent(base, 4);
    reflector.reflect(switched);
    const pending = session.pendingForTest();
    const [first, second] = pending;
    if (first === undefined || second === undefined) {
      throw new Error('検査用の保留中の反映がない');
    }

    second.reject(new Error('新しい反映の失敗'));
    await flush();
    expect(reflector.getSnapshot().failureMessage).toBe('新しい反映の失敗');

    // 古い反映の成功は新しい失敗表示を消さないこと。
    first.resolve();
    await flush();
    expect(reflector.getSnapshot().failureMessage).toBe('新しい反映の失敗');
  });
});

describe('再開失敗と回復', () => {
  it('再開失敗を伝えて再反映で鳴らし直せる', async () => {
    const { reflector, session } = createHarness();
    const intent = togglePitchGridIntent(PITCH_GRID_INITIAL_INTENT, { x: 0, y: 0 });
    reflector.reflect(intent);
    await flush();
    session.failNextWith(new Error('再開失敗'));
    const switched = selectPitchGridDimensionIntent(intent, 4);
    reflector.reflect(switched);
    await flush();

    // 声だけが外れた状態として失敗を表示し、共有意図は保つこと。
    expect(reflector.getSnapshot().failureMessage).toBe('再開失敗');

    // 次の反映で鳴らし直せること。
    const added = togglePitchGridIntent(switched, { x: 1, y: 0 });
    reflector.reflect(added);
    await flush();
    expect(session.reflectCalls).toHaveLength(3);
    const last = session.reflectCalls[2];
    if (last === undefined) {
      throw new Error('検査用の反映記録がない');
    }
    expect(last.chord).toEqual(expectedChordOf(added));
    expect(reflector.getSnapshot().failureMessage).toBeNull();
  });
});

describe('停止と破棄の競合', () => {
  it('停止は進行中の反映完了を古いものにする', async () => {
    const { reflector, session, notified } = createHarness();
    session.manual = true;
    reflector.reflect(togglePitchGridIntent(PITCH_GRID_INITIAL_INTENT, { x: 0, y: 0 }));
    const pending = session.pendingForTest();
    const [first] = pending;
    if (first === undefined) {
      throw new Error('検査用の保留中の反映がない');
    }
    const callsBefore = notified();

    reflector.stop();
    first.resolve();
    await flush();

    expect(session.stopCalls).toBe(1);
    // 停止後に届いた古い完了は表示を上書きしないこと。
    expect(notified()).toBe(callsBefore);
  });

  it('破棄後は反映を受け付けず文脈を一度だけ閉じる', async () => {
    const { reflector, session, notified } = createHarness();
    reflector.reflect(togglePitchGridIntent(PITCH_GRID_INITIAL_INTENT, { x: 0, y: 0 }));
    await flush();
    await reflector.dispose();
    await reflector.dispose();

    expect(session.disposeCalls).toBe(1);
    const callsBefore = session.reflectCalls.length;
    reflector.reflect(twoPointIntent());
    await flush();
    expect(session.reflectCalls).toHaveLength(callsBefore);
    expect(session.stopCalls).toBe(0);
    expect(notified()).toBeGreaterThan(0);
  });

  it('破棄後の未完了反映の完了は通知しない', async () => {
    const { reflector, session, notified } = createHarness();
    session.manual = true;
    reflector.reflect(togglePitchGridIntent(PITCH_GRID_INITIAL_INTENT, { x: 0, y: 0 }));
    const pending = session.pendingForTest();
    const [first] = pending;
    if (first === undefined) {
      throw new Error('検査用の保留中の反映がない');
    }
    await reflector.dispose();
    const callsBefore = notified();

    first.resolve();
    await flush();

    expect(notified()).toBe(callsBefore);
  });

  it('起動前に破棄した場合は session の破棄だけを行う', async () => {
    const { reflector, session } = createHarness();
    await reflector.dispose();

    expect(session.disposeCalls).toBe(1);
    expect(session.reflectCalls).toHaveLength(0);
    expect(session.stopCalls).toBe(0);
  });
});

describe('声数の扱い', () => {
  it('声数を容量判定に使わない', async () => {
    const { reflector, session } = createHarness();
    // 実発音一覧が上限いっぱいでも、新しい反映を session へ渡すこと。
    // 容量の検査は session が仕様数で行い、制御器は表示の声数で抑止しない。
    session.setSoundingForTest(
      Array.from({ length: 15 }, (_, index) => ({
        key: `semantic:tone:dummy/${String(index + 2)}`,
        frequency: 440,
      })),
    );
    expect(reflector.getSnapshot().voiceCount).toBe(15);

    let intent = PITCH_GRID_INITIAL_INTENT;
    for (let x = -2; x <= 2; x += 1) {
      for (let y = -1; y <= 1; y += 1) {
        intent = togglePitchGridIntent(intent, { x, y });
      }
    }
    reflector.reflect(intent);
    await flush();

    expect(session.reflectCalls).toHaveLength(1);
  });
});
