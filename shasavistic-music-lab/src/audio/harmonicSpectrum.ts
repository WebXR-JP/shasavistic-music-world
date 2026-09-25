/**
 * 調波スペクトルの係数計算。
 *
 * 倍音振幅・素数次元重み・調波上限・ナイキスト打切りを純関数で求める。
 * 音声文脈や声の寿命管理は扱わず、発音側（`harmonicTone`）から分離する。
 * 位相は固定（全倍音 φ=0）とし、動的位相は含まない。
 *
 * @packageDocumentation
 */

/** 減衰係数の既定値。根拠資料の推奨初期値（標準波形）。 */
export const HARMONIC_SPECTRUM_DEFAULT_ALPHA = 1.5;

/**
 * 最大倍音数の上限既定値。
 *
 * ナイキスト条件だけでは低い基音で数千の係数になり発音開始時の負荷が増すため、
 * 可聴域の上限を十分に覆う安全な天井を設ける。f0=55Hz・48kHzでも約14kHzまで届く。
 */
export const HARMONIC_SPECTRUM_DEFAULT_MAX_PARTIALS = 256;

/** 調波スペクトルを求める条件。 */
export interface HarmonicSpectrumParams {
  /**
   * 基音周波数（Hz）。正の有限値。
   */
  readonly fundamentalFrequency: number;
  /**
   * 標本化周波数（Hz）。正の有限値。実文脈の `sampleRate` を渡す。
   */
  readonly sampleRate: number;
  /**
   * 倍音減衰係数。有限かつ0以上。
   *
   * @defaultValue `HARMONIC_SPECTRUM_DEFAULT_ALPHA`（省略時に計算処理が適用）。
   */
  readonly alpha?: number;
  /**
   * 素数ごとの重み。素数を鍵、有限かつ0以上の倍率を値とする。
   * 省略した素数は1として扱う。3・5・7・11を主対象とし、2・13も同じ形で受け付ける。
   */
  readonly primeWeights?: Readonly<Record<number, number>>;
  /**
   * 調波上限（素因数の上限。例: 5/7/11）。上限を超える素因数を持つ倍音を落とす。
   * 省略時は制限しない。n=1は素因数を持たないため常に残る。
   */
  readonly harmonicLimit?: number;
  /**
   * 最大倍音数。1以上の整数。
   *
   * @defaultValue `HARMONIC_SPECTRUM_DEFAULT_MAX_PARTIALS`（省略時に計算処理が適用）。
   */
  readonly maxPartials?: number;
}

/**
 * 周期波係数。Web Audio の添字規則（[0] は直流分で 0、添字 n が倍音次数）に沿う。
 */
export interface PeriodicWaveCoefficients {
  /** 余弦項。位相固定（φ=0）のため直流分と同様にすべて 0 になる。 */
  readonly real: Float32Array;
  /** 正弦項。添字 n に倍音振幅が入る。 */
  readonly imag: Float32Array;
}

function fail(message: string): never {
  throw new RangeError(message);
}

/**
 * 倍音次数を素因数分解し、各素数の指数を返す。
 *
 * @param n - 倍音次数。1以上の整数。
 * @returns 素数から指数への写像。n=1 の場合は空になる。
 */
export function primeExponents(n: number): ReadonlyMap<number, number> {
  const result = new Map<number, number>();
  let rest = n;
  let divisor = 2;
  while (divisor * divisor <= rest) {
    let exponent = 0;
    while (rest % divisor === 0) {
      rest /= divisor;
      exponent += 1;
    }
    if (exponent > 0) {
      result.set(divisor, exponent);
    }
    divisor += divisor === 2 ? 1 : 2;
  }
  if (rest > 1) {
    result.set(rest, (result.get(rest) ?? 0) + 1);
  }
  return result;
}

/**
 * 調波上限に照らして倍音を残すかを判定する。
 *
 * @param n - 倍音次数。
 * @param harmonicLimit - 素因数の上限。`undefined` は制限なし。
 * @returns 上限を超える素因数を持たなければ `true`。
 */
export function isAllowedByHarmonicLimit(n: number, harmonicLimit: number | undefined): boolean {
  if (harmonicLimit === undefined) {
    return true;
  }
  if (n <= 1) {
    return true;
  }
  for (const prime of primeExponents(n).keys()) {
    if (prime > harmonicLimit) {
      return false;
    }
  }
  return true;
}

/**
 * 倍音振幅を求める。
 *
 * n を素因数分解した各指数で重みを累乗し、次数のべき乗で減衰させる。
 *
 * @param n - 倍音次数。1以上の整数。
 * @param alpha - 倍音減衰係数。
 * @param primeWeights - 素数ごとの重み。省略した素数は1として扱う。
 * @returns 倍音振幅。
 */
export function harmonicAmplitude(
  n: number,
  alpha: number,
  primeWeights: Readonly<Record<number, number>> = {},
): number {
  let weight = 1;
  for (const [prime, exponent] of primeExponents(n)) {
    const primeWeight = primeWeights[prime] ?? 1;
    weight *= primeWeight ** exponent;
  }
  return weight / n ** alpha;
}

/**
 * 周期波係数を求める。
 *
 * ナイキスト条件（n・f0 < sampleRate/2）を満たす範囲で打ち切り、
 * 調波上限の除外成分は 0 のまま残す（添字と次数の対応を保つため短縮しない）。
 * 周期波の利用だけを折返し防止とみなさず、係数打切りとの二段構えにする。
 *
 * @param params - 基音・標本化周波数・減衰・重み・上限・最大倍音数。
 * @returns Web Audio の添字規則に沿った実部・虚部。長さは有効な最大次数+1。
 * @throws `RangeError` — 基音・標本化周波数が正の有限値でない場合。
 * @throws `RangeError` — 減衰係数が有限かつ0以上でない場合。
 * @throws `RangeError` — 調波上限が2未満の有限値でない場合。
 * @throws `RangeError` — 重みに有限かつ0以上でない値がある場合。
 * @throws `RangeError` — 最大倍音数が1以上の整数でない場合。
 */
export function createPeriodicWaveCoefficients(
  params: HarmonicSpectrumParams,
): PeriodicWaveCoefficients {
  const { fundamentalFrequency, sampleRate } = params;
  if (!Number.isFinite(fundamentalFrequency) || fundamentalFrequency <= 0) {
    fail(`基音周波数は正の有限値であること: ${fundamentalFrequency}`);
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    fail(`標本化周波数は正の有限値であること: ${sampleRate}`);
  }
  const alpha = params.alpha ?? HARMONIC_SPECTRUM_DEFAULT_ALPHA;
  if (!Number.isFinite(alpha) || alpha < 0) {
    fail(`減衰係数は有限かつ0以上であること: ${alpha}`);
  }
  const { harmonicLimit } = params;
  if (harmonicLimit !== undefined && (!Number.isFinite(harmonicLimit) || harmonicLimit < 2)) {
    fail(`調波上限は2以上の有限値であること: ${harmonicLimit}`);
  }
  const primeWeights = params.primeWeights ?? {};
  for (const [prime, weight] of Object.entries(primeWeights)) {
    if (!Number.isFinite(weight) || weight < 0) {
      fail(`素数 ${prime} の重みは有限かつ0以上であること: ${weight}`);
    }
  }
  const maxPartials = params.maxPartials ?? HARMONIC_SPECTRUM_DEFAULT_MAX_PARTIALS;
  if (!Number.isInteger(maxPartials) || maxPartials < 1) {
    fail(`最大倍音数は1以上の整数であること: ${maxPartials}`);
  }

  // ナイキスト条件を満たす最大次数を求める。境界（等号）は含まない。
  let top = 0;
  for (let n = 1; n <= maxPartials; n += 1) {
    if (n * fundamentalFrequency >= sampleRate / 2) {
      break;
    }
    top = n;
  }
  const real = new Float32Array(top + 1);
  const imag = new Float32Array(top + 1);
  // [0] は直流分で 0 のままにする。
  for (let n = 1; n <= top; n += 1) {
    if (!isAllowedByHarmonicLimit(n, harmonicLimit)) {
      continue;
    }
    // 位相固定（φ=0）の対応：実部 = A・sinφ = 0、虚部 = A・cosφ = A。
    imag[n] = harmonicAmplitude(n, alpha, primeWeights);
  }
  return { real, imag };
}
