import { describe, it, expect } from 'vitest';
import { applyDialectBoundaries, getRuleSet } from './dialect-boundaries.js';

describe('getRuleSet', () => {
  it('A1: returns EN rule set for "en" with charsPerToken === 4.0', () => {
    const rs = getRuleSet('en');
    expect(rs.charsPerToken).toBe(4.0);
  });

  it('A2: ZH rule set sentence pattern matches CJK terminator', () => {
    const rs = getRuleSet('zh');
    expect(rs.charsPerToken).toBe(2.0);
    expect('字。'.match(rs.sentencePattern)).not.toBeNull();
  });

  it('A3: zh-CN normalises case-insensitively to ZH ruleset', () => {
    const rs = getRuleSet('zh-CN');
    expect(rs.charsPerToken).toBe(2.0);
  });

  it('A4: ZH-TW (uppercase) normalises to ZH ruleset', () => {
    const rs = getRuleSet('ZH-TW');
    expect(rs.charsPerToken).toBe(2.0);
  });

  it('A5: JA rule set matches U+3002 and U+FF01', () => {
    const rs = getRuleSet('ja');
    expect(rs.charsPerToken).toBe(2.0);
    expect('私は。'.match(rs.sentencePattern)).not.toBeNull();
    expect('はい！'.match(rs.sentencePattern)).not.toBeNull();
  });

  it('A6: KO rule set has charsPerToken 2.5', () => {
    const rs = getRuleSet('ko');
    expect(rs.charsPerToken).toBe(2.5);
  });

  it('A7: AR rule set matches U+061F (Arabic question mark)', () => {
    const rs = getRuleSet('ar');
    expect(rs.charsPerToken).toBe(3.5);
    expect('كلمة؟ '.match(rs.sentencePattern)).not.toBeNull();
  });

  it('A8: HE rule set has charsPerToken 3.5', () => {
    const rs = getRuleSet('he');
    expect(rs.charsPerToken).toBe(3.5);
  });

  it('A9: "und" returns DEFAULT (EN) rule set', () => {
    const rs = getRuleSet('und');
    expect(rs.charsPerToken).toBe(4.0);
  });

  it('A10: "xlm-roberta" returns DEFAULT (EN) rule set', () => {
    const rs = getRuleSet('xlm-roberta');
    expect(rs.charsPerToken).toBe(4.0);
  });

  it('A11: "fr" returns EN rule set (Latin alias)', () => {
    const rs = getRuleSet('fr');
    expect(rs.charsPerToken).toBe(4.0);
  });

  it('A12: empty string returns DEFAULT (EN), no throw', () => {
    expect(() => getRuleSet('')).not.toThrow();
    expect(getRuleSet('').charsPerToken).toBe(4.0);
  });

  it('A13: unknown language returns DEFAULT (EN)', () => {
    const rs = getRuleSet('klingon');
    expect(rs.charsPerToken).toBe(4.0);
  });
});

describe('applyDialectBoundaries', () => {
  it('B1: EN paragraph wins over sentence at >= halfMark', () => {
    const text = 'aaaaaa. bbbbbb. cccccc.\n\ndddddd. eeeeee. ffffff. ggggg';
    const segs = applyDialectBoundaries(text, getRuleSet('en'), 40);
    expect(segs[0]).toBe(text.slice(0, 24));
  });

  it('B2: EN sentence fall-through when no paragraph in window', () => {
    const text = 'aaaa. bbbb. cccc. dddd. eeee. ffff';
    const segs = applyDialectBoundaries(text, getRuleSet('en'), 30);
    expect(segs[0]).toBe(text.slice(0, 29));
  });

  it('B3: EN word fall-through when no paragraph or sentence', () => {
    const text = 'one two three four five six seven eight nine ten';
    const segs = applyDialectBoundaries(text, getRuleSet('en'), 20);
    expect(segs[0]).toBe('one two three four ');
  });

  it('B4: EN hard-cut when no boundaries exist', () => {
    const text = 'a'.repeat(25);
    const segs = applyDialectBoundaries(text, getRuleSet('en'), 10);
    expect(segs).toHaveLength(3);
    expect(segs[0]!.length).toBe(10);
    expect(segs[1]!.length).toBe(10);
    expect(segs[2]!.length).toBe(5);
  });

  it('B5: ZH `。` split — first segment ends with terminator', () => {
    const text = '甲'.repeat(50) + '。' + '乙'.repeat(50) + '。' + '丙'.repeat(20);
    const segs = applyDialectBoundaries(text, getRuleSet('zh'), 80);
    expect(segs[0]!.endsWith('。')).toBe(true);
  });

  it('B6: JA `。` split with mixed kanji/kana', () => {
    const text = '私は毎日。それは良い。'.repeat(8);
    const segs = applyDialectBoundaries(text, getRuleSet('ja'), 60);
    for (let i = 0; i < segs.length - 1; i++) {
      expect(segs[i]!.endsWith('。')).toBe(true);
    }
  });

  it('B7: AR paragraph break — first segment ends with newline', () => {
    // Each 'كلمة ' is 5 chars; paragraph break sits at index 75, well inside maxChars=120.
    const text = 'كلمة '.repeat(15) + '\n\n' + 'كلمة '.repeat(30);
    const segs = applyDialectBoundaries(text, getRuleSet('ar'), 120);
    expect(segs[0]!.endsWith('\n')).toBe(true);
    expect(segs.length).toBeGreaterThanOrEqual(2);
  });

  it('B8: reconstruction invariant — joined segments equal source for all rule sets', () => {
    const fixtures: ReadonlyArray<readonly [string, string, number]> = [
      ['en', 'aaaaaa. bbbbbb. cccccc.\n\ndddddd. eeeeee. ffffff. gggggg.', 40],
      ['zh', '甲'.repeat(50) + '。' + '乙'.repeat(50) + '。', 80],
      ['ja', '私は毎日。それは良い。'.repeat(6), 60],
      ['ko', 'first. second. third. fourth. fifth.', 30],
      ['ar', 'كلمة '.repeat(30) + '\n\n' + 'كلمة '.repeat(30), 120],
      ['he', 'aaa. bbb. ccc. ddd. eee.', 15],
    ];
    for (const [lang, text, maxChars] of fixtures) {
      const segs = applyDialectBoundaries(text, getRuleSet(lang), maxChars);
      expect(segs.join('')).toBe(text);
    }
  });
});

