/**
 * 解決済み意味論和音から発音口の声仕様への純粋変換。
 *
 * 鍵は役割と正規化済み論理比だけから作り、周波数・添字・時刻を含めない。
 * 解音周波数だけを変えても鍵は変わらない。和音側の同一比率は一声にまとめ、
 * 機能根と同音の他の構成音は機能根側に残す。ベースは同音でも独立した
 * 鍵・一声とする。音声資源・外部状態・時刻を読まず、入力を変更しない。
 *
 * @packageDocumentation
 */

import {
  type HarmonicRatioInput,
  normalizeHarmonicRatio,
} from './harmonicRatio';
import type { PitchGridVoiceSpec } from './pitchGridSound';
import type { ResolvedSemanticChord } from './semanticChord';

function failSemanticChordVoices(message: string): never {
  throw new RangeError(message);
}

/** 検査済みの一声。声仕様と比率の照合鍵を持つ。 */
interface CheckedVoice {
  /** 発音口へ渡す声仕様。 */
  readonly spec: PitchGridVoiceSpec;
  /** 正規化済み比率の照合鍵（`分子/分母` 形式）。 */
  readonly ratioKey: string;
}

// 一つの解決済み声を確かめ、役割の鍵で声仕様を作る。
// 比率が正規化できることと周波数が正の有限値であることだけを確かめ、
// 比率と周波数の対応の正しさは判定しない（基準周波数を持たず単独では
// 判定できないため。対応の正しさは `resolveSemanticChord` 経由で保つ）。
function checkedVoice(role: 'root' | 'tone' | 'bass', voice: unknown): CheckedVoice {
  if (voice === null || typeof voice !== 'object') {
    failSemanticChordVoices(`声は比率と周波数を持つこと: ${String(voice)}`);
  }
  const candidate = voice as { readonly ratio?: unknown; readonly frequency?: unknown };
  // ADR: `unknown` からの読み替えは実行時の検証へ渡すためだけに行い、
  // 型の成立は主張しない。不正な値は `normalizeHarmonicRatio` が
  // `RangeError` で拒む。
  const ratio = normalizeHarmonicRatio(candidate.ratio as HarmonicRatioInput);
  if (
    typeof candidate.frequency !== 'number' ||
    !Number.isFinite(candidate.frequency) ||
    candidate.frequency <= 0
  ) {
    failSemanticChordVoices(`声の周波数は正の有限値であること: ${String(candidate.frequency)}`);
  }
  return {
    spec: {
      key: `semantic:${role}:${ratio.numerator}/${ratio.denominator}`,
      frequency: candidate.frequency,
    },
    ratioKey: `${ratio.numerator}/${ratio.denominator}`,
  };
}

/**
 * 解決済み意味論和音を発音口の声仕様へ変換する。
 *
 * 機能根・他の構成音・ベースの順に並べる。他の構成音の順序は
 * 解決済みの低音順を保つ。`harmonyEstablished=false` の単音・二音も
 * 発音できる声仕様にする。
 *
 * @param resolved - 解決済み意味論和音。変更しない。
 * @returns 役割の鍵と周波数の声仕様。機能根、他の構成音、ベースの順。
 * @throws `RangeError` — 解決済み和音の形でない、比率が正規化できない、
 * 周波数が正の有限値でない、必要な要素が空の場合。
 * @remarks
 * 入力オブジェクトを変更しない。音声資源・外部状態・時刻を読まない。
 */
export function toSemanticChordVoiceSpecs(
  resolved: ResolvedSemanticChord,
): PitchGridVoiceSpec[] {
  if (resolved === null || typeof resolved !== 'object' || Array.isArray(resolved)) {
    failSemanticChordVoices(`解決済み和音は構造であること: ${String(resolved)}`);
  }
  if (!Array.isArray(resolved.chordVoices)) {
    failSemanticChordVoices(
      `他の構成音の声は配列であること: ${String(resolved.chordVoices)}`,
    );
  }
  const root = checkedVoice('root', resolved.functionalRoot);
  const specs: PitchGridVoiceSpec[] = [root.spec];
  const seenToneRatios = new Set<string>();
  for (const voice of resolved.chordVoices) {
    const tone = checkedVoice('tone', voice);
    // ADR: 機能根と同音の他の構成音は機能根側に残し、他構成音側の重複を
    // 落とす。オクターブ違いは比率が異なるため別の声として残る。
    if (tone.ratioKey === root.ratioKey || seenToneRatios.has(tone.ratioKey)) {
      continue;
    }
    seenToneRatios.add(tone.ratioKey);
    specs.push(tone.spec);
  }
  // ADR: ベースは構成音と同音でも発音上の役割が異なるため、独立した
  // 鍵・一声とする。構成音側との束ねは行わない。
  if (resolved.bass !== undefined) {
    specs.push(checkedVoice('bass', resolved.bass).spec);
  }
  if (specs.length === 0) {
    failSemanticChordVoices('声仕様は一つ以上あること');
  }
  return specs;
}
