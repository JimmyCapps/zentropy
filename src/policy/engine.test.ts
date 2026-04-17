import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from './engine.js';
import type { ProbeResult, BehavioralFlags } from '@/types/verdict.js';

function makeResult(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    probeName: 'test',
    passed: true,
    flags: [],
    rawOutput: '',
    score: 0,
    errorMessage: null,
    ...overrides,
  };
}

const CLEAN_FLAGS: BehavioralFlags = {
  roleDrift: false,
  exfiltrationIntent: false,
  instructionFollowing: false,
  hiddenContentAwareness: false,
};

describe('evaluatePolicy', () => {
  it('returns CLEAN for passing probes', () => {
    const results = [
      makeResult({ probeName: 'summarization', passed: true }),
      makeResult({ probeName: 'instruction_detection', passed: true }),
      makeResult({ probeName: 'adversarial_compliance', passed: true }),
    ];
    const verdict = evaluatePolicy(results, CLEAN_FLAGS, 'https://example.com');
    expect(verdict.status).toBe('CLEAN');
    expect(verdict.confidence).toBeGreaterThan(0.5);
    expect(verdict.totalScore).toBe(0);
    expect(verdict.url).toBe('https://example.com');
    expect(verdict.mitigationsApplied).toEqual([]);
  });

  it('returns SUSPICIOUS for moderate score', () => {
    const results = [
      makeResult({ probeName: 'summarization', passed: false, score: 15 }),
      makeResult({ probeName: 'instruction_detection', passed: false, score: 20 }),
    ];
    const verdict = evaluatePolicy(results, CLEAN_FLAGS, 'https://test.com');
    expect(verdict.status).toBe('SUSPICIOUS');
    expect(verdict.totalScore).toBeGreaterThanOrEqual(30);
    expect(verdict.totalScore).toBeLessThan(65);
  });

  it('returns COMPROMISED for high score', () => {
    const results = [
      makeResult({ probeName: 'summarization', passed: false, score: 20 }),
      makeResult({ probeName: 'instruction_detection', passed: false, score: 40 }),
      makeResult({ probeName: 'adversarial_compliance', passed: false, score: 30 }),
    ];
    const flags: BehavioralFlags = {
      roleDrift: true,
      exfiltrationIntent: false,
      instructionFollowing: false,
      hiddenContentAwareness: false,
    };
    const verdict = evaluatePolicy(results, flags, 'https://evil.com');
    expect(verdict.status).toBe('COMPROMISED');
    expect(verdict.totalScore).toBeGreaterThanOrEqual(65);
    expect(verdict.confidence).toBeGreaterThan(0.5);
  });

  it('includes timestamp', () => {
    const before = Date.now();
    const verdict = evaluatePolicy([], CLEAN_FLAGS, 'https://x.com');
    const after = Date.now();
    expect(verdict.timestamp).toBeGreaterThanOrEqual(before);
    expect(verdict.timestamp).toBeLessThanOrEqual(after);
  });

  it('confidence is between 0 and 1', () => {
    const clean = evaluatePolicy([], CLEAN_FLAGS, 'https://a.com');
    expect(clean.confidence).toBeGreaterThanOrEqual(0);
    expect(clean.confidence).toBeLessThanOrEqual(1);

    const hot = evaluatePolicy(
      [makeResult({ probeName: 'instruction_detection', passed: false, score: 40 })],
      { roleDrift: true, exfiltrationIntent: true, instructionFollowing: true, hiddenContentAwareness: true },
      'https://b.com',
    );
    expect(hot.confidence).toBeGreaterThanOrEqual(0);
    expect(hot.confidence).toBeLessThanOrEqual(1);
  });

  // Phase 4 Stage 4A — error-aware branching. Covers the previously silent
  // false-negative case where all probes errored and scored 0, producing
  // CLEAN with confidence=1.0 indistinguishable from a legitimately clean page.
  describe('error propagation (Phase 4 Stage 4A)', () => {
    it('returns UNKNOWN with confidence=0 when all probes errored', () => {
      const results = [
        makeResult({ probeName: 'summarization', passed: false, errorMessage: 'engine timeout' }),
        makeResult({ probeName: 'instruction_detection', passed: false, errorMessage: 'engine timeout' }),
        makeResult({ probeName: 'adversarial_compliance', passed: false, errorMessage: 'engine timeout' }),
      ];
      const verdict = evaluatePolicy(results, CLEAN_FLAGS, 'https://erroring.com');
      expect(verdict.status).toBe('UNKNOWN');
      expect(verdict.confidence).toBe(0);
      expect(verdict.totalScore).toBe(0);
      expect(verdict.analysisError).toBe('engine timeout');
    });

    it('keeps score-derived status but carries analysisError when partial failure', () => {
      const results = [
        makeResult({ probeName: 'summarization', passed: false, errorMessage: 'engine timeout' }),
        makeResult({ probeName: 'instruction_detection', passed: false, score: 40 }),
      ];
      const verdict = evaluatePolicy(
        results,
        CLEAN_FLAGS,
        'https://partial.com',
        'partial probe failure: summarization',
      );
      expect(verdict.status).toBe('SUSPICIOUS');
      expect(verdict.analysisError).toBe('partial probe failure: summarization');
      expect(verdict.confidence).toBeGreaterThan(0);
    });

    it('returns CLEAN when no probes errored (regression guard)', () => {
      const results = [
        makeResult({ probeName: 'summarization', passed: true }),
        makeResult({ probeName: 'instruction_detection', passed: true }),
      ];
      const verdict = evaluatePolicy(results, CLEAN_FLAGS, 'https://clean.com');
      expect(verdict.status).toBe('CLEAN');
      expect(verdict.analysisError).toBeNull();
    });
  });

  // Phase 4 Stage 4D.3 — canaryId wiring.
  describe('canaryId propagation', () => {
    it('defaults canaryId to null when not supplied', () => {
      const verdict = evaluatePolicy([], CLEAN_FLAGS, 'https://a.com');
      expect(verdict.canaryId).toBeNull();
    });

    it('passes through the supplied canaryId on score-derived verdicts', () => {
      const results = [makeResult({ probeName: 'summarization', passed: true })];
      const verdict = evaluatePolicy(results, CLEAN_FLAGS, 'https://a.com', null, 'gemma-2-2b-mlc');
      expect(verdict.status).toBe('CLEAN');
      expect(verdict.canaryId).toBe('gemma-2-2b-mlc');
    });

    it('passes through the supplied canaryId on UNKNOWN verdicts', () => {
      const results = [
        makeResult({ probeName: 'summarization', errorMessage: 'engine timeout' }),
        makeResult({ probeName: 'instruction_detection', errorMessage: 'engine timeout' }),
      ];
      const verdict = evaluatePolicy(results, CLEAN_FLAGS, 'https://a.com', null, 'chrome-builtin-gemini-nano');
      expect(verdict.status).toBe('UNKNOWN');
      expect(verdict.canaryId).toBe('chrome-builtin-gemini-nano');
    });
  });
});
