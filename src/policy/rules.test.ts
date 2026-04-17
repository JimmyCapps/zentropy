import { describe, it, expect } from 'vitest';
import { computeScore } from './rules.js';
import type { ProbeResult, BehavioralFlags } from '@/types/verdict.js';
import * as C from '@/shared/constants.js';

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

describe('computeScore', () => {
  it('returns 0 for all clean results', () => {
    const results = [
      makeResult({ probeName: 'summarization', passed: true }),
      makeResult({ probeName: 'instruction_detection', passed: true }),
      makeResult({ probeName: 'adversarial_compliance', passed: true }),
    ];
    const { totalScore, contributions } = computeScore(results, CLEAN_FLAGS);
    expect(totalScore).toBe(0);
    expect(contributions).toEqual([]);
  });

  it('adds summarization anomaly score', () => {
    const results = [
      makeResult({ probeName: 'summarization', passed: false, score: 15 }),
    ];
    const { totalScore } = computeScore(results, CLEAN_FLAGS);
    expect(totalScore).toBe(15);
  });

  it('caps summarization score at max', () => {
    const results = [
      makeResult({ probeName: 'summarization', passed: false, score: 100 }),
    ];
    const { totalScore } = computeScore(results, CLEAN_FLAGS);
    expect(totalScore).toBe(C.SCORE_SUMMARIZATION_ANOMALY);
  });

  it('adds instruction detection score', () => {
    const results = [
      makeResult({ probeName: 'instruction_detection', passed: false, score: 35 }),
    ];
    const { totalScore } = computeScore(results, CLEAN_FLAGS);
    expect(totalScore).toBe(35);
  });

  it('adds adversarial divergence score', () => {
    const results = [
      makeResult({ probeName: 'adversarial_compliance', passed: false, score: 25 }),
    ];
    const { totalScore } = computeScore(results, CLEAN_FLAGS);
    expect(totalScore).toBe(25);
  });

  it('adds behavioral flag scores', () => {
    const flags: BehavioralFlags = {
      roleDrift: true,
      exfiltrationIntent: true,
      instructionFollowing: false,
      hiddenContentAwareness: true,
    };
    const { totalScore } = computeScore([], flags);
    expect(totalScore).toBe(
      C.SCORE_ROLE_DRIFT + C.SCORE_EXFILTRATION_INTENT + C.SCORE_HIDDEN_CONTENT_INSTRUCTIONS,
    );
  });

  it('accumulates all scores together', () => {
    const results = [
      makeResult({ probeName: 'summarization', passed: false, score: 20 }),
      makeResult({ probeName: 'instruction_detection', passed: false, score: 40 }),
      makeResult({ probeName: 'adversarial_compliance', passed: false, score: 30 }),
    ];
    const flags: BehavioralFlags = {
      roleDrift: true,
      exfiltrationIntent: true,
      instructionFollowing: false,
      hiddenContentAwareness: true,
    };
    const { totalScore, contributions } = computeScore(results, flags);
    const expectedMax =
      C.SCORE_SUMMARIZATION_ANOMALY +
      C.SCORE_INSTRUCTION_DETECTION +
      C.SCORE_ADVERSARIAL_DIVERGENCE +
      C.SCORE_ROLE_DRIFT +
      C.SCORE_EXFILTRATION_INTENT +
      C.SCORE_HIDDEN_CONTENT_INSTRUCTIONS;
    expect(totalScore).toBe(expectedMax);
    expect(contributions.length).toBe(6);
  });
});
