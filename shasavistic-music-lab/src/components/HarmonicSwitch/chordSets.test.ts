/**
 * 調波和音の聴き比べの組合せの検査。
 *
 * 集合に単声が残ること、各組合せが有効な声数に収まること、表示名と
 * 音色参照の正当性を確かめる。具体値はこの検査に置く。信号の性質は
 * 採取検査で確かめる。
 */

import { describe, expect, it } from 'vitest';
import { HARMONIC_CHORD_MAX_VOICES } from '../../audio/harmonicChord';
import { HARMONIC_PRESETS } from '../../audio/harmonicPresets';
import { HARMONIC_TONE_FREQUENCY_HZ } from '../../audio/harmonicTone';
import { resolveHarmonicVoices } from '../../audio/harmonicRatio';
import { HARMONIC_CHORD_SETS, formatHarmonicRatioLabel } from './chordSets';

describe('聴き比べの組合せ', () => {
  it('先頭に単声を残す', () => {
    const first = HARMONIC_CHORD_SETS[0];
    expect(first).toBeDefined();
    const voices = resolveHarmonicVoices(
      first?.ratios ?? [],
      HARMONIC_TONE_FREQUENCY_HZ,
    );
    expect(voices).toHaveLength(1);
    expect(voices[0]?.frequency).toBe(HARMONIC_TONE_FREQUENCY_HZ);
  });

  it('全組合せの有効な声数が同時発音の上限以下である', () => {
    expect(HARMONIC_CHORD_SETS.length).toBeGreaterThan(1);
    for (const chordSet of HARMONIC_CHORD_SETS) {
      const voices = resolveHarmonicVoices(chordSet.ratios, HARMONIC_TONE_FREQUENCY_HZ);
      expect(voices.length).toBeGreaterThan(0);
      expect(voices.length).toBeLessThanOrEqual(HARMONIC_CHORD_MAX_VOICES);
    }
  });

  it('表示名が空でなく重ならず音色が既定の列に含まれる', () => {
    const names = HARMONIC_CHORD_SETS.map((chordSet) => chordSet.name);
    for (const name of names) {
      expect(name.length).toBeGreaterThan(0);
    }
    expect(new Set(names).size).toBe(names.length);
    for (const chordSet of HARMONIC_CHORD_SETS) {
      expect(HARMONIC_PRESETS).toContain(chordSet.preset);
    }
  });

  it('4件の選択IDが重ならず常時表示の比率行と対応する', () => {
    expect(HARMONIC_CHORD_SETS).toHaveLength(4);
    const ids = HARMONIC_CHORD_SETS.map((chordSet) => chordSet.id);
    for (const id of ids) {
      expect(id.length).toBeGreaterThan(0);
    }
    expect(new Set(ids).size).toBe(ids.length);
    const labels = new Map(HARMONIC_CHORD_SETS.map((chordSet) => [chordSet.id, chordSet]));
    expect(formatHarmonicRatioLabel(labels.get('single-neutral')?.ratios ?? [])).toBe('1/1');
    expect(formatHarmonicRatioLabel(labels.get('fifth-low-limit')?.ratios ?? [])).toBe('1/1 3/2');
    expect(formatHarmonicRatioLabel(labels.get('major-triad-neutral')?.ratios ?? [])).toBe(
      '1/1 5/4 3/2',
    );
    expect(formatHarmonicRatioLabel(labels.get('seventh-septimal')?.ratios ?? [])).toBe('1/1 7/4');
    expect(formatHarmonicRatioLabel([])).toBe('');
  });
});
