/**
 * 和音の音程比の正規化と周波数への変換。
 *
 * 比率は正の整数の分子・分母で保持し、約分した値を声の識別に使う。
 * 素数次元表示を入力に加える場合も、まず同じ有理比へ変換する。
 * 係数計算や文脈・声の寿命は扱わず、発音側（`harmonicChord`）から分離する。
 *
 * @packageDocumentation
 */

/**
 * 有理比の入力。正の整数の分子・分母で保持する。
 */
export interface HarmonicRatio {
  /** 分子。正の整数。 */
  readonly numerator: number;
  /** 分母。正の整数。 */
  readonly denominator: number;
}

/**
 * 素数次元表示の入力。有理比の別表記であり、声の識別には使わず、
 * 正規化の過程で同じ有理比へ変換する。
 */
export interface HarmonicPrimeDimensions {
  /**
   * 素数から指数への写像。鍵は素数（2以上の素数の整数）、値は整数の指数
   * （負も許し、分母側の素因数になる）。指数がすべて0の場合は1/1とみなす。
   */
  readonly primeExponents: Readonly<Record<number, number>>;
}

/**
 * 声の音程比の入力。有理比か素数次元表示のどちらかで渡す。
 */
export type HarmonicRatioInput = HarmonicRatio | HarmonicPrimeDimensions;

/**
 * 約分済みの音程比。声の識別と周波数変換の基準になる。
 */
export interface NormalizedHarmonicRatio {
  /** 約分後の分子。正の整数。 */
  readonly numerator: number;
  /** 約分後の分母。正の整数。 */
  readonly denominator: number;
}

/**
 * 解決済みの声。約分済み比率と基準周波数からの周波数を持つ。
 */
export interface ResolvedHarmonicVoice {
  /** 約分済み比率。等価な比率は同じ値にまとまる。 */
  readonly ratio: NormalizedHarmonicRatio;
  /** 声の周波数（Hz）。基準周波数と比率の積。 */
  readonly frequency: number;
}

function failHarmonicRatio(message: string): never {
  throw new RangeError(message);
}

/**
 * 最大公約数を求める。
 *
 * @param a - 正の整数。
 * @param b - 正の整数。
 * @returns 最大公約数。
 */
export function greatestCommonDivisor(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) {
    const rest = x % y;
    x = y;
    y = rest;
  }
  return x;
}

/**
 * 素数かを判定する。
 *
 * @param value - 判定対象。
 * @returns 2以上の素数の整数の場合だけ `true`。
 */
export function isPrimeNumber(value: number): boolean {
  if (!Number.isInteger(value) || value < 2) {
    return false;
  }
  for (let divisor = 2; divisor * divisor <= value; divisor += 1) {
    if (value % divisor === 0) {
      return false;
    }
  }
  return true;
}

/**
 * 素数次元表示を有理比へ変換する。
 *
 * 正の指数の素数は分子へ、負の指数の素数は分母へ集める。
 *
 * @param primeExponents - 素数から指数への写像。
 * @returns 約分済みの音程比。
 * @throws `RangeError` — 鍵が素数でない、指数が整数でない、結果が有限の正値にならない場合。
 */
export function ratioFromPrimeExponents(
  primeExponents: Readonly<Record<number, number>>,
): NormalizedHarmonicRatio {
  if (primeExponents === null || typeof primeExponents !== 'object') {
    failHarmonicRatio(`素数次元表示は素数から指数への写像であること: ${String(primeExponents)}`);
  }
  let numerator = 1;
  let denominator = 1;
  for (const [primeText, exponent] of Object.entries(primeExponents)) {
    const prime = Number(primeText);
    if (!isPrimeNumber(prime)) {
      failHarmonicRatio(`素数次元表示の鍵は素数であること: ${primeText}`);
    }
    if (!Number.isInteger(exponent)) {
      failHarmonicRatio(`素数 ${primeText} の指数は整数であること: ${String(exponent)}`);
    }
    if (exponent > 0) {
      numerator *= prime ** exponent;
    } else if (exponent < 0) {
      denominator *= prime ** -exponent;
    }
  }
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) {
    failHarmonicRatio('素数次元表示の変換結果が有限値に収まらない');
  }
  const divisor = greatestCommonDivisor(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

/**
 * 音程比の入力を約分済み比率へ正規化する。
 *
 * 素数次元表示はまず同じ有理比へ変換する。実行時の検証であり、
 * 型注釈だけでは正の整数であることを保証しない。
 *
 * @param input - 有理比か素数次元表示。
 * @returns 約分済みの音程比。
 * @throws `RangeError` — 分子・分母が正の整数でない、素数次元表示が不正な場合。
 */
export function normalizeHarmonicRatio(input: HarmonicRatioInput): NormalizedHarmonicRatio {
  if (input === null || typeof input !== 'object') {
    failHarmonicRatio(`音程比は分子・分母か素数次元表示であること: ${String(input)}`);
  }
  if ('primeExponents' in input) {
    return ratioFromPrimeExponents(input.primeExponents);
  }
  if (!Number.isInteger(input.numerator) || input.numerator <= 0) {
    failHarmonicRatio(`分子は正の整数であること: ${String(input.numerator)}`);
  }
  if (!Number.isInteger(input.denominator) || input.denominator <= 0) {
    failHarmonicRatio(`分母は正の整数であること: ${String(input.denominator)}`);
  }
  const divisor = greatestCommonDivisor(input.numerator, input.denominator);
  return { numerator: input.numerator / divisor, denominator: input.denominator / divisor };
}

/**
 * 比率列を有効な声へ解決する。
 *
 * 等価な比率と同音は一つの声にまとめる。同じ基準周波数では約分一致と
 * 同音が一致するため、約分済み比率の一致で束ねる。声は低い順に並べ、
 * 順序を呼び出しの並びに依存させない。
 *
 * @param inputs - 音程比の入力列。空にしない。
 * @param baseFrequency - 基準周波数（Hz）。正の有限値。
 * @returns 低い順に並んだ有効な声。
 * @throws `RangeError` — 入力が空の列でない、基準周波数が正の有限値でない、
 * 比率が不正、変換後の周波数が有限の正値にならない場合。
 */
export function resolveHarmonicVoices(
  inputs: readonly HarmonicRatioInput[],
  baseFrequency: number,
): ResolvedHarmonicVoice[] {
  if (!Number.isFinite(baseFrequency) || baseFrequency <= 0) {
    failHarmonicRatio(`基準周波数は正の有限値であること: ${String(baseFrequency)}`);
  }
  if (!Array.isArray(inputs) || inputs.length === 0) {
    failHarmonicRatio('音程比は一つ以上指定すること');
  }
  const voices = new Map<string, ResolvedHarmonicVoice>();
  for (const input of inputs) {
    const ratio = normalizeHarmonicRatio(input);
    const key = `${ratio.numerator}/${ratio.denominator}`;
    if (voices.has(key)) {
      continue;
    }
    const frequency = (baseFrequency * ratio.numerator) / ratio.denominator;
    if (!Number.isFinite(frequency) || frequency <= 0) {
      failHarmonicRatio(`声の周波数が有限の正値にならない: ${key}`);
    }
    voices.set(key, { ratio, frequency });
  }
  // ADR: 浮動小数点の周波数ではなく有理比の交叉乗算で順序を決める。
  // 同じ基準周波数では順序が周波数順と一致し、丸めの影響を受けない。
  return [...voices.values()].sort(
    (a, b) => a.ratio.numerator * b.ratio.denominator - b.ratio.numerator * a.ratio.denominator,
  );
}
