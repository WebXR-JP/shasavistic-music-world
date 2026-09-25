/**
 * 利用者の実操作起点による4 Cube の選択・切替の採取判定。
 *
 * 既存の採取検査（`harmonicTone.capture.test.ts`・`harmonicChord.capture.test.ts`）は
 * 演奏口を直接駆動するため、実操作経路（`Interactable` の操作口の駆動）を通らない。
 * この検査は開発サーバでワールドを起動し、信頼済み入力（Playwright のキーボード移動と
 * マウス操作）だけで4つの Cube（`HarmonicSwitch`）を操作して、操作起点で生まれた
 * 音声文脈の出力を採取口（`AnalyserNode` への分岐）で判定する。自動再生方針の緩和は
 * 使わず、文脈が操作由来の再開で `running` になること自体を操作起点の証拠に含める。
 * 採取口は検査が用意する足場であり、ワールドの実行時挙動は変えない。
 *
 * 照準は利用者と同じ手段（`A`・`D` キーによる左右移動と中央照準の命中表示）で行い、
 * 左から右への掃引で4 Cube を順に見つける。対象の正しさは音の成分（各集合の声の
 * 基音）で検出し、遭遇順が聴き比べ列の順序と一致することで配置の対応も確かめる。
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

/** 採取に使う実ブラウザの起動引数。自動再生方針は緩めない。 */
const INTERACT_BROWSER_ARGS = ['--mute-audio'];

/** 成分の採取口の窓の大きさ。周波数分解能を優先する。 */
const COMPONENT_FFT_SIZE = 16384;

/** 包絡の採取口の窓の大きさ。時間分解能を優先する。 */
const ENVELOPE_FFT_SIZE = 4096;

/** 信号の出現・消失を確かめる間隔（ミリ秒）。 */
const POLL_INTERVAL_MS = 100;

/** 開始後の信号の出現を待つ上限（ミリ秒）。描画の遅れを吸収するための待ちであり合否ではない。 */
const TONE_TIMEOUT_MS = 6000;

/** 切替後の新成分の出現を待つ上限（ミリ秒）。減衰完了後の自動開始を含むため長めにする。 */
const SWITCH_TIMEOUT_MS = 10000;

/** 減衰完了後の消音を待つ上限（ミリ秒）。描画の遅れを吸収するための待ちであり合否ではない。 */
const STOP_TIMEOUT_MS = 4000;

/** 照準の命中表示が出るまでの上限（ミリ秒）。描画の遅れを吸収するための待ちであり合否ではない。 */
const AIM_TIMEOUT_MS = 30000;

/** 掃引の一押しの長さ（ミリ秒）。Cube を飛び越えない小刻みであり合否ではない。 */
const SWEEP_BURST_MS = 40;

/** 掃引の押しの後の落ち着き待ち（ミリ秒）。慣性の収まりを待つための待ちであり合否ではない。 */
const SWEEP_SETTLE_MS = 200;

/** 左への掃引の押しの上限回数。近傍だけを移動するため少なくする。 */
const SWEEP_LEFT_MAX_BURSTS = 40;

/** 右への掃引の押しの上限回数。左端から右端までの往復に足りる回数にする。 */
const SWEEP_RIGHT_MAX_BURSTS = 60;

/** 切替先の探索の押しの上限回数。 */
const SWITCH_MAX_BURSTS = 40;

/** 操作前の音声文脈の数。操作まで文脈を作らないこと。 */
const BASELINE_CONTEXT_COUNT = 0;

/** 4 Cube で共有する音声文脈の数。Cube ごとに文脈を作らないこと。 */
const SHARED_CONTEXT_COUNT = 1;

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

/** 全 Cube に共通の基音（Hz）。聴き比べ列の基準周波数に対応する。 */
const BASE_HZ = 440;

/** 単声に現れる倍音（Hz）。調波であることの証拠に使う。 */
const HARMONIC_HZ = 880;

/** 五度・長三和音の第二声の基音（Hz）。単声の倍音列に現れない。 */
const FIFTH_HZ = 660;

/** 長三和音の中声の基音（Hz）。五度・七度の集合に現れない。 */
const THIRD_HZ = 550;

/** 七度の第二声の基音（Hz）。他の集合に現れない。 */
const SEVENTH_HZ = 770;

/** 左から右への遭遇順に期待する集合の種類。配置の対応の判定に使う。 */
const EXPECTED_LEFT_ORDER = ['fifth', 'single'] as const;

/** 右への折り返しで新たに期待する集合の種類。 */
const EXPECTED_RIGHT_ORDER = ['triad', 'seventh'] as const;

/** 集合の種類。成分の組合せで識別する。 */
type SweepChordKind = 'single' | 'fifth' | 'triad' | 'seventh';

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
  readonly sweepBursts: number;
  readonly leftOrder: readonly string[];
  readonly rightOrder: readonly string[];
  readonly clickTrusted: boolean[];
}

describe.skipIf(process.env['XRIFT_INTERACT_CAPTURE'] !== '1')(
  '実操作起点の4 Cube の採取',
  () => {
    it(
      '4 Cube の照準・選択で単声と各和音の成分・停止・減衰・切替を判定する',
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

          // 中央照準の表示が出るまで待つのは描画の立上がりのためであり合否ではない。
          const aimStart = Date.now();
          while (Date.now() - aimStart < AIM_TIMEOUT_MS) {
            const hit = await page.evaluate(() => window.__crosshairActive());
            if (hit !== null) {
              break;
            }
            await sleep(POLL_INTERVAL_MS);
          }

          // 操作前は音声文脈を作らない。遅延生成の確認であり、無操作時との差の起点にする。
          const baselineContexts = await page.evaluate(() => window.__contextCount());

          // 常時表示の確認用にスポーン地点からの画面を残す。
          await sleep(1000);
          const evidenceDir = fileURLToPath(
            new URL('../../tmp/harmonic-interact-capture/', import.meta.url),
          );
          await mkdir(evidenceDir, { recursive: true });
          const stamp = new Date().toISOString().replace(/:/g, '-');
          await page.screenshot({ path: `${evidenceDir}cubes-label-${stamp}.png` });

          // 中央への信頼済み押下で操作口を駆動する。
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
          const readLevels = async (): Promise<{
            base: number;
            harmonic: number;
            fifth: number;
            third: number;
            seventh: number;
          }> => {
            await page.evaluate(() => window.__setFftSize(16384));
            await sleep(500);
            return {
              base: await levelDbOf(BASE_HZ),
              harmonic: await levelDbOf(HARMONIC_HZ),
              fifth: await levelDbOf(FIFTH_HZ),
              third: await levelDbOf(THIRD_HZ),
              seventh: await levelDbOf(SEVENTH_HZ),
            };
          };
          const identifyChord = (levels: {
            base: number;
            fifth: number;
            third: number;
            seventh: number;
          }): SweepChordKind | null => {
            const hasFifth = levels.fifth > PRESENT_DB_MIN;
            const hasThird = levels.third > PRESENT_DB_MIN;
            const hasSeventh = levels.seventh > PRESENT_DB_MIN;
            if (hasThird && hasFifth) {
              return 'triad';
            }
            if (hasFifth) {
              return 'fifth';
            }
            if (hasSeventh) {
              return 'seventh';
            }
            if (levels.base > PRESENT_DB_MIN) {
              return 'single';
            }
            return null;
          };
          const strafe = async (key: 'a' | 'd'): Promise<void> => {
            await page.keyboard.down(key);
            await sleep(SWEEP_BURST_MS);
            await page.keyboard.up(key);
            await sleep(SWEEP_SETTLE_MS);
          };

          // スポーン地点の照準は Cube 間の隙間であり、すぐ左に五度・単声、
          // 右に戻れば長三和音・七度がある。遠くへ外さず近傍だけを移動する。
          // 当たった Cube は調べて止め、外れを挟んで離れたことを確かめてから
          // 次を探す。同じ Cube への連打にならない。
          const investigateHit = async (): Promise<{
            kind: SweepChordKind | null;
            toneRms: number;
            levels: {
              base: number;
              harmonic: number;
              fifth: number;
              third: number;
              seventh: number;
            } | null;
          }> => {
            await clickAtCenter();
            await sleep(200);
            const toneRms = await waitForTone();
            if (toneRms < TONE_RMS_MIN) {
              return { kind: null, toneRms, levels: null };
            }
            await sleep(400);
            const levels = await readLevels();
            return { kind: identifyChord(levels), toneRms, levels };
          };
          const stopSound = async (toneRms: number): Promise<void> => {
            await page.evaluate(() => window.__setFftSize(4096));
            await sleep(300);
            await clickAtCenter();
            await waitForStopped(toneRms);
            await page.evaluate(() => window.__setFftSize(16384));
            await sleep(500);
          };

          const leftOrder: SweepChordKind[] = [];
          const rightOrder: SweepChordKind[] = [];
          const perChordLevels: Array<{
            kind: SweepChordKind;
            base: number;
            harmonic: number;
            fifth: number;
            third: number;
            seventh: number;
          }> = [];
          const foundKinds = new Set<SweepChordKind>();
          let sweepBursts = 0;
          let settledHit = false;
          // 直前の Cube から外れたことを表す。外れなく次の当たりを調べない。
          let leftCube = true;
          // 左へ進み、五度・単声の順に見つける。
          for (let burst = 0; burst < SWEEP_LEFT_MAX_BURSTS && leftOrder.length < 2; burst += 1) {
            await strafe('a');
            sweepBursts += 1;
            const hit = await page.evaluate(() => window.__crosshairActive());
            if (hit !== true) {
              leftCube = true;
              continue;
            }
            if (!leftCube) {
              continue;
            }
            leftCube = false;
            settledHit = true;
            const investigated = await investigateHit();
            if (investigated.kind === null || investigated.levels === null) {
              continue;
            }
            if (!foundKinds.has(investigated.kind)) {
              foundKinds.add(investigated.kind);
              leftOrder.push(investigated.kind);
              perChordLevels.push({ kind: investigated.kind, ...investigated.levels });
            }
            await stopSound(investigated.toneRms);
          }
          // 右へ折り返し、長三和音・七度の順に見つける。左で見つけた集合への
          // 再操作は止めて進み、最後の七度だけを鳴らしたままにする。
          // 照準は止めた単声の上にあるため、外れてから次を探す。
          leftCube = false;
          for (
            let burst = 0;
            burst < SWEEP_RIGHT_MAX_BURSTS && rightOrder.length < 2;
            burst += 1
          ) {
            await strafe('d');
            sweepBursts += 1;
            const hit = await page.evaluate(() => window.__crosshairActive());
            if (hit !== true) {
              leftCube = true;
              continue;
            }
            if (!leftCube) {
              continue;
            }
            leftCube = false;
            settledHit = true;
            const investigated = await investigateHit();
            if (investigated.kind === null || investigated.levels === null) {
              continue;
            }
            if (foundKinds.has(investigated.kind)) {
              await stopSound(investigated.toneRms);
              continue;
            }
            foundKinds.add(investigated.kind);
            rightOrder.push(investigated.kind);
            perChordLevels.push({ kind: investigated.kind, ...investigated.levels });
            if (rightOrder.length < 2) {
              await stopSound(investigated.toneRms);
            }
          }

          // 七度は鳴らしたまま、停止・減衰・無重複の時系列を判定する。
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
          // 時系列の頂上は発音中の窓で測る。停止後に測ると無音窓になる。
          const tonePeak = await page.evaluate(() => window.__peak(0));

          // 同一 Cube の再操作（ノートオフ）。減衰の予約であり、直後は跳ね上がらない。
          // 減衰（0.3秒）の中に読みを収める。
          await clickAtCenter();
          await sleep(40);
          const releaseFirstRms = await readRms();
          // 減衰中の再操作は次の和音を重ねない。無視されれば減衰が単調に進む。
          await sleep(50);
          await clickAtCenter();
          await sleep(40);
          const restrikeRms = await readRms();
          await sleep(40);
          const releaseMidRms = await readRms();
          const stoppedRms = await waitForStopped(sustainMean);

          // 切替の判定。四つ目を鳴らし直し、発音中に左隣の Cube を操作する。
          // 別 Cube の操作は現音への減衰の予約であり、全声の終了後に選択した
          // 集合が自動開始する。重ねないし、即時切断もしない。
          await page.evaluate(() => window.__setFftSize(16384));
          await sleep(500);
          await clickAtCenter();
          const switchBaseRms = await waitForTone();
          await sleep(400);
          // 左隣へ確実に移る。七度を離れた後に当たった面が切替先である。
          // 照準は鳴らし直した七度の上にあるため、外れてから探す。
          leftCube = false;
          let switched = false;
          for (let burst = 0; burst < SWITCH_MAX_BURSTS; burst += 1) {
            await strafe('a');
            sweepBursts += 1;
            const hit = await page.evaluate(() => window.__crosshairActive());
            if (hit !== true) {
              leftCube = true;
              continue;
            }
            if (!leftCube) {
              continue;
            }
            await clickAtCenter();
            switched = true;
            break;
          }
          // 切替先（長三和音）の目印である中声の出現を待つ。
          const switchStart = Date.now();
          let switchedThirdDb = await levelDbOf(THIRD_HZ);
          while (switchedThirdDb < PRESENT_DB_MIN && Date.now() - switchStart < SWITCH_TIMEOUT_MS) {
            await sleep(POLL_INTERVAL_MS);
            switchedThirdDb = await levelDbOf(THIRD_HZ);
          }
          // 採取窓（16384標本≒341ミリ秒）が切替後の定常音で満たされるまで待つ。
          await sleep(800);
          // 待ち後の定常音で測り直す。待ち前の値は立上がり途中の通過点である。
          switchedThirdDb = await levelDbOf(THIRD_HZ);
          const switchedRms = await readRms();
          const switchedPeak = await page.evaluate(() => window.__peak(0));
          const switchedBaseDb = await levelDbOf(BASE_HZ);
          const switchedFifthDb = await levelDbOf(FIFTH_HZ);
          const switchedSeventhDb = await levelDbOf(SEVENTH_HZ);
          const clickTrusted = await page.evaluate(() => window.__mousedownTrusted);
          const contextStates = await page.evaluate(() => window.__contextStates());
          const contextCount = await page.evaluate(() => window.__contextCount());
          const tapCount = await page.evaluate(() => window.__tapCount());
          // 切替後の発音中の画面を残す。常時表示の可読性の証拠にする。
          await page.screenshot({ path: `${evidenceDir}cubes-playing-${stamp}.png` });

          const levelByKind = (
            kind: SweepChordKind,
          ): { base: number; harmonic: number; fifth: number; third: number; seventh: number } | undefined =>
            perChordLevels.find((measured) => measured.kind === kind);
          const single = levelByKind('single');
          const fifth = levelByKind('fifth');
          const triad = levelByKind('triad');
          const seventh = levelByKind('seventh');
          const operationLog: InteractOperationLog = {
            sweepBursts,
            leftOrder,
            rightOrder,
            clickTrusted,
          };
          const evidence = {
            scenario: 'harmonic-interact-capture-4cubes',
            environment: {
              browser: `chromium/${version}`,
              devUrl,
              viewport: [800, 600],
              autoplayPolicy: 'default(require-gesture)',
              componentFftSize: COMPONENT_FFT_SIZE,
              envelopeFftSize: ENVELOPE_FFT_SIZE,
              contextStates,
              contextCount,
              tapCount,
              pageErrors: pageErrors.slice(0, 8),
            },
            operation: operationLog,
            thresholds: {
              baselineContextCount: BASELINE_CONTEXT_COUNT,
              sharedContextCount: SHARED_CONTEXT_COUNT,
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
              perChordLevels,
              sustainMean,
              releaseFirstRms,
              restrikeRms,
              releaseMidRms,
              stoppedRms,
              tonePeak,
              switchBaseRms,
              switched,
              switchedRms,
              switchedPeak,
              switchedBaseDb,
              switchedThirdDb,
              switchedFifthDb,
              switchedSeventhDb,
            },
            note: '開発環境の音声グラフ内の標本であり、ホスト環境と物理出力の証明にはならない',
          };
          await writeFile(
            `${evidenceDir}capture-${stamp}-chromium.json`,
            `${JSON.stringify(evidence, null, 2)}\n`,
          );
          await page.close();

          // 操作前は無音（文脈なし）であり、操作起点で文脈が生まれること。
          expect(baselineContexts).toBe(BASELINE_CONTEXT_COUNT);
          // 近傍の移動で4 Cube に照準を合わせられること。左へ進んで五度・
          // 単声の順に、右へ戻って長三和音・七度の順に見つける。
          expect(settledHit).toBe(true);
          expect(leftOrder).toEqual([...EXPECTED_LEFT_ORDER]);
          expect(rightOrder).toEqual([...EXPECTED_RIGHT_ORDER]);
          // 全操作が信頼済み入力であり、文脈は操作由来の再開で動くこと。
          expect(clickTrusted.length).toBeGreaterThanOrEqual(6);
          for (const trusted of clickTrusted) {
            expect(trusted).toBe(true);
          }
          expect(contextStates).toContain('running');
          // 4 Cube で1つの文脈と1つの採取口を共有すること。
          expect(contextCount).toBe(SHARED_CONTEXT_COUNT);
          expect(tapCount).toBe(SHARED_CONTEXT_COUNT);
          // 単声：非無音かつ過大でなく、狙った成分を持つこと。
          // 五度の基音が底に落ちることで単声であること、倍音があることで
          // 調波の操作であること。
          expect(single?.base).toBeGreaterThan(PRESENT_DB_MIN);
          expect(single?.harmonic).toBeGreaterThan(PRESENT_DB_MIN);
          expect(single?.fifth).toBeLessThan(ABSENT_DB_MAX);
          expect((single?.base ?? 0) - (single?.fifth ?? 0)).toBeGreaterThan(ABSENT_DROP_DB_MIN);
          // 五度：基音と五度の声を持ち、中声は底に落ちること。
          expect(fifth?.base).toBeGreaterThan(PRESENT_DB_MIN);
          expect(fifth?.fifth).toBeGreaterThan(PRESENT_DB_MIN);
          expect(fifth?.third).toBeLessThan(ABSENT_DB_MAX);
          expect((fifth?.base ?? 0) - (fifth?.third ?? 0)).toBeGreaterThan(ABSENT_DROP_DB_MIN);
          // 長三和音：三つの声の基音を持つこと。
          expect(triad?.base).toBeGreaterThan(PRESENT_DB_MIN);
          expect(triad?.third).toBeGreaterThan(PRESENT_DB_MIN);
          expect(triad?.fifth).toBeGreaterThan(PRESENT_DB_MIN);
          // 七度：基音と七度の声を持ち、五度は底に落ちること。
          expect(seventh?.base).toBeGreaterThan(PRESENT_DB_MIN);
          expect(seventh?.seventh).toBeGreaterThan(PRESENT_DB_MIN);
          expect(seventh?.fifth).toBeLessThan(ABSENT_DB_MAX);
          expect((seventh?.base ?? 0) - (seventh?.fifth ?? 0)).toBeGreaterThan(ABSENT_DROP_DB_MIN);
          // 同一 Cube の再操作の減衰：直後は跳ね上がらないこと。
          expect(sustainMean).toBeGreaterThan(SUSTAIN_RMS_MIN);
          expect(releaseFirstRms).toBeLessThan(sustainMean * RELEASE_FIRST_RATIO_MAX);
          // 減衰中の再操作は次の和音を重ねず、減衰が単調に進むこと。
          // 新たな起動があれば立ち上がりで直後の読みを上回る。
          expect(restrikeRms).toBeLessThan(sustainMean * RESTRIKE_RATIO_MAX);
          expect(restrikeRms).toBeLessThan(releaseFirstRms);
          expect(releaseMidRms).toBeLessThan(restrikeRms);
          // 即時切断では途中も消音と同じになるため、途中が消音を上回ることで
          // 減衰の予約であることを確かめる。比較する途中点は再操作直後の読み
          // （ノートオフから固定待ち合計で約150ミリ秒後）とする。減衰時間
          // （0.3秒）の内側に収まるため、即時切断であれば採取窓が無音で満た
          // されて消音と同値になり予約と区別できる。終端側の読みは操作と採取
          // の遅れで無音窓になり消音と同値になりうるため、この比較には使わない。
          expect(restrikeRms).toBeGreaterThan(stoppedRms);
          expect(stoppedRms).toBeLessThan(STOPPED_RMS_MAX);
          expect(stoppedRms).toBeLessThan(sustainMean * STOPPED_RMS_RATIO_MAX);
          expect(tonePeak).toBeLessThan(TONE_PEAK_MAX);
          // 別 Cube の操作で減衰完了後に切替先（長三和音）が鳴ること。
          // 七度の声は消え、中声と五度が現れる。重ねたままでは七度が残る。
          expect(switched).toBe(true);
          expect(switchBaseRms).toBeGreaterThan(TONE_RMS_MIN);
          expect(switchedRms).toBeGreaterThan(TONE_RMS_MIN);
          expect(switchedRms).toBeLessThan(TONE_RMS_MAX);
          expect(switchedPeak).toBeLessThan(TONE_PEAK_MAX);
          expect(switchedBaseDb).toBeGreaterThan(PRESENT_DB_MIN);
          expect(switchedThirdDb).toBeGreaterThan(PRESENT_DB_MIN);
          expect(switchedFifthDb).toBeGreaterThan(PRESENT_DB_MIN);
          expect(switchedSeventhDb).toBeLessThan(ABSENT_DB_MAX);
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
