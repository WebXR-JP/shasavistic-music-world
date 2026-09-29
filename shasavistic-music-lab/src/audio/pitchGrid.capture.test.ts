/**
 * 実ブラウザの音声グラフから採取した標本による格子の個別声の判定。
 *
 * 配線検査（`pitchGridSound.test.ts`）では代替物で呼び出しの有無だけを確かめるため、
 * 本物の `AudioContext` が座標どおりの信号を生成しているかは分からない。この検査は
 * 実ブラウザで `createPitchGridSound` の実コードを依存（包絡）ごと動かし、
 * 発振器の出力にだけ触れる採取口（`AnalyserNode`）で無操作時との差・非無音・
 * 予定した格子点の基音成分とノコギリ波の倍音・個別オフ後の他点の継続・
 * 停止後の消音・合成の頂上を機械判定する。
 * 採取口は検査が用意する足場であり、ワールドの実行時挙動は変えない。
 *
 * 周波数の期待値は Node 側で純粋計算（`pitchGrid`）から求め、
 * ブラウザへは鍵と周波数の対応だけを渡す。音声側が格子範囲を
 * 再判定しない境界に従い、ブラウザ側では座標の意味を解釈しない。
 *
 * 覆う層：演奏口から実音声グラフへの信号生成（ブラウザ内の Web Audio）。
 * 覆わない層：利用者の実操作経路（`Interactable` の操作口の駆動）と物理出力。
 * 物理出力の証明にはならないため、未確認として残す。
 *
 * @packageDocumentation
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { describe, expect, it } from 'vitest';
import { allPitchGridPoints, assignPitchGridFrequencies, pitchGridKey } from './pitchGrid';
import type { PitchGridAssignedVoice } from './pitchGrid';
import type { PitchGridSound, PitchGridSoundContext } from './pitchGridSound';

/** 採取に使う実ブラウザの起動引数。発声を抑え、操作なしで文脈を開始できる形にする。 */
const CAPTURE_BROWSER_ARGS = ['--autoplay-policy=no-user-gesture-required', '--mute-audio'];

/** 採取口の周波数分解能を決める窓の大きさ。 */
const CAPTURE_FFT_SIZE = 16384;

/** 信号の出現・消失を確かめる間隔（ミリ秒）。 */
const CAPTURE_POLL_INTERVAL_MS = 100;

/** 開始後の信号の出現を待つ上限（ミリ秒）。描画の遅れを吸収するための待ちであり合否ではない。 */
const TONE_TIMEOUT_MS = 6000;

/** 停止後の信号の消失を待つ上限（ミリ秒）。描画の遅れを吸収するための待ちであり合否ではない。 */
const STOP_TIMEOUT_MS = 3000;

/** 個別オフ後の減衰完了を待つ時間（ミリ秒）。リリース時間に余裕を加える。 */
const SOLO_OFF_SETTLE_MS = 900;

/** 個別オフ後の測定前に窓を満たす待ち（ミリ秒）。 */
const SOLO_WINDOW_MS = 400;

/** 採取に使う選択次元。 */
const CAPTURE_DIMENSION = 3 as const;

/** 無操作時に許す実効値の上限。無音なら 0 になる。 */
const BASELINE_RMS_MAX = 0.01;

/** 15声の発音中に求める実効値の下限。固定利得の水準に合わせる。 */
const ENSEMBLE_RMS_MIN = 0.02;

/** 発音中に許す実効値の上限。固定利得で抑えることを保証する。 */
const ENSEMBLE_RMS_MAX = 0.5;

/** 二声の発音中に求める実効値の下限。 */
const SOLO_RMS_MIN = 0.005;

/** 時系列の頂上に許す上限（絶対値）。1 を下回り過大振幅でないことを保証する。 */
const TONE_PEAK_MAX = 0.99;

/** 停止後に許す実効値の上限（絶対値）。 */
const STOPPED_RMS_MAX = 0.05;

/** 停止後に許す実効値の上限（発音中の実効値に対する割合）。 */
const STOPPED_RMS_RATIO_MAX = 0.1;

/**
 * 必要成分として認める水準の下限（dBFS）。無信号の底より十分に上であること。
 *
 * 単一声の採取と同じ水準を用いる。声ごとの固定利得でも基音は余裕を持って上回る。
 */
const PRESENT_DB_MIN = -64;

/** 除外成分に許す水準の上限（絶対値、dBFS）。 */
const ABSENT_DB_MAX = -85;

/** 除外成分に求める落ち込み（残る声の基音からの差、dB）。 */
const ABSENT_DROP_DB_MIN = 30;

/** 成分測定で走査する幅（区画数）。漏れ込みを吸収するための走査であり合否ではない。 */
const PARTIAL_SEARCH_BINS = 2;

/** ブラウザへ渡す一つの声。鍵は座標由来の不透明な文字列。 */
interface CaptureVoiceSpec {
  readonly key: string;
  readonly frequency: number;
}

/** ブラウザ内で採取した標本。合否の判定は検査側で行い、ここには置かない。 */
interface EnsembleMeasurements {
  readonly sampleRate: number;
  readonly contextState: string;
  readonly baselineRms: number;
  readonly toneRms: number;
  readonly tonePeak: number;
  readonly toneSettled: boolean;
  readonly tonePolls: number;
  readonly levelDb: Record<number, number>;
  readonly stoppedRms: number;
  readonly stopSettled: boolean;
  readonly stopPolls: number;
}

/** 個別オフとして採取した標本。合否の判定は検査側で行い、ここには置かない。 */
interface SoloOffMeasurements {
  readonly sampleRate: number;
  readonly contextState: string;
  readonly baselineRms: number;
  readonly toneRms: number;
  readonly levelDbBefore: Record<number, number>;
  readonly levelDbAfter: Record<number, number>;
  readonly stoppedRms: number;
  readonly stopSettled: boolean;
  readonly stopPolls: number;
}

/** 合奏の採取でブラウザへ渡す入力。採取条件は検査側の正本から一つだけ渡す。 */
interface EnsembleCaptureInput {
  readonly moduleCode: string;
  readonly specs: CaptureVoiceSpec[];
  readonly fftSize: number;
  readonly pollIntervalMs: number;
  readonly toneTimeoutMs: number;
  readonly stopTimeoutMs: number;
  readonly toneRmsMin: number;
  readonly stoppedRmsMax: number;
  readonly stoppedRmsRatioMax: number;
  readonly measuredFrequencies: number[];
  readonly searchBins: number;
}

/** 個別オフの採取でブラウザへ渡す入力。採取条件は検査側の正本から一つだけ渡す。 */
interface SoloOffCaptureInput {
  readonly moduleCode: string;
  readonly first: CaptureVoiceSpec;
  readonly second: CaptureVoiceSpec;
  readonly fftSize: number;
  readonly pollIntervalMs: number;
  readonly toneTimeoutMs: number;
  readonly offSettleMs: number;
  readonly windowMs: number;
  readonly stopTimeoutMs: number;
  readonly toneRmsMin: number;
  readonly stoppedRmsMax: number;
  readonly stoppedRmsRatioMax: number;
  readonly measuredFrequencies: number[];
  readonly searchBins: number;
}

/**
 * 集合単位の配置結果から鍵に対応する発音周波数を取り出す。
 *
 * 配置にない鍵は検査の組み立て誤りのため、採取前に落とす。
 *
 * @param assigned - 集合単位の配置結果。
 * @param key - 取り出す声の鍵。
 * @returns 配置で選ばれた発音周波数（Hz）。
 */
function assignedFrequencyOf(assigned: readonly PitchGridAssignedVoice[], key: string): number {
  const found = assigned.find((voice) => voice.key === key);
  if (found === undefined) {
    throw new Error(`配置にない声の鍵である: ${key}`);
  }
  return found.frequency;
}

/**
 * 実コードとその依存を一つの実行単位に束ねる。
 *
 * 実コードは分割されているため、変換結果を結合して実ブラウザへ送る。
 * 依存先の宣言は結合先の同一範囲にあり、导入文だけを取り除く。
 * 実行時挙動への変更は加えない。
 *
 * @returns 実ブラウザへ送る結合済みの実行単位。
 */
async function loadPitchGridModuleCode(): Promise<string> {
  const sources = await Promise.all(
    ['./harmonicEnvelope.ts', './pitchGridSound.ts'].map((name) =>
      readFile(new URL(name, import.meta.url), 'utf8'),
    ),
  );
  const modules = sources.map(
    (source) =>
      transpileModule(source, {
        compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2020 },
      }).outputText,
  );
  // 結合後の同一範囲に依存先の宣言があるため、导入文だけを取り除く。
  const linked = modules.map((code) =>
    code
      .split('\n')
      .filter((line) => !/^\s*import\s/.test(line))
      .join('\n'),
  );
  return linked.join('\n');
}

/**
 * ブラウザ内で合奏の信号を採取する手順。
 *
 * ブラウザへ送るため外側の変数は掴まない。型注釈は送る前に消える。
 * 固定の待ちでは描画の遅れと競合して不安定になるため、信号の出現と消失は
 * 期限付きで確かめる。期限内の到達可否は標本として返し、合否は検査側が決める。
 *
 * @param input - 実コードの変換結果と採取条件。
 * @returns 採取した標本。
 */
async function captureEnsembleInPage(input: EnsembleCaptureInput): Promise<EnsembleMeasurements> {
  const moduleUrl = URL.createObjectURL(new Blob([input.moduleCode], { type: 'text/javascript' }));
  // 検査実行側の vitest が bare の動的导入を SSR 用に書き換えるため、文字列のまま
  // ブラウザへ送り、実行時に組み立てる間接导入で実コードを読む。外側の値は掴まない。
  const importModule = new Function('url', 'return import(url)') as unknown as (
    url: string,
  ) => Promise<unknown>;
  // 変換対象は検査対象と同じ出所の実コードであり、外部からの入力ではない。
  // 导入の戻り値は `unknown` になるため、演奏口の最小口だけを主張する。
  const gridModule = (await importModule(moduleUrl)) as unknown as {
    createPitchGridSound(createContext: () => PitchGridSoundContext): PitchGridSound;
  };
  URL.revokeObjectURL(moduleUrl);

  const context = new AudioContext();
  // 採取口は信号の通り道にだけ置き、発振器の接続先や設定には触れない。
  const tap = context.createAnalyser();
  tap.fftSize = input.fftSize;
  tap.smoothingTimeConstant = 0;
  tap.connect(context.destination);

  // 代替物の接続先を実ノードへ読み替える対応付け。声の利得器は代替物であり
  // 実ノードではないため、発振器側の接続で実体へ読み替える。
  const nodeOf = new WeakMap<object, AudioNode>();
  const resolveNode = (target: object): AudioNode => nodeOf.get(target) ?? (target as AudioNode);

  const createContext = (): PitchGridSoundContext => ({
    destination: tap,
    get currentTime(): number {
      return context.currentTime;
    },
    get state(): string {
      return context.state;
    },
    resume: (): Promise<void> => context.resume(),
    close: (): Promise<void> => context.close(),
    createOscillator: () => {
      const oscillator = context.createOscillator();
      let ended: (() => void) | null = null;
      const port = {
        frequency: oscillator.frequency,
        get type(): OscillatorType {
          return oscillator.type;
        },
        set type(value: OscillatorType) {
          oscillator.type = value;
        },
        get onended(): (() => void) | null {
          return ended;
        },
        set onended(handler: (() => void) | null) {
          ended = handler;
          if (handler === null) {
            oscillator.onended = null;
          } else {
            const active: () => void = handler;
            oscillator.onended = (): void => {
              active();
            };
          }
        },
        connect: (target: object): void => {
          oscillator.connect(resolveNode(target));
        },
        disconnect: (): void => {
          oscillator.disconnect();
        },
        start: (): void => {
          oscillator.start();
        },
        stop: (when?: number): void => {
          if (when === undefined) {
            oscillator.stop();
          } else {
            oscillator.stop(when);
          }
        },
      };
      nodeOf.set(port, oscillator);
      return port;
    },
    createGain: () => {
      const gainNode = context.createGain();
      const port = {
        gain: gainNode.gain,
        connect: (target: object): void => {
          gainNode.connect(resolveNode(target));
        },
        disconnect: (): void => {
          gainNode.disconnect();
        },
      };
      nodeOf.set(port, gainNode);
      return port;
    },
  });

  const rmsOf = (): number => {
    const samples = new Float32Array(tap.fftSize);
    tap.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) {
      sum += sample * sample;
    }
    return Math.sqrt(sum / samples.length);
  };
  const peakOf = (): number => {
    const samples = new Float32Array(tap.fftSize);
    tap.getFloatTimeDomainData(samples);
    let peak = 0;
    for (const sample of samples) {
      const absolute = Math.abs(sample);
      if (absolute > peak) {
        peak = absolute;
      }
    }
    return peak;
  };
  const levelDbOf = (frequency: number): number => {
    const bins = new Float32Array(tap.frequencyBinCount);
    tap.getFloatFrequencyData(bins);
    const center = Math.round((frequency * input.fftSize) / context.sampleRate);
    let best = Number.NEGATIVE_INFINITY;
    for (
      let index = Math.max(1, center - input.searchBins);
      index <= Math.min(bins.length - 1, center + input.searchBins);
      index += 1
    ) {
      const value = bins[index] ?? Number.NEGATIVE_INFINITY;
      if (value > best) {
        best = value;
      }
    }
    return best;
  };
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  const session = gridModule.createPitchGridSound(createContext);
  const baselineRms = rmsOf();
  await session.setVoices([...input.specs]);
  let toneRms = rmsOf();
  let tonePolls = 0;
  while (toneRms < input.toneRmsMin && tonePolls * input.pollIntervalMs < input.toneTimeoutMs) {
    await sleep(input.pollIntervalMs);
    tonePolls += 1;
    toneRms = rmsOf();
  }
  const toneSettled = toneRms >= input.toneRmsMin;
  // 採取窓が信号で満たされてから測る。通過直後の読みは窓の途切れを含むため、
  // 1窓分だけ進めて読み直し、実効値と成分の余裕を確保する。
  await sleep((1000 * input.fftSize) / context.sampleRate);
  toneRms = rmsOf();
  const tonePeak = peakOf();
  const stateAtTone = context.state;
  const levelDb: Record<number, number> = {};
  for (const frequency of input.measuredFrequencies) {
    levelDb[frequency] = levelDbOf(frequency);
  }
  session.stopAll();
  let stoppedRms = rmsOf();
  let stopPolls = 0;
  while (
    (stoppedRms >= input.stoppedRmsMax || stoppedRms >= toneRms * input.stoppedRmsRatioMax) &&
    stopPolls * input.pollIntervalMs < input.stopTimeoutMs
  ) {
    await sleep(input.pollIntervalMs);
    stopPolls += 1;
    stoppedRms = rmsOf();
  }
  const stopSettled =
    stoppedRms < input.stoppedRmsMax && stoppedRms < toneRms * input.stoppedRmsRatioMax;
  await session.dispose();

  return {
    sampleRate: context.sampleRate,
    contextState: stateAtTone,
    baselineRms,
    toneRms,
    tonePeak,
    toneSettled,
    tonePolls,
    levelDb,
    stoppedRms,
    stopSettled,
    stopPolls,
  };
}

/**
 * ブラウザ内で個別オフの前後を採取する手順。
 *
 * 二声を開始し、一声だけを外した前後で成分を測る。外側の変数は掴まない。
 * 減衰の完了は固定の待ちではなく、リリース時間に余裕を加えた期限で進め、
 * 採取窓が新しい集合で満たされてから測る。合否は検査側が決める。
 *
 * @param input - 実コードの変換結果と採取条件。
 * @returns 採取した標本。
 */
async function captureSoloOffInPage(input: SoloOffCaptureInput): Promise<SoloOffMeasurements> {
  const moduleUrl = URL.createObjectURL(new Blob([input.moduleCode], { type: 'text/javascript' }));
  // 検査実行側の vitest が bare の動的导入を SSR 用に書き換えるため、文字列のまま
  // ブラウザへ送り、実行時に組み立てる間接导入で実コードを読む。外側の値は掴まない。
  const importModule = new Function('url', 'return import(url)') as unknown as (
    url: string,
  ) => Promise<unknown>;
  // 変換対象は検査対象と同じ出所の実コードであり、外部からの入力ではない。
  // 导入の戻り値は `unknown` になるため、演奏口の最小口だけを主張する。
  const gridModule = (await importModule(moduleUrl)) as unknown as {
    createPitchGridSound(createContext: () => PitchGridSoundContext): PitchGridSound;
  };
  URL.revokeObjectURL(moduleUrl);

  const context = new AudioContext();
  const tap = context.createAnalyser();
  tap.fftSize = input.fftSize;
  tap.smoothingTimeConstant = 0;
  tap.connect(context.destination);

  const nodeOf = new WeakMap<object, AudioNode>();
  const resolveNode = (target: object): AudioNode => nodeOf.get(target) ?? (target as AudioNode);

  const createContext = (): PitchGridSoundContext => ({
    destination: tap,
    get currentTime(): number {
      return context.currentTime;
    },
    get state(): string {
      return context.state;
    },
    resume: (): Promise<void> => context.resume(),
    close: (): Promise<void> => context.close(),
    createOscillator: () => {
      const oscillator = context.createOscillator();
      let ended: (() => void) | null = null;
      const port = {
        frequency: oscillator.frequency,
        get type(): OscillatorType {
          return oscillator.type;
        },
        set type(value: OscillatorType) {
          oscillator.type = value;
        },
        get onended(): (() => void) | null {
          return ended;
        },
        set onended(handler: (() => void) | null) {
          ended = handler;
          if (handler === null) {
            oscillator.onended = null;
          } else {
            const active: () => void = handler;
            oscillator.onended = (): void => {
              active();
            };
          }
        },
        connect: (target: object): void => {
          oscillator.connect(resolveNode(target));
        },
        disconnect: (): void => {
          oscillator.disconnect();
        },
        start: (): void => {
          oscillator.start();
        },
        stop: (when?: number): void => {
          if (when === undefined) {
            oscillator.stop();
          } else {
            oscillator.stop(when);
          }
        },
      };
      nodeOf.set(port, oscillator);
      return port;
    },
    createGain: () => {
      const gainNode = context.createGain();
      const port = {
        gain: gainNode.gain,
        connect: (target: object): void => {
          gainNode.connect(resolveNode(target));
        },
        disconnect: (): void => {
          gainNode.disconnect();
        },
      };
      nodeOf.set(port, gainNode);
      return port;
    },
  });

  const rmsOf = (): number => {
    const samples = new Float32Array(tap.fftSize);
    tap.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) {
      sum += sample * sample;
    }
    return Math.sqrt(sum / samples.length);
  };
  const levelDbOf = (frequency: number): number => {
    const bins = new Float32Array(tap.frequencyBinCount);
    tap.getFloatFrequencyData(bins);
    const center = Math.round((frequency * input.fftSize) / context.sampleRate);
    let best = Number.NEGATIVE_INFINITY;
    for (
      let index = Math.max(1, center - input.searchBins);
      index <= Math.min(bins.length - 1, center + input.searchBins);
      index += 1
    ) {
      const value = bins[index] ?? Number.NEGATIVE_INFINITY;
      if (value > best) {
        best = value;
      }
    }
    return best;
  };
  const levelsOf = (): Record<number, number> => {
    const levels: Record<number, number> = {};
    for (const frequency of input.measuredFrequencies) {
      levels[frequency] = levelDbOf(frequency);
    }
    return levels;
  };
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  const session = gridModule.createPitchGridSound(createContext);
  const baselineRms = rmsOf();
  await session.setVoices([{ ...input.first }, { ...input.second }]);
  let toneRms = rmsOf();
  let tonePolls = 0;
  while (toneRms < input.toneRmsMin && tonePolls * input.pollIntervalMs < input.toneTimeoutMs) {
    await sleep(input.pollIntervalMs);
    tonePolls += 1;
    toneRms = rmsOf();
  }
  // 採取窓が信号で満たされてから測る。
  await sleep((1000 * input.fftSize) / context.sampleRate);
  toneRms = rmsOf();
  const stateAtTone = context.state;
  const levelDbBefore = levelsOf();
  // 一声だけを外し、減衰完了と窓の満たしを待って測り直す。
  await session.setVoices([{ ...input.second }]);
  await sleep(input.offSettleMs);
  await sleep((1000 * input.fftSize) / context.sampleRate + input.windowMs);
  const levelDbAfter = levelsOf();
  session.stopAll();
  let stoppedRms = rmsOf();
  let stopPolls = 0;
  while (
    (stoppedRms >= input.stoppedRmsMax || stoppedRms >= toneRms * input.stoppedRmsRatioMax) &&
    stopPolls * input.pollIntervalMs < input.stopTimeoutMs
  ) {
    await sleep(input.pollIntervalMs);
    stopPolls += 1;
    stoppedRms = rmsOf();
  }
  const stopSettled =
    stoppedRms < input.stoppedRmsMax && stoppedRms < toneRms * input.stoppedRmsRatioMax;
  await session.dispose();

  return {
    sampleRate: context.sampleRate,
    contextState: stateAtTone,
    baselineRms,
    toneRms,
    levelDbBefore,
    levelDbAfter,
    stoppedRms,
    stopSettled,
    stopPolls,
  };
}

/**
 * 採取用ブラウザを起動する。
 *
 * @returns 起動したブラウザ。
 * @throws `Error` — Chrome の用意または実行体指定が必要な場合。
 */
async function launchCaptureBrowser(): Promise<{
  browser: import('playwright-core').ChromiumBrowser;
  version: string;
}> {
  const executablePath = process.env['XRIFT_CAPTURE_CHROME'];
  try {
    const browser =
      executablePath === undefined || executablePath === ''
        ? await chromium.launch({ channel: 'chrome', args: CAPTURE_BROWSER_ARGS })
        : await chromium.launch({ executablePath, args: CAPTURE_BROWSER_ARGS });
    return { browser, version: browser.version() };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `採取用ブラウザの起動に失敗した。Chrome の用意または XRIFT_CAPTURE_CHROME での実行体指定が必要である: ${detail}`,
    );
  }
}

describe('格子の個別声の音声信号採取', () => {
  it(
    '音声グラフの標本で格子の複数声の基音成分と合成頂上・停止後の消音を判定する',
    async () => {
      // 実コードを依存ごとそのまま実ブラウザへ送る。実行時挙動への変更は加えない。
      const moduleCode = await loadPitchGridModuleCode();
      // 15点すべての声を開始し、合成の頂上も同じ条件で確かめる。
      // 同時発音の周波数は集合単位の配置に従う。期待値も同じ配置から求める。
      const assigned = assignPitchGridFrequencies(allPitchGridPoints(), CAPTURE_DIMENSION);
      const specs: CaptureVoiceSpec[] = assigned.map((voice) => ({
        key: voice.key,
        frequency: voice.frequency,
      }));
      // 中央・右・上の声を区別可能な基音として測る。他声の高調波と重ならないこと。
      const centerHz = assignedFrequencyOf(assigned, pitchGridKey({ x: 0, y: 0 }));
      const rightHz = assignedFrequencyOf(assigned, pitchGridKey({ x: 1, y: 0 }));
      const upperHz = assignedFrequencyOf(assigned, pitchGridKey({ x: 0, y: 1 }));

      const { browser, version } = await launchCaptureBrowser();
      try {
        const page = await browser.newPage();
        await page.goto('about:blank');
        const measurements = await page.evaluate<EnsembleMeasurements, EnsembleCaptureInput>(
          captureEnsembleInPage,
          {
            moduleCode,
            specs,
            fftSize: CAPTURE_FFT_SIZE,
            pollIntervalMs: CAPTURE_POLL_INTERVAL_MS,
            toneTimeoutMs: TONE_TIMEOUT_MS,
            stopTimeoutMs: STOP_TIMEOUT_MS,
            toneRmsMin: ENSEMBLE_RMS_MIN,
            stoppedRmsMax: STOPPED_RMS_MAX,
            stoppedRmsRatioMax: STOPPED_RMS_RATIO_MAX,
            measuredFrequencies: [centerHz, rightHz, upperHz],
            searchBins: PARTIAL_SEARCH_BINS,
          } satisfies EnsembleCaptureInput,
        );

        const evidence = {
          scenario: 'pitch-grid-ensemble-capture',
          environment: {
            browser: `chromium/${version}`,
            sampleRateHz: measurements.sampleRate,
            contextState: measurements.contextState,
            fftSize: CAPTURE_FFT_SIZE,
            dimension: CAPTURE_DIMENSION,
            voiceCount: specs.length,
            measuredFrequenciesHz: { centerHz, rightHz, upperHz },
            timeoutsMs: { tone: TONE_TIMEOUT_MS, stop: STOP_TIMEOUT_MS },
          },
          thresholds: {
            baselineRmsMax: BASELINE_RMS_MAX,
            toneRmsMin: ENSEMBLE_RMS_MIN,
            toneRmsMax: ENSEMBLE_RMS_MAX,
            tonePeakMax: TONE_PEAK_MAX,
            stoppedRmsMax: STOPPED_RMS_MAX,
            stoppedRmsRatioMax: STOPPED_RMS_RATIO_MAX,
            presentDbMin: PRESENT_DB_MIN,
          },
          measurements,
          note: '音声グラフ内の標本であり、物理出力の証明にはならない',
        };
        const evidenceDir = fileURLToPath(new URL('../../tmp/pitch-grid-capture/', import.meta.url));
        await mkdir(evidenceDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/:/g, '-');
        await writeFile(
          `${evidenceDir}capture-${stamp}-chromium.json`,
          `${JSON.stringify(evidence, null, 2)}\n`,
        );

        // 無操作時との差：開始前は無音であること。
        expect(measurements.baselineRms).toBeLessThan(BASELINE_RMS_MAX);
        // 非無音かつ過大でない：固定利得の範囲に収まること。
        expect(measurements.toneRms).toBeGreaterThan(ENSEMBLE_RMS_MIN);
        expect(measurements.toneRms).toBeLessThan(ENSEMBLE_RMS_MAX);
        expect(measurements.tonePeak).toBeLessThan(TONE_PEAK_MAX);
        // 予定した格子点の基音：三つの声の基音が水準を満たすこと。
        for (const frequency of [centerHz, rightHz, upperHz]) {
          expect(
            measurements.levelDb[frequency] ?? Number.NEGATIVE_INFINITY,
            `${frequency}Hz`,
          ).toBeGreaterThan(PRESENT_DB_MIN);
        }
        // 停止で信号が消えること。
        expect(measurements.stoppedRms).toBeLessThan(STOPPED_RMS_MAX);
        expect(measurements.stoppedRms).toBeLessThan(measurements.toneRms * STOPPED_RMS_RATIO_MAX);
      } finally {
        await browser.close();
      }
    },
    120000,
  );

  it(
    '音声グラフの標本で個別のオフと他点の継続・全停止後の消音を判定する',
    async () => {
      const moduleCode = await loadPitchGridModuleCode();
      // 二声の同時発音は集合単位の配置に従う（単点の値とは限らない）。
      // 中央 440Hz と上 550Hz の二声。550Hz は 440Hz の低い倍音列に現れない。
      // （550/440 = 5/4 のため、一致は 2200Hz の5次・4次が最初であり測定対象外である）
      const firstPoint = { x: 0, y: 0 };
      const secondPoint = { x: 0, y: 1 };
      const pairAssigned = assignPitchGridFrequencies([firstPoint, secondPoint], CAPTURE_DIMENSION);
      const firstHz = assignedFrequencyOf(pairAssigned, pitchGridKey(firstPoint));
      const secondHz = assignedFrequencyOf(pairAssigned, pitchGridKey(secondPoint));
      // ノコギリ波の2次までの倍音として現れる次数。440Hz は第一声だけの成分である。
      const measured = [firstHz, secondHz, firstHz * 2, secondHz * 2];

      const { browser, version } = await launchCaptureBrowser();
      try {
        const page = await browser.newPage();
        await page.goto('about:blank');
        const measurements = await page.evaluate<SoloOffMeasurements, SoloOffCaptureInput>(
          captureSoloOffInPage,
          {
            moduleCode,
            first: { key: pitchGridKey(firstPoint), frequency: firstHz },
            second: { key: pitchGridKey(secondPoint), frequency: secondHz },
            fftSize: CAPTURE_FFT_SIZE,
            pollIntervalMs: CAPTURE_POLL_INTERVAL_MS,
            toneTimeoutMs: TONE_TIMEOUT_MS,
            offSettleMs: SOLO_OFF_SETTLE_MS,
            windowMs: SOLO_WINDOW_MS,
            stopTimeoutMs: STOP_TIMEOUT_MS,
            toneRmsMin: SOLO_RMS_MIN,
            stoppedRmsMax: STOPPED_RMS_MAX,
            stoppedRmsRatioMax: STOPPED_RMS_RATIO_MAX,
            measuredFrequencies: measured,
            searchBins: PARTIAL_SEARCH_BINS,
          } satisfies SoloOffCaptureInput,
        );

        const evidence = {
          scenario: 'pitch-grid-solo-off-capture',
          environment: {
            browser: `chromium/${version}`,
            sampleRateHz: measurements.sampleRate,
            contextState: measurements.contextState,
            fftSize: CAPTURE_FFT_SIZE,
            dimension: CAPTURE_DIMENSION,
            firstHz,
            secondHz,
            offSettleMs: SOLO_OFF_SETTLE_MS,
            timeoutsMs: { tone: TONE_TIMEOUT_MS, stop: STOP_TIMEOUT_MS },
          },
          thresholds: {
            baselineRmsMax: BASELINE_RMS_MAX,
            toneRmsMin: SOLO_RMS_MIN,
            stoppedRmsMax: STOPPED_RMS_MAX,
            stoppedRmsRatioMax: STOPPED_RMS_RATIO_MAX,
            presentDbMin: PRESENT_DB_MIN,
            absentDbMax: ABSENT_DB_MAX,
            absentDropDbMin: ABSENT_DROP_DB_MIN,
          },
          measurements,
          note: '音声グラフ内の標本であり、物理出力の証明にはならない',
        };
        const evidenceDir = fileURLToPath(new URL('../../tmp/pitch-grid-capture/', import.meta.url));
        await mkdir(evidenceDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/:/g, '-');
        await writeFile(
          `${evidenceDir}capture-${stamp}-chromium.json`,
          `${JSON.stringify(evidence, null, 2)}\n`,
        );

        // 二声の開始：基音とノコギリ波の倍音が現れること。
        expect(measurements.baselineRms).toBeLessThan(BASELINE_RMS_MAX);
        expect(measurements.toneRms).toBeGreaterThan(SOLO_RMS_MIN);
        for (const frequency of measured) {
          expect(
            measurements.levelDbBefore[frequency] ?? Number.NEGATIVE_INFINITY,
            `開始時の${frequency}Hz`,
          ).toBeGreaterThan(PRESENT_DB_MIN);
        }
        const secondBefore = measurements.levelDbBefore[secondHz] ?? Number.NEGATIVE_INFINITY;
        // 個別のオフ：外した声の基音とその倍音だけが底に落ちること。
        for (const frequency of [firstHz, firstHz * 2]) {
          const level = measurements.levelDbAfter[frequency] ?? Number.POSITIVE_INFINITY;
          expect(level, `終了後の${frequency}Hz`).toBeLessThan(ABSENT_DB_MAX);
          expect(secondBefore - level, `${frequency}Hzの落ち込み`).toBeGreaterThan(
            ABSENT_DROP_DB_MIN,
          );
        }
        // 他点の継続：残した声の基音とその倍音は水準を保つこと。
        for (const frequency of [secondHz, secondHz * 2]) {
          expect(
            measurements.levelDbAfter[frequency] ?? Number.NEGATIVE_INFINITY,
            `継続中の${frequency}Hz`,
          ).toBeGreaterThan(PRESENT_DB_MIN);
        }
        // 全停止で信号が消えること。
        expect(measurements.stoppedRms).toBeLessThan(STOPPED_RMS_MAX);
        expect(measurements.stoppedRms).toBeLessThan(measurements.toneRms * STOPPED_RMS_RATIO_MAX);
      } finally {
        await browser.close();
      }
    },
    120000,
  );
});
