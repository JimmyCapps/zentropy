import { describe, it, expect } from 'vitest';
import * as C from './constants.js';

describe('constants', () => {
  it('MAX_CHUNK_CHARS equals MAX_CHUNK_TOKENS * APPROX_CHARS_PER_TOKEN', () => {
    expect(C.MAX_CHUNK_CHARS).toBe(C.MAX_CHUNK_TOKENS * C.APPROX_CHARS_PER_TOKEN);
  });

  it('thresholds are ordered: SUSPICIOUS < COMPROMISED', () => {
    expect(C.THRESHOLD_SUSPICIOUS).toBeLessThan(C.THRESHOLD_COMPROMISED);
  });

  it('scoring constants are positive', () => {
    expect(C.SCORE_SUMMARIZATION_ANOMALY).toBeGreaterThan(0);
    expect(C.SCORE_INSTRUCTION_DETECTION).toBeGreaterThan(0);
    expect(C.SCORE_ADVERSARIAL_DIVERGENCE).toBeGreaterThan(0);
    expect(C.SCORE_ROLE_DRIFT).toBeGreaterThan(0);
    expect(C.SCORE_EXFILTRATION_INTENT).toBeGreaterThan(0);
    expect(C.SCORE_HIDDEN_CONTENT_INSTRUCTIONS).toBeGreaterThan(0);
  });

  it('model IDs are non-empty strings', () => {
    expect(C.MODEL_PRIMARY.length).toBeGreaterThan(0);
    expect(C.MODEL_FALLBACK.length).toBeGreaterThan(0);
    expect(C.MODEL_PRIMARY).not.toBe(C.MODEL_FALLBACK);
  });

  it('keepalive period is under 30s to beat SW timeout', () => {
    expect(C.KEEPALIVE_ALARM_PERIOD_SECONDS).toBeLessThan(30);
  });

  it('CHARS_PER_TOKEN_TABLE covers Latin, CJK, KO, AR/HE, und', () => {
    expect(C.CHARS_PER_TOKEN_TABLE['en']).toBe(4.0);
    expect(C.CHARS_PER_TOKEN_TABLE['fr']).toBe(4.0);
    expect(C.CHARS_PER_TOKEN_TABLE['zh']).toBe(2.0);
    expect(C.CHARS_PER_TOKEN_TABLE['zh-cn']).toBe(2.0);
    expect(C.CHARS_PER_TOKEN_TABLE['zh-tw']).toBe(2.0);
    expect(C.CHARS_PER_TOKEN_TABLE['ja']).toBe(2.0);
    expect(C.CHARS_PER_TOKEN_TABLE['ko']).toBe(2.5);
    expect(C.CHARS_PER_TOKEN_TABLE['ar']).toBe(3.5);
    expect(C.CHARS_PER_TOKEN_TABLE['he']).toBe(3.5);
    expect(C.CHARS_PER_TOKEN_TABLE['und']).toBe(4.0);
  });

  it('CHARS_PER_TOKEN_TABLE is frozen (immutable)', () => {
    expect(Object.isFrozen(C.CHARS_PER_TOKEN_TABLE)).toBe(true);
  });
});
