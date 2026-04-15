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
});
