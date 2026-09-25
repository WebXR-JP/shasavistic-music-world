/**
 * 利用者の実操作起点による調波和音の生成・減衰・進行の採取判定。
 *
 * 既存の採取検査（`harmonicTone.capture.test.ts`・`harmonicChord.capture.test.ts`）は
 * 演奏口を直接駆動するため、実操作経路（`Interactable` の操作口の駆動）を通らない。
 * この検査は開発サーバでワールドを起動し、信頼済み入力（Playwright のキーボード移動と
 * マウス操作）だけで `HarmonicSwitch` を操作して、操作起点で生まれた音声文脈の出力を
 * 採取口（`AnalyserNode` への分岐）で判定する。自動再生方針の緩和は使わず、文脈が操作
 * 由来の再開で `running` になること自体を操作起点の証拠に含める。
 * 採取口は検査が用意する足場であり、ワールドの実行時挙動は変えない。
 *
 * 照準は利用者と同じ手段（`D` キーによる右移動と中央照準の命中表示）で行い、
 * 命中対象の取違いは音の成分（正弦の旧口にはない倍音と五度の声）で検出する。
 *
 * 覆う層：実操作経路から演奏口・実音声グラフへの信号生成（開発環境のブラウザ内）。
 * 覆わない層：ホスト環境の操作・許可・聴き分けと物理出力。物理出力の証明には
 * ならないため、未確認として残す。
 *
 * 実行時間と安定性への影響を避けるため、既定の `npm test` では跳ばし、
 * `XRIFT_INTERACT_CAPTURE=1` のときだけ実行する（`npm run test:interact`）。
 *
 * @packageDocumentation
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { describe, expect, it } from 'vitest';

/** ページ初期化手続きが用意する採取口。型は検査側の宣言であり実行時検証ではない。 */
declare global {
  interface Window {
    /** 信頼済み `mousedown` の記録（`isTrusted` の列）。 */
    readonly __mousedownTrusted: boolean[];
    /** 中央照準の命中表示。取得できない場合は `null`。 */
    __crosshairActive(): boolean | null;
    /** 指定した採取口の実効値。採取口がなければ `-1`。 */
    __rms(index: number): number;
    /** 指定した採取口の時系列の頂上。採取口がなければ `-1`。 */
    __peak(index: number): number;
    /** 指定した採取口の周波数水準（dBFS）。採取口がなければ `-999`。 */
    __levelDb(frequencyHz: number, index: number): number;
    /** 全採取口の窓の大きさを変える。変更後は窓が空になるため待ちを置くこと。 */
    __setFftSize(size: number): void;
    /** 生成済みの音声文脈の状態列。 */
    __contextStates(): string[];
    /** 生成済みの音声文脈の数。 */
    __contextCount(): number;
    /** 採取口の数。 */
    __tapCount(): number;
  }
}

/**
 * 実アプリが生成する音声文脈の出力を採取口へ分岐する初期化手続き。
 *
 * アプリの接続は残したまま `destination` 行きの接続元を採取口へ複製する。
 * 採取口は終端（出力へは繋がない）ため二重出力にならず、発振器の接続先や
 * 設定には触れない。検査側の足場であり、本番コードには置かない。
 */
const INTERACT_INIT_SCRIPT = [
  '(() => {',
  '  window.__mousedownTrusted = [];',
  "  window.addEventListener('mousedown', (event) => {",
  '    window.__mousedownTrusted.push(event.isTrusted);',
  '  }, true);',
  '  window.__taps = [];',
  '  window.__contexts = [];',
  '  const OrigConnect = AudioNode.prototype.connect;',
  '  const OrigCreateAnalyser = AudioContext.prototype.createAnalyser;',
  '  function ensureTap(context) {',
  '    if (context.__captureTap) return context.__captureTap;',
  '    const tap = OrigCreateAnalyser.call(context);',
  '    tap.fftSize = 16384;',
  '    tap.smoothingTimeConstant = 0;',
  '    context.__captureTap = tap;',
  '    window.__taps.push(tap);',
  '    return tap;',
  '  }',
  '  AudioNode.prototype.connect = function (dest, ...rest) {',
  '    const result = OrigConnect.apply(this, [dest, ...rest]);',
  '    try {',
  '      const ctx = this.context;',
  '      if (ctx && dest === ctx.destination) {',
  '        OrigConnect.call(this, ensureTap(ctx));',
  '      }',
  '    } catch (error) {}',
  '    return result;',
  '  };',
  '  const OrigAC = window.AudioContext;',
  '  class PatchedAC extends OrigAC {',
  '    constructor(...args) {',
  '      super(...args);',
  '      window.__contexts.push(this);',
  '      ensureTap(this);',
  '    }',
  '  }',
  '  window.AudioContext = PatchedAC;',
  '  function tapAt(index) { return window.__taps[index]; }',
  '  window.__crosshairActive = () => {',
  "    const cross = [...document.querySelectorAll('div')].find((d) => d.style && d.style.zIndex === '100');",
  '    if (!cross || cross.children.length === 0) return null;',
  "    return cross.children[0].style.backgroundColor !== 'rgba(255, 255, 255, 0.1)';",
  '  };',
  '  window.__rms = (index) => {',
  '    const tap = tapAt(index);',
  '    if (!tap) return -1;',
  '    const samples = new Float32Array(tap.fftSize);',
  '    tap.getFloatTimeDomainData(samples);',
  '    let sum = 0;',
  '    for (const sample of samples) sum += sample * sample;',
  '    return Math.sqrt(sum / samples.length);',
  '  };',
  '  window.__peak = (index) => {',
  '    const tap = tapAt(index);',
  '    if (!tap) return -1;',
  '    const samples = new Float32Array(tap.fftSize);',
  '    tap.getFloatTimeDomainData(samples);',
  '    let peak = 0;',
  '    for (const sample of samples) { const absolute = Math.abs(sample); if (absolute > peak) peak = absolute; }',
  '    return peak;',
  '  };',
  '  window.__levelDb = (frequencyHz, index) => {',
  '    const tap = tapAt(index);',
  '    const context = window.__contexts[index];',
  '    if (!tap || !context) return -999;',
  '    const bins = new Float32Array(tap.frequencyBinCount);',
  '    tap.getFloatFrequencyData(bins);',
  '    const center = Math.round((frequencyHz * tap.fftSize) / context.sampleRate);',
  '    let best = Number.NEGATIVE_INFINITY;',
  '    for (let i = Math.max(1, center - 2); i <= Math.min(bins.length - 1, center + 2); i += 1) {',
  '      if (bins[i] > best) best = bins[i];',
  '    }',
  '    return best;',
  '  };',
  '  window.__setFftSize = (size) => { for (const tap of window.__taps) tap.fftSize = size; };',
  '  window.__contextStates = () => window.__contexts.map((context) => context.state);',
  '  window.__contextCount = () => window.__contexts.length;',
  '  window.__tapCount = () => window.__taps.length;',
  '})();',
].join('\n');

/** 採取に使う実ブラウザの起動引数。自動再生方針は緩めず、発声だけ抑える。 */
const INTERACT_BROWSER_ARGS = ['--mute-audio'];

/** 成分の採取口の窓の大きさ。周波数分解能を優先する。 */
const COMPONENT_FFT_SIZE = 16384;

/** 包絡の採取口の窓の大きさ。時間分解能を優先する。 */
const ENVELOPE_FFT_SIZE = 4096;

/** 信号の出現・消失を確かめる間隔（ミリ秒）。 */
const POLL_INTERVAL_MS = 100;

/** 開始後の信号の出現を待つ上限（ミリ秒）。描画の遅れを吸収するための待ちであり合否ではない。 */
const TONE_TIMEOUT_MS = 6000;

/** 減衰完了後の消音を待つ上限（ミリ秒）。描画の遅れを吸収するための待ちであり合否ではない。 */
const STOP_TIMEOUT_MS = 4000;

/** 照準の命中表示が出るまでの上限（ミリ秒）。描画の遅れを吸収するための待ちであり合否ではない。 */
const AIM_TIMEOUT_MS = 30000;

/** 照準移動の一押しの長さ（ミリ秒）。移動速度に対する刻みであり合否ではない。 */
const STRAFE_BURST_MS = 60;

/** 照準移動の押しの後の落ち着き待ち（ミリ秒）。慣性の収まりを待つための待ちであり合否ではない。 */
const STRAFE_SETTLE_MS = 250;

/** 照準移動の押しの上限回数。 */
const STRAFE_MAX_BURSTS = 14;

/** 操作前の音声文脈の数。操作まで文脈を作らないこと。 */
const BASELINE_CONTEXT_COUNT = 0;

/** 発音中に求める実効値の下限。総利得予算の分配後の水準に合わせる。 */
const TONE_RMS_MIN = 0.03;

/** 発音中に許す実効値の上限。総利得予算で抑えることを保証する。 */
const TONE_RMS_MAX = 0.4;

/** 持続中に求める実効値の下限。最大からの減衰後も可聴であること。 */
const SUSTAIN_RMS_MIN = 0.02;

/** 減衰直後の実効値が持続平均を上回ってよい割合。跳ね上がりがないこと。 */
const RELEASE_FIRST_RATIO_MAX = 1.15;

/**
 * 減衰中の再操作後に許す実効値の上限（持続平均に対する割合）。新たな起動がないこと。
 *
 * 即時切断でないことは減衰途中の読みが消音を上回ることで確かめる。信頼済み
 * クリックの押下時間だけ直後の読みが減衰に入るため、直後読みの下限では見ない。
 */
const RESTRIKE_RATIO_MAX = 1.15;

/** 時系列の頂上に許す上限（絶対値）。1 を下回り過大振幅でないことを保証する。 */
const TONE_PEAK_MAX = 0.99;

/** 減衰完了後に許す実効値の上限（絶対値）。 */
const STOPPED_RMS_MAX = 0.05;

/** 減衰完了後に許す実効値の上限（発音中の実効値に対する割合）。 */
const STOPPED_RMS_RATIO_MAX = 0.1;

/** 必要成分として認める水準の下限（dBFS）。無信号の底より十分に上であること。 */
const PRESENT_DB_MIN = -64;

/** 除外成分に許す水準の上限（絶対値、dBFS）。 */
const ABSENT_DB_MAX = -85;

/** 除外成分に求める落ち込み（基音成分からの差、dB）。 */
const ABSENT_DROP_DB_MIN = 30;

/** 一操作目の単声の基音（Hz）。聴き比べ列の先頭に対応する。 */
const SINGLE_BASE_HZ = 440;

/** 一操作目の単声に現れる倍音（Hz）。正弦の旧口との区別に使う。 */
const SINGLE_HARMONIC_HZ = 880;

/** 二和音目の第二声の基音（Hz）。単声の倍音列に現れない。 */
const FIFTH_SECOND_HZ = 660;

/** 眠る。固定の待ちではなく区切りのための待ちに使う。 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * 採取用ブラウザを起動する。自動再生方針は緩めない。
 *
 * @returns 起動したブラウザ。
 * @throws `Error` — Chrome の用意または実行体指定が必要な場合。
 */
async function launchInteractBrowser(): Promise<{
  browser: import('playwright-core').ChromiumBrowser;
  version: string;
}> {
  const executablePath = process.env['XRIFT_CAPTURE_CHROME'];
  try {
    const browser =
      executablePath === undefined || executablePath === ''
        ? await chromium.launch({ channel: 'chrome', args: INTERACT_BROWSER_ARGS })
        : await chromium.launch({ executablePath, args: INTERACT_BROWSER_ARGS });
    return { browser, version: browser.version() };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `採取用ブラウザの起動に失敗した。Chrome の用意または XRIFT_CAPTURE_CHROME での実行体指定が必要である: ${detail}`,
    );
  }
}

/** 操作と採取の時系列の記録。証拠に残し、合否の判定は検査側が行う。 */
interface InteractOperationLog {
  readonly initialHit: boolean;
  readonly strafeBursts: number;
  readonly sawGap: boolean;
  readonly aimedHit: boolean;
  readonly clickTrusted: boolean[];
}

describe.skipIf(process.env['XRIFT_INTERACT_CAPTURE'] !== '1')(
  '実操作起点の調波和音の採取',
  () => {
    it(
      '操作口の駆動で単声・減衰・次和音の進行を判定する',
      async () => {
        let server: ViteDevServer | null = null;
        const { browser, version } = await launchInteractBrowser();
        try {
          server = await createServer({
            root: process.cwd(),
            logLevel: 'silent',
            server: { port: 0, strictPort: false },
          });
          await server.listen();
          const devUrl = server.resolvedUrls?.local[0];
          if (devUrl === undefined) {
            throw new Error('開発サーバの公開先が求まらない');
          }

          const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
          await page.addInitScript({ content: INTERACT_INIT_SCRIPT });
          const pageErrors: string[] = [];
          page.on('pageerror', (error) => {
            pageErrors.push(error.message.slice(0, 200));
          });
          await page.goto(devUrl, { waitUntil: 'load', timeout: 60000 });
          await page.waitForSelector('canvas', { timeout: 60000 });

          // 生成直後は旧口が正面にあり、中央照準が当たる。描画と物理の立上がりを待つ。
          let initialHit = false;
          const aimStart = Date.now();
          while (Date.now() - aimStart < AIM_TIMEOUT_MS) {
            const hit = await page.evaluate(() => window.__crosshairActive());
            if (hit === true) {
              initialHit = true;
              break;
            }
            await sleep(POLL_INTERVAL_MS);
          }

          // 操作前は音声文脈を作らない。遅延生成の確認であり、無操作時との差の起点にする。
          const baselineContexts = await page.evaluate(() => window.__contextCount());

          // 右へ刻み移動し、旧口を外して新口に当てる。命中表示の「有→無→有」で
          // 新口への到達とみなし、音の成分で対象の取違いを検出する。
          let sawGap = false;
          let aimedHit = false;
          let strafeBursts = 0;
          if (initialHit) {
            for (let burst = 0; burst < STRAFE_MAX_BURSTS; burst += 1) {
              await page.keyboard.down('d');
              await sleep(STRAFE_BURST_MS);
              await page.keyboard.up('d');
              await sleep(STRAFE_SETTLE_MS);
              strafeBursts += 1;
              const hit = await page.evaluate(() => window.__crosshairActive());
              if (hit === false) {
                sawGap = true;
              }
              if (hit === true && sawGap) {
                aimedHit = true;
                break;
              }
            }
            await sleep(500);
            const settledHit = await page.evaluate(() => window.__crosshairActive());
            aimedHit = aimedHit && settledHit === true;
          }

          // 一操作目（単声）。中央への信頼済み押下で操作口を駆動する。
          // 信頼済みかどうかの記録は最後にまとめて読む。
          // 押下の保持は短くし、減衰の読みが押下時間に埋もれないようにする。
          const clickAtCenter = async (): Promise<void> => {
            await page.mouse.move(400, 300);
            await page.mouse.down();
            await sleep(20);
            await page.mouse.up();
          };
          const readRms = (): Promise<number> => page.evaluate(() => window.__rms(0));
          const waitForTone = async (): Promise<number> => {
            const start = Date.now();
            let rms = await readRms();
            while (rms < TONE_RMS_MIN && Date.now() - start < TONE_TIMEOUT_MS) {
              await sleep(POLL_INTERVAL_MS);
              rms = await readRms();
            }
            return rms;
          };
          const waitForStopped = async (referenceRms: number): Promise<number> => {
            const start = Date.now();
            let rms = await readRms();
            while (
              (rms >= STOPPED_RMS_MAX || rms >= referenceRms * STOPPED_RMS_RATIO_MAX) &&
              Date.now() - start < STOP_TIMEOUT_MS
            ) {
              await sleep(POLL_INTERVAL_MS);
              rms = await readRms();
            }
            return rms;
          };
          const levelDbOf = (frequencyHz: number): Promise<number> =>
            page.evaluate((frequency) => window.__levelDb(frequency, 0), frequencyHz);

          await clickAtCenter();
          await sleep(200);
          let toneRms = await waitForTone();
          // 採取窓が信号で満たされてから測る。
          await sleep(400);
          toneRms = await readRms();
          const tonePeak = await page.evaluate(() => window.__peak(0));
          const contextStatesAfterFirst = await page.evaluate(() => window.__contextStates());
          const singleBaseDb = await levelDbOf(SINGLE_BASE_HZ);
          const singleHarmonicDb = await levelDbOf(SINGLE_HARMONIC_HZ);
          const fifthAbsentDb = await levelDbOf(FIFTH_SECOND_HZ);

          // 包絡の時間追跡に切り替え、持続の平均を求める。
          await page.evaluate(() => window.__setFftSize(4096));
          await sleep(300);
          const sustainSamples: number[] = [];
          for (let index = 0; index < 4; index += 1) {
            await sleep(50);
            sustainSamples.push(await readRms());
          }
          let sustainMean = 0;
          for (const sample of sustainSamples) {
            sustainMean += sample;
          }
          sustainMean /= sustainSamples.length;

          // 二操作目（ノートオフ）。減衰の予約であり、直後は跳ね上がらない。
          // 減衰（0.3秒）の中に読みを収める。
          await clickAtCenter();
          await sleep(40);
          const releaseFirstRms = await readRms();
          // 減衰中の三操作目は次の和音を重ねない。無視されれば減衰が単調に進む。
          await sleep(50);
          await clickAtCenter();
          await sleep(40);
          const restrikeRms = await readRms();
          await sleep(40);
          const releaseMidRms = await readRms();
          const stoppedRms = await waitForStopped(sustainMean);

          // 減衰完了後の四操作目（次の和音）。五度の第二声が現れ、組合せが進む。
          await page.evaluate(() => window.__setFftSize(16384));
          await sleep(500);
          await clickAtCenter();
          const fifthRms = await waitForTone();
          await sleep(400);
          const fifthSettledRms = await readRms();
          const fifthBaseDb = await levelDbOf(SINGLE_BASE_HZ);
          const fifthSecondDb = await levelDbOf(FIFTH_SECOND_HZ);
          const clickTrusted = await page.evaluate(() => window.__mousedownTrusted);
          const contextStatesAfterFifth = await page.evaluate(() => window.__contextStates());

          const operationLog: InteractOperationLog = {
            initialHit,
            strafeBursts,
            sawGap,
            aimedHit,
            clickTrusted,
          };
          const evidence = {
            scenario: 'harmonic-interact-capture',
            environment: {
              browser: `chromium/${version}`,
              devUrl,
              viewport: [800, 600],
              autoplayPolicy: 'default(require-gesture)',
              componentFftSize: COMPONENT_FFT_SIZE,
              envelopeFftSize: ENVELOPE_FFT_SIZE,
              contextStates: {
                afterFirst: contextStatesAfterFirst,
                afterFifth: contextStatesAfterFifth,
              },
              pageErrors: pageErrors.slice(0, 8),
            },
            operation: operationLog,
            thresholds: {
              baselineContextCount: BASELINE_CONTEXT_COUNT,
              toneRmsMin: TONE_RMS_MIN,
              toneRmsMax: TONE_RMS_MAX,
              tonePeakMax: TONE_PEAK_MAX,
              sustainRmsMin: SUSTAIN_RMS_MIN,
              releaseFirstRatioMax: RELEASE_FIRST_RATIO_MAX,
              restrikeRatioMax: RESTRIKE_RATIO_MAX,
              stoppedRmsMax: STOPPED_RMS_MAX,
              stoppedRmsRatioMax: STOPPED_RMS_RATIO_MAX,
              presentDbMin: PRESENT_DB_MIN,
              absentDbMax: ABSENT_DB_MAX,
              absentDropDbMin: ABSENT_DROP_DB_MIN,
            },
            measurements: {
              baselineContexts,
              toneRms,
              tonePeak,
              singleBaseDb,
              singleHarmonicDb,
              fifthAbsentDb,
              sustainMean,
              releaseFirstRms,
              restrikeRms,
              releaseMidRms,
              stoppedRms,
              fifthRms,
              fifthSettledRms,
              fifthBaseDb,
              fifthSecondDb,
            },
            note: '開発環境の音声グラフ内の標本であり、ホスト環境と物理出力の証明にはならない',
          };
          const evidenceDir = fileURLToPath(
            new URL('../../tmp/harmonic-interact-capture/', import.meta.url),
          );
          await mkdir(evidenceDir, { recursive: true });
          const stamp = new Date().toISOString().replace(/:/g, '-');
          await writeFile(
            `${evidenceDir}capture-${stamp}-chromium.json`,
            `${JSON.stringify(evidence, null, 2)}\n`,
          );
          await page.close();

          // 操作前は無音（文脈なし）であり、操作起点で文脈が生まれること。
          expect(baselineContexts).toBe(BASELINE_CONTEXT_COUNT);
          expect(initialHit).toBe(true);
          expect(aimedHit).toBe(true);
          // 全操作が信頼済み入力であり、文脈は操作由来の再開で動くこと。
          expect(clickTrusted.length).toBeGreaterThanOrEqual(4);
          for (const trusted of clickTrusted) {
            expect(trusted).toBe(true);
          }
          expect(contextStatesAfterFirst).toContain('running');
          // 一操作目の単声：非無音かつ過大でなく、狙った成分を持つこと。
          // 第二声の基音が底に落ちることで単声であること、倍音があることで
          // 正弦の旧口ではなく新口の操作であること。
          expect(toneRms).toBeGreaterThan(TONE_RMS_MIN);
          expect(toneRms).toBeLessThan(TONE_RMS_MAX);
          expect(tonePeak).toBeLessThan(TONE_PEAK_MAX);
          expect(singleBaseDb).toBeGreaterThan(PRESENT_DB_MIN);
          expect(singleHarmonicDb).toBeGreaterThan(PRESENT_DB_MIN);
          expect(fifthAbsentDb).toBeLessThan(ABSENT_DB_MAX);
          expect(singleBaseDb - fifthAbsentDb).toBeGreaterThan(ABSENT_DROP_DB_MIN);
          // 二操作目の減衰：直後は跳ね上がらないこと。
          expect(sustainMean).toBeGreaterThan(SUSTAIN_RMS_MIN);
          expect(releaseFirstRms).toBeLessThan(sustainMean * RELEASE_FIRST_RATIO_MAX);
          // 減衰中の再操作は次の和音を重ねず、減衰が単調に進むこと。
          // 新たな起動があれば立ち上がりで直後の読みを上回る。
          expect(restrikeRms).toBeLessThan(sustainMean * RESTRIKE_RATIO_MAX);
          expect(restrikeRms).toBeLessThan(releaseFirstRms);
          expect(releaseMidRms).toBeLessThan(restrikeRms);
          // 即時切断では途中も消音と同じになるため、途中が消音を上回ることで
          // 減衰の予約であることを確かめる。
          expect(releaseMidRms).toBeGreaterThan(stoppedRms);
          expect(stoppedRms).toBeLessThan(STOPPED_RMS_MAX);
          expect(stoppedRms).toBeLessThan(sustainMean * STOPPED_RMS_RATIO_MAX);
          // 減衰完了後の再操作で次の和音（五度）へ進むこと。
          expect(fifthSettledRms).toBeGreaterThan(TONE_RMS_MIN);
          expect(fifthBaseDb).toBeGreaterThan(PRESENT_DB_MIN);
          expect(fifthSecondDb).toBeGreaterThan(PRESENT_DB_MIN);
          expect(contextStatesAfterFifth).toContain('running');
        } finally {
          await browser.close();
          if (server !== null) {
            await server.close();
          }
        }
      },
      180000,
    );
  },
);
