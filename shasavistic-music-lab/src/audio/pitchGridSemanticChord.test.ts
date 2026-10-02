/**
 * 格子入力から意味論型への純粋変換の単体検査。
 *
 * 根と解音の差・各構成音と根の差・根の重複なし・単音と二音の保持・
 * 配置指数の伝達・根変更での解決音高の保持・解音再基準化での音高関係の
 * 保持・入力非変更・不正入力の拒否を確かめる。具体値はこの検査に置く。
 * 意味論解決の保証は `semanticChord.test.ts` が所有し、複製しない。
 * 対応表の保証は `pitchGrid.test.ts` が所有し、複製しない。
 */

import { describe, expect, it } from 'vitest';
import {
  toPitchGridSemanticChord,
  type PitchGridSemanticChordInput,
} from './pitchGridSemanticChord';
import { resolveSemanticChord } from './semanticChord';

/** 三次元の三点入力。根は A、配置指数は各点で異なる。 */
function threePointInput(): PitchGridSemanticChordInput {
  return {
    dimension: 3,
    points: [
      { x: 0, y: 0, k: 1 },
      { x: 1, y: 0, k: -1 },
      { x: 0, y: 1, k: 2 },
    ],
    functionalRoot: { x: 0, y: 0 },
  };
}

describe('根と解音と構成音の差', () => {
  it('機能根の移動は根の配置指数と座標をそのまま表す', () => {
    const chord = toPitchGridSemanticChord(threePointInput());

    // E(r) − E(s)。解音は零写像のため、根の写像そのものになる。
    expect(chord.primaryDimension).toBe(3);
    expect(chord.functionalRootOffset).toEqual({ primeExponents: { 2: 1 } });
  });

  it('各構成音の移動はその点と根の指数の差になる', () => {
    const chord = toPitchGridSemanticChord(threePointInput());

    // E(q) − E(r)。零の指数は落とす。
    expect(chord.toneOffsets).toEqual([
      { primeExponents: { 2: -2, 3: 1 } },
      { primeExponents: { 2: 1, 5: 1 } },
    ]);
  });

  it('根自身を構成音に重ねない', () => {
    const chord = toPitchGridSemanticChord(threePointInput());

    expect(chord.toneOffsets).toHaveLength(2);
    for (const offset of chord.toneOffsets) {
      expect(Object.keys(offset.primeExponents)).not.toHaveLength(0);
    }
  });

  it('選択次元の縦軸の素数を鍵に使う', () => {
    const chord = toPitchGridSemanticChord({
      dimension: 4,
      points: [{ x: 0, y: 1, k: 0 }],
      functionalRoot: { x: 0, y: 1 },
    });

    // 四次元の縦軸の素数は `7` であり、新しい対応表を作らない。
    expect(chord.functionalRootOffset).toEqual({ primeExponents: { 7: 1 } });
    expect(chord.toneOffsets).toEqual([]);
  });
});

describe('単音と二音の保持', () => {
  it('単音は構成音なしで保つ', () => {
    const chord = toPitchGridSemanticChord({
      dimension: 3,
      points: [{ x: 0, y: 0, k: 1 }],
      functionalRoot: { x: 0, y: 0 },
    });

    expect(chord.toneOffsets).toEqual([]);
    expect(chord.functionalRootOffset).toEqual({ primeExponents: { 2: 1 } });
  });

  it('二音は根以外の一点を構成音に保つ', () => {
    const chord = toPitchGridSemanticChord({
      dimension: 3,
      points: [
        { x: 0, y: 0, k: 1 },
        { x: 1, y: 0, k: -1 },
      ],
      functionalRoot: { x: 0, y: 0 },
    });

    expect(chord.toneOffsets).toEqual([{ primeExponents: { 2: -2, 3: 1 } }]);
  });
});

describe('配置指数の伝達', () => {
  it('各点で異なる配置指数を差として伝える', () => {
    const chord = toPitchGridSemanticChord({
      dimension: 3,
      points: [
        { x: 0, y: 0, k: 1 },
        { x: 1, y: 0, k: -2 },
        { x: -1, y: 1, k: 3 },
      ],
      functionalRoot: { x: 0, y: 0 },
    });

    // 素数2の指数の差が各点の `k` をそのまま反映すること。
    expect(chord.toneOffsets).toEqual([
      { primeExponents: { 2: -3, 3: 1 } },
      { primeExponents: { 2: 2, 3: -1, 5: 1 } },
    ]);
  });
});

describe('解決音高の保持', () => {
  it('根を変えても同じ格子点の解決音高を保つ', () => {
    const points = [
      { x: 0, y: 0, k: 1 },
      { x: 1, y: 0, k: -1 },
    ] as const;
    const rootA = toPitchGridSemanticChord({
      dimension: 3,
      points: [...points],
      functionalRoot: { x: 0, y: 0 },
    });
    const rootB = toPitchGridSemanticChord({
      dimension: 3,
      points: [...points],
      functionalRoot: { x: 1, y: 0 },
    });

    const resolvedA = resolveSemanticChord(rootA, 440);
    const resolvedB = resolveSemanticChord(rootB, 440);

    // 同じ格子点は根の選び方によらず同じ絶対音高になること。
    // 点 B は根 A の構成音では 660Hz、根 B の機能根でも 660Hz。
    expect(resolvedA.chordVoices.map((voice) => voice.frequency)).toEqual([660]);
    expect(resolvedB.functionalRoot.frequency).toBe(660);
    // 点 A は根 A の機能根では 880Hz、根 B の構成音でも 880Hz。
    expect(resolvedA.functionalRoot.frequency).toBe(880);
    expect(resolvedB.chordVoices.map((voice) => voice.frequency)).toEqual([880]);
  });

  it('解音を再基準化しても音高関係を保つ', () => {
    const chord = toPitchGridSemanticChord(threePointInput());

    const low = resolveSemanticChord(chord, 440);
    const high = resolveSemanticChord(chord, 880);

    const lowFrequencies = [
      low.functionalRoot.frequency,
      ...low.chordVoices.map((voice) => voice.frequency),
    ].sort((a, b) => a - b);
    const highFrequencies = [
      high.functionalRoot.frequency,
      ...high.chordVoices.map((voice) => voice.frequency),
    ].sort((a, b) => a - b);
    // 解音の倍増で全声が倍増し、論理比は変わらないこと。
    expect(highFrequencies).toEqual(lowFrequencies.map((frequency) => frequency * 2));
    expect(high.functionalRoot.ratio).toEqual(low.functionalRoot.ratio);
    expect(high.chordVoices.map((voice) => voice.ratio)).toEqual(
      low.chordVoices.map((voice) => voice.ratio),
    );
  });
});

describe('ベースの扱い', () => {
  it('ベース省略時はベースなしで返す', () => {
    const chord = toPitchGridSemanticChord(threePointInput());

    expect('bass' in chord).toBe(false);
  });

  it('ベース指定時は根との指数の差を返す', () => {
    const chord = toPitchGridSemanticChord({
      ...threePointInput(),
      bass: { x: -1, y: 0, k: 1 },
    });

    // E(b) − E(r)。素数2の指数が等しいため落とす。
    expect(chord.bass).toEqual({ primeExponents: { 3: -1 } });
  });
});

describe('入力の扱いと不正入力の拒否', () => {
  it('入力オブジェクトを変更しない', () => {
    const input = {
      ...threePointInput(),
      bass: { x: -1, y: 0, k: 1 },
    };
    const before = JSON.stringify(input);

    toPitchGridSemanticChord(input);

    expect(JSON.stringify(input)).toBe(before);
  });

  it('空集合では和音を作らない', () => {
    expect(() =>
      toPitchGridSemanticChord({
        dimension: 3,
        points: [],
        functionalRoot: { x: 0, y: 0 },
      }),
    ).toThrow(RangeError);
  });

  it('配置指数の欠落を拒む', () => {
    const withoutK = {
      dimension: 3,
      points: [{ x: 0, y: 0 }],
      functionalRoot: { x: 0, y: 0 },
    } as unknown as PitchGridSemanticChordInput;

    expect(() => toPitchGridSemanticChord(withoutK)).toThrow(RangeError);
  });

  it('重複したオン点を拒む', () => {
    expect(() =>
      toPitchGridSemanticChord({
        dimension: 3,
        points: [
          { x: 0, y: 0, k: 1 },
          { x: 0, y: 0, k: -1 },
        ],
        functionalRoot: { x: 0, y: 0 },
      }),
    ).toThrow(RangeError);
  });

  it('格子外の点を拒む', () => {
    expect(() =>
      toPitchGridSemanticChord({
        dimension: 3,
        points: [
          { x: 0, y: 0, k: 1 },
          { x: 3, y: 0, k: 0 },
        ],
        functionalRoot: { x: 0, y: 0 },
      }),
    ).toThrow(RangeError);
  });

  it('非整数の配置指数を拒む', () => {
    for (const k of [0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        toPitchGridSemanticChord({
          dimension: 3,
          points: [
            { x: 0, y: 0, k: 1 },
            { x: 1, y: 0, k },
          ],
          functionalRoot: { x: 0, y: 0 },
        }),
      ).toThrow(RangeError);
    }
  });

  it('集合に含まれない機能根を拒む', () => {
    expect(() =>
      toPitchGridSemanticChord({
        ...threePointInput(),
        functionalRoot: { x: 2, y: 1 },
      }),
    ).toThrow(RangeError);
  });

  it('選択次元でない次元を拒む', () => {
    const invalid = {
      dimension: 2,
      points: [{ x: 0, y: 0, k: 1 }],
      functionalRoot: { x: 0, y: 0 },
    } as unknown as PitchGridSemanticChordInput;

    expect(() => toPitchGridSemanticChord(invalid)).toThrow(RangeError);
  });

  it('ベースの配置指数の欠落を拒む', () => {
    const withoutBassK = {
      ...threePointInput(),
      bass: { x: -1, y: 0 },
    } as unknown as PitchGridSemanticChordInput;

    expect(() => toPitchGridSemanticChord(withoutBassK)).toThrow(RangeError);
  });
});
