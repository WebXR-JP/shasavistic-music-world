/**
 * 鳴り中音高のピアノ対照表示のための純粋な写像と点配置。
 *
 * 発音周波数（`[220, 1760]` Hz）から鍵盤上の横位置（0..1）への写像と、
 * 同じ鍵付近で重なる声の丸の配置だけを担う。描画（Canvas や React）には
 * 依存せず、検査では数値だけで判定する。配置の具体値（点の大きさ・間隔・
 * 色など）は描画側の初期候補とし、実画面の確認で決める。
 *
 * 横位置は基準音 A3 からの半音関係（12平均律上での半音位置）で求め、
 * 隣接する鍵の中心間へ補間する。Hz に線形な配置や最寄り鍵中心への丸めは
 * しない。A3 中心を左端（0）、A6 中心を終端（1）に対応させ、全域を鍵盤幅に
 * 写す。A6 は発音域の上端を含む。
 *
 * @packageDocumentation
 */

/** 鍵盤の左端の基準音（A3、Hz）。 */
export const SOUNDING_PIANO_LOW_HZ = 220;

/** 鍵盤の下端の音（A6、Hz）。発音域の上端を含む。 */
export const SOUNDING_PIANO_HIGH_HZ = 1760;

/** 半音位置の総数（A3=0 … A6=36、3オクターブ）。 */
export const SOUNDING_PIANO_SEMITONE_COUNT = 36;

/** 1オクターブあたりの半音数。基準音からの半音位置の算出に使う。 */
const SEMITONES_PER_OCTAVE = 12;

/** A3 から数えた白鍵の半音位置。3オクターブ分22鍵の順。 */
const WHITE_KEY_SEMITONES: readonly number[] = [
  0, 2, 3, 5, 7, 8, 10, 12, 14, 15, 17, 19, 20, 22, 24, 26, 27, 29, 31, 32, 34,
  36,
];

/** A3 からの鍵名。A3 … A6 の37鍵。 */
const KEY_NAMES: readonly string[] = [
  'A3',
  'A#3',
  'B3',
  'C4',
  'C#4',
  'D4',
  'D#4',
  'E4',
  'F4',
  'F#4',
  'G4',
  'G#4',
  'A4',
  'A#4',
  'B4',
  'C5',
  'C#5',
  'D5',
  'D#5',
  'E5',
  'F5',
  'F#5',
  'G5',
  'G#5',
  'A5',
  'A#5',
  'B5',
  'C6',
  'C#6',
  'D6',
  'D#6',
  'E6',
  'F6',
  'F#6',
  'G6',
  'G#6',
  'A6',
];

/**
 * 半音位置の鍵が黒鍵かを判定する。
 *
 * @param semitone - A3 からの半音位置。0…36 の整数。
 * @returns 黒鍵の場合だけ `true`。
 * @throws `RangeError` — 半音位置が 0…36 の整数でない場合。
 */
export function isBlackPianoKey(semitone: number): boolean {
  if (!Number.isInteger(semitone) || semitone < 0 || semitone > SOUNDING_PIANO_SEMITONE_COUNT) {
    throw new RangeError(`半音位置は0…36の整数であること: ${String(semitone)}`);
  }
  return !WHITE_KEY_SEMITONES.includes(semitone);
}

/**
 * 半音位置の鍵名を返す。
 *
 * @param semitone - A3 からの半音位置。0…36 の整数。
 * @returns `A3` … `A6` の鍵名。
 * @throws `RangeError` — 半音位置が 0…36 の整数でない場合。
 */
export function pianoKeyName(semitone: number): string {
  if (!Number.isInteger(semitone) || semitone < 0 || semitone > SOUNDING_PIANO_SEMITONE_COUNT) {
    throw new RangeError(`半音位置は0…36の整数であること: ${String(semitone)}`);
  }
  // 範囲検査済みのため表内を指す。
  return KEY_NAMES[semitone];
}

/**
 * ド（C4）の半音位置を返す。
 *
 * 鍵盤上に「ド／C4」と示す鍵の特定に使う。
 *
 * @returns C4 の半音位置（3）。
 */
export function doPianoSemitone(): number {
  return 3;
}

/** 鍵盤上の鍵の配置。描画の矩形算出に使う。 */
export interface PianoKeyLayout {
  /** A3 からの半音位置。0…36 の整数。 */
  readonly semitone: number;
  /** 鍵名。`A3` … `A6`。 */
  readonly name: string;
  /** 黒鍵か。 */
  readonly black: boolean;
  /** 左端（0..1）。 */
  readonly x0: number;
  /** 右端（0..1）。 */
  readonly x1: number;
}

/**
 * 黒鍵の幅（白鍵幅に対する倍率）。
 *
 * 描画の初期候補であり、判読性は実画面の確認で決める。
 */
export const BLACK_PIANO_KEY_WIDTH_RATIO = 0.62;

/**
 * A3 … A6 の37鍵の配置を返す。
 *
 * 白鍵22鍵を `[0, 1]` に等間隔で並べ、黒鍵は両隣の白鍵の境界を中心に置く
 * （通常の並び）。横位置の写像（`soundingPianoX`）の鍵中心と一致する。
 *
 * @returns 半音位置の昇順に並んだ37鍵の配置。
 */
export function pianoKeyboardLayout(): readonly PianoKeyLayout[] {
  const whiteWidth = 1 / WHITE_KEY_SEMITONES.length;
  const layout: PianoKeyLayout[] = [];
  for (let semitone = 0; semitone <= SOUNDING_PIANO_SEMITONE_COUNT; semitone += 1) {
    const whiteIndex = WHITE_KEY_SEMITONES.indexOf(semitone);
    if (whiteIndex >= 0) {
      layout.push({
        semitone,
        name: pianoKeyName(semitone),
        black: false,
        x0: whiteIndex * whiteWidth,
        x1: (whiteIndex + 1) * whiteWidth,
      });
    } else {
      // 黒鍵の中心は写像と同じ白鍵境界に置く。
      const center = rawKeyCenter(semitone) * whiteWidth;
      const halfWidth = (BLACK_PIANO_KEY_WIDTH_RATIO * whiteWidth) / 2;
      layout.push({
        semitone,
        name: pianoKeyName(semitone),
        black: true,
        x0: center - halfWidth,
        x1: center + halfWidth,
      });
    }
  }
  return layout;
}

// 半音位置の鍵中心を白鍵幅単位で返す。白鍵は幅1で等間隔に並べ、黒鍵は
// 両隣の白鍵の境界に置く（通常の並び）。A3 中心が 0.5、A6 中心が 21.5 である。
function rawKeyCenter(semitone: number): number {
  const whiteIndex = WHITE_KEY_SEMITONES.indexOf(semitone);
  if (whiteIndex >= 0) {
    return whiteIndex + 0.5;
  }
  // 黒鍵はそれより低い白鍵の数だけ右の境界にある。
  let boundary = 0;
  for (const white of WHITE_KEY_SEMITONES) {
    if (white < semitone) {
      boundary += 1;
    }
  }
  return boundary;
}

/**
 * 発音周波数を鍵盤上の横位置（0..1）へ写す。
 *
 * 基準音 A3 からの半音位置を求め、隣接する鍵の中心間へ補間する。
 * A3 中心を左端（0）、A6 中心を右端（1）に正規化し、全域を鍵盤幅に写す。
 * 域外の正の周波数は両端へ寄せ、描画を破綻させない。
 *
 * @param frequency - 発音周波数（Hz）。正の有限値。
 * @returns 鍵盤上の横位置。A3 で 0、A6 で 1。
 * @throws `RangeError` — 周波数が正の有限値でない場合。
 */
export function soundingPianoX(frequency: number): number {
  if (!Number.isFinite(frequency) || frequency <= 0) {
    throw new RangeError(`発音周波数は正の有限値であること: ${String(frequency)}`);
  }
  // ADR: 半音位置は1オクターブ12半音で求める。鍵盤の総半音数（36）とは
  // 無関係であり、高域を端へ押し付けず全域を鍵盤幅に写す。域外は通常
  // 到達しないため、描画面の破綻を避ける表示上の譲歩として両端へ寄せ、
  // 拒否はしない。
  const semitones = Math.min(
    Math.max(
      SEMITONES_PER_OCTAVE * Math.log2(frequency / SOUNDING_PIANO_LOW_HZ),
      0,
    ),
    SOUNDING_PIANO_SEMITONE_COUNT,
  );
  const lower = Math.min(Math.floor(semitones), SOUNDING_PIANO_SEMITONE_COUNT - 1);
  const upper = lower + 1;
  const ratio = semitones - lower;
  const raw = rawKeyCenter(lower) * (1 - ratio) + rawKeyCenter(upper) * ratio;
  // A3 中心（0.5）を 0、A6 中心（21.5）を 1 に正規化する。
  return (raw - 0.5) / (rawKeyCenter(SOUNDING_PIANO_SEMITONE_COUNT) - 0.5);
}

/**
 * 発音周波数に最も近い鍵の半音位置を返す。
 *
 * 同じ鍵付近の重なり群の特定に使う。丸めは群分けだけに用い、
 * 横位置の写像（`soundingPianoX`）には使わない。
 *
 * @param frequency - 発音周波数（Hz）。正の有限値。
 * @returns 最も近い鍵の半音位置。0…36 の整数。
 * @throws `RangeError` — 周波数が正の有限値でない場合。
 */
export function nearestPianoSemitone(frequency: number): number {
  if (!Number.isFinite(frequency) || frequency <= 0) {
    throw new RangeError(`発音周波数は正の有限値であること: ${String(frequency)}`);
  }
  const semitones =
    SEMITONES_PER_OCTAVE * Math.log2(frequency / SOUNDING_PIANO_LOW_HZ);
  return Math.min(Math.max(Math.round(semitones), 0), SOUNDING_PIANO_SEMITONE_COUNT);
}

/** 配置前の保持中の声。音声側の表示一覧の要素に対応する。 */
export interface SoundingDot {
  /** 声の鍵。 */
  readonly key: string;
  /** 発音周波数（Hz）。 */
  readonly frequency: number;
}

/** 配置済みの点。丸と周波数位置を指す細い線の描画に使う。 */
export interface PlacedSoundingDot {
  /** 声の鍵。 */
  readonly key: string;
  /** 発音周波数（Hz）。 */
  readonly frequency: number;
  /** 周波数位置の横位置（0..1）。細い線はここを指す。 */
  readonly x: number;
  /**
   * 同じ鍵付近の群内での順序。鍵順に揃えた安定順であり、入力順に依存しない。
   * 0 は群の代表（ずれなし）である。
   */
  readonly lane: number;
  /** 群内での段（上下のずれの段数）。描画側の間隔と掛けて使う。 */
  readonly row: number;
  /** 群内での列（左右のずれの段数）。描画側の間隔と掛けて使う。 */
  readonly column: number;
}

// レーン順の環状のずれ方向。中心から交互に上下・左右・斜めへ広げ、
// 順序は固定であり入力順に依存しない。
const LANE_RING_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * 群内順序から段と列のずれを求める。
 *
 * 0 はずれなしとし、1 以上は中心から環状に広げる。声数に上限があっても
 * 段数に上限を設けず、黙って隠さない。
 *
 * @param lane - 群内での順序。0 以上の整数。
 * @returns 段と列のずれ。
 */
function laneOffset(lane: number): { readonly row: number; readonly column: number } {
  if (lane === 0) {
    return { row: 0, column: 0 };
  }
  const direction = LANE_RING_DIRECTIONS[(lane - 1) % LANE_RING_DIRECTIONS.length];
  const ring = Math.floor((lane - 1) / LANE_RING_DIRECTIONS.length) + 1;
  // 方向表は空でない固定表であり、剰余の添字は常に表内を指す。
  return { row: direction[0] * ring, column: direction[1] * ring };
}

/**
 * 保持中の声を鍵盤上の点へ配置する。
 *
 * 同じ鍵付近（最も近い鍵が同じ）の声は群とし、群内を鍵順・周波数順に
 * 揃えた安定順で小さなレーンへずらす。入力の並び順には依存しない。
 * 丸の中心はずれ後の位置に置き、周波数位置を指す細い線は `x` に残す。
 *
 * @param dots - 保持中の声。空でもよい。
 * @returns 入力と同じ順序の配置済みの点。
 */
export function layoutSoundingDots(dots: readonly SoundingDot[]): PlacedSoundingDot[] {
  const groups = new Map<number, number[]>();
  const computed = dots.map((dot, index) => {
    const semitone = nearestPianoSemitone(dot.frequency);
    const laneOf = groups.get(semitone);
    if (laneOf === undefined) {
      groups.set(semitone, [index]);
    } else {
      laneOf.push(index);
    }
    return { dot, index, semitone, x: soundingPianoX(dot.frequency) };
  });
  // 群内を鍵順・周波数順に揃え、入力順に依存しない安定順でレーンを割る。
  // 添字はこの関数で作った表の範囲内だけを指す。
  const lanes: number[] = new Array<number>(dots.length).fill(0);
  for (const members of groups.values()) {
    const ordered = [...members].sort((a, b) => {
      const left = dots[a];
      const right = dots[b];
      if (left.key < right.key) {
        return -1;
      }
      if (left.key > right.key) {
        return 1;
      }
      return left.frequency - right.frequency;
    });
    ordered.forEach((member, lane) => {
      lanes[member] = lane;
    });
  }
  return computed.map(({ dot, x, index }) => {
    const lane = lanes[index];
    const offset = laneOffset(lane);
    return {
      key: dot.key,
      frequency: dot.frequency,
      x,
      lane,
      row: offset.row,
      column: offset.column,
    };
  });
}
