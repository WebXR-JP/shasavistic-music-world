/**
 * 4 Cube の選択と切替の制御器の配線検査。
 *
 * ブラウザの音声文脈を使わず、演奏口の代替物で次を確かめる。4 ID と各組合せの
 * 対応、1演奏口の所有、同一 Cube の停止、別 Cube の減衰完了後切替、減衰中の
 * 選択更新、起動待ち・再開失敗・遅延終了・破棄の競合を判定対象とする。
 * 呼び出し記録だけでなく値と時刻の順序（開始が終了の後であること）まで照合し、
 * 呼び出し回数だけを合格証拠にしない。具体値はこの検査に置く。
 */

import { describe, expect, it } from 'vitest';
import type { StartHarmonicChordOptions } from '../../audio/harmonicChord';
import type { HarmonicChordSession } from '../../audio/harmonicChord';
import { HARMONIC_CHORD_SETS } from './chordSets';
import { createHarmonicCubeSwitch } from './cubeSwitch';

/** 非同期の継続を進める。固定時間の待ちではなく区切りのための譲歩である。 */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** 演奏口の代替物。声の有無と減衰完了を手動で進める。 */
class FakeChordSession implements HarmonicChordSession {
  playing = false;

  releasing = false;

  /** `start()` に渡された設定の記録。順序と対応付けの照合に使う。 */
  readonly startOptions: StartHarmonicChordOptions[] = [];

  noteOffCalls = 0;

  stopCalls = 0;

  disposeCalls = 0;

  /** `start()` の完了を手動解決にする場合に `true`。 */
  manualStart = false;

  /** 次の `start()` を失敗させる誤り。失敗後は空に戻る。 */
  failNextStart: Error | null = null;

  private disposed = false;

  private pendingStarts: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];

  private idleWaiters: Array<() => void> = [];

  async start(options: StartHarmonicChordOptions = {}): Promise<void> {
    this.startOptions.push(options);
    if (this.failNextStart !== null) {
      const failure = this.failNextStart;
      this.failNextStart = null;
      throw failure;
    }
    if (this.manualStart) {
      await new Promise<void>((resolve, reject) => {
        this.pendingStarts.push({ resolve, reject });
      });
    }
    // 破棄後の非同期完了は声を残さない。
    if (this.disposed) {
      return;
    }
    this.playing = true;
    this.releasing = false;
  }

  noteOff(): void {
    this.noteOffCalls += 1;
    if (this.playing) {
      this.releasing = true;
    }
  }

  waitForAllVoicesEnded(): Promise<void> {
    if (!this.playing && !this.releasing) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  stop(): void {
    this.stopCalls += 1;
    this.playing = false;
    this.releasing = false;
    const pendings = this.pendingStarts.splice(0);
    for (const pending of pendings) {
      pending.resolve();
    }
    const waiters = this.idleWaiters.splice(0);
    for (const resolve of waiters) {
      resolve();
    }
  }

  async dispose(): Promise<void> {
    this.disposeCalls += 1;
    this.disposed = true;
    this.playing = false;
    this.releasing = false;
    const pendings = this.pendingStarts.splice(0);
    for (const pending of pendings) {
      pending.resolve();
    }
    const waiters = this.idleWaiters.splice(0);
    for (const resolve of waiters) {
      resolve();
    }
  }

  /** 起動の完了待ちをすべて成功として進める。 */
  resolveStarts(): void {
    const pendings = this.pendingStarts.splice(0);
    for (const pending of pendings) {
      pending.resolve();
    }
  }

  /** 全声の減衰完了を模擬し、待機を解決する。 */
  endAllVoices(): void {
    this.playing = false;
    this.releasing = false;
    const waiters = this.idleWaiters.splice(0);
    for (const resolve of waiters) {
      resolve();
    }
  }
}

/** 制御器と代替物の束。 */
interface SwitchHarness {
  readonly session: FakeChordSession;
  createCalls: number;
}

function createSwitch(
  harness: SwitchHarness,
  session: FakeChordSession = harness.session,
): ReturnType<typeof createHarmonicCubeSwitch> {
  return createHarmonicCubeSwitch({
    createSession: () => {
      harness.createCalls += 1;
      return session;
    },
  });
}

function createHarness(): SwitchHarness {
  return { session: new FakeChordSession(), createCalls: 0 };
}

describe('4 Cube の選択対応と所有', () => {
  it('4 ID が各組合せの音色と比率集合に対応する', async () => {
    expect(HARMONIC_CHORD_SETS).toHaveLength(4);
    for (const chordSet of HARMONIC_CHORD_SETS) {
      const harness = createHarness();
      const cubeSwitch = createSwitch(harness);
      cubeSwitch.interact(chordSet.id);
      await flush();
      await flush();
      // 参照の一致で対応付けの破れを検出する。文言の変更でずれない。
      expect(harness.session.startOptions).toHaveLength(1);
      expect(harness.session.startOptions[0]?.preset).toBe(chordSet.preset);
      expect(harness.session.startOptions[0]?.ratios).toBe(chordSet.ratios);
      expect(cubeSwitch.getSnapshot()).toMatchObject({ status: 'playing', activeId: chordSet.id });
      await cubeSwitch.dispose();
    }
  });

  it('未知の選択では演奏口を作らずに拒む', () => {
    const harness = createHarness();
    const cubeSwitch = createSwitch(harness);
    expect(() => {
      cubeSwitch.interact('unknown-cube');
    }).toThrow('未知の Cube 選択である: unknown-cube');
    expect(harness.createCalls).toBe(0);
  });

  it('4 Cube で1つの演奏口を使い回し破棄は一度だけ行う', async () => {
    const harness = createHarness();
    const cubeSwitch = createSwitch(harness);
    const firstId = HARMONIC_CHORD_SETS[0]?.id ?? '';
    const secondId = HARMONIC_CHORD_SETS[1]?.id ?? '';
    cubeSwitch.interact(firstId);
    await flush();
    await flush();
    // 同一 Cube の停止と別 Cube の開始を経ても演奏口は一つである。
    cubeSwitch.interact(firstId);
    harness.session.endAllVoices();
    await flush();
    await flush();
    cubeSwitch.interact(secondId);
    await flush();
    await flush();
    expect(harness.createCalls).toBe(1);
    expect(harness.session.disposeCalls).toBe(0);
    await cubeSwitch.dispose();
    await cubeSwitch.dispose();
    expect(harness.session.disposeCalls).toBe(1);
  });
});

describe('同一 Cube と別 Cube の切替', () => {
  it('発音中の同一 Cube の再操作で減衰して停止する', async () => {
    const harness = createHarness();
    const cubeSwitch = createSwitch(harness);
    const cubeId = HARMONIC_CHORD_SETS[0]?.id ?? '';
    cubeSwitch.interact(cubeId);
    await flush();
    await flush();
    expect(cubeSwitch.getSnapshot()).toMatchObject({ status: 'playing', activeId: cubeId });

    cubeSwitch.interact(cubeId);
    expect(harness.session.noteOffCalls).toBe(1);
    expect(harness.session.startOptions).toHaveLength(1);
    expect(cubeSwitch.getSnapshot()).toMatchObject({
      status: 'releasing',
      activeId: cubeId,
      pendingId: null,
    });

    harness.session.endAllVoices();
    await flush();
    await flush();
    expect(cubeSwitch.getSnapshot()).toMatchObject({ status: 'stopped', activeId: null });
    // 停止のための再操作であり、新しい起動を重ねない。
    expect(harness.session.startOptions).toHaveLength(1);
    await cubeSwitch.dispose();
  });

  it('別 Cube の操作で現音を減衰し全声の終了後に選択した集合を開始する', async () => {
    const harness = createHarness();
    const cubeSwitch = createSwitch(harness);
    const firstId = HARMONIC_CHORD_SETS[0]?.id ?? '';
    const secondId = HARMONIC_CHORD_SETS[2]?.id ?? '';
    const secondSet = HARMONIC_CHORD_SETS[2];
    cubeSwitch.interact(firstId);
    await flush();
    await flush();

    cubeSwitch.interact(secondId);
    // 現音への減衰の予約であり、終了前には次を開始しない。
    expect(harness.session.noteOffCalls).toBe(1);
    expect(harness.session.startOptions).toHaveLength(1);
    expect(cubeSwitch.getSnapshot()).toMatchObject({
      status: 'releasing',
      activeId: firstId,
      pendingId: secondId,
    });

    harness.session.endAllVoices();
    await flush();
    await flush();
    expect(harness.session.startOptions).toHaveLength(2);
    expect(harness.session.startOptions[1]?.ratios).toBe(secondSet?.ratios);
    expect(cubeSwitch.getSnapshot()).toMatchObject({ status: 'playing', activeId: secondId });
    await cubeSwitch.dispose();
  });

  it('減衰中の選択更新で最後の選択だけを残す', async () => {
    const harness = createHarness();
    const cubeSwitch = createSwitch(harness);
    const firstId = HARMONIC_CHORD_SETS[0]?.id ?? '';
    const secondId = HARMONIC_CHORD_SETS[1]?.id ?? '';
    const thirdId = HARMONIC_CHORD_SETS[3]?.id ?? '';
    const thirdSet = HARMONIC_CHORD_SETS[3];
    cubeSwitch.interact(firstId);
    await flush();
    await flush();

    cubeSwitch.interact(secondId);
    cubeSwitch.interact(thirdId);
    expect(cubeSwitch.getSnapshot()).toMatchObject({ pendingId: thirdId });

    harness.session.endAllVoices();
    await flush();
    await flush();
    // 途中の選択は起動せず、最後の選択だけを開始する。
    expect(harness.session.startOptions).toHaveLength(2);
    expect(harness.session.startOptions[1]?.ratios).toBe(thirdSet?.ratios);
    expect(cubeSwitch.getSnapshot()).toMatchObject({ status: 'playing', activeId: thirdId });
    await cubeSwitch.dispose();
  });

  it('同じ選択の連打は重複予約しない', async () => {
    const harness = createHarness();
    const cubeSwitch = createSwitch(harness);
    const firstId = HARMONIC_CHORD_SETS[0]?.id ?? '';
    const secondId = HARMONIC_CHORD_SETS[1]?.id ?? '';
    cubeSwitch.interact(firstId);
    await flush();
    await flush();

    cubeSwitch.interact(secondId);
    cubeSwitch.interact(secondId);
    cubeSwitch.interact(secondId);
    expect(harness.session.startOptions).toHaveLength(1);
    expect(cubeSwitch.getSnapshot()).toMatchObject({ pendingId: secondId });

    harness.session.endAllVoices();
    await flush();
    await flush();
    expect(harness.session.startOptions).toHaveLength(2);
    await cubeSwitch.dispose();
  });
});

describe('起動待ち・失敗・破棄の競合', () => {
  it('起動の完了待ちの間の連打は一つの起動に束ね別選択だけが取り消して残る', async () => {
    const harness = createHarness();
    harness.session.manualStart = true;
    const cubeSwitch = createSwitch(harness);
    const firstId = HARMONIC_CHORD_SETS[0]?.id ?? '';
    const secondId = HARMONIC_CHORD_SETS[1]?.id ?? '';
    cubeSwitch.interact(firstId);
    await flush();
    // 同じ選択の連打は起動を重ねない。
    cubeSwitch.interact(firstId);
    expect(harness.session.startOptions).toHaveLength(1);

    // 別選択は古い起動を取り消して残る。
    cubeSwitch.interact(secondId);
    expect(harness.session.stopCalls).toBe(1);
    expect(harness.session.startOptions).toHaveLength(2);
    harness.session.resolveStarts();
    await flush();
    await flush();
    expect(cubeSwitch.getSnapshot()).toMatchObject({ status: 'playing', activeId: secondId });
    await cubeSwitch.dispose();
  });

  it('再開の失敗は切替成功と表示せず再操作を待つ', async () => {
    const harness = createHarness();
    const cubeSwitch = createSwitch(harness);
    const cubeId = HARMONIC_CHORD_SETS[0]?.id ?? '';
    harness.session.failNextStart = new Error('再開失敗');
    cubeSwitch.interact(cubeId);
    await flush();
    await flush();
    expect(cubeSwitch.getSnapshot()).toMatchObject({
      status: 'needsRetry',
      activeId: null,
      retryId: cubeId,
    });

    // 再操作で同じ選択を起動できる。
    cubeSwitch.interact(cubeId);
    await flush();
    await flush();
    expect(cubeSwitch.getSnapshot()).toMatchObject({ status: 'playing', activeId: cubeId });
    expect(harness.session.startOptions).toHaveLength(2);
    await cubeSwitch.dispose();
  });

  it('破棄後の非同期完了が古い選択を再生しない', async () => {
    const harness = createHarness();
    harness.session.manualStart = true;
    const cubeSwitch = createSwitch(harness);
    const cubeId = HARMONIC_CHORD_SETS[0]?.id ?? '';
    cubeSwitch.interact(cubeId);
    await flush();
    await cubeSwitch.dispose();
    // 破棄後に届いた起動の完了は表示を戻さない。
    harness.session.resolveStarts();
    await flush();
    await flush();
    expect(cubeSwitch.getSnapshot()).toMatchObject({ status: 'stopped', activeId: null });
    expect(harness.session.disposeCalls).toBe(1);
  });

  it('減衰完了の遅延通知が破棄後に届いても何もしない', async () => {
    const harness = createHarness();
    const cubeSwitch = createSwitch(harness);
    const cubeId = HARMONIC_CHORD_SETS[0]?.id ?? '';
    cubeSwitch.interact(cubeId);
    await flush();
    await flush();
    cubeSwitch.interact(cubeId);
    await cubeSwitch.dispose();
    // 破棄後に届いた終了通知は後続の表示を変えない。
    harness.session.endAllVoices();
    await flush();
    await flush();
    expect(cubeSwitch.getSnapshot()).toMatchObject({ status: 'stopped', activeId: null });
    expect(harness.session.startOptions).toHaveLength(1);
    expect(harness.session.disposeCalls).toBe(1);
  });

  it('起動前の破棄で演奏口を作らない', async () => {
    const harness = createHarness();
    const cubeSwitch = createSwitch(harness);
    await cubeSwitch.dispose();
    expect(harness.createCalls).toBe(0);
  });
});
