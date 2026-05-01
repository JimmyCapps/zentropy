import { describe, expect, it } from 'vitest';
import type { SecurityVerdict, WrapPolicy } from '../types.js';
import { shouldBlock } from '../policy.js';

const verdict = (status: SecurityVerdict['status'], score = 0): SecurityVerdict => ({
  status,
  confidence: 1,
  totalScore: score,
  url: 'https://example.com/',
  timestamp: 0,
  analysisError: null,
});

describe('shouldBlock', () => {
  const cases: ReadonlyArray<{
    policy: WrapPolicy;
    status: SecurityVerdict['status'];
    expected: boolean;
  }> = [
    { policy: 'flag-only', status: 'CLEAN', expected: false },
    { policy: 'flag-only', status: 'SUSPICIOUS', expected: false },
    { policy: 'flag-only', status: 'COMPROMISED', expected: false },
    { policy: 'flag-only', status: 'UNKNOWN', expected: false },

    { policy: 'block-on-compromised', status: 'CLEAN', expected: false },
    { policy: 'block-on-compromised', status: 'SUSPICIOUS', expected: false },
    { policy: 'block-on-compromised', status: 'COMPROMISED', expected: true },
    { policy: 'block-on-compromised', status: 'UNKNOWN', expected: false },

    { policy: 'block-on-suspicious', status: 'CLEAN', expected: false },
    { policy: 'block-on-suspicious', status: 'SUSPICIOUS', expected: true },
    { policy: 'block-on-suspicious', status: 'COMPROMISED', expected: true },
    { policy: 'block-on-suspicious', status: 'UNKNOWN', expected: false },
  ];

  for (const { policy, status, expected } of cases) {
    it(`policy=${policy} status=${status} → blocked=${String(expected)}`, () => {
      expect(shouldBlock(verdict(status), policy)).toBe(expected);
    });
  }

  it('UNKNOWN never blocks regardless of policy (fail-open on analyzer error)', () => {
    expect(shouldBlock(verdict('UNKNOWN'), 'block-on-suspicious')).toBe(false);
    expect(shouldBlock(verdict('UNKNOWN'), 'block-on-compromised')).toBe(false);
  });
});
