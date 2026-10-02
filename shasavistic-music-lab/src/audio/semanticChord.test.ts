/**
 * 意味論の和音とベースの純粋変換の単体検査。
 *
 * 機能根経由の解決・解音周波数の倍率・主要次元の許可と拒否・
 * オクターブとベースの役割・同一比率の束ね・入力非変更・無効入力の
 * 拒否を確かめる。具体値はこの検査に置く。一般の比率演算
 * （約分・指数変換・重複排除・順序・周波数）は `harmonicRatio.test.ts`、
 * 探索発音口の配線は `harmonicChord.test.ts` が所有し、複製しない。
 */

import { describe, expect, it } from 'vitest';
import { type SemanticChord, resolveSemanticChord } from './semanticChord';

describe('機能根を経由した解決', () => {
  it('構成音とベースの周波数に解音と機能根の寄与を反映する', () => {
    const chord: SemanticChord = {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: { 3: 1 } },
      toneOffsets: [{ primeExponents: { 2: 1 } }],
      bass: { primeExponents: { 2: -1 } },
    };

    const resolved = resolveSemanticChord(chord, 440);

    // 機能根 440×3、構成音 440×3×2、ベース 440×3/2。解音から直接
    // （構成音 440×2=880）ではこの値にならない。
    expect(resolved.functionalRoot.ratio).toEqual({ numerator: 3, denominator: 1 });
    expect(resolved.functionalRoot.frequency).toBe(1320);
    expect(resolved.chordVoices).toHaveLength(1);
    expect(resolved.chordVoices[0]?.ratio).toEqual({ numerator: 6, denominator: 1 });
    expect(resolved.chordVoices[0]?.frequency).toBe(2640);
    expect(resolved.bass?.ratio).toEqual({ numerator: 3, denominator: 2 });
    expect(resolved.bass?.frequency).toBe(660);
  });

  it('構成音側が零移動でも機能根の移動を消さない', () => {
    const chord: SemanticChord = {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: { 3: 1 } },
      toneOffsets: [{ primeExponents: {} }],
    };

    const resolved = resolveSemanticChord(chord, 440);

    expect(resolved.functionalRoot.frequency).toBe(1320);
    expect(resolved.chordVoices).toHaveLength(1);
    expect(resolved.chordVoices[0]?.ratio).toEqual({ numerator: 3, denominator: 1 });
    expect(resolved.chordVoices[0]?.frequency).toBe(1320);
  });

  it('解音周波数だけを変えると比率と成立を保ったまま全周波数が同じ倍率で変わる', () => {
    const chord: SemanticChord = {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: {} },
      toneOffsets: [{ primeExponents: { 3: 1 } }, { primeExponents: { 5: 1 } }],
      bass: { primeExponents: { 2: 1 } },
    };

    const low = resolveSemanticChord(chord, 220);
    const high = resolveSemanticChord(chord, 440);

    expect(high.harmonyEstablished).toBe(true);
    expect(low.harmonyEstablished).toBe(high.harmonyEstablished);
    expect(high.functionalRoot.ratio).toEqual(low.functionalRoot.ratio);
    expect(high.chordVoices.map((voice) => voice.ratio)).toEqual(
      low.chordVoices.map((voice) => voice.ratio),
    );
    expect(high.bass?.ratio).toEqual(low.bass?.ratio);
    expect(high.functionalRoot.frequency).toBe(low.functionalRoot.frequency * 2);
    expect(high.chordVoices.map((voice) => voice.frequency)).toEqual(
      low.chordVoices.map((voice) => voice.frequency * 2),
    );
    expect(high.bass?.frequency).toBe((low.bass?.frequency ?? 0) * 2);
  });
});

describe('主要次元の許可と拒否', () => {
  it('選択した主要次元の素数を許す', () => {
    const third: SemanticChord = {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: {} },
      toneOffsets: [{ primeExponents: { 5: 1 } }],
    };
    const fourth: SemanticChord = {
      primaryDimension: 4,
      functionalRootOffset: { primeExponents: {} },
      toneOffsets: [{ primeExponents: { 7: 1 } }],
    };
    const fifth: SemanticChord = {
      primaryDimension: 5,
      functionalRootOffset: { primeExponents: {} },
      toneOffsets: [{ primeExponents: { 11: 1 } }],
    };

    expect(resolveSemanticChord(third, 440).chordVoices[0]?.frequency).toBe(2200);
    expect(resolveSemanticChord(fourth, 440).chordVoices[0]?.frequency).toBe(3080);
    expect(resolveSemanticChord(fifth, 440).chordVoices[0]?.frequency).toBe(4840);
  });

  it('他の主要次元の素数と未知の鍵を拒む', () => {
    const withTone = (primeExponents: Readonly<Record<number, number>>): SemanticChord => ({
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: {} },
      toneOffsets: [{ primeExponents }],
    });

    expect(() => resolveSemanticChord(withTone({ 7: 1 }), 440)).toThrow(RangeError);
    expect(() => resolveSemanticChord(withTone({ 11: 1 }), 440)).toThrow(RangeError);
    expect(() => resolveSemanticChord(withTone({ 13: 1 }), 440)).toThrow(RangeError);
    expect(() => resolveSemanticChord(withTone({ 4: 1 }), 440)).toThrow(RangeError);
    expect(() => resolveSemanticChord(withTone({ 1: 1 }), 440)).toThrow(RangeError);
  });

  it('他の主要次元の素数を機能根とベースでも拒む', () => {
    const rootRejected: SemanticChord = {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: { 7: 1 } },
      toneOffsets: [{ primeExponents: {} }],
    };
    const bassRejected: SemanticChord = {
      primaryDimension: 4,
      functionalRootOffset: { primeExponents: {} },
      toneOffsets: [{ primeExponents: {} }],
      bass: { primeExponents: { 5: 1 } },
    };

    expect(() => resolveSemanticChord(rootRejected, 440)).toThrow(RangeError);
    expect(() => resolveSemanticChord(bassRejected, 440)).toThrow(RangeError);
  });

  it('合計で相殺する禁止次元も個別検査で拒む', () => {
    const cancelled: SemanticChord = {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: { 7: 1 } },
      toneOffsets: [{ primeExponents: { 7: -1 } }],
    };
    const cancelledOther: SemanticChord = {
      primaryDimension: 4,
      functionalRootOffset: { primeExponents: { 5: 1 } },
      toneOffsets: [{ primeExponents: { 5: -1 } }],
    };

    expect(() => resolveSemanticChord(cancelled, 440)).toThrow(RangeError);
    expect(() => resolveSemanticChord(cancelledOther, 440)).toThrow(RangeError);
  });
});

describe('和声成立の判定', () => {
  it('三種の位置で成立し単音と二音では成立しない', () => {
    const single: SemanticChord = {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: {} },
      toneOffsets: [],
    };
    const twoKinds: SemanticChord = {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: {} },
      toneOffsets: [{ primeExponents: { 3: 1 } }],
    };
    const threeKinds: SemanticChord = {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: {} },
      toneOffsets: [{ primeExponents: { 3: 1 } }, { primeExponents: { 5: 1 } }],
    };

    expect(resolveSemanticChord(single, 440).harmonyEstablished).toBe(false);
    expect(resolveSemanticChord(single, 440).chordVoices).toHaveLength(0);
    expect(resolveSemanticChord(twoKinds, 440).harmonyEstablished).toBe(false);
    expect(resolveSemanticChord(threeKinds, 440).harmonyEstablished).toBe(true);
  });

  it('オクターブ違いは発音高さとして残るが成立種数を増やさない', () => {
    const chord: SemanticChord = {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: {} },
      toneOffsets: [{ primeExponents: { 2: 1 } }, { primeExponents: { 2: 2 } }],
    };

    const resolved = resolveSemanticChord(chord, 440);

    expect(resolved.chordVoices).toHaveLength(2);
    expect(resolved.chordVoices.map((voice) => voice.frequency)).toEqual([880, 1760]);
    expect(resolved.harmonyEstablished).toBe(false);
  });
});

describe('ベースの役割', () => {
  it('省略時は出力を持たず指定時は解音基準で解く', () => {
    const omitted: SemanticChord = {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: { 3: 1 } },
      toneOffsets: [{ primeExponents: {} }],
    };
    const specified: SemanticChord = {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: { 3: 1 } },
      toneOffsets: [{ primeExponents: {} }],
      bass: { primeExponents: { 2: 1 } },
    };

    expect(resolveSemanticChord(omitted, 440).bass).toBeUndefined();
    const resolved = resolveSemanticChord(specified, 440);
    expect(resolved.bass?.ratio).toEqual({ numerator: 6, denominator: 1 });
    expect(resolved.bass?.frequency).toBe(2640);
  });

  it('構成音と同音でも別の出力に残し成立種数に加算しない', () => {
    const chord: SemanticChord = {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: {} },
      toneOffsets: [{ primeExponents: { 3: 1 } }],
      bass: { primeExponents: { 5: 1 } },
    };

    const resolved = resolveSemanticChord(chord, 440);

    // 構成音は2種のため不成立。ベースが第3種でも成立に数えない。
    expect(resolved.harmonyEstablished).toBe(false);
    expect(resolved.chordVoices).toHaveLength(1);
    expect(resolved.bass?.ratio).toEqual({ numerator: 5, denominator: 1 });
    expect(resolved.bass?.frequency).toBe(2200);
  });

  it('構成音と完全に同音のベースを吸収しない', () => {
    const chord: SemanticChord = {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: {} },
      toneOffsets: [{ primeExponents: { 3: 1 } }],
      bass: { primeExponents: { 3: 1 } },
    };

    const resolved = resolveSemanticChord(chord, 440);

    expect(resolved.chordVoices).toHaveLength(1);
    expect(resolved.bass?.ratio).toEqual(resolved.chordVoices[0]?.ratio);
    expect(resolved.bass?.frequency).toBe(resolved.chordVoices[0]?.frequency);
  });
});

describe('束ねと入力の扱い', () => {
  it('同一比率の構成音を束ねる', () => {
    const chord: SemanticChord = {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: {} },
      toneOffsets: [{ primeExponents: { 3: 1 } }, { primeExponents: { 3: 1 } }],
    };

    const resolved = resolveSemanticChord(chord, 440);

    expect(resolved.chordVoices).toHaveLength(1);
    expect(resolved.chordVoices[0]?.ratio).toEqual({ numerator: 3, denominator: 1 });
  });

  it('入力オブジェクトを変更しない', () => {
    const chord: SemanticChord = {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: { 3: 1 } },
      toneOffsets: [{ primeExponents: { 2: 1 } }, { primeExponents: { 5: -1 } }],
      bass: { primeExponents: { 2: -1 } },
    };
    const before = JSON.stringify(chord);

    resolveSemanticChord(chord, 440);

    expect(JSON.stringify(chord)).toBe(before);
  });
});

describe('無効入力の拒否', () => {
  it('無効な主要次元を拒む', () => {
    const chord: SemanticChord = {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: {} },
      toneOffsets: [],
    };

    for (const primaryDimension of [2, 6, '3', null, undefined]) {
      expect(() =>
        resolveSemanticChord(
          { ...chord, primaryDimension } as unknown as SemanticChord,
          440,
        ),
      ).toThrow(RangeError);
    }
  });

  it('正でない解音周波数と非有限の解音周波数を拒む', () => {
    const chord: SemanticChord = {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: {} },
      toneOffsets: [],
    };

    for (const frequency of [0, -440, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => resolveSemanticChord(chord, frequency)).toThrow(RangeError);
    }
  });

  it('非整数の指数を拒む', () => {
    const withTone = (primeExponents: Readonly<Record<number, number>>): SemanticChord => ({
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: {} },
      toneOffsets: [{ primeExponents }],
    });

    expect(() => resolveSemanticChord(withTone({ 3: 0.5 }), 440)).toThrow(RangeError);
    expect(() => resolveSemanticChord(withTone({ 3: Number.NaN }), 440)).toThrow(RangeError);
  });

  it('整数精度を逸脱する指数と合成を拒む', () => {
    const unsafeExponent: SemanticChord = {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: {} },
      toneOffsets: [{ primeExponents: { 3: Number.MAX_SAFE_INTEGER + 1 } }],
    };
    const overflow: SemanticChord = {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: { 2: Number.MAX_SAFE_INTEGER } },
      toneOffsets: [{ primeExponents: { 2: 1 } }],
    };

    expect(() => resolveSemanticChord(unsafeExponent, 440)).toThrow(RangeError);
    expect(() => resolveSemanticChord(overflow, 440)).toThrow(RangeError);
  });
});

describe('境界入力の扱い', () => {
  it('配列でない構成音の移動を拒む', () => {
    const base: SemanticChord = {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: {} },
      toneOffsets: [],
    };

    // 構成音の移動は配列が契約であり、欠落や単独の写像では解決しない。
    for (const toneOffsets of [undefined, null, 0, { primeExponents: {} }]) {
      expect(() =>
        resolveSemanticChord(
          { ...base, toneOffsets } as unknown as SemanticChord,
          440,
        ),
      ).toThrow(RangeError);
    }
  });

  it('写像でない移動量を構成音とベースで拒む', () => {
    const base: SemanticChord = {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: {} },
      toneOffsets: [{ primeExponents: {} }],
    };

    // 空や数値・文字列は素数から指数への写像ではない。
    for (const offset of [null, 0, '3', []]) {
      expect(() =>
        resolveSemanticChord(
          { ...base, toneOffsets: [offset] } as unknown as SemanticChord,
          440,
        ),
      ).toThrow(RangeError);
      expect(() =>
        resolveSemanticChord(
          { ...base, bass: offset } as unknown as SemanticChord,
          440,
        ),
      ).toThrow(RangeError);
    }
  });

  it('主要次元が3以外でも横軸の素数3を許し他の主要次元の素数を拒む', () => {
    const withTone = (
      primaryDimension: SemanticChord['primaryDimension'],
      primeExponents: Readonly<Record<number, number>>,
    ): SemanticChord => ({
      primaryDimension,
      functionalRootOffset: { primeExponents: {} },
      toneOffsets: [{ primeExponents }],
    });

    // 横軸の素数3は主要次元の選択によらず許す。主要次元4の縦軸は7であり、
    // 主要次元3の縦軸5は主要次元4では禁止次元として拒む。
    expect(resolveSemanticChord(withTone(4, { 3: 1 }), 440).chordVoices[0]?.frequency).toBe(
      1320,
    );
    expect(() => resolveSemanticChord(withTone(4, { 5: 1 }), 440)).toThrow(RangeError);
  });

  it('無限大の指数と非数値の鍵を拒む', () => {
    const withTone = (primeExponents: Readonly<Record<number, number>>): SemanticChord => ({
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: {} },
      toneOffsets: [{ primeExponents }],
    });

    // 無限大は安全な整数ではなく、数値化できない鍵は許可集合に含まれない。
    expect(() => resolveSemanticChord(withTone({ 3: Number.POSITIVE_INFINITY }), 440)).toThrow(
      RangeError,
    );
    expect(() => resolveSemanticChord(withTone({ 3: Number.NEGATIVE_INFINITY }), 440)).toThrow(
      RangeError,
    );
    expect(() => resolveSemanticChord(withTone({ [Number('abc')]: 1 }), 440)).toThrow(
      RangeError,
    );
  });

  it('声数に上限を設けず音域で折り返さない', () => {
    const chord: SemanticChord = {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: {} },
      toneOffsets: [
        { primeExponents: { 3: 1 } },
        { primeExponents: { 5: 1 } },
        { primeExponents: { 3: 1, 5: 1 } },
        { primeExponents: { 3: 2 } },
      ],
    };

    // 異なる構成音は4つとも声として残る。声数上限は別経路の責務とする。
    expect(resolveSemanticChord(chord, 440).chordVoices).toHaveLength(4);
  });

  it('常用域の外の解音周波数をそのまま基準にする', () => {
    const chord: SemanticChord = {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: {} },
      toneOffsets: [],
    };

    // 音域への折返しは適用せず、解音周波数がそのまま機能根の周波数になる。
    expect(resolveSemanticChord(chord, 55).functionalRoot.frequency).toBe(55);
    expect(resolveSemanticChord(chord, 7040).functionalRoot.frequency).toBe(7040);
  });

  it('機能根と同音のベースを別の出力に残す', () => {
    const chord: SemanticChord = {
      primaryDimension: 3,
      functionalRootOffset: { primeExponents: { 3: 1 } },
      toneOffsets: [{ primeExponents: {} }],
      bass: { primeExponents: {} },
    };

    const resolved = resolveSemanticChord(chord, 440);

    // ベースの移動が零でも機能根との合成で同音になり、出力は残る。
    expect(resolved.bass).toBeDefined();
    expect(resolved.bass?.ratio).toEqual(resolved.functionalRoot.ratio);
    expect(resolved.bass?.frequency).toBe(resolved.functionalRoot.frequency);
    expect(resolved.bass).not.toBe(resolved.functionalRoot);
  });
});
