/**
 * 実ブラウザの音声グラフから採取した標本による単音生成の判定。
 *
 * 配線検査（`singleTone.test.ts`）では代替物で呼び出しの有無だけを確かめるため、
 * 本物の `AudioContext` が実際に信号を生成しているかは分からない。この検査は
 * 実ブラウザで `createSingleToneSession` の実コードを動かし、発振器の出力にだけ
 * 触れる採取口（`AnalyserNode`）で無操作時との差・非無音・狙った単一音の主成分を
 * 機械判定する。採取口は検査が用意する足場であり、ワールドの実行時挙動は変えない。
 *
 * 覆う層：演奏口から実音声グラフへの信号生成（ブラウザ内の Web Audio）。
 * 覆わない層：利用者の実操作経路（`Interactable` の操作口の駆動）と物理出力。
 * 物理出力の証明にはならないため、未確認として残し、操作起点の受入れ条件は
 * 一時的な検証計画に残す。
 *
 * @packageDocumentation
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  SINGLE_TONE_FREQUENCY_HZ,
  type SingleToneContext,
  type SingleToneSession,
} from './singleTone';

/** 採取に使う実ブラウザの起動引数。発声を抑え、操作なしで文脈を開始できる形にする。 */
const CAPTURE_BROWSER_ARGS = ['--autoplay-policy=no-user-gesture-required', '--mute-audio'];

/** 採取口の周波数分解能を決める窓の大きさ。 */
const CAPTURE_FFT_SIZE = 8192;

/** 信号の出現・消失を確かめる間隔（ミリ秒）。 */
const CAPTURE_POLL_INTERVAL_MS = 100;

/** 開始後の信号の出現を待つ上限（ミリ秒）。描画の遅れを吸収するための待ちであり合否ではない。 */
const TONE_TIMEOUT_MS = 6000;

/** 停止後の信号の消失を待つ上限（ミリ秒）。描画の遅れを吸収するための待ちであり合否ではない。 */
const STOP_TIMEOUT_MS = 3000;

/** 無操作時に許す実効値の上限。無音なら 0 になる。 */
const BASELINE_RMS_MAX = 0.01;

/** 発音中に求める実効値の下限。全振幅の正弦波は約 0.707 になる。 */
const TONE_RMS_MIN = 0.2;

/** 停止後に許す実効値の上限（絶対値）。 */
const STOPPED_RMS_MAX = 0.05;

/** 停止後に許す実効値の上限（発音中の実効値に対する割合）。 */
const STOPPED_RMS_RATIO_MAX = 0.1;

/** 主成分として認める水準の下限（dBFS）。無信号の底より十分に上であること。 */
const PEAK_DB_MIN = -60;

/** 主成分の周波数に許す誤差（Hz）。採取窓1区画の約3倍に相当する。 */
const PEAK_FREQ_TOLERANCE_HZ = 15;

/** ブラウザ内で採取した標本。合否の判定は検査側で行い、ここには置かない。 */
interface CaptureMeasurements {
  readonly sampleRate: number;
  readonly contextState: string;
  readonly baselineRms: number;
  readonly toneRms: number;
  readonly toneSettled: boolean;
  readonly tonePolls: number;
  readonly peakDb: number;
  readonly peakHz: number;
  readonly stoppedRms: number;
  readonly stopSettled: boolean;
  readonly stopPolls: number;
}

/** ブラウザへ渡す入力。採取条件は検査側の正本から一つだけ渡す。 */
interface CaptureInput {
  readonly moduleCode: string;
  readonly frequency: number;
  readonly fftSize: number;
  readonly pollIntervalMs: number;
  readonly toneTimeoutMs: number;
  readonly stopTimeoutMs: number;
  readonly toneRmsMin: number;
  readonly stoppedRmsMax: number;
  readonly stoppedRmsRatioMax: number;
}

/**
 * ブラウザ内で信号を採取する手順。
 *
 * ブラウザへ送るため外側の変数は掴まない。型注釈は送る前に消える。
 * 固定の待ちでは描画の遅れと競合して不安定になるため、信号の出現と消失は
 * 期限付きで確かめる。期限内の到達可否は標本として返し、合否は検査側が決める。
 *
 * @param input - 実コードの変換結果と採取条件。
 * @returns 採取した標本。
 */
async function captureInPage(input: CaptureInput): Promise<CaptureMeasurements> {
  const moduleUrl = URL.createObjectURL(new Blob([input.moduleCode], { type: 'text/javascript' }));
  // 検査実行側の vitest が bare の動的导入を SSR 用に書き換えるため、文字列のまま
  // ブラウザへ送り、実行時に組み立てる間接导入で実コードを読む。外側の値は掴まない。
  const importModule = new Function('url', 'return import(url)') as unknown as (
    url: string,
  ) => Promise<unknown>;
  // 変換対象は検査対象と同じ出所の実コードであり、外部からの入力ではない。
  // 导入の戻り値は `unknown` になるため、演奏口の最小口だけを主張する。
  const toneModule = (await importModule(moduleUrl)) as unknown as {
    createSingleToneSession(createContext: () => SingleToneContext): SingleToneSession;
  };
  URL.revokeObjectURL(moduleUrl);

  const context = new AudioContext();
  // 採取口は信号の通り道にだけ置き、発振器の接続先や設定には触れない。
  const tap = context.createAnalyser();
  tap.fftSize = input.fftSize;
  tap.smoothingTimeConstant = 0;
  tap.connect(context.destination);

  const createContext = (): SingleToneContext => ({
    destination: {},
    get state(): string {
      return context.state;
    },
    resume: (): Promise<void> => context.resume(),
    close: (): Promise<void> => context.close(),
    createOscillator: () => {
      const oscillator = context.createOscillator();
      return {
        frequency: oscillator.frequency,
        get type(): OscillatorType {
          return oscillator.type;
        },
        set type(value: OscillatorType) {
          oscillator.type = value;
        },
        connect: (): void => {
          oscillator.connect(tap);
        },
        disconnect: (): void => {
          oscillator.disconnect();
        },
        start: (): void => {
          oscillator.start();
        },
        stop: (): void => {
          oscillator.stop();
        },
      };
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
  const peakOf = (): { peakDb: number; peakHz: number } => {
    const bins = new Float32Array(tap.frequencyBinCount);
    tap.getFloatFrequencyData(bins);
    let best = 0;
    for (let index = 1; index < bins.length; index += 1) {
      if (bins[index] > bins[best]) {
        best = index;
      }
    }
    return {
      peakDb: bins[best] ?? Number.NEGATIVE_INFINITY,
      peakHz: (best * context.sampleRate) / tap.fftSize,
    };
  };
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  const session = toneModule.createSingleToneSession(createContext);
  const baselineRms = rmsOf();
  await session.start({ frequency: input.frequency });
  let toneRms = rmsOf();
  let tonePolls = 0;
  while (toneRms < input.toneRmsMin && tonePolls * input.pollIntervalMs < input.toneTimeoutMs) {
    await sleep(input.pollIntervalMs);
    tonePolls += 1;
    toneRms = rmsOf();
  }
  const toneSettled = toneRms >= input.toneRmsMin;
  // 採取窓が信号で満たされてから測る。通過直後の読みは窓の途切れを含むため、
  // 1窓分だけ進めて読み直し、実効値と主成分の余裕を確保する。
  await sleep((1000 * input.fftSize) / context.sampleRate);
  toneRms = rmsOf();
  const stateAtTone = context.state;
  const peak = peakOf();
  session.stop();
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
    toneSettled,
    tonePolls,
    peakDb: peak.peakDb,
    peakHz: peak.peakHz,
    stoppedRms,
    stopSettled,
    stopPolls,
  };
}

describe('単音の音声信号採取', () => {
  it(
    '音声グラフの標本で単音の生成を判定する',
    async () => {
      // 実コードをそのまま実ブラウザへ送る。実行時挙動への変更は加えない。
      const source = await readFile(new URL('./singleTone.ts', import.meta.url), 'utf8');
      const moduleCode = transpileModule(source, {
        compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2020 },
      }).outputText;

      const executablePath = process.env['XRIFT_CAPTURE_CHROME'];
      let browser;
      try {
        browser = await (executablePath === undefined || executablePath === ''
          ? chromium.launch({ channel: 'chrome', args: CAPTURE_BROWSER_ARGS })
          : chromium.launch({ executablePath, args: CAPTURE_BROWSER_ARGS }));
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(
          `採取用ブラウザの起動に失敗した。Chrome の用意または XRIFT_CAPTURE_CHROME での実行体指定が必要である: ${detail}`,
        );
      }
      try {
        const page = await browser.newPage();
        await page.goto('about:blank');
        const measurements = await page.evaluate<CaptureMeasurements, CaptureInput>(captureInPage, {
          moduleCode,
          frequency: SINGLE_TONE_FREQUENCY_HZ,
          fftSize: CAPTURE_FFT_SIZE,
          pollIntervalMs: CAPTURE_POLL_INTERVAL_MS,
          toneTimeoutMs: TONE_TIMEOUT_MS,
          stopTimeoutMs: STOP_TIMEOUT_MS,
          toneRmsMin: TONE_RMS_MIN,
          stoppedRmsMax: STOPPED_RMS_MAX,
          stoppedRmsRatioMax: STOPPED_RMS_RATIO_MAX,
        } satisfies CaptureInput);

        const evidence = {
          scenario: 'single-tone-capture',
          environment: {
            browser: `chromium/${browser.version()}`,
            sampleRateHz: measurements.sampleRate,
            contextState: measurements.contextState,
            fftSize: CAPTURE_FFT_SIZE,
            timeoutsMs: { tone: TONE_TIMEOUT_MS, stop: STOP_TIMEOUT_MS },
          },
          thresholds: {
            baselineRmsMax: BASELINE_RMS_MAX,
            toneRmsMin: TONE_RMS_MIN,
            stoppedRmsMax: STOPPED_RMS_MAX,
            stoppedRmsRatioMax: STOPPED_RMS_RATIO_MAX,
            peakDbMin: PEAK_DB_MIN,
            peakFreqToleranceHz: PEAK_FREQ_TOLERANCE_HZ,
          },
          measurements,
          note: '音声グラフ内の標本であり、物理出力の証明にはならない',
        };
        const evidenceDir = fileURLToPath(new URL('../../tmp/single-tone-capture/', import.meta.url));
        await mkdir(evidenceDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/:/g, '-');
        await writeFile(
          `${evidenceDir}capture-${stamp}-chromium.json`,
          `${JSON.stringify(evidence, null, 2)}\n`,
        );

        // 無操作時との差：開始前は無音であること。
        expect(measurements.baselineRms).toBeLessThan(BASELINE_RMS_MAX);
        // 非無音：開始後は信号があること。
        expect(measurements.toneRms).toBeGreaterThan(TONE_RMS_MIN);
        // 狙った単一音の主成分：水準と周波数が期待に沿うこと。
        expect(measurements.peakDb).toBeGreaterThan(PEAK_DB_MIN);
        expect(Math.abs(measurements.peakHz - SINGLE_TONE_FREQUENCY_HZ)).toBeLessThanOrEqual(
          PEAK_FREQ_TOLERANCE_HZ,
        );
        // 停止で信号が消えること。
        expect(measurements.stoppedRms).toBeLessThan(STOPPED_RMS_MAX);
        expect(measurements.stoppedRms).toBeLessThan(measurements.toneRms * STOPPED_RMS_RATIO_MAX);
      } finally {
        await browser.close();
      }
    },
    90000,
  );
});
