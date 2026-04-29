import { describe, it, expect } from 'vitest';
import { getRuleSet } from './dialect-boundaries.js';

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
