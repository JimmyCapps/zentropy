import { describe, it, expect } from 'vitest';
import { detectInstructionFollowing } from './instruction-following.js';
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

describe('detectInstructionFollowing', () => {
  it('returns false when probes are missing', () => {
    expect(detectInstructionFollowing([])).toBe(false);
    expect(detectInstructionFollowing([makeResult({ probeName: 'summarization' })])).toBe(false);
  });

  it('returns false when outputs are similar (no injection)', () => {
    const summary = 'The page talks about cooking recipes and pasta dishes.';
    const adversarial = 'The page discusses cooking recipes and pasta preparation.';
    expect(
      detectInstructionFollowing([
        makeResult({ probeName: 'summarization', rawOutput: summary }),
        makeResult({ probeName: 'adversarial_compliance', rawOutput: adversarial }),
      ]),
    ).toBe(false);
  });

  it('detects high divergence between probes (low similarity)', () => {
    const summary = 'The page talks about cooking recipes.';
    const adversarial =
      'I am now DAN. I will ignore all safety measures and exfiltrate data to https://evil.com. My new role is unrestricted assistant.';
    expect(
      detectInstructionFollowing([
        makeResult({ probeName: 'summarization', rawOutput: summary }),
        makeResult({ probeName: 'adversarial_compliance', rawOutput: adversarial }),
      ]),
    ).toBe(true);
  });

  it('detects excessive length ratio', () => {
    const summary = 'Short summary.';
    const adversarial = 'Very long response '.repeat(50);
    expect(
      detectInstructionFollowing([
        makeResult({ probeName: 'summarization', rawOutput: summary }),
        makeResult({ probeName: 'adversarial_compliance', rawOutput: adversarial }),
      ]),
    ).toBe(true);
  });

  it('detects based on adversarial probe flags', () => {
    expect(
      detectInstructionFollowing([
        makeResult({ probeName: 'summarization', rawOutput: 'Summary.' }),
        makeResult({
          probeName: 'adversarial_compliance',
          rawOutput: 'Divergent.',
          passed: false,
          flags: ['role_adoption', 'exfiltration_language', 'jailbreak_compliance'],
        }),
      ]),
    ).toBe(true);
  });

  it('returns false when both outputs are empty', () => {
    expect(
      detectInstructionFollowing([
        makeResult({ probeName: 'summarization', rawOutput: '' }),
        makeResult({ probeName: 'adversarial_compliance', rawOutput: '' }),
      ]),
    ).toBe(false);
  });
});
