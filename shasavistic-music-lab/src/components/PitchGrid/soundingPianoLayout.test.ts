/**
 * 鳴り中音高の鍵盤写像と点配置の検査。
 *
 * 描画（Canvas や React）を使わず、数値だけで次を確かめる。
 * 音域両端の対応、半音の中間の補間、周波数に対する単調性、
 * 重なり時のレーン割当の安定性と非重複を判定対象とする。
 * 具体値と判定手順はこの検査に置く。
 */

import { describe, expect, it } from 'vitest';
import {
  BLACK_PIANO_KEY_WIDTH_RATIO,
  SOUNDING_PIANO_HIGH_HZ,
  SOUNDING_PIANO_LOW_HZ,
  isBlackPianoKey,
  layoutSoundingDots,
  nearestPianoSemitone,
  pianoKeyName,
  pianoKeyboardLayout,
  soundingPianoX,
} from './soundingPianoLayout';

/** 半音だけ高い周波数を返す。12平均律上の半音関係の算出に使う。 */
function semitoneAbove(frequency: number, semitones: number): number {
  return frequency * 2 ** (semitones / 12);
}

describe('発音周波数から鍵盤横位置への写像', () => {
  it('音域両端を左端と右端に対応させる', () => {
    expect(soundingPianoX(SOUNDING_PIANO_LOW_HZ)).toBe(0);
    expect(soundingPianoX(SOUNDING_PIANO_HIGH_HZ)).toBe(1);
  });

  it('半音の中間を隣接する鍵の中心間へ補間する', () => {
    // A3 中心を 0、A#3 中心を白鍵幅単位の 1 とした中間であること。
    // 白鍵幅単位の A3 中心 0.5・A#3 中心 1・正規化幅 21 から求まる。
    const middle = soundingPianoX(semitoneAbove(SOUNDING_PIANO_LOW_HZ, 0.5));
    expect(middle).toBeCloseTo(0.25 / 21, 10);
  });

  it('オクターブ境界を鍵盤幅の3分の1ずつに写す', () => {
    // A4（12半音）は 1/3、A5（24半音）は 2/3 に置き、高域を端へ押し付けないこと。
    expect(soundingPianoX(semitoneAbove(SOUNDING_PIANO_LOW_HZ, 12))).toBeCloseTo(1 / 3, 10);
    expect(soundingPianoX(semitoneAbove(SOUNDING_PIANO_LOW_HZ, 24))).toBeCloseTo(2 / 3, 10);
  });

  it('Hz に線形な配置にしない', () => {
    // Hz を等分した前半と後半の幅は等しくならないこと。
    const middleHz = (SOUNDING_PIANO_LOW_HZ + SOUNDING_PIANO_HIGH_HZ) / 2;
    const firstHalf = soundingPianoX(middleHz) - soundingPianoX(SOUNDING_PIANO_LOW_HZ);
    const secondHalf = soundingPianoX(SOUNDING_PIANO_HIGH_HZ) - soundingPianoX(middleHz);
    expect(firstHalf).not.toBeCloseTo(secondHalf, 5);
    expect(firstHalf + secondHalf).toBeCloseTo(1, 10);
  });

  it('最寄り鍵の中心へ丸めない', () => {
    // 半音の4分の1だけずれた周波数は鍵中心から区間内の4分の1だけずれること。
    const offKey = soundingPianoX(semitoneAbove(SOUNDING_PIANO_LOW_HZ, 0.25));
    const nextKey = soundingPianoX(semitoneAbove(SOUNDING_PIANO_LOW_HZ, 1));
    expect(offKey).toBeGreaterThan(0);
    expect(offKey).toBeLessThan(nextKey);
    expect(offKey).toBeCloseTo(nextKey / 4, 10);
  });

  it('周波数に対して単調に増加する', () => {
    let previous = -1;
    for (let index = 0; index <= 100; index += 1) {
      const x = soundingPianoX(semitoneAbove(SOUNDING_PIANO_LOW_HZ, index * 0.36));
      expect(x).toBeGreaterThan(previous);
      previous = x;
    }
  });

  it('域外の正の周波数は両端へ寄せる', () => {
    expect(soundingPianoX(SOUNDING_PIANO_LOW_HZ / 2)).toBe(0);
    expect(soundingPianoX(SOUNDING_PIANO_HIGH_HZ * 2)).toBe(1);
  });

  it('正でない周波数は拒む', () => {
    expect(() => soundingPianoX(0)).toThrow(RangeError);
    expect(() => soundingPianoX(Number.NaN)).toThrow(RangeError);
  });
});

describe('鍵盤の鍵配置', () => {
  it('C4 を鍵名で示す', () => {
    expect(pianoKeyName(3)).toBe('C4');
    const whiteNames = pianoKeyboardLayout()
      .filter((key) => !key.black)
      .map((key) => key.name);
    expect(whiteNames).toContain('C4');
  });

  it('白鍵と黒鍵を通常の並びで分ける', () => {
    expect(isBlackPianoKey(0)).toBe(false);
    expect(isBlackPianoKey(1)).toBe(true);
    expect(isBlackPianoKey(3)).toBe(false);
    expect(isBlackPianoKey(35)).toBe(true);
    expect(isBlackPianoKey(36)).toBe(false);
    expect(pianoKeyName(0)).toBe('A3');
    expect(pianoKeyName(12)).toBe('A4');
    expect(pianoKeyName(24)).toBe('A5');
    expect(pianoKeyName(36)).toBe('A6');
  });

  it('37鍵を半音順に隙間なく並べる', () => {
    const layout = pianoKeyboardLayout();
    expect(layout).toHaveLength(37);
    // 白鍵は全幅を等分し、黒鍵は白鍵幅より狭く境界を中心に置くこと。
    const whiteKeys = layout.filter((key) => !key.black);
    expect(whiteKeys).toHaveLength(22);
    expect(whiteKeys[0]?.x0).toBe(0);
    expect(whiteKeys[whiteKeys.length - 1]?.x1).toBe(1);
    for (const key of layout) {
      if (key.black) {
        expect(key.x1 - key.x0).toBeCloseTo(BLACK_PIANO_KEY_WIDTH_RATIO / 22, 10);
      } else {
        expect(key.x1 - key.x0).toBeCloseTo(1 / 22, 10);
      }
    }
    // 黒鍵の中心は隣り合う白鍵の境界にあること。
    const whiteBoundaries = new Set(whiteKeys.flatMap((key) => [key.x0, key.x1]));
    for (const key of layout) {
      if (key.black) {
        const center = (key.x0 + key.x1) / 2;
        let nearest = Number.POSITIVE_INFINITY;
        for (const boundary of whiteBoundaries) {
          nearest = Math.min(nearest, Math.abs(center - boundary));
        }
        expect(nearest).toBeLessThan(1e-9);
      }
    }
  });

  it('最も近い鍵を半音位置で返す', () => {
    expect(nearestPianoSemitone(SOUNDING_PIANO_LOW_HZ)).toBe(0);
    expect(nearestPianoSemitone(SOUNDING_PIANO_HIGH_HZ)).toBe(36);
    // 境界のちょうど中間は避け、近い側を確かめる。
    expect(nearestPianoSemitone(semitoneAbove(SOUNDING_PIANO_LOW_HZ, 0.6))).toBe(1);
    expect(nearestPianoSemitone(semitoneAbove(SOUNDING_PIANO_LOW_HZ, 0.4))).toBe(0);
    // 高域側の近い側も確かめる。
    expect(nearestPianoSemitone(semitoneAbove(SOUNDING_PIANO_LOW_HZ, 35.6))).toBe(36);
    expect(nearestPianoSemitone(semitoneAbove(SOUNDING_PIANO_LOW_HZ, 35.4))).toBe(35);
  });
});

describe('重なり時の点配置', () => {
  it('単独の声はずれなしで周波数位置に置く', () => {
    const [placed] = layoutSoundingDots([{ key: '0,0', frequency: 220 }]);
    expect(placed?.x).toBe(0);
    expect(placed?.lane).toBe(0);
    expect(placed?.row).toBe(0);
    expect(placed?.column).toBe(0);
  });

  it('同じ鍵付近ではレーンを重複なく割る', () => {
    const placed = layoutSoundingDots([
      { key: '0,0', frequency: 220 },
      { key: '0,1', frequency: semitoneAbove(220, 0.1) },
      { key: '1,0', frequency: semitoneAbove(220, -0.1) },
    ]);
    // 群内は鍵順の安定順であり、入力順の先頭が代表になるとは限らないこと。
    const lanes = placed.map((dot) => dot.lane).sort((a, b) => a - b);
    expect(lanes).toEqual([0, 1, 2]);
    // ずれの組み合わせは群内で重複しないこと。
    const offsets = placed.map((dot) => `${dot.row},${dot.column}`);
    expect(new Set(offsets).size).toBe(3);
    // 周波数位置は各声の値を保ち、丸めないこと。
    expect(placed[1]?.x).toBe(soundingPianoX(semitoneAbove(220, 0.1)));
  });

  it('入力順を変えても鍵ごとの割当は変わらない', () => {
    const dots = [
      { key: '1,0', frequency: semitoneAbove(220, -0.1) },
      { key: '0,0', frequency: 220 },
      { key: '0,1', frequency: semitoneAbove(220, 0.1) },
    ];
    const forward = layoutSoundingDots(dots);
    const reversed = layoutSoundingDots([...dots].reverse());
    const laneOf = (placed: ReturnType<typeof layoutSoundingDots>): Map<string, number> =>
      new Map(placed.map((dot) => [dot.key, dot.lane]));
    expect(laneOf(reversed)).toEqual(laneOf(forward));
  });

  it('離れた鍵の声は互いにずらさない', () => {
    const placed = layoutSoundingDots([
      { key: '0,0', frequency: 220 },
      { key: '2,0', frequency: 330 },
    ]);
    expect(placed.map((dot) => dot.lane)).toEqual([0, 0]);
    expect(placed.map((dot) => [dot.row, dot.column])).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });
});
