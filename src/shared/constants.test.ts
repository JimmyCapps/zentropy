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

  describe('canary contextWindow + tokeniser-aware chunking (issue #25)', () => {
    it('every CANARY_CATALOG entry exposes a positive contextWindow', () => {
      for (const [id, def] of Object.entries(C.CANARY_CATALOG)) {
        expect(typeof def.contextWindow, `${id}.contextWindow type`).toBe('number');
        expect(def.contextWindow, `${id}.contextWindow`).toBeGreaterThan(0);
      }
    });

    it('Gemma 2 2B contextWindow matches its documented 4096-token limit', () => {
      expect(C.CANARY_CATALOG['gemma-2-2b-mlc'].contextWindow).toBe(4096);
    });

    it('Qwen 2.5 0.5B exposes its larger 32k-token window', () => {
      // The whole point of issue #25: smaller-model chunkers shouldn't
      // cap larger-window canaries at the Gemma budget.
      expect(C.CANARY_CATALOG['qwen2.5-0.5b-mlc'].contextWindow).toBeGreaterThanOrEqual(32_000);
    });

    it('effectiveChunkTokenBudget shrinks the window by reserves so prompts fit', () => {
      const gemmaBudget = C.effectiveChunkTokenBudget(4096);
      expect(gemmaBudget).toBeLessThan(4096);
      // Must leave room for system prompt + response generation.
      expect(gemmaBudget).toBeLessThanOrEqual(4096 - C.PROMPT_TOKEN_RESERVE);
      expect(gemmaBudget).toBeGreaterThan(0);
    });

    it('effectiveChunkTokenBudget never exceeds MAX_CHUNK_TOKENS for small windows', () => {
      // Gemma's window is the original sizing target; the helper should
      // produce a budget at most equal to MAX_CHUNK_TOKENS so existing
      // long-prose handling stays at parity.
      expect(C.effectiveChunkTokenBudget(4096)).toBeLessThanOrEqual(C.MAX_CHUNK_TOKENS);
    });

    it('effectiveChunkTokenBudget scales up with larger windows', () => {
      const small = C.effectiveChunkTokenBudget(4096);
      const large = C.effectiveChunkTokenBudget(32_768);
      expect(large).toBeGreaterThan(small);
    });

    it('effectiveChunkTokenBudget for null/undefined canary falls back to MAX_CHUNK_TOKENS', () => {
      expect(C.effectiveChunkTokenBudget(null)).toBe(C.MAX_CHUNK_TOKENS);
    });

    it('effectiveChunkTokenBudget caps tiny windows to a non-negative number', () => {
      // Defensive: if a future canary lists a window smaller than reserves,
      // we must not return a negative budget.
      expect(C.effectiveChunkTokenBudget(100)).toBeGreaterThanOrEqual(0);
    });
  });
});
