/**
 * 意味論和音を専有の発音口へ反映する小さな session。
 *
 * 呼び出し側が `SemanticChord` と解音周波数を供給し、解決・純粋変換・
 * 検査を経て専有の `PitchGridSound` へ届ける。既存 `pitchGridController`
 * とは別経路とし、同じ発音口への二重反映はしない。常設診断口・表示快照・
 * 共有状態は持たない。
 *
 * @packageDocumentation
 */

import {
  PITCH_GRID_MAX_VOICES,
  createPitchGridSound,
  type PitchGridSound,
} from './pitchGridSound';
import { resolveSemanticChord, type SemanticChord } from './semanticChord';
import { toSemanticChordVoiceSpecs } from './semanticChordVoices';

/** session 生成時の設定。 */
export interface SemanticChordSoundSessionOptions {
  /**
   * 専有する発音口の生成口。省略時は `createPitchGridSound`。
   * 検査では代替物に差し替える。
   */
  readonly createSound?: () => PitchGridSound;
}

/**
 * 意味論和音の専用発音口。
 *
 * 発音口を専有し、遅延生成する。解音周波数は反映ごとに明示引数で受け、
 * 既定値や格子基準の読み取りを置かない。
 */
export interface SemanticChordSoundSession {
  /**
   * 和音を解決して発音口へ反映する。
   *
   * 同一次元の反映は `setVoices`、次元が変わった反映は `switchDimension`
   * で行う。解決・変換・検査を終えてから発音口を生成・更新する。
   *
   * @param chord - 意味論の和音とベース。変更しない。
   * @param resolutionToneFrequencyHz - 解音周波数（Hz）。正の有限値。
   * @returns 発音口の反映完了で解決する約束。
   * @throws `RangeError` — 解音周波数が正の有限値でない、和音が不正、
   * 声数が上限を超える場合。発音口の生成・更新は行わない。
   * @throws `Error` — 破棄後に呼び出した場合。発音失敗時はその失敗を伝える。
   */
  reflect(chord: SemanticChord, resolutionToneFrequencyHz: number): Promise<void>;
  /**
   * 全声を止める。
   *
   * 発音口が未生成の場合は何もしない。音声文脈を作らない。
   */
  stop(): void;
  /**
   * 発音口を一度だけ破棄する。
   *
   * 発音口が未生成の場合は何もしない。複数回呼んでも破棄は一度だけ行う。
   */
  dispose(): Promise<void>;
}

/**
 * 意味論和音の専用発音口を作る。
 *
 * @param options - 発音口の生成口の差し替え。省略時は既定の生成口を使う。
 * @returns 専有の発音口を駆動する session。
 */
export function createSemanticChordSoundSession(
  options: SemanticChordSoundSessionOptions = {},
): SemanticChordSoundSession {
  const createSound = options.createSound ?? createPitchGridSound;
  let sound: PitchGridSound | null = null;
  // 直近に反映した主要次元。次元変更の判定に使う。反映の成功後に更新し、
  // 失敗時は判定基準を動かさない。
  let lastDimension: SemanticChord['primaryDimension'] | null = null;
  let disposed = false;
  let disposePromise: Promise<void> | null = null;

  return {
    async reflect(chord: SemanticChord, resolutionToneFrequencyHz: number): Promise<void> {
      if (disposed) {
        throw new Error('破棄後の口は使えない');
      }
      // ADR: 解決・変換・検査を終えてから発音口を生成・更新する。
      // 不正入力や上限超過では発音口を作らず、既存の声に触れない。
      const resolved = resolveSemanticChord(chord, resolutionToneFrequencyHz);
      const specs = toSemanticChordVoiceSpecs(resolved);
      if (specs.length > PITCH_GRID_MAX_VOICES) {
        throw new RangeError(
          `意味論の声数は同時発音の上限以下であること: ${specs.length} > ${PITCH_GRID_MAX_VOICES}`,
        );
      }
      if (sound === null) {
        sound = createSound();
      }
      if (lastDimension !== null && lastDimension !== chord.primaryDimension) {
        await sound.switchDimension(specs);
      } else {
        await sound.setVoices(specs);
      }
      lastDimension = chord.primaryDimension;
    },
    stop(): void {
      sound?.stopAll();
    },
    async dispose(): Promise<void> {
      if (disposePromise !== null) {
        return disposePromise;
      }
      disposed = true;
      disposePromise = sound === null ? Promise.resolve() : sound.dispose();
      return disposePromise;
    },
  };
}
