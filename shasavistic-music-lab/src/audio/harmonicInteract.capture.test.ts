/**
 * 利用者の実操作起点による音高格子の採取判定。
 *
 * 既存の採取検査（`pitchGrid.capture.test.ts`）は演奏口を直接駆動するため、
 * 実操作経路（`Interactable` の操作口の駆動）を通らない。この検査は開発サーバで
 * ワールドを起動し、信頼済み入力（Playwright の視点操作と中央照準の押下）だけで
 * 格子15点・八方向移動・次元選択（`PitchGrid`）を操作して、操作起点で生まれた
 * 音声文脈の出力を採取口（`AnalyserNode` への分岐）で判定する。自動再生方針の
 * 緩和は使わず、文脈が操作由来の再開で `running` になること自体を操作起点の
 * 証拠に含める。採取口は検査が用意する足場であり、ワールドの実行時挙動は変えない。
 *
 * 照準は利用者と同じ手段（視点の左右・俯仰と中央照準の命中表示）で行い、
 * 命中した操作対象を効果（発音周波数の成分変化）で同定する。配置の対応は
 * 走査順と成分の順序の一致で確かめる。視点の向きは局面ごとに再読込で確定状態へ
 * 戻し、長い開ループ走査は平行移動と短走査の組合せで置き換える。
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
import { assignPitchGridFrequencies, pitchGridKey } from './pitchGrid';

/** ページ初期化手続きが用意する採取口。型は検査側の宣言であり実行時検証ではない。 */
declare global {
  interface Window {
    /** 信頼済み `mousedown` の記録（`isTrusted` の列）。 */
    readonly __mousedownTrusted: boolean[];
    /** ポインターロック中か。 */
    __locked(): boolean;
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
  '  window.__locked = () => document.pointerLockElement !== null;',
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

/** 信号の出現・消失を確かめる間隔（ミリ秒）。 */
const POLL_INTERVAL_MS = 100;

/** 開始後の信号の出現を待つ上限（ミリ秒）。描画の遅れを吸収するための待ちであり合否ではない。 */
const TONE_TIMEOUT_MS = 6000;

/** 消音を待つ上限（ミリ秒）。描画の遅れを吸収するための待ちであり合否ではない。 */
const STOP_TIMEOUT_MS = 4000;

/** 照準の命中表示が出るまでの上限（ミリ秒）。描画の遅れを吸収するための待ちであり合否ではない。 */
const AIM_TIMEOUT_MS = 30000;

/** 視点の刻み後の落ち着き待ち（ミリ秒）。命中表示の更新を待つための待ちであり合否ではない。 */
const LOOK_SETTLE_MS = 150;

/** 視点走査の一刻みの大きさ（画素）。操作対象を飛び越えない小刻みであり合否ではない。 */
const LOOK_STEP_PX = 3;

/** 視点走査の上限回数。見つからない場合は証拠を残して失敗する。 */
const SCAN_MAX_STEPS = 250;

/** リベースまでの視点移動の目安（画素）。画面内に収めるための区切りであり合否ではない。 */
const REBASE_EVERY_PX = 200;

/** 操作前の音声文脈の数。操作まで文脈を作らないこと。 */
const BASELINE_CONTEXT_COUNT = 0;

/** 格子操作で共有する音声文脈の数。Cube ごとに文脈を作らないこと。 */
const SHARED_CONTEXT_COUNT = 1;

/** 単声の発音中に求める実効値の下限。声の固定利得の水準に合わせる。 */
const TONE_RMS_MIN = 0.005;

/** 発音中に許す実効値の上限。固定利得で抑えることを保証する。 */
const TONE_RMS_MAX = 0.4;

/** 時系列の頂上に許す上限（絶対値）。1 を下回り過大振幅でないことを保証する。 */
const TONE_PEAK_MAX = 0.99;

/** 消音後に許す実効値の上限（絶対値）。 */
const STOPPED_RMS_MAX = 0.05;

/** 消音後に許す実効値の上限（発音中の実効値に対する割合）。 */
const STOPPED_RMS_RATIO_MAX = 0.1;

/** 必要成分として認める水準の下限（dBFS）。無信号の底より十分に上であること。 */
const PRESENT_DB_MIN = -64;

/** 除外成分に許す水準の上限（絶対値、dBFS）。 */
const ABSENT_DB_MAX = -85;

/** 除外成分に求める落ち込み（残る声の基音からの差、dB）。 */
const ABSENT_DROP_DB_MIN = 30;

/** 操作後の減衰完了と採取窓の満たしを待つ時間（ミリ秒）。 */
const POST_ACTION_SETTLE_MS = 750;

/** 成分測定前の採取窓の満たし待ち（ミリ秒）。 */
const COMPONENT_WINDOW_MS = 400;

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

/** 中段の横座標の順序。左から右への走査の対応付けに使う。 */
const MIDDLE_X_ORDER = [-2, -1, 0, 1, 2] as const;

/** 八方向の移動量。右・上を正とする。 */
const MOVE_DIRS: readonly { readonly dx: number; readonly dy: number }[] = [
  { dx: -1, dy: 1 },
  { dx: 0, dy: 1 },
  { dx: 1, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: -1, dy: -1 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: -1 },
];

/**
 * 単点集合の配置で選ばれる発音周波数。単一声の採取の期待値に使う。
 *
 * 複数点の同時発音の期待値には使わない（集合単位の配置に従うため）。
 */
function singleAssignedFrequency(
  point: { readonly x: number; readonly y: number },
  dimension: 3 | 4 | 5,
): number {
  const assigned = assignPitchGridFrequencies([point], dimension);
  return assigned[0].frequency;
}

/** 視点の追跡位置。 */
interface Aim {
  readonly x: number;
  readonly y: number;
}

/** 操作と採取の時系列の記録。証拠に残し、合否の判定は検査側が行う。 */
interface InteractOperationLog {
  readonly middleOrder: readonly number[];
  readonly moveBaseX: number;
  readonly moveResults: readonly { readonly dx: number; readonly dy: number; readonly frequencyHz: number }[];
  readonly topBaseX: number;
  readonly dimensionResults: readonly { readonly dimension: number; readonly frequencyHz: number }[];
  readonly clickTrusted: boolean[];
}

describe.skipIf(process.env['XRIFT_INTERACT_CAPTURE'] !== '1')(
  '実操作起点の音高格子の採取',
  () => {
    it(
      '格子の照準・オンオフ・複数音・八方向移動・端拒否・次元切替を判定する',
      async () => {
        // 期待する発音周波数は Node 側の純粋計算から求める。
        // 単一声の期待値は単点集合の配置から求める。
        const middleFreqs = MIDDLE_X_ORDER.map((x) => singleAssignedFrequency({ x, y: 0 }, 3));
        const topFreqsOf = (dimension: 3 | 4 | 5): number[] =>
          MIDDLE_X_ORDER.map((x) => singleAssignedFrequency({ x, y: 1 }, dimension));

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
          const evidenceDir = fileURLToPath(
            new URL('../../tmp/harmonic-interact-capture/', import.meta.url),
          );
          await mkdir(evidenceDir, { recursive: true });
          const stamp = new Date().toISOString().replace(/:/g, '-');

          const gotoFresh = async (): Promise<void> => {
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
            await sleep(1500);
          };

          // 視点の追跡位置。相対移動だけを行い、再照準は記録した絶対位置へ戻る。
          // 画面外への累積を避けるため、移動量が目安を超えたら ESC リベースで区切る。
          let mouseX = 400;
          let mouseY = 300;
          const crosshair = (): Promise<boolean | null> =>
            page.evaluate(() => window.__crosshairActive());
          const look = async (dx: number, dy: number): Promise<boolean | null> => {
            mouseX += dx;
            mouseY += dy;
            await page.mouse.move(mouseX, mouseY, { steps: 2 });
            await sleep(LOOK_SETTLE_MS);
            return crosshair();
          };
          const aimAt = async (aim: Aim): Promise<void> => {
            mouseX = aim.x;
            mouseY = aim.y;
            await page.mouse.move(mouseX, mouseY, { steps: 4 });
            await sleep(LOOK_SETTLE_MS);
          };
          // 中央への信頼済み押下で操作口を駆動する。
          const clickAtCenter = async (): Promise<void> => {
            await page.mouse.move(mouseX, mouseY);
            await page.mouse.down();
            await sleep(20);
            await page.mouse.up();
            await sleep(300);
          };
          // ポインターロックを外してカーソルを中央へ戻し、掛け直す。
          // 視点は動かさないため照準は保たれる。押下が操作にならない空で押す。
          // headless では ESC 押下で外れないため、API で外す。
          const rebaseLook = async (): Promise<void> => {
            for (let step = 0; step < 30; step += 1) {
              const hit = await crosshair();
              if (hit === false) {
                break;
              }
              await look(6, 0);
            }
            await page.evaluate(() => document.exitPointerLock());
            await sleep(300);
            const unlocked = await page.evaluate(() => window.__locked());
            if (unlocked) {
              await page.screenshot({
                path: `${evidenceDir}pitch-grid-unlock-fail-${stamp}.png`,
              });
              throw new Error('ポインターロックが外れない');
            }
            mouseX = 400;
            mouseY = 300;
            await page.mouse.move(mouseX, mouseY);
            await sleep(200);
            const locked = await page.evaluate(() => window.__locked());
            if (!locked) {
              await clickAtCenter();
            }
          };
          // 長い走査の途中でリベースし、画面外への累積を消す。
          const maybeRebase = async (): Promise<void> => {
            if (Math.abs(mouseX - 400) + Math.abs(mouseY - 300) >= REBASE_EVERY_PX) {
              await rebaseLook();
            }
          };
          // 進捗の記録。時間切れ時の切り分け用であり、合否の判定は検査側が行う。
          const mark = async (phase: string): Promise<void> => {
            await writeFile(
              `${evidenceDir}pitch-grid-progress-${stamp}.log`,
              `${new Date().toISOString()} ${phase} aim=(${mouseX},${mouseY})\n`,
              { flag: 'a' },
            );
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
          // 成分測定は採取窓が信号で満たされてから行う。
          const readLevels = async (frequencies: readonly number[]): Promise<number[]> => {
            await page.evaluate(() => window.__setFftSize(16384));
            await sleep(COMPONENT_WINDOW_MS);
            const levels: number[] = [];
            for (const frequency of frequencies) {
              levels.push(await levelDbOf(frequency));
            }
            return levels;
          };
          const argMax = (levels: readonly number[]): number => {
            let best = 0;
            for (let index = 1; index < levels.length; index += 1) {
              if (
                (levels[index] ?? Number.NEGATIVE_INFINITY) >
                (levels[best] ?? Number.NEGATIVE_INFINITY)
              ) {
                best = index;
              }
            }
            return best;
          };
          // 現在の命中 run の中央へ寄せる。再照準を確実にするための調整であり合否ではない。
          const centerOfHit = async (): Promise<Aim> => {
            let forward = 0;
            for (; forward < 40; forward += 1) {
              await maybeRebase();
              const hit = await look(LOOK_STEP_PX, 0);
              if (hit !== true) {
                break;
              }
            }
            const back = Math.floor(forward / 2);
            for (let index = 0; index < back; index += 1) {
              await look(-LOOK_STEP_PX, 0);
            }
            // 端に寄り過ぎた場合に戻す。
            const live = await crosshair();
            if (live !== true) {
              for (let index = 0; index < back; index += 1) {
                const hit = await look(LOOK_STEP_PX, 0);
                if (hit === true) {
                  break;
                }
              }
            }
            return { x: mouseX, y: mouseY };
          };
          // 命中するまで視点を動かす。見つからない場合は証拠用の失敗として投げる。
          const scanUntilHit = async (dx: number, dy: number, label: string): Promise<Aim> => {
            for (let step = 0; step < SCAN_MAX_STEPS; step += 1) {
              await maybeRebase();
              const hit = await look(dx, dy);
              if (hit === true) {
                return centerOfHit();
              }
            }
            await page.screenshot({ path: `${evidenceDir}pitch-grid-scan-fail-${label}-${stamp}.png` });
            throw new Error(`操作対象が見つからない: ${label}`);
          };
          // 非命中になるまで視点を動かす（隙間への移動）。見つからない場合は投げる。
          const scanUntilMiss = async (dx: number, dy: number, label: string): Promise<void> => {
            for (let step = 0; step < SCAN_MAX_STEPS; step += 1) {
              await maybeRebase();
              const hit = await look(dx, dy);
              if (hit === false) {
                return;
              }
            }
            throw new Error(`隙間が見つからない: ${label}`);
          };
          // 左の何もない所まで視点を振る。開始位置によらず格子の左へ出る。
          const swingToLeftVoid = async (): Promise<void> => {
            let missRun = 0;
            while (missRun < 150) {
              await maybeRebase();
              const hit = await look(-LOOK_STEP_PX, 0);
              missRun = hit === true ? 0 : missRun + 1;
            }
          };
          // 右へ段を走査し、命中の列を左から集める。右側の空で止まる。
          const collectRowRight = async (label: string): Promise<Aim[]> => {
            const aims: Aim[] = [];
            for (;;) {
              let found = false;
              for (let step = 0; step < 150; step += 1) {
                await maybeRebase();
                const hit = await look(LOOK_STEP_PX, 0);
                if (hit === true) {
                  found = true;
                  break;
                }
              }
              if (!found) {
                return aims;
              }
              aims.push(await centerOfHit());
              await scanUntilMiss(LOOK_STEP_PX, 0, `${label}-gap-${aims.length}`);
            }
          };
          // 平行移動で位置を変える。視点の向きは変えない確定移動である。
          const strafe = async (key: 'a' | 'd', ms: number): Promise<void> => {
            await page.keyboard.down(key);
            await sleep(ms);
            await page.keyboard.up(key);
            await sleep(800);
          };
          // 中段の点を押して同定する。調べた後は止める。
          const identifyMiddle = async (
            aim: Aim,
            found: number | string,
          ): Promise<{ readonly index: number; readonly toneRms: number }> => {
            await aimAt(aim);
            // 照準が生きた命中であることを確かめてから押す。
            const live = await crosshair();
            expect(live, `中段${found}の照準`).toBe(true);
            await clickAtCenter();
            const toneRms = await waitForTone();
            if (toneRms < TONE_RMS_MIN) {
              // 診断用に成分と画面を残して失敗する。
              const diagLevels = await readLevels(middleFreqs);
              await page.screenshot({
                path: `${evidenceDir}pitch-grid-notone-${found}-${stamp}.png`,
              });
              await mark(`notone-${found} levels=${diagLevels.join(',')}`);
            }
            expect(toneRms, `中段${found}の発音`).toBeGreaterThan(TONE_RMS_MIN);
            await sleep(POST_ACTION_SETTLE_MS);
            const levels = await readLevels(middleFreqs);
            const index = argMax(levels);
            await clickAtCenter();
            await waitForStopped(toneRms);
            return { index, toneRms };
          };

          // ========== 局面1：中段5点・オンオフ・複数音（スポーン位置） ==========
          await gotoFresh();
          const baselineContexts = await page.evaluate(() => window.__contextCount());
          await page.screenshot({ path: `${evidenceDir}pitch-grid-label-${stamp}.png` });
          await rebaseLook();
          await swingToLeftVoid();
          const middleAims: Aim[] = [];
          const middleIdentified: number[] = [];
          for (let found = 0; found < MIDDLE_X_ORDER.length; found += 1) {
            const aim = await scanUntilHit(6, 0, `middle-${found}`);
            middleAims.push(aim);
            const identified = await identifyMiddle(aim, found);
            middleIdentified.push(identified.index);
            if (found < MIDDLE_X_ORDER.length - 1) {
              await scanUntilMiss(LOOK_STEP_PX, 0, `middle-gap-${found}`);
            }
          }
          // 左から右への遭遇順が横座標の順序と一致することで配置の対応を確かめる。
          expect(middleIdentified).toEqual([0, 1, 2, 3, 4]);
          const middleAim = (index: number): Aim => {
            const aim = middleAims[index];
            if (aim === undefined) {
              throw new Error(`中段の対応付けがない: ${index}`);
            }
            return aim;
          };

          // オン・オフ：中央点の切替と成分の出現・消失。
          await aimAt(middleAim(2));
          await clickAtCenter();
          const singleRms = await waitForTone();
          await sleep(POST_ACTION_SETTLE_MS);
          const singleLevels = await readLevels(middleFreqs);
          const singlePeak = await page.evaluate(() => window.__peak(0));
          await clickAtCenter();
          const singleStoppedRms = await waitForStopped(singleRms);
          await sleep(POST_ACTION_SETTLE_MS);
          const singleOffLevels = await readLevels(middleFreqs);

          // 複数音の発音と停止：隣の2点を鳴らし、成分と消音を確かめる。
          // 二声の同時発音は集合単位の配置に従い、単点の値とは限らない。
          const duoFreqs = assignPitchGridFrequencies(
            [
              { x: MIDDLE_X_ORDER[2], y: 0 },
              { x: MIDDLE_X_ORDER[3], y: 0 },
            ],
            3,
          ).map((voice) => voice.frequency);
          await aimAt(middleAim(2));
          await clickAtCenter();
          await waitForTone();
          await aimAt(middleAim(3));
          await clickAtCenter();
          const duoRms = await waitForTone();
          await sleep(POST_ACTION_SETTLE_MS);
          const duoLevels = await readLevels(duoFreqs);
          const duoPeak = await page.evaluate(() => window.__peak(0));
          await aimAt(middleAim(2));
          await clickAtCenter();
          await aimAt(middleAim(3));
          await clickAtCenter();
          const duoStoppedRms = await waitForStopped(duoRms);

          // 発音中の画面を残す。オン表示の証拠にする。
          await aimAt(middleAim(2));
          await clickAtCenter();
          await waitForTone();
          await page.screenshot({ path: `${evidenceDir}pitch-grid-playing-${stamp}.png` });
          await clickAtCenter();
          await waitForStopped(duoRms);

          // ========== 局面2：移動パッド・八方向・端・次元（右寄り位置） ==========
          // 視点の向きを確定状態へ戻し、パッドの下へ平行移動する。
          await mark('phase1-done');
          await gotoFresh();
          mouseX = 400;
          mouseY = 300;
          await rebaseLook();
          await mark('phase2-start');
          // パッド中段を探す：見つからなければ右へ寄る適応移動で補う。
          let padMiddleLeft: Aim | null = null;
          for (let attempt = 0; attempt < 6 && padMiddleLeft === null; attempt += 1) {
            for (let step = 0; step < 120; step += 1) {
              await maybeRebase();
              const hit = await look(6, 0);
              if (hit === true) {
                padMiddleLeft = await centerOfHit();
                break;
              }
            }
            if (padMiddleLeft === null) {
              await strafe('d', 200);
              await rebaseLook();
            }
          }
          if (padMiddleLeft === null) {
            throw new Error('移動パッドが見つからない');
          }
          // パッドの命中が格子の中段点でないことを成分で裏付ける。
          // 格子の中段点なら中央成分のいずれかが鳴るが、パッドは空集合の移動で無音である。
          await aimAt(padMiddleLeft);
          await clickAtCenter();
          await sleep(600);
          const padTouchRms = await readRms();
          expect(padTouchRms, 'パッド初回押下の無音（空集合の移動）').toBeLessThan(STOPPED_RMS_MAX);

          // 上段へ登る：命中を辿って登り、外れ続けたら最後の命中に戻る。
          // パッドの列の上に格子はないため、上段の上が空であることで止まる。
          let padTopLeft: Aim = padMiddleLeft;
          for (;;) {
            await maybeRebase();
            const hit = await look(0, -LOOK_STEP_PX);
            if (hit === true) {
              padTopLeft = { x: mouseX, y: mouseY };
              continue;
            }
            let found = false;
            for (let probe = 0; probe < 80; probe += 1) {
              await maybeRebase();
              const probeHit = await look(0, -LOOK_STEP_PX);
              if (probeHit === true) {
                padTopLeft = { x: mouseX, y: mouseY };
                found = true;
                break;
              }
            }
            if (!found) {
              break;
            }
          }
          await aimAt(padTopLeft);
          // 段走査：各段の左端から右へ数える。上段3・中段2（中央穴）・下段3。
          const padAims: Aim[][] = [];
          let rowStart: Aim = padTopLeft;
          for (let row = 0; row < 3; row += 1) {
            await aimAt(rowStart);
            const rowAims: Aim[] = [await centerOfHit()];
            await scanUntilMiss(LOOK_STEP_PX, 0, `pad-row-gap-${row}-0`);
            const rest = await collectRowRight(`pad-row-${row}`);
            for (const aim of rest) {
              rowAims.push(aim);
            }
            padAims.push(rowAims);
            if (row < 2) {
              // 次の段へ降りる：左端の列を保って隙間を抜ける。
              await aimAt(rowStart);
              await scanUntilMiss(0, LOOK_STEP_PX, `pad-row-down-gap-${row}`);
              rowStart = await scanUntilHit(0, LOOK_STEP_PX, `pad-row-down-${row}`);
            }
          }
          // 上段3・中段2（中央穴）・下段3の8釦であること。
          expect(padAims.map((row) => row.length)).toEqual([3, 2, 3]);
          const padByDir = (dx: number, dy: number): Aim => {
            // 段は上から下へ、列は左から右へ数える。中段の右は列を詰める。
            const row = dy === 1 ? 0 : dy === 0 ? 1 : 2;
            const column = dx === -1 ? 0 : dx === 0 ? 1 : row === 1 ? 1 : 2;
            const aim = padAims[row]?.[column];
            if (aim === undefined) {
              throw new Error(`移動釦の対応付けがない: (${dx}, ${dy})`);
            }
            return aim;
          };

          // 移動の起点：パッドから左へ走査し、内側の中段点 (1,0) を同定する。
          await aimAt(padMiddleLeft);
          await scanUntilMiss(-LOOK_STEP_PX, 0, 'base-gap');
          const baseSecond = await scanUntilHit(-6, 0, 'base-second');
          const baseSecondId = await identifyMiddle(baseSecond, 'base-second');
          expect(baseSecondId.index, '起点の右隣は(2,0)').toBe(4);
          await aimAt(baseSecond);
          await scanUntilMiss(-LOOK_STEP_PX, 0, 'base-gap-2');
          const baseAim = await scanUntilHit(-6, 0, 'base-first');
          const baseId = await identifyMiddle(baseAim, 'base-first');
          expect(baseId.index, '移動の起点は(1,0)').toBe(3);
          const moveBaseX = MIDDLE_X_ORDER[baseId.index] ?? 1;
          // 起点を鳴らしたままにする。
          await aimAt(baseAim);
          await clickAtCenter();
          await waitForTone();
          // 移動の各局面は単一点の発声のため、単点集合の配置から求める。
          const moveFreqOf = (dx: number, dy: number): number =>
            singleAssignedFrequency({ x: moveBaseX + dx, y: dy }, 3);
          const moveCandidates = [
            singleAssignedFrequency({ x: moveBaseX, y: 0 }, 3),
            ...MOVE_DIRS.map(({ dx, dy }) => moveFreqOf(dx, dy)),
            singleAssignedFrequency({ x: -2, y: 0 }, 3),
          ];

          // 八方向移動：単一点を全方向へ動かし、成分で確かめる。動かしては逆向きに戻す。
          const moveResults: { readonly dx: number; readonly dy: number; readonly frequencyHz: number }[] = [];
          await mark('moves-start');
          for (const { dx, dy } of MOVE_DIRS) {
            const before = await readLevels([moveCandidates[0] ?? -1]);
            const button = padByDir(dx, dy);
            await aimAt(button);
            await clickAtCenter();
            await sleep(POST_ACTION_SETTLE_MS);
            const levels = await readLevels(moveCandidates);
            const expected = moveFreqOf(dx, dy);
            const expectedIndex = moveCandidates.indexOf(expected);
            moveResults.push({ dx, dy, frequencyHz: moveCandidates[argMax(levels)] ?? -1 });
            expect(levels[expectedIndex] ?? Number.NEGATIVE_INFINITY, `移動(${dx},${dy})の成分`).toBeGreaterThan(
              PRESENT_DB_MIN,
            );
            expect(argMax(levels), `移動(${dx},${dy})の最大成分`).toBe(expectedIndex);
            expect(
              (before[0] ?? 0) - (levels[0] ?? 0),
              `移動(${dx},${dy})の旧成分の落ち込み`,
            ).toBeGreaterThan(ABSENT_DROP_DB_MIN);
            // 逆向きに戻す。
            const back = padByDir(-dx, -dy);
            await aimAt(back);
            await clickAtCenter();
            await sleep(POST_ACTION_SETTLE_MS);
            const restored = await readLevels(moveCandidates);
            expect(argMax(restored), `復帰(${-dx},${-dy})の最大成分`).toBe(0);
            expect(restored[0] ?? Number.NEGATIVE_INFINITY, '復帰後の起点成分').toBeGreaterThan(
              PRESENT_DB_MIN,
            );
          }

          // 端拒否：左端 (-2,0) の点は格子外へ出る移動を受け付けない。
          // 起点 (1,0) から左へ3つ進み、左端で鳴らす。
          await mark('moves-done');
          await aimAt(baseAim);
          await scanUntilMiss(-LOOK_STEP_PX, 0, 'edge-gap-1');
          await scanUntilHit(-6, 0, 'edge-hop-1');
          await scanUntilMiss(-LOOK_STEP_PX, 0, 'edge-gap-2');
          const edgeRestoreAim = await scanUntilHit(-6, 0, 'edge-hop-2');
          await scanUntilMiss(-LOOK_STEP_PX, 0, 'edge-gap-3');
          const edgeAim = await scanUntilHit(-6, 0, 'edge-hop-3');
          await aimAt(edgeAim);
          await clickAtCenter();
          await waitForTone();
          await sleep(POST_ACTION_SETTLE_MS);
          const edgeLevels = await readLevels(moveCandidates);
          // 左端の点は起点と鳴り続ける二点集合で配置される。
          const edgeAssigned = assignPitchGridFrequencies(
            [
              { x: moveBaseX, y: 0 },
              { x: -2, y: 0 },
            ],
            3,
          );
          const edgeVoice = edgeAssigned.find(
            (voice) => voice.key === pitchGridKey({ x: -2, y: 0 }),
          );
          if (edgeVoice === undefined) {
            throw new Error('左端の配置が求まらない');
          }
          const edgeHz = edgeVoice.frequency;
          const edgeIndex = moveCandidates.indexOf(edgeHz);
          expect(edgeIndex).toBeGreaterThanOrEqual(0);
          expect(edgeLevels[edgeIndex] ?? Number.NEGATIVE_INFINITY, '左端の成分').toBeGreaterThan(
            PRESENT_DB_MIN,
          );
          // さらに左への移動は集合全体で行わず、音は端のまま残る。
          await aimAt(padByDir(-1, 0));
          await clickAtCenter();
          await sleep(POST_ACTION_SETTLE_MS);
          const rejectedLevels = await readLevels(moveCandidates);
          expect(
            rejectedLevels[edgeIndex] ?? Number.NEGATIVE_INFINITY,
            '端拒否後の左端成分',
          ).toBeGreaterThan(PRESENT_DB_MIN);
          expect(argMax(rejectedLevels), '端拒否後の最大成分').toBe(edgeIndex);
          expect(await readRms(), '端拒否後の発音').toBeGreaterThan(TONE_RMS_MIN);
          // 右へ戻して止める。
          await aimAt(padByDir(1, 0));
          await clickAtCenter();
          await sleep(POST_ACTION_SETTLE_MS);
          const restoreRms = await readRms();
          await aimAt(edgeRestoreAim);
          await clickAtCenter();
          const edgeStoppedRms = await waitForStopped(restoreRms);

          // 空集合の移動：発音しない。
          await aimAt(padByDir(1, 0));
          await clickAtCenter();
          await sleep(600);
          expect(await readRms(), '空集合の移動の無音').toBeLessThan(STOPPED_RMS_MAX);

          // 次元選択：上段の点を鳴らし、3列の釦を左から3・4・5次元として操作する。
          // パッド上段左から左へ走査し、上段の点を同定する。
          await mark('edge-done');
          const padTopRow = padAims[0];
          if (padTopRow === undefined || padTopRow[0] === undefined) {
            throw new Error('パッド上段の対応付けがない');
          }
          await aimAt(padTopRow[0]);
          await scanUntilMiss(-LOOK_STEP_PX, 0, 'top-gap');
          const topAim = await scanUntilHit(-6, 0, 'top-first');
          await aimAt(topAim);
          await clickAtCenter();
          const dimBaseRms = await waitForTone();
          await sleep(POST_ACTION_SETTLE_MS);
          // 上段の同定：3次元の上段候補のうち最大のものを起点にする。
          const topBaseLevels = await readLevels(topFreqsOf(3));
          const topBaseIndex = argMax(topBaseLevels);
          const topBaseX = MIDDLE_X_ORDER[topBaseIndex] ?? 0;
          expect(topBaseLevels[topBaseIndex] ?? Number.NEGATIVE_INFINITY, '上段起点の成分').toBeGreaterThan(
            PRESENT_DB_MIN,
          );
          const topFreqOf = (dimension: 3 | 4 | 5): number =>
            singleAssignedFrequency({ x: topBaseX, y: 1 }, dimension);
          // 次元釦列へ降りる：パッド下段左から真下へ走査し、左端から右へ数える。
          const padBottomRow = padAims[2];
          if (padBottomRow === undefined || padBottomRow[0] === undefined) {
            throw new Error('パッド下段の対応付けがない');
          }
          await aimAt(padBottomRow[0]);
          await scanUntilMiss(0, LOOK_STEP_PX, 'dim-gap');
          const dimFirst = await scanUntilHit(0, LOOK_STEP_PX, 'dim-hit');
          await aimAt(dimFirst);
          // 列の左端へ寄せる。左側の格子には届かない短さに留める。
          for (let step = 0; step < 40; step += 1) {
            await maybeRebase();
            const hit = await look(-LOOK_STEP_PX, 0);
            if (hit !== true) {
              break;
            }
          }
          const dimAims: Aim[] = await collectRowRight('dim');
          expect(dimAims.length, '次元釦の数').toBe(3);
          const dimensionResults: { readonly dimension: number; readonly frequencyHz: number }[] = [];
          // 同じ次元の選び直しは何もしない（発音が続く）。
          const dim3Aim = dimAims[0];
          if (dim3Aim === undefined) {
            throw new Error('3次元釦の対応付けがない');
          }
          await aimAt(dim3Aim);
          await clickAtCenter();
          await sleep(600);
          expect(await readRms(), '同じ次元の選び直しの継続').toBeGreaterThan(TONE_RMS_MIN);
          // 4・5・3次元の順に切り替え、旧音の停止と新次元の再選択を確かめる。
          const switchOrder = [4, 5, 3] as const;
          await mark('dim-buttons-found');
          for (const dimension of switchOrder) {
            const aim = dimAims[dimension - 3];
            if (aim === undefined) {
              throw new Error(`次元釦の対応付けがない: ${dimension}`);
            }
            await aimAt(aim);
            await clickAtCenter();
            const stoppedRms = await waitForStopped(dimBaseRms);
            expect(stoppedRms, `${dimension}次元切替の停止`).toBeLessThan(STOPPED_RMS_MAX);
            // 新次元で上点を選び直す。
            await aimAt(topAim);
            await clickAtCenter();
            const reselectedRms = await waitForTone();
            await sleep(POST_ACTION_SETTLE_MS);
            const topFreqs = [topFreqOf(3), topFreqOf(4), topFreqOf(5)];
            const reselected = await readLevels(topFreqs);
            const expectedTopIndex = topFreqs.indexOf(topFreqOf(dimension));
            dimensionResults.push({
              dimension,
              frequencyHz: topFreqs[argMax(reselected)] ?? -1,
            });
            expect(reselectedRms, `${dimension}次元の再選択の発音`).toBeGreaterThan(TONE_RMS_MIN);
            expect(
              reselected[expectedTopIndex] ?? Number.NEGATIVE_INFINITY,
              `${dimension}次元の上点成分`,
            ).toBeGreaterThan(PRESENT_DB_MIN);
            expect(argMax(reselected), `${dimension}次元の最大成分`).toBe(expectedTopIndex);
            // 次の切替に備えて止める。
            await clickAtCenter();
            await waitForStopped(reselectedRms);
          }

          const clickTrusted = await page.evaluate(() => window.__mousedownTrusted);
          const contextStates = await page.evaluate(() => window.__contextStates());
          const contextCount = await page.evaluate(() => window.__contextCount());
          const tapCount = await page.evaluate(() => window.__tapCount());

          const operationLog: InteractOperationLog = {
            middleOrder: middleIdentified,
            moveBaseX,
            moveResults,
            topBaseX,
            dimensionResults,
            clickTrusted,
          };
          const evidence = {
            scenario: 'pitch-grid-interact-capture',
            environment: {
              browser: `chromium/${version}`,
              devUrl,
              viewport: [800, 600],
              autoplayPolicy: 'default(require-gesture)',
              componentFftSize: COMPONENT_FFT_SIZE,
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
              stoppedRmsMax: STOPPED_RMS_MAX,
              stoppedRmsRatioMax: STOPPED_RMS_RATIO_MAX,
              presentDbMin: PRESENT_DB_MIN,
              absentDbMax: ABSENT_DB_MAX,
              absentDropDbMin: ABSENT_DROP_DB_MIN,
            },
            measurements: {
              baselineContexts,
              middleFreqs,
              singleRms,
              singlePeak,
              singleStoppedRms,
              singleOffCenterDb: singleOffLevels[2],
              duoRms,
              duoPeak,
              duoStoppedRms,
              edgeStoppedRms,
              dimBaseRms,
            },
            note: '開発環境の音声グラフ内の標本であり、ホスト環境と物理出力の証明にはならない',
          };
          await writeFile(
            `${evidenceDir}pitch-grid-capture-${stamp}-chromium.json`,
            `${JSON.stringify(evidence, null, 2)}\n`,
          );
          await page.close();

          // 操作前は無音（文脈なし）であり、操作起点で文脈が生まれること。
          expect(baselineContexts).toBe(BASELINE_CONTEXT_COUNT);
          // 中段5点の配置対応は走査順の同定で確かめた（middleIdentified の一致）。
          // 単声：非無音かつ過大でなく、狙った成分を持つこと。
          expect(singleRms).toBeGreaterThan(TONE_RMS_MIN);
          expect(singleRms).toBeLessThan(TONE_RMS_MAX);
          expect(singlePeak).toBeLessThan(TONE_PEAK_MAX);
          expect(singleLevels[2] ?? Number.NEGATIVE_INFINITY).toBeGreaterThan(PRESENT_DB_MIN);
          for (const [index, level] of singleLevels.entries()) {
            if (index !== 2) {
              expect(level, `単声時の非対象成分${index}`).toBeLessThan(ABSENT_DB_MAX);
            }
          }
          // オフ：中央成分が底に落ち、消音すること。
          expect(singleOffLevels[2] ?? Number.POSITIVE_INFINITY).toBeLessThan(ABSENT_DB_MAX);
          expect((singleLevels[2] ?? 0) - (singleOffLevels[2] ?? 0)).toBeGreaterThan(
            ABSENT_DROP_DB_MIN,
          );
          expect(singleStoppedRms).toBeLessThan(STOPPED_RMS_MAX);
          // 複数音：2点の成分を持ち、過大でなく、全停止で消音すること。
          expect(duoRms).toBeGreaterThan(TONE_RMS_MIN);
          expect(duoRms).toBeLessThan(TONE_RMS_MAX);
          expect(duoPeak).toBeLessThan(TONE_PEAK_MAX);
          for (const [index, frequency] of duoFreqs.entries()) {
            expect(
              duoLevels[index] ?? Number.NEGATIVE_INFINITY,
              `複数音の成分${frequency}Hz`,
            ).toBeGreaterThan(PRESENT_DB_MIN);
          }
          expect(duoStoppedRms).toBeLessThan(STOPPED_RMS_MAX);
          // 八方向移動と次元切替の効果は操作直後に確かめた（moveResults/dimensionResults）。
          expect(moveResults).toHaveLength(MOVE_DIRS.length);
          for (const result of moveResults) {
            expect(result.frequencyHz).toBe(
              singleAssignedFrequency({ x: moveBaseX + result.dx, y: result.dy }, 3),
            );
          }
          expect(dimensionResults.map((result) => result.dimension)).toEqual([4, 5, 3]);
          for (const result of dimensionResults) {
            expect(result.frequencyHz).toBe(
              singleAssignedFrequency({ x: topBaseX, y: 1 }, result.dimension as 3 | 4 | 5),
            );
          }
          // 全操作が信頼済み入力であり、文脈は操作由来の再開で動くこと。
          expect(clickTrusted.length).toBeGreaterThanOrEqual(10);
          for (const trusted of clickTrusted) {
            expect(trusted).toBe(true);
          }
          expect(contextStates).toContain('running');
          // 格子操作で1つの文脈と1つの採取口を共有すること。
          expect(contextCount).toBe(SHARED_CONTEXT_COUNT);
          expect(tapCount).toBe(SHARED_CONTEXT_COUNT);
        } finally {
          await browser.close();
          if (server !== null) {
            await server.close();
          }
        }
      },
      600000,
    );
  },
);