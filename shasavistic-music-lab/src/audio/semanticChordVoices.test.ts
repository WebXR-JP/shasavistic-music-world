/**
 * 解決済み意味論和音から声仕様への純粋変換の単体検査。
 *
 * 役割と鍵の対応・周波数対応・機能根の二重発音回避・同音ベースの独立鍵・
 * オクターブ保持・解音変更での鍵不変・入力非変更・無効入力の拒否を確かめる。
 * 具体値はこの検査に置く。意味論解決の保証は `semanticChord.test.ts` が
 * 所有し、複製しない。
 */

import { describe, expect, it } from 'vitest';
import { resolveSemanticChord, type SemanticChord } from './semanticChord';
import { toSemanticChordVoiceSpecs } from './semanticChordVoices';

describe('役割と鍵の対応', () => {
  it('機能根・他の構成音・ベースを役割の鍵で声仕様にする', () => {
    const chord: SemanticChord = {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: {} },
      toneOffsets: [{ primeExponents: { 3: 1 } }, { primeExponents: { 5: 1 } }],
      bass: { primeExponents: { 2: 1 } },
    };

    const specs = toSemanticChordVoiceSpecs(resolveSemanticChord(chord, 440));

    // 機能根、他の構成音、ベースの順に並ぶこと。
    expect(specs).toEqual([
      { key: 'semantic:root:1/1', frequency: 440 },
      { key: 'semantic:tone:3/1', frequency: 1320 },
      { key: 'semantic:tone:5/1', frequency: 2200 },
      { key: 'semantic:bass:2/1', frequency: 880 },
    ]);
  });

  it('単音でも機能根の一声を作る', () => {
    const chord: SemanticChord = {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: {} },
      toneOffsets: [],
    };

    const specs = toSemanticChordVoiceSpecs(resolveSemanticChord(chord, 440));

    // 和声不成立でも発音禁止にしないこと。
    expect(specs).toEqual([{ key: 'semantic:root:1/1', frequency: 440 }]);
  });

  it('比率と周波数の対応は判定せず個別の正しさだけを確かめる', () => {
    const resolved = resolveSemanticChord(
      {
        primaryDimension: 3,
        functionalRootOffset: { primeExponents: {} },
        toneOffsets: [],
      },
      440,
    );

    // 比率と周波数の組がずれていても、個別に正しければ受け付けること。
    // 対応の正しさは `resolveSemanticChord` 経由で保つ。
    const specs = toSemanticChordVoiceSpecs({
      ...resolved,
      functionalRoot: { ratio: { numerator: 3, denominator: 1 }, frequency: 999 },
    });

    expect(specs).toEqual([{ key: 'semantic:root:3/1', frequency: 999 }]);
  });
});

describe('同音の扱い', () => {
  it('機能根と同音の他の構成音は機能根側に残す', () => {
    const chord: SemanticChord = {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: { 3: 1 } },
      toneOffsets: [{ primeExponents: {} }, { primeExponents: { 5: 1 } }],
    };

    const specs = toSemanticChordVoiceSpecs(resolveSemanticChord(chord, 440));

    // 零移動の構成音は機能根と同音のため落とし、異なる構成音だけ残ること。
    expect(specs).toEqual([
      { key: 'semantic:root:3/1', frequency: 1320 },
      { key: 'semantic:tone:15/1', frequency: 6600 },
    ]);
  });

  it('構成音と同音のベースは独立した鍵・一声とする', () => {
    const chord: SemanticChord = {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: {} },
      toneOffsets: [{ primeExponents: { 3: 1 } }],
      bass: { primeExponents: { 3: 1 } },
    };

    const specs = toSemanticChordVoiceSpecs(resolveSemanticChord(chord, 440));

    expect(specs).toEqual([
      { key: 'semantic:root:1/1', frequency: 440 },
      { key: 'semantic:tone:3/1', frequency: 1320 },
      { key: 'semantic:bass:3/1', frequency: 1320 },
    ]);
  });

  it('オクターブ違いは別の声として残す', () => {
    const chord: SemanticChord = {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: {} },
      toneOffsets: [{ primeExponents: { 2: 1 } }, { primeExponents: { 2: 2 } }],
    };

    const specs = toSemanticChordVoiceSpecs(resolveSemanticChord(chord, 440));

    expect(specs).toEqual([
      { key: 'semantic:root:1/1', frequency: 440 },
      { key: 'semantic:tone:2/1', frequency: 880 },
      { key: 'semantic:tone:4/1', frequency: 1760 },
    ]);
  });
});

describe('解音周波数と鍵の関係', () => {
  it('解音周波数だけを変えても鍵は変わらない', () => {
    const chord: SemanticChord = {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: {} },
      toneOffsets: [{ primeExponents: { 3: 1 } }, { primeExponents: { 5: 1 } }],
      bass: { primeExponents: { 2: 1 } },
    };

    const low = toSemanticChordVoiceSpecs(resolveSemanticChord(chord, 220));
    const high = toSemanticChordVoiceSpecs(resolveSemanticChord(chord, 440));

    expect(high.map((spec) => spec.key)).toEqual(low.map((spec) => spec.key));
    expect(high.map((spec) => spec.frequency)).toEqual(
      low.map((spec) => spec.frequency * 2),
    );
  });
});

describe('入力の扱いと無効入力の拒否', () => {
  it('入力オブジェクトを変更しない', () => {
    const resolved = resolveSemanticChord(
      {
        primaryDimension: 3,
        functionalRootOffset: { primeExponents: { 3: 1 } },
        toneOffsets: [{ primeExponents: { 2: 1 } }, { primeExponents: { 5: 1 } }],
        bass: { primeExponents: { 2: -1 } },
      },
      440,
    );
    const before = JSON.stringify(resolved);

    toSemanticChordVoiceSpecs(resolved);

    expect(JSON.stringify(resolved)).toBe(before);
  });

  it('解決済み和音の形でない入力を拒む', () => {
    const valid = resolveSemanticChord(
      {
        primaryDimension: 3,
        functionalRootOffset: { primeExponents: {} },
        toneOffsets: [{ primeExponents: { 3: 1 } }],
      },
      440,
    );

    for (const resolved of [null, undefined, 0, 'chord', []]) {
      expect(() =>
        toSemanticChordVoiceSpecs(resolved as unknown as typeof valid),
      ).toThrow(RangeError);
    }
    // 機能根の欠落と構成音の非配列は声を作れない。
    expect(() =>
      toSemanticChordVoiceSpecs({
        ...valid,
        functionalRoot: undefined,
      } as unknown as typeof valid),
    ).toThrow(RangeError);
    expect(() =>
      toSemanticChordVoiceSpecs({ ...valid, chordVoices: null } as unknown as typeof valid),
    ).toThrow(RangeError);
  });

  it('正規化できない比率と正でない周波数を拒む', () => {
    const valid = resolveSemanticChord(
      {
        primaryDimension: 3,
        functionalRootOffset: { primeExponents: {} },
        toneOffsets: [],
      },
      440,
    );

    // 分子ゼロの比率は正規化できない。
    expect(() =>
      toSemanticChordVoiceSpecs({
        ...valid,
        functionalRoot: { ratio: { numerator: 0, denominator: 1 }, frequency: 440 },
      }),
    ).toThrow(RangeError);
    // 正の有限値でない周波数は受け付けない。
    for (const frequency of [0, -440, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        toSemanticChordVoiceSpecs({
          ...valid,
          functionalRoot: { ratio: { numerator: 1, denominator: 1 }, frequency },
        }),
      ).toThrow(RangeError);
    }
    // ベースの不正も見逃さない。
    expect(() =>
      toSemanticChordVoiceSpecs({
        ...valid,
        bass: { ratio: { numerator: 2, denominator: 1 }, frequency: 0 },
      }),
    ).toThrow(RangeError);
  });
});
