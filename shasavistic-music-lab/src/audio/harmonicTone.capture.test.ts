/**
 * 実ブラウザの音声グラフから採取した標本による調波単音生成と包絡の判定。
 *
 * 配線検査（`harmonicTone.test.ts`）では代替物で呼び出しの有無だけを確かめるため、
 * 本物の `AudioContext` が係数どおりの信号を生成しているかは分からない。この検査は
 * 実ブラウザで `createHarmonicToneSession` の実コードを依存（係数計算・プリセット・
 * 包絡）ごと動かし、発振器の出力にだけ触れる採取口（`AnalyserNode`）で無操作時との差・
 * 非無音・必要成分と除外成分・停止後の消音・過大振幅の有無を機械判定する。
 * 包絡の検査では時系列に広げ、立ち上がり・減衰・持続・消音への推移と途中ノートオフ時の
 * 接続を音声標本で判定する。
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
import { HARMONIC_ENVELOPE_DEFAULTS } from './harmonicEnvelope';
import { HARMONIC_PRESETS, type HarmonicPreset } from './harmonicPresets';
import type { HarmonicToneContext, HarmonicToneSession } from './harmonicTone';

/** 採取に使う実ブラウザの起動引数。発声を抑え、操作なしで文脈を開始できる形にする。 */
const CAPTURE_BROWSER_ARGS = ['--autoplay-policy=no-user-gesture-required', '--mute-audio'];

/** 採取口の周波数分解能を決める窓の大きさ。 */
const CAPTURE_FFT_SIZE = 16384;

/** 包絡の時系列を追う窓の大きさ。時間分解能を優先して小さく取る。 */
const ENVELOPE_FFT_SIZE = 4096;

/** 信号の出現・消失を確かめる間隔（ミリ秒）。 */
const CAPTURE_POLL_INTERVAL_MS = 100;

/** 包絡の時系列を追う間隔（ミリ秒）。 */
const ENVELOPE_SAMPLE_INTERVAL_MS = 50;

/** 持続区間の開始余裕（秒）。減衰完了（アタック＋ディケイ）後の標本だけを使う。 */
const ENVELOPE_SUSTAIN_MARGIN_S = 0.1;

/** 持続区間の採取幅（秒）。減衰完了＋余裕からこの幅だけ音声時刻が進むまで追う。 */
const ENVELOPE_SUSTAIN_COVER_S = 0.4;

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

/** 持続中に求める実効値の下限。最大からの減衰後も可聴であること。 */
const SUSTAIN_RMS_MIN = 0.03;

/** 立ち上がりの途上が持続平均を下回る割合。無音からの上昇を示すこと。 */
const ATTACK_EARLY_RATIO_MAX = 0.85;

/** 頂上が持続平均を上回る割合。減衰前の到達を示すこと。 */
const ENVELOPE_PEAK_RATIO_MIN = 1.03;

/** 持続の標本が平均から外れてよい割合。安定していること。 */
const SUSTAIN_DEVIATION_RATIO_MAX = 0.4;

/** 減衰直後の実効値が持続平均を上回ってよい割合。跳ね上がりがないこと。 */
const RELEASE_FIRST_RATIO_MAX = 1.15;

/** 減衰直後の実効値が持続平均を下回ってよい下限。即時切断でないこと。 */
const RELEASE_FIRST_RATIO_MIN = 0.25;

/** 時系列の頂上に許す上限（絶対値）。1 を下回り過大振幅でないことを保証する。 */
const TONE_PEAK_MAX = 0.99;

/** 停止後に許す実効値の上限（絶対値）。 */
const STOPPED_RMS_MAX = 0.05;

/** 停止後に許す実効値の上限（発音中の実効値に対する割合）。 */
const STOPPED_RMS_RATIO_MAX = 0.1;

/** 途中ノートオフ直後の窓に許す最大の段差（絶対値）。粗い不連続がないこと。 */
const NOTE_OFF_JUMP_MAX = 0.4;

/**
 * 必要成分として認める水準の下限（dBFS）。無信号の底より十分に上であること。
 *
 * 持続利得は最大利得の0.7倍（約-3dB）のため、最大基準の-60から測定の余裕を
 * 含めて3dB下げている。除外成分の底（-150dBFS付近）とは90dB以上の差がある。
 */
const PRESENT_DB_MIN = -64;

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

/** 包絡の時系列として採取した標本。合否の判定は検査側で行い、ここには置かない。 */
interface EnvelopeMeasurements {
  readonly sampleRate: number;
  readonly contextState: string;
  readonly earlyRms: number;
  readonly peakRms: number;
  readonly sustainMean: number;
  readonly sustainMaxDeviation: number;
  readonly releaseFirstRms: number;
  readonly releaseMidRms: number;
  readonly stoppedRms: number;
  readonly stopSettled: boolean;
  readonly stopPolls: number;
  readonly playingAfterRelease: boolean;
  readonly releasingAfterRelease: boolean;
  /** 持続区間の音声時刻に到達したか。未達でも標本は返し、合否は検査側が決める。 */
  readonly settleReached: boolean;
  /** 音声時刻付きで採取した標本数。 */
  readonly timedSamples: number;
}

/** 途中ノートオフとして採取した標本。合否の判定は検査側で行い、ここには置かない。 */
interface MidNoteOffMeasurements {
  readonly sampleRate: number;
  readonly contextState: string;
  readonly baselineRms: number;
  readonly preRms: number;
  readonly preJump: number;
  readonly postJump: number;
  readonly postRms: number;
  readonly midRms: number;
  readonly stoppedRms: number;
  readonly stopSettled: boolean;
  readonly stopPolls: number;
  readonly playingAfterRelease: boolean;
  readonly releasingAfterRelease: boolean;
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

/** 包絡の採取でブラウザへ渡す入力。採取条件は検査側の正本から一つだけ渡す。 */
interface EnvelopeCaptureInput {
  readonly moduleCode: string;
  readonly preset: HarmonicPreset;
  readonly frequency: number;
  readonly fftSize: number;
  readonly sampleIntervalMs: number;
  readonly attackTimeS: number;
  readonly decayTimeS: number;
  readonly sustainMarginS: number;
  readonly sustainCoverS: number;
  readonly settleTimeoutMs: number;
  readonly pollIntervalMs: number;
  readonly stopTimeoutMs: number;
  readonly stoppedRmsMax: number;
  readonly stoppedRmsRatioMax: number;
}

/** 途中ノートオフの採取でブラウザへ渡す入力。採取条件は検査側の正本から一つだけ渡す。 */
interface MidNoteOffCaptureInput {
  readonly moduleCode: string;
  readonly preset: HarmonicPreset;
  readonly frequency: number;
  readonly fftSize: number;
  readonly noteOffDelayMs: number;
  readonly midDelayMs: number;
  readonly pollIntervalMs: number;
  readonly stopTimeoutMs: number;
  readonly stoppedRmsMax: number;
  readonly stoppedRmsRatioMax: number;
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
    ['./harmonicSpectrum.ts', './harmonicPresets.ts', './harmonicEnvelope.ts', './harmonicTone.ts'].map(
      (name) => readFile(new URL(name, import.meta.url), 'utf8'),
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

/**
 * 包絡の時系列を採取する手順。
 *
 * 立ち上がりの途中から持続までを追い、ノートオフ後の減衰と消音への
 * 推移を同じ採取口で測る。外側の変数は掴まない。合否は検査側が決める。
 *
 * 各標本に音声時刻を添え、立ち上がり・持続の区間を音声時刻で選ぶ。
 * 壁時計の固定回数だけでは負荷時の描画遅れで減衰前の区間を取り違えるため、
 * 持続区間の音声時刻に進むまで期限付きで追う。期限内の到達可否は標本として
 * 返し、合否は検査側が決める。
 *
 * @param input - 実コードの変換結果と採取条件。
 * @returns 採取した標本。
 */
async function captureEnvelopeInPage(input: EnvelopeCaptureInput): Promise<EnvelopeMeasurements> {
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
  const tap = context.createAnalyser();
  tap.fftSize = input.fftSize;
  tap.smoothingTimeConstant = 0;
  tap.connect(context.destination);

  const nodeOf = new WeakMap<object, AudioNode>();
  const resolveNode = (target: object): AudioNode => nodeOf.get(target) ?? (target as AudioNode);

  const createContext = (): HarmonicToneContext => ({
    destination: tap,
    get sampleRate(): number {
      return context.sampleRate;
    },
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
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  const session = toneModule.createHarmonicToneSession(createContext);
  // 発音開始の音声時刻を掴む。予約はこの直後の現在時刻を基準に行われる。
  const noteOnAudioTime = context.currentTime;
  await session.start({ frequency: input.frequency, preset: input.preset });
  // 立ち上がりと減衰を音声時刻で横断して持続まで追う時系列。
  const sustainStart = input.attackTimeS + input.decayTimeS;
  const timed: Array<{ audioTime: number; rms: number }> = [];
  const sampleStartWall = Date.now();
  let settleReached = false;
  while (Date.now() - sampleStartWall < input.settleTimeoutMs) {
    await sleep(input.sampleIntervalMs);
    const sample = { audioTime: context.currentTime - noteOnAudioTime, rms: rmsOf() };
    timed.push(sample);
    if (sample.audioTime >= sustainStart + input.sustainCoverS) {
      settleReached = true;
      break;
    }
  }
  // 立ち上がりの途中（アタックの半ば）に最も近い標本を早期読みとする。
  const earlyTarget = input.attackTimeS / 2;
  let earlyRms = timed[0]?.rms ?? 0;
  let earlyDistance = Number.POSITIVE_INFINITY;
  for (const sample of timed) {
    const distance = Math.abs(sample.audioTime - earlyTarget);
    if (distance < earlyDistance) {
      earlyDistance = distance;
      earlyRms = sample.rms;
    }
  }
  const series = timed.map((sample) => sample.rms);
  let peakRms = 0;
  for (const value of series) {
    if (value > peakRms) {
      peakRms = value;
    }
  }
  // 持続は減衰完了＋余裕より後の標本だけを使う。区間に届かなければ
  // 末尾の標本で代え、持続の低さとして検査側の判定に掛ける。
  const sustainRegion = timed.filter(
    (sample) => sample.audioTime >= sustainStart + input.sustainMarginS,
  );
  const sustainSource =
    sustainRegion.length > 0 ? sustainRegion.slice(-4) : timed.slice(-4);
  const sustainSamples = sustainSource.map((sample) => sample.rms);
  let sustainMean = 0;
  for (const value of sustainSamples) {
    sustainMean += value;
  }
  sustainMean /= sustainSamples.length > 0 ? sustainSamples.length : 1;
  let sustainMaxDeviation = 0;
  for (const value of sustainSamples) {
    const deviation = Math.abs(value - sustainMean);
    if (deviation > sustainMaxDeviation) {
      sustainMaxDeviation = deviation;
    }
  }
  const stateAtTone = context.state;
  const noteOffAudioTime = context.currentTime;
  session.noteOff();
  // 減衰の読みも音声時刻の進行で確かめる。壁時計だけでは描画遅れで
  // 減衰前の標本を直後読みに混ぜるため、期限付きで進行を待つ。
  const waitAudioAdvance = async (fromAudioTime: number, advanceS: number): Promise<void> => {
    const waitStart = Date.now();
    while (
      context.currentTime - fromAudioTime < advanceS &&
      Date.now() - waitStart < input.settleTimeoutMs
    ) {
      await sleep(input.pollIntervalMs);
    }
  };
  await waitAudioAdvance(noteOffAudioTime, input.sampleIntervalMs / 1000);
  const releaseFirstRms = rmsOf();
  await waitAudioAdvance(noteOffAudioTime, (input.sampleIntervalMs * 4) / 1000);
  const releaseMidRms = rmsOf();
  let stoppedRms = rmsOf();
  let stopPolls = 0;
  // 消音の標本と終了通知の到達を同じ期限で待つ。標本だけが先に消えても
  // 終了通知の到達前には声の状態が残るため、両方の到達を確かめる。
  while (
    (stoppedRms >= input.stoppedRmsMax ||
      stoppedRms >= sustainMean * input.stoppedRmsRatioMax ||
      session.playing ||
      session.releasing) &&
    stopPolls * input.pollIntervalMs < input.stopTimeoutMs
  ) {
    await sleep(input.pollIntervalMs);
    stopPolls += 1;
    stoppedRms = rmsOf();
  }
  const stopSettled =
    stoppedRms < input.stoppedRmsMax && stoppedRms < sustainMean * input.stoppedRmsRatioMax;
  const playingAfterRelease = session.playing;
  const releasingAfterRelease = session.releasing;
  await session.dispose();

  return {
    sampleRate: context.sampleRate,
    contextState: stateAtTone,
    earlyRms,
    peakRms,
    sustainMean,
    sustainMaxDeviation,
    releaseFirstRms,
    releaseMidRms,
    stoppedRms,
    stopSettled,
    stopPolls,
    playingAfterRelease,
    releasingAfterRelease,
    settleReached,
    timedSamples: timed.length,
  };
}

/**
 * 途中ノートオフの接続を採取する手順。
 *
 * 立ち上がりの途中でノートオフし、直後の窓の段差と減衰の推移を測る。
 * 外側の変数は掴まない。合否は検査側が決める。
 *
 * @param input - 実コードの変換結果と採取条件。
 * @returns 採取した標本。
 */
async function captureMidNoteOffInPage(
  input: MidNoteOffCaptureInput,
): Promise<MidNoteOffMeasurements> {
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
  const tap = context.createAnalyser();
  tap.fftSize = input.fftSize;
  tap.smoothingTimeConstant = 0;
  tap.connect(context.destination);

  const nodeOf = new WeakMap<object, AudioNode>();
  const resolveNode = (target: object): AudioNode => nodeOf.get(target) ?? (target as AudioNode);

  const createContext = (): HarmonicToneContext => ({
    destination: tap,
    get sampleRate(): number {
      return context.sampleRate;
    },
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
  const maxJumpOf = (): number => {
    const samples = new Float32Array(tap.fftSize);
    tap.getFloatTimeDomainData(samples);
    let jump = 0;
    for (let index = 1; index < samples.length; index += 1) {
      const difference = Math.abs((samples[index] ?? 0) - (samples[index - 1] ?? 0));
      if (difference > jump) {
        jump = difference;
      }
    }
    return jump;
  };
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  const session = toneModule.createHarmonicToneSession(createContext);
  const baselineRms = rmsOf();
  await session.start({ frequency: input.frequency, preset: input.preset });
  // 立ち上がりの途中でノートオフする。
  await sleep(input.noteOffDelayMs);
  const preRms = rmsOf();
  const preJump = maxJumpOf();
  const stateAtTone = context.state;
  session.noteOff();
  const postJump = maxJumpOf();
  const postRms = rmsOf();
  await sleep(input.midDelayMs);
  const midRms = rmsOf();
  let stoppedRms = rmsOf();
  let stopPolls = 0;
  // 消音の標本と終了通知の到達を同じ期限で待つ。標本だけが先に消えても
  // 終了通知の到達前には声の状態が残るため、両方の到達を確かめる。
  while (
    (stoppedRms >= input.stoppedRmsMax ||
      stoppedRms >= preRms * input.stoppedRmsRatioMax ||
      session.playing ||
      session.releasing) &&
    stopPolls * input.pollIntervalMs < input.stopTimeoutMs
  ) {
    await sleep(input.pollIntervalMs);
    stopPolls += 1;
    stoppedRms = rmsOf();
  }
  const stopSettled =
    stoppedRms < input.stoppedRmsMax && stoppedRms < preRms * input.stoppedRmsRatioMax;
  const playingAfterRelease = session.playing;
  const releasingAfterRelease = session.releasing;
  await session.dispose();

  return {
    sampleRate: context.sampleRate,
    contextState: stateAtTone,
    baselineRms,
    preRms,
    preJump,
    postJump,
    postRms,
    midRms,
    stoppedRms,
    stopSettled,
    stopPolls,
    playingAfterRelease,
    releasingAfterRelease,
  };
}

/**
 * 採取用ブラウザを起動する。
 *
 * @returns 起動したブラウザ。
 * @throws `Error` — Chrome の用意または実行体指定が必要な場合。
 */
async function launchCaptureBrowser(): Promise<{ browser: import('playwright-core').ChromiumBrowser; version: string }> {
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

      const { browser, version } = await launchCaptureBrowser();
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
            browser: `chromium/${version}`,
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

  it(
    '音声グラフの時系列で包絡の立ち上がり・持続・減衰と消音を判定する',
    async () => {
      const moduleCode = await loadHarmonicModuleCode();
      const preset = HARMONIC_PRESETS.find((candidate) => candidate.name === 'Low-Limit Pure');
      if (preset === undefined) {
        throw new Error('採取に使うプリセットが見つからない');
      }

      const { browser, version } = await launchCaptureBrowser();
      try {
        const page = await browser.newPage();
        await page.goto('about:blank');
        const measurements = await page.evaluate<EnvelopeMeasurements, EnvelopeCaptureInput>(
          captureEnvelopeInPage,
          {
            moduleCode,
            preset,
            frequency: CAPTURE_FREQUENCY_HZ,
            fftSize: ENVELOPE_FFT_SIZE,
            sampleIntervalMs: ENVELOPE_SAMPLE_INTERVAL_MS,
            attackTimeS: HARMONIC_ENVELOPE_DEFAULTS.attackTime,
            decayTimeS: HARMONIC_ENVELOPE_DEFAULTS.decayTime,
            sustainMarginS: ENVELOPE_SUSTAIN_MARGIN_S,
            sustainCoverS: ENVELOPE_SUSTAIN_COVER_S,
            settleTimeoutMs: TONE_TIMEOUT_MS,
            pollIntervalMs: CAPTURE_POLL_INTERVAL_MS,
            stopTimeoutMs: STOP_TIMEOUT_MS,
            stoppedRmsMax: STOPPED_RMS_MAX,
            stoppedRmsRatioMax: STOPPED_RMS_RATIO_MAX,
          } satisfies EnvelopeCaptureInput,
        );

        const evidence = {
          scenario: 'harmonic-envelope-capture',
          environment: {
            browser: `chromium/${version}`,
            sampleRateHz: measurements.sampleRate,
            contextState: measurements.contextState,
            fftSize: ENVELOPE_FFT_SIZE,
            preset: preset.name,
            frequencyHz: CAPTURE_FREQUENCY_HZ,
          },
          thresholds: {
            sustainRmsMin: SUSTAIN_RMS_MIN,
            attackEarlyRatioMax: ATTACK_EARLY_RATIO_MAX,
            envelopePeakRatioMin: ENVELOPE_PEAK_RATIO_MIN,
            sustainDeviationRatioMax: SUSTAIN_DEVIATION_RATIO_MAX,
            releaseFirstRatioMax: RELEASE_FIRST_RATIO_MAX,
            releaseFirstRatioMin: RELEASE_FIRST_RATIO_MIN,
            stoppedRmsMax: STOPPED_RMS_MAX,
            stoppedRmsRatioMax: STOPPED_RMS_RATIO_MAX,
          },
          measurements,
          note: '音声グラフ内の標本であり、物理出力の証明にはならない',
        };
        const evidenceDir = fileURLToPath(
          new URL('../../tmp/harmonic-envelope-capture/', import.meta.url),
        );
        await mkdir(evidenceDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/:/g, '-');
        await writeFile(
          `${evidenceDir}capture-${stamp}-chromium.json`,
          `${JSON.stringify(evidence, null, 2)}\n`,
        );

        // 立ち上がり：途中の読みは持続平均を下回り、無音から上昇すること。
        expect(measurements.sustainMean).toBeGreaterThan(SUSTAIN_RMS_MIN);
        expect(measurements.earlyRms).toBeLessThan(
          measurements.sustainMean * ATTACK_EARLY_RATIO_MAX,
        );
        // 到達と減衰：頂上は持続平均を上回ること。
        expect(measurements.peakRms).toBeGreaterThan(
          measurements.sustainMean * ENVELOPE_PEAK_RATIO_MIN,
        );
        // 持続：末尾の標本は平均の近くに留まること。
        expect(measurements.sustainMaxDeviation).toBeLessThan(
          measurements.sustainMean * SUSTAIN_DEVIATION_RATIO_MAX,
        );
        // 減衰：直後は跳ね上がらず、即時切断でもないこと。
        expect(measurements.releaseFirstRms).toBeLessThan(
          measurements.sustainMean * RELEASE_FIRST_RATIO_MAX,
        );
        expect(measurements.releaseFirstRms).toBeGreaterThan(
          measurements.sustainMean * RELEASE_FIRST_RATIO_MIN,
        );
        // 減衰の途中はさらに下がること。
        expect(measurements.releaseMidRms).toBeLessThan(measurements.releaseFirstRms);
        // 消音：減衰完了後は信号が消え、声の状態も戻ること。
        expect(measurements.stoppedRms).toBeLessThan(STOPPED_RMS_MAX);
        expect(measurements.stoppedRms).toBeLessThan(
          measurements.sustainMean * STOPPED_RMS_RATIO_MAX,
        );
        expect(measurements.playingAfterRelease).toBe(false);
        expect(measurements.releasingAfterRelease).toBe(false);
      } finally {
        await browser.close();
      }
    },
    90000,
  );

  it(
    '音声グラフの標本で途中ノートオフの接続と減衰完了を判定する',
    async () => {
      const moduleCode = await loadHarmonicModuleCode();
      const preset = HARMONIC_PRESETS.find((candidate) => candidate.name === 'Low-Limit Pure');
      if (preset === undefined) {
        throw new Error('採取に使うプリセットが見つからない');
      }

      const { browser, version } = await launchCaptureBrowser();
      try {
        const page = await browser.newPage();
        await page.goto('about:blank');
        const measurements = await page.evaluate<MidNoteOffMeasurements, MidNoteOffCaptureInput>(
          captureMidNoteOffInPage,
          {
            moduleCode,
            preset,
            frequency: CAPTURE_FREQUENCY_HZ,
            fftSize: ENVELOPE_FFT_SIZE,
            noteOffDelayMs: 40,
            midDelayMs: 200,
            pollIntervalMs: CAPTURE_POLL_INTERVAL_MS,
            stopTimeoutMs: STOP_TIMEOUT_MS,
            stoppedRmsMax: STOPPED_RMS_MAX,
            stoppedRmsRatioMax: STOPPED_RMS_RATIO_MAX,
          } satisfies MidNoteOffCaptureInput,
        );

        const evidence = {
          scenario: 'harmonic-mid-noteoff-capture',
          environment: {
            browser: `chromium/${version}`,
            sampleRateHz: measurements.sampleRate,
            contextState: measurements.contextState,
            fftSize: ENVELOPE_FFT_SIZE,
            preset: preset.name,
            frequencyHz: CAPTURE_FREQUENCY_HZ,
          },
          thresholds: {
            baselineRmsMax: BASELINE_RMS_MAX,
            noteOffJumpMax: NOTE_OFF_JUMP_MAX,
            stoppedRmsMax: STOPPED_RMS_MAX,
            stoppedRmsRatioMax: STOPPED_RMS_RATIO_MAX,
          },
          measurements,
          note: '音声グラフ内の標本であり、物理出力の証明にはならない',
        };
        const evidenceDir = fileURLToPath(
          new URL('../../tmp/harmonic-mid-noteoff-capture/', import.meta.url),
        );
        await mkdir(evidenceDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/:/g, '-');
        await writeFile(
          `${evidenceDir}capture-${stamp}-chromium.json`,
          `${JSON.stringify(evidence, null, 2)}\n`,
        );

        // 立ち上がりの途中で信号があること。
        expect(measurements.baselineRms).toBeLessThan(BASELINE_RMS_MAX);
        expect(measurements.preRms).toBeGreaterThan(measurements.baselineRms);
        // 接続点に粗い不連続がないこと。直後の窓は切断前の標本を主に含むため、
        // 段差は滑らかな波形の範囲に留まる。不連続の有無は前後の段差の記録で残す。
        expect(measurements.postJump).toBeLessThan(NOTE_OFF_JUMP_MAX);
        // 減衰の途中はまだ信号が残り、完了後は消音すること。
        // 即時切断では途中も消音と同じになるため、この差で取り違えを検出する。
        expect(measurements.midRms).toBeGreaterThan(measurements.stoppedRms);
        expect(measurements.stoppedRms).toBeLessThan(STOPPED_RMS_MAX);
        expect(measurements.stoppedRms).toBeLessThan(measurements.preRms * STOPPED_RMS_RATIO_MAX);
        expect(measurements.playingAfterRelease).toBe(false);
        expect(measurements.releasingAfterRelease).toBe(false);
      } finally {
        await browser.close();
      }
    },
    90000,
  );
});
