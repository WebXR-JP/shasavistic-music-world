/**
 * 格子奥側の理論説明の文章データの検査。
 *
 * バンドルに含めて静的 import で読む正規データの形と来歴キーの不在を確かめる。
 * 文面の内容は利用者が差し替えられるものとし、具体的な文字列や文字数は断定しない。
 * 下書き専用の `draft`・`note`・`sources` は正規データに含めない。
 */

import { describe, expect, it } from 'vitest';
import intro from './pitch-grid-intro.json';

describe('格子奥側の理論説明の文章データ', () => {
  it('空でない見出しと空でない段落配列を持つ', () => {
    expect(typeof intro.title).toBe('string');
    expect(intro.title.length).toBeGreaterThan(0);
    expect(Array.isArray(intro.paragraphs)).toBe(true);
    expect(intro.paragraphs.length).toBeGreaterThan(0);
    for (const paragraph of intro.paragraphs) {
      expect(typeof paragraph).toBe('string');
      expect(paragraph.length).toBeGreaterThan(0);
    }
  });

  it('下書き専用の来歴メモを含まない', () => {
    expect(Object.keys(intro).sort()).toEqual(['paragraphs', 'title']);
  });
});
