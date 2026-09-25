/**
 * 調波スペクトル係数計算の単体検査。
 *
 * 音声文脈を使わず、次数・重み・上限・位相・周波数上限の判定だけを行う。
 * 合否値と境界値はこの検査に置き、設計には複製しない。
 */

import { describe, expect, it } from 'vitest';
import {
  HARMONIC_SPECTRUM_DEFAULT_ALPHA,
  createPeriodicWaveCoefficients,
  harmonicAmplitude,
  isAllowedByHarmonicLimit,
  primeExponents,
} from './harmonicSpectrum';

describe('倍音次数の素因数分解', () => {
  it('1は素因数を持たない', () => {
    expect(primeExponents(1).size).toBe(0);
  });

  it('合成数を指数付きで分解する', () => {
    // 12 = 2^2・3、7 = 7^1 であることを保証する。
    expect(Object.fromEntries(primeExponents(12))).toEqual({ 2: 2, 3: 1 });
    expect(Object.fromEntries(primeExponents(7))).toEqual({ 7: 1 });
  });
});

describe('次数による減衰', () => {
  it('既定の減衰で1/n^1.5に従う', () => {
    // 係数表の代表値との一致で次数則を保証する。
    expect(harmonicAmplitude(1, HARMONIC_SPECTRUM_DEFAULT_ALPHA)).toBeCloseTo(1, 10);
    expect(harmonicAmplitude(2, HARMONIC_SPECTRUM_DEFAULT_ALPHA)).toBeCloseTo(0.353553, 5);
    expect(harmonicAmplitude(3, HARMONIC_SPECTRUM_DEFAULT_ALPHA)).toBeCloseTo(0.19245, 5);
    expect(harmonicAmplitude(8, HARMONIC_SPECTRUM_DEFAULT_ALPHA)).toBeCloseTo(0.044194, 5);
  });

  it('減衰係数の変更で明るさが変わる', () => {
    // 小さい係数ほど高次倍音が残ることを保証する。
    expect(harmonicAmplitude(8, 1.1)).toBeGreaterThan(harmonicAmplitude(8, 2.0));
  });
});

describe('素数次元の重み', () => {
  it('重みが指数で掛かる', () => {
    // 9 = 3^2 のため重みが二乗で効き、5には効かないことを保証する。
    expect(harmonicAmplitude(3, 1.5, { 3: 2 })).toBeCloseTo(
      harmonicAmplitude(3, 1.5) * 2,
      10,
    );
    expect(harmonicAmplitude(9, 1.5, { 3: 2 })).toBeCloseTo(
      harmonicAmplitude(9, 1.5) * 4,
      10,
    );
    expect(harmonicAmplitude(5, 1.5, { 3: 2 })).toBeCloseTo(harmonicAmplitude(5, 1.5), 10);
  });

  it('合成数の倍音に含まれる次元全体が強調される', () => {
    // 6 = 2・3 のため3の重みが一乗で効くことを保証する。
    expect(harmonicAmplitude(6, 1.5, { 3: 2 })).toBeCloseTo(
      harmonicAmplitude(6, 1.5) * 2,
      10,
    );
  });

  it('2と13の重みも同じ形で受け付ける', () => {
    // 4 = 2^2 のため2の重みが二乗で効くことを保証する。
    expect(harmonicAmplitude(4, 1.5, { 2: 0.5 })).toBeCloseTo(
      harmonicAmplitude(4, 1.5) * 0.25,
      10,
    );
    expect(harmonicAmplitude(13, 1.5, { 13: 3 })).toBeCloseTo(
      harmonicAmplitude(13, 1.5) * 3,
      10,
    );
  });

  it('重み0の次元を含む倍音を消す', () => {
    expect(harmonicAmplitude(7, 1.5, { 7: 0 })).toBe(0);
    expect(harmonicAmplitude(14, 1.5, { 7: 0 })).toBe(0);
    expect(harmonicAmplitude(5, 1.5, { 7: 0 })).toBeGreaterThan(0);
  });
});

describe('調波上限', () => {
  it('5-limitで7以上の素因数を持つ倍音を落とす', () => {
    // 10 = 2・5 は残り、7・11・14は落ちることを保証する。
    expect(isAllowedByHarmonicLimit(10, 5)).toBe(true);
    expect(isAllowedByHarmonicLimit(7, 5)).toBe(false);
    expect(isAllowedByHarmonicLimit(11, 5)).toBe(false);
    expect(isAllowedByHarmonicLimit(14, 5)).toBe(false);
  });

  it('7-limitで7を残し11を落とす', () => {
    expect(isAllowedByHarmonicLimit(7, 7)).toBe(true);
    expect(isAllowedByHarmonicLimit(11, 7)).toBe(false);
  });

  it('基音は上限に関わらず残る', () => {
    expect(isAllowedByHarmonicLimit(1, 5)).toBe(true);
  });

  it('上限の除外成分を係数列に0として残す', () => {
    const { imag } = createPeriodicWaveCoefficients({
      fundamentalFrequency: 440,
      sampleRate: 48000,
      harmonicLimit: 5,
    });
    // 添字と次数の対応を保つため短縮せず、除外成分だけを0にする。
    expect(imag[6]).toBeGreaterThan(0);
    expect(imag[7]).toBe(0);
    expect(imag[11]).toBe(0);
  });
});

describe('位相の固定', () => {
  it('実部がすべて0で虚部に振幅が入る', () => {
    const { real, imag } = createPeriodicWaveCoefficients({
      fundamentalFrequency: 440,
      sampleRate: 48000,
    });
    // Web Audio の添字規則：[0] は直流分で 0、n が倍音次数。
    expect(real.length).toBe(imag.length);
    expect(real[0]).toBe(0);
    expect(imag[0]).toBe(0);
    for (const value of real) {
      expect(value).toBe(0);
    }
    expect(imag[1]).toBeCloseTo(1, 5);
    expect(imag[2]).toBeCloseTo(0.353553, 5);
  });
});

describe('周波数上限による打切り', () => {
  it('ナイキスト条件を満たす次数だけを残す', () => {
    // 440Hz・48kHz では n・440 < 24000 の n=1..54 が残る。
    const { real, imag } = createPeriodicWaveCoefficients({
      fundamentalFrequency: 440,
      sampleRate: 48000,
    });
    expect(imag.length).toBe(55);
    expect(real.length).toBe(55);
    expect(imag[54]).toBeGreaterThan(0);
  });

  it('境界の等号を含まない', () => {
    // 1000Hz・8kHz では n=4 が等号になるため n=1..3 だけが残る。
    const { imag } = createPeriodicWaveCoefficients({
      fundamentalFrequency: 1000,
      sampleRate: 8000,
    });
    expect(imag.length).toBe(4);
    expect(imag[3]).toBeGreaterThan(0);
  });

  it('最大倍音数で天井を設ける', () => {
    const { imag } = createPeriodicWaveCoefficients({
      fundamentalFrequency: 440,
      sampleRate: 48000,
      maxPartials: 8,
    });
    expect(imag.length).toBe(9);
  });
});

describe('係数計算の不正入力', () => {
  it('正でない基音と標本化周波数を拒む', () => {
    const bad = [0, -440, Number.NaN, Number.POSITIVE_INFINITY];
    for (const fundamentalFrequency of bad) {
      expect(() =>
        createPeriodicWaveCoefficients({ fundamentalFrequency, sampleRate: 48000 }),
      ).toThrow(RangeError);
    }
    for (const sampleRate of bad) {
      expect(() =>
        createPeriodicWaveCoefficients({ fundamentalFrequency: 440, sampleRate }),
      ).toThrow(RangeError);
    }
  });

  it('範囲外の減衰・上限・重み・最大倍音数を拒む', () => {
    const base = { fundamentalFrequency: 440, sampleRate: 48000 };
    expect(() => createPeriodicWaveCoefficients({ ...base, alpha: -1 })).toThrow(RangeError);
    expect(() => createPeriodicWaveCoefficients({ ...base, alpha: Number.NaN })).toThrow(
      RangeError,
    );
    expect(() => createPeriodicWaveCoefficients({ ...base, harmonicLimit: 1 })).toThrow(
      RangeError,
    );
    expect(() => createPeriodicWaveCoefficients({ ...base, primeWeights: { 3: -1 } })).toThrow(
      RangeError,
    );
    expect(() => createPeriodicWaveCoefficients({ ...base, primeWeights: { 3: Number.NaN } })).toThrow(
      RangeError,
    );
    expect(() => createPeriodicWaveCoefficients({ ...base, maxPartials: 0 })).toThrow(RangeError);
    expect(() => createPeriodicWaveCoefficients({ ...base, maxPartials: 1.5 })).toThrow(RangeError);
  });
});
