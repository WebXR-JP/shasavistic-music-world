/**
 * 音程比の正規化と周波数変換の単体検査。
 *
 * 文脈や声を使わず、約分・重複排除・順序・不正入力の拒否を確かめる。
 * 具体値はこの検査に置く。発音の配線は `harmonicChord.test.ts`、
 * 信号の採取は `harmonicChord.capture.test.ts` で確かめる。
 */

import { describe, expect, it } from 'vitest';
import {
  greatestCommonDivisor,
  isPrimeNumber,
  normalizeHarmonicRatio,
  ratioFromPrimeExponents,
  resolveHarmonicVoices,
} from './harmonicRatio';

describe('最大公約数と素数判定', () => {
  it('最大公約数を求める', () => {
    expect(greatestCommonDivisor(6, 4)).toBe(2);
    expect(greatestCommonDivisor(7, 4)).toBe(1);
    expect(greatestCommonDivisor(12, 12)).toBe(12);
  });

  it('素数だけを認める', () => {
    expect(isPrimeNumber(2)).toBe(true);
    expect(isPrimeNumber(3)).toBe(true);
    expect(isPrimeNumber(11)).toBe(true);
    expect(isPrimeNumber(1)).toBe(false);
    expect(isPrimeNumber(4)).toBe(false);
    expect(isPrimeNumber(9)).toBe(false);
    expect(isPrimeNumber(2.5)).toBe(false);
  });
});

describe('音程比の正規化', () => {
  it('約分した値を返す', () => {
    expect(normalizeHarmonicRatio({ numerator: 2, denominator: 2 })).toEqual({
      numerator: 1,
      denominator: 1,
    });
    expect(normalizeHarmonicRatio({ numerator: 6, denominator: 4 })).toEqual({
      numerator: 3,
      denominator: 2,
    });
  });

  it('素数次元表示を同じ有理比へ変換する', () => {
    expect(normalizeHarmonicRatio({ primeExponents: { 3: 1 } })).toEqual({
      numerator: 3,
      denominator: 1,
    });
    expect(normalizeHarmonicRatio({ primeExponents: { 3: 1, 2: -1 } })).toEqual({
      numerator: 3,
      denominator: 2,
    });
    expect(normalizeHarmonicRatio({ primeExponents: {} })).toEqual({
      numerator: 1,
      denominator: 1,
    });
  });

  it('正の整数でない分子・分母を拒む', () => {
    expect(() => normalizeHarmonicRatio({ numerator: 0, denominator: 1 })).toThrow(RangeError);
    expect(() => normalizeHarmonicRatio({ numerator: -1, denominator: 1 })).toThrow(RangeError);
    expect(() => normalizeHarmonicRatio({ numerator: 1, denominator: 0 })).toThrow(RangeError);
    expect(() => normalizeHarmonicRatio({ numerator: 1.5, denominator: 1 })).toThrow(RangeError);
    expect(() => normalizeHarmonicRatio({ numerator: 1, denominator: Number.NaN })).toThrow(
      RangeError,
    );
    expect(() =>
      normalizeHarmonicRatio({ numerator: Number.POSITIVE_INFINITY, denominator: 1 }),
    ).toThrow(RangeError);
  });

  it('素数でない鍵と整数でない指数を拒む', () => {
    expect(() => ratioFromPrimeExponents({ 4: 1 })).toThrow(RangeError);
    expect(() => ratioFromPrimeExponents({ 1: 1 })).toThrow(RangeError);
    expect(() => ratioFromPrimeExponents({ 3: 0.5 })).toThrow(RangeError);
    expect(() => ratioFromPrimeExponents({ 3: Number.NaN })).toThrow(RangeError);
  });
});

describe('声の解決', () => {
  it('等価な比率と同音を一つの声にまとめて低い順に並べる', () => {
    const voices = resolveHarmonicVoices(
      [
        { numerator: 3, denominator: 2 },
        { numerator: 2, denominator: 2 },
        { numerator: 1, denominator: 1 },
        { numerator: 6, denominator: 4 },
      ],
      440,
    );

    expect(voices).toHaveLength(2);
    expect(voices[0]?.ratio).toEqual({ numerator: 1, denominator: 1 });
    expect(voices[0]?.frequency).toBe(440);
    expect(voices[1]?.ratio).toEqual({ numerator: 3, denominator: 2 });
    expect(voices[1]?.frequency).toBe(660);
  });

  it('基準周波数と比率の積で声の周波数を求める', () => {
    const voices = resolveHarmonicVoices(
      [
        { numerator: 5, denominator: 4 },
        { numerator: 1, denominator: 1 },
        { numerator: 3, denominator: 2 },
      ],
      440,
    );

    expect(voices.map((voice) => voice.frequency)).toEqual([440, 550, 660]);
  });

  it('素数次元表示の入力を同じ声へ解決する', () => {
    const voices = resolveHarmonicVoices(
      [{ numerator: 1, denominator: 1 }, { primeExponents: { 3: 1, 2: -1 } }],
      440,
    );

    expect(voices).toHaveLength(2);
    expect(voices[1]?.ratio).toEqual({ numerator: 3, denominator: 2 });
    expect(voices[1]?.frequency).toBe(660);
  });

  it('空の集合と正でない基準周波数を拒む', () => {
    expect(() => resolveHarmonicVoices([], 440)).toThrow(RangeError);
    expect(() => resolveHarmonicVoices([{ numerator: 1, denominator: 1 }], 0)).toThrow(RangeError);
    expect(() => resolveHarmonicVoices([{ numerator: 1, denominator: 1 }], -440)).toThrow(
      RangeError,
    );
    expect(() =>
      resolveHarmonicVoices([{ numerator: 1, denominator: 1 }], Number.NaN),
    ).toThrow(RangeError);
  });
});
