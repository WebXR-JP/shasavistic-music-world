/**
 * 実ブラウザの音声グラフから採取した標本による調波単音生成の判定。
 *
 * 配線検査（`harmonicTone.test.ts`）では代替物で呼び出しの有無だけを確かめるため、
 * 本物の `AudioContext` が係数どおりの信号を生成しているかは分からない。この検査は
 * 実ブラウザで `createHarmonicToneSession` の実コードを依存（係数計算・プリセット）
 * ごと動かし、発振器の出力にだけ触れる採取口（`AnalyserNode`）で無操作時との差・
 * 非無音・必要成分と除外成分・停止後の消音・過大振幅の有無を機械判定する。
 * 採取口は検査が用意する足場であり、ワールドの実行時挙動は変えない。
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
import { HARMONIC_PRESETS, type HarmonicPreset } from './harmonicPresets';
import type { HarmonicToneContext, HarmonicToneSession } from './harmonicTone';

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

/** 採取する基音（Hz）。上限の除外成分が測定域に入るよう高めに取る。 */
const CAPTURE_FREQUENCY_HZ = 2000;

/** 残ることを求める倍音次数（5-limit の内側）。 */
const PRESENT_PARTIALS = [1, 2, 3, 4, 5, 6, 8] as const;

/** 落ちることを求める倍音次数（7・11は上限除外、12は周波数上限除外）。 */
const ABSENT_PARTIALS = [7, 11, 12] as const;

/** 無操作時に許す実効値の上限。無音なら 0 になる。 */
const BASELINE_RMS_MAX = 0.01;

/** 発音中に求める実効値の下限。 */
const TONE_RMS_MIN = 0.05;

/** 発音中に許す実効値の上限。固定ゲインで抑えることを保証する。 */
const TONE_RMS_MAX = 0.4;

/** 時系列の頂上に許す上限（絶対値）。1 を下回り過大振幅でないことを保証する。 */
const TONE_PEAK_MAX = 0.99;

/** 停止後に許す実効値の上限（絶対値）。 */
const STOPPED_RMS_MAX = 0.05;

/** 停止後に許す実効値の上限（発音中の実効値に対する割合）。 */
const STOPPED_RMS_RATIO_MAX = 0.1;

/** 必要成分として認める水準の下限（dBFS）。無信号の底より十分に上であること。 */
const PRESENT_DB_MIN = -60;

/** 除外成分に許す水準の上限（絶対値、dBFS）。 */
const ABSENT_DB_MAX = -85;

/** 除外成分に求める落ち込み（基音成分からの差、dB）。 */
const ABSENT_DROP_DB_MIN = 30;

/** 成分測定で走査する幅（区画数）。漏れ込みを吸収するための走査であり合否ではない。 */
const PARTIAL_SEARCH_BINS = 2;

/** ブラウザ内で採取した標本。合否の判定は検査側で行い、ここには置かない。 */
interface CaptureMeasurements {
  readonly sampleRate: number;
  readonly contextState: string;
  readonly baselineRms: number;
  readonly toneRms: number;
  readonly tonePeak: number;
  readonly toneSettled: boolean;
  readonly tonePolls: number;
  readonly partialDb: Record<number, number>;
  readonly stoppedRms: number;
  readonly stopSettled: boolean;
  readonly stopPolls: number;
}

/** ブラウザへ渡す入力。採取条件は検査側の正本から一つだけ渡す。 */
interface CaptureInput {
  readonly moduleCode: string;
  readonly preset: HarmonicPreset;
  readonly frequency: number;
  readonly fftSize: number;
  readonly pollIntervalMs: number;
  readonly toneTimeoutMs: number;
  readonly stopTimeoutMs: number;
  readonly toneRmsMin: number;
  readonly stoppedRmsMax: number;
  readonly stoppedRmsRatioMax: number;
  readonly measuredPartials: number[];
  readonly searchBins: number;
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
async function loadHarmonicModuleCode(): Promise<string> {
  const sources = await Promise.all(
    ['./harmonicSpectrum.ts', './harmonicPresets.ts', './harmonicTone.ts'].map((name) =>
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
    createHarmonicToneSession(createContext: () => HarmonicToneContext): HarmonicToneSession;
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

  const createContext = (): HarmonicToneContext => ({
    destination: tap,
    get sampleRate(): number {
      return context.sampleRate;
    },
    get state(): string {
      return context.state;
    },
    resume: (): Promise<void> => context.resume(),
    close: (): Promise<void> => context.close(),
    createOscillator: () => {
      const oscillator = context.createOscillator();
      const port = {
        frequency: oscillator.frequency,
        setPeriodicWave: (wave: object): void => {
          oscillator.setPeriodicWave(wave as PeriodicWave);
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
        stop: (): void => {
          oscillator.stop();
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
    createPeriodicWave: (
      real: Float32Array,
      imag: Float32Array,
      constraints: { disableNormalization: boolean },
    ): object => context.createPeriodicWave(real, imag, constraints),
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
  const partialDbOf = (harmonic: number): number => {
    const bins = new Float32Array(tap.frequencyBinCount);
    tap.getFloatFrequencyData(bins);
    const center = Math.round((harmonic * input.frequency * input.fftSize) / context.sampleRate);
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

  const session = toneModule.createHarmonicToneSession(createContext);
  const baselineRms = rmsOf();
  await session.start({ frequency: input.frequency, preset: input.preset });
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
  const partialDb: Record<number, number> = {};
  for (const harmonic of input.measuredPartials) {
    partialDb[harmonic] = partialDbOf(harmonic);
  }
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
    tonePeak,
    toneSettled,
    tonePolls,
    partialDb,
    stoppedRms,
    stopSettled,
    stopPolls,
  };
}

describe('調波単音の音声信号採取', () => {
  it(
    '音声グラフの標本で調波スペクトルの生成を判定する',
    async () => {
      // 実コードを依存ごとそのまま実ブラウザへ送る。実行時挙動への変更は加えない。
      const moduleCode = await loadHarmonicModuleCode();
      const preset = HARMONIC_PRESETS.find((candidate) => candidate.name === 'Low-Limit Pure');
      if (preset === undefined) {
        throw new Error('採取に使うプリセットが見つからない');
      }

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
          preset,
          frequency: CAPTURE_FREQUENCY_HZ,
          fftSize: CAPTURE_FFT_SIZE,
          pollIntervalMs: CAPTURE_POLL_INTERVAL_MS,
          toneTimeoutMs: TONE_TIMEOUT_MS,
          stopTimeoutMs: STOP_TIMEOUT_MS,
          toneRmsMin: TONE_RMS_MIN,
          stoppedRmsMax: STOPPED_RMS_MAX,
          stoppedRmsRatioMax: STOPPED_RMS_RATIO_MAX,
          measuredPartials: [...PRESENT_PARTIALS, ...ABSENT_PARTIALS],
          searchBins: PARTIAL_SEARCH_BINS,
        } satisfies CaptureInput);

        const evidence = {
          scenario: 'harmonic-tone-capture',
          environment: {
            browser: `chromium/${browser.version()}`,
            sampleRateHz: measurements.sampleRate,
            contextState: measurements.contextState,
            fftSize: CAPTURE_FFT_SIZE,
            preset: preset.name,
            frequencyHz: CAPTURE_FREQUENCY_HZ,
            timeoutsMs: { tone: TONE_TIMEOUT_MS, stop: STOP_TIMEOUT_MS },
          },
          thresholds: {
            baselineRmsMax: BASELINE_RMS_MAX,
            toneRmsMin: TONE_RMS_MIN,
            toneRmsMax: TONE_RMS_MAX,
            tonePeakMax: TONE_PEAK_MAX,
            stoppedRmsMax: STOPPED_RMS_MAX,
            stoppedRmsRatioMax: STOPPED_RMS_RATIO_MAX,
            presentDbMin: PRESENT_DB_MIN,
            absentDbMax: ABSENT_DB_MAX,
            absentDropDbMin: ABSENT_DROP_DB_MIN,
          },
          measurements,
          note: '音声グラフ内の標本であり、物理出力の証明にはならない',
        };
        const evidenceDir = fileURLToPath(new URL('../../tmp/harmonic-tone-capture/', import.meta.url));
        await mkdir(evidenceDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/:/g, '-');
        await writeFile(
          `${evidenceDir}capture-${stamp}-chromium.json`,
          `${JSON.stringify(evidence, null, 2)}\n`,
        );

        // 無操作時との差：開始前は無音であること。
        expect(measurements.baselineRms).toBeLessThan(BASELINE_RMS_MAX);
        // 非無音かつ過大でない：固定ゲインの範囲に収まること。
        expect(measurements.toneRms).toBeGreaterThan(TONE_RMS_MIN);
        expect(measurements.toneRms).toBeLessThan(TONE_RMS_MAX);
        expect(measurements.tonePeak).toBeLessThan(TONE_PEAK_MAX);
        // 必要成分：上限の内側の倍音が水準を満たすこと。
        for (const harmonic of PRESENT_PARTIALS) {
          expect(
            measurements.partialDb[harmonic] ?? Number.NEGATIVE_INFINITY,
            `倍音 ${harmonic} 次`,
          ).toBeGreaterThan(PRESENT_DB_MIN);
        }
        // 除外成分：上限と周波数上限の外側が底に落ちること。
        const fundamentalDb = measurements.partialDb[1] ?? Number.NEGATIVE_INFINITY;
        for (const harmonic of ABSENT_PARTIALS) {
          const level = measurements.partialDb[harmonic] ?? Number.POSITIVE_INFINITY;
          expect(level, `倍音 ${harmonic} 次`).toBeLessThan(ABSENT_DB_MAX);
          expect(fundamentalDb - level, `倍音 ${harmonic} 次の落ち込み`).toBeGreaterThan(
            ABSENT_DROP_DB_MIN,
          );
        }
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
