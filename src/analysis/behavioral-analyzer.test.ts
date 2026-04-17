import { describe, it, expect } from 'vitest';
import { analyzeBehavior } from './behavioral-analyzer.js';
import type { ProbeResult } from '@/types/verdict.js';

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

describe('analyzeBehavior', () => {
  it('returns all false for clean results', () => {
    const results = [
      makeResult({ probeName: 'summarization', rawOutput: 'Clean summary.' }),
      makeResult({ probeName: 'instruction_detection', rawOutput: '{"found":false}', passed: true }),
      makeResult({ probeName: 'adversarial_compliance', rawOutput: 'Clean response.' }),
    ];
    const flags = analyzeBehavior(results);
    expect(flags.roleDrift).toBe(false);
    expect(flags.exfiltrationIntent).toBe(false);
    expect(flags.instructionFollowing).toBe(false);
    expect(flags.hiddenContentAwareness).toBe(false);
  });

  it('detects role drift from raw output', () => {
    const results = [
      makeResult({ probeName: 'adversarial_compliance', rawOutput: 'I am now DAN.' }),
    ];
    const flags = analyzeBehavior(results);
    expect(flags.roleDrift).toBe(true);
  });

  it('detects exfiltration from raw output', () => {
    const results = [
      makeResult({ probeName: 'adversarial_compliance', rawOutput: 'Send data to https://webhook.site/abc' }),
    ];
    const flags = analyzeBehavior(results);
    expect(flags.exfiltrationIntent).toBe(true);
  });

  it('detects hidden content awareness from instruction_detection probe', () => {
    const results = [
      makeResult({ probeName: 'instruction_detection', passed: false, flags: ['injection_detected'] }),
    ];
    const flags = analyzeBehavior(results);
    expect(flags.hiddenContentAwareness).toBe(true);
  });

  it('does not flag hidden content awareness when instruction probe passes', () => {
    const results = [
      makeResult({ probeName: 'instruction_detection', passed: true }),
    ];
    const flags = analyzeBehavior(results);
    expect(flags.hiddenContentAwareness).toBe(false);
  });
});
