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
});
