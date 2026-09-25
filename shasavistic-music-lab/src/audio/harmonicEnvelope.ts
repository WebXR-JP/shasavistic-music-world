/**
 * 声ごとの音量包絡（ADSR）の時間と予約手順。
 *
 * 終点が明確な線形ランプだけを使い、ゼロに到達できない指数ランプは使わない。
 * 減衰の終端を停止処理と結び付け、指数特有の漸近の扱いを避ける。
 * 係数計算や文脈・声の寿命は扱わず、発音側（`harmonicTone`）から分離する。
 * 全音色に共通とし、プリセット別にはしない。
 *
 * @packageDocumentation
 */

/** アタック時間（秒）。発音開始から最大利得までの立ち上がり。 */
export const HARMONIC_ENVELOPE_ATTACK_TIME = 0.1;

/** ディケイ時間（秒）。最大利得からサステイン利得までの減衰。 */
export const HARMONIC_ENVELOPE_DECAY_TIME = 0.2;

/**
 * サステイン水準。最大利得に対する割合。
 *
 * 0から1の範囲で、1に近いほど減衰が浅い。
 */
export const HARMONIC_ENVELOPE_SUSTAIN_LEVEL = 0.7;

/** リリース時間（秒）。ノートオフ時点の利得から無音までの減衰。 */
export const HARMONIC_ENVELOPE_RELEASE_TIME = 0.3;

/**
 * 包絡の時間設定。
 *
 * 時間は秒、サステインは最大利得に対する割合（0から1）で、
 * 有限かつ時間は0より大きいことを前提とする。
 */
export interface HarmonicEnvelopeSettings {
  /** アタック時間（秒）。 */
  readonly attackTime: number;
  /** ディケイ時間（秒）。 */
  readonly decayTime: number;
  /** サステイン水準（最大利得に対する割合）。 */
  readonly sustainLevel: number;
  /** リリース時間（秒）。 */
  readonly releaseTime: number;
}

/** 全音色に共通の既定設定。 */
export const HARMONIC_ENVELOPE_DEFAULTS: HarmonicEnvelopeSettings = {
  attackTime: HARMONIC_ENVELOPE_ATTACK_TIME,
  decayTime: HARMONIC_ENVELOPE_DECAY_TIME,
  sustainLevel: HARMONIC_ENVELOPE_SUSTAIN_LEVEL,
  releaseTime: HARMONIC_ENVELOPE_RELEASE_TIME,
};

/**
 * 包絡の予約に必要な利得パラメータの最小口。
 *
 * `AudioParam` はこの形を満たす。保持付き取消しは対応が限定的なため、
 * 任意として扱い、ない環境では取消しと値の再設定で補う。
 */
export interface HarmonicEnvelopeParam {
  /** 現在値。発音前は無音（0）に保つ。 */
  value: number;
  setValueAtTime(value: number, startTime: number): void;
  linearRampToValueAtTime(value: number, endTime: number): void;
  cancelScheduledValues(cancelTime: number): void;
  cancelAndHoldAtTime?(cancelTime: number): void;
}

/**
 * サステイン利得を求める。
 *
 * @param peakGain - 最大利得。発音側の出力利得定数を渡す。
 * @param settings - 包絡の時間設定。省略時は既定の共通設定。
 * @returns 最大利得にサステイン水準を掛けた利得。
 */
export function envelopeSustainGain(
  peakGain: number,
  settings: HarmonicEnvelopeSettings = HARMONIC_ENVELOPE_DEFAULTS,
): number {
  return peakGain * settings.sustainLevel;
}

/**
 * ノートオンの立ち上がりと減衰を予約する。
 *
 * 発音前の無音からアタックで最大利得へ、ディケイでサステイン利得へ
 * 線形に移す。作りたての利得ノードにだけ使い、予約済みの声には使わない。
 *
 * @param param - 声の利得パラメータ。
 * @param startTime - 発音開始時刻（音声文脈の現在時刻）。
 * @param peakGain - 最大利得。発音側の出力利得定数を渡す。
 * @param settings - 包絡の時間設定。省略時は既定の共通設定。
 */
export function scheduleNoteOn(
  param: HarmonicEnvelopeParam,
  startTime: number,
  peakGain: number,
  settings: HarmonicEnvelopeSettings = HARMONIC_ENVELOPE_DEFAULTS,
): void {
  param.setValueAtTime(0, startTime);
  param.linearRampToValueAtTime(peakGain, startTime + settings.attackTime);
  param.linearRampToValueAtTime(
    envelopeSustainGain(peakGain, settings),
    startTime + settings.attackTime + settings.decayTime,
  );
}

/**
 * ノートオン時刻を基準にした時点利得を求める。
 *
 * 予約した線形区間と同じ折れ線を純関数で再現する。保持付き取消しがない
 * 環境で途中ノートオフの開始値を決めるために使う。
 *
 * @param noteOnTime - ノートオン時刻。
 * @param queryTime - 利得を知りたい時刻。
 * @param peakGain - 最大利得。発音側の出力利得定数を渡す。
 * @param settings - 包絡の時間設定。省略時は既定の共通設定。
 * @returns 指定時刻の利得。開始前は無音、減衰の完了後はサステイン利得。
 */
export function envelopeGainAtTime(
  noteOnTime: number,
  queryTime: number,
  peakGain: number,
  settings: HarmonicEnvelopeSettings = HARMONIC_ENVELOPE_DEFAULTS,
): number {
  const sustainGain = envelopeSustainGain(peakGain, settings);
  if (queryTime <= noteOnTime) {
    return 0;
  }
  const attackEnd = noteOnTime + settings.attackTime;
  if (queryTime < attackEnd) {
    return (peakGain * (queryTime - noteOnTime)) / settings.attackTime;
  }
  const decayEnd = attackEnd + settings.decayTime;
  if (queryTime < decayEnd) {
    const progress = (queryTime - attackEnd) / settings.decayTime;
    return peakGain + (sustainGain - peakGain) * progress;
  }
  return sustainGain;
}

/**
 * ノートオフ時点の利得から無音への減衰を予約し、終了時刻を返す。
 *
 * 予約済みの将来値を取り消す際、取消し単独では進行中のランプが不連続に
 * なり得る。保持付き取消しがある環境ではこれで値を保ち、ない環境では
 * 呼び出し側が `envelopeGainAtTime` で求めた現在値を再設定してつなぐ。
 *
 * @param param - 声の利得パラメータ。
 * @param noteOffTime - ノートオフ時刻（音声文脈の現在時刻）。
 * @param currentGain - ノートオフ時点の利得。保持付き取消しがない環境での再設定値。
 * @param settings - 包絡の時間設定。省略時は既定の共通設定。
 * @returns リリース終了時刻。発振器の停止予約に使う。
 */
export function scheduleRelease(
  param: HarmonicEnvelopeParam,
  noteOffTime: number,
  currentGain: number,
  settings: HarmonicEnvelopeSettings = HARMONIC_ENVELOPE_DEFAULTS,
): number {
  const releaseEnd = noteOffTime + settings.releaseTime;
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(noteOffTime);
  } else {
    param.cancelScheduledValues(noteOffTime);
    param.setValueAtTime(currentGain, noteOffTime);
  }
  param.linearRampToValueAtTime(0, releaseEnd);
  return releaseEnd;
}
