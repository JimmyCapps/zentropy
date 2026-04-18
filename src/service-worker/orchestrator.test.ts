import { describe, it, expect } from 'vitest';
import { mergeErrors, buildOriginSkippedVerdict } from './orchestrator.js';
import type { PageSnapshot } from '@/types/snapshot.js';

function snapshotFixture(overrides: Partial<PageSnapshot['metadata']> = {}): PageSnapshot {
  return {
    visibleText: '',
    hiddenText: '',
    scriptFingerprints: [],
    metadata: {
      title: 'Test',
      url: 'https://example.com/',
      origin: 'example.com',
      description: '',
      ogTags: new Map<string, string>(),
      cspMeta: null,
      lang: 'en',
      ...overrides,
    },
    extractedAt: 1_700_000_000_000,
    charCount: 0,
  };
}

describe('mergeErrors (Phase 4 Stage 4B)', () => {
  it('returns null when both inputs are null', () => {
    expect(mergeErrors(null, null)).toBeNull();
  });

  it('passes through the probe error when chunk error is null', () => {
    expect(mergeErrors('engine timeout', null)).toBe('engine timeout');
  });

  it('passes through the chunk error when probe error is null', () => {
    expect(mergeErrors(null, 'chunk_count_capped (8 chunks → kept first 4)')).toBe(
      'chunk_count_capped (8 chunks → kept first 4)',
    );
  });

  it('joins both errors with "; " so both signals survive downstream', () => {
    expect(
      mergeErrors('partial probe failure: summarization', 'chunk_count_capped (6 chunks → kept first 4)'),
    ).toBe('partial probe failure: summarization; chunk_count_capped (6 chunks → kept first 4)');
  });
});

describe('buildOriginSkippedVerdict (issue #20)', () => {
  it('produces UNKNOWN status with zero confidence and zero score', () => {
    const verdict = buildOriginSkippedVerdict(
      snapshotFixture({ url: 'https://mail.google.com/inbox' }),
      'Gmail',
      'deny_list_match',
    );
    expect(verdict.status).toBe('UNKNOWN');
    expect(verdict.confidence).toBe(0);
    expect(verdict.totalScore).toBe(0);
  });

  it('stamps analysisError with origin_denied prefix + rule label for deny-list match', () => {
    const verdict = buildOriginSkippedVerdict(
      snapshotFixture({ url: 'https://mail.google.com/' }),
      'Gmail',
      'deny_list_match',
    );
    expect(verdict.analysisError).toBe('origin_denied: default deny-list (Gmail)');
  });

  it('stamps analysisError without rule label when matchedRule is null', () => {
    const verdict = buildOriginSkippedVerdict(
      snapshotFixture(),
      null,
      'deny_list_match',
    );
    expect(verdict.analysisError).toBe('origin_denied: default deny-list');
  });

  it('stamps analysisError with "user override" marker for user-skip', () => {
    const verdict = buildOriginSkippedVerdict(
      snapshotFixture(),
      null,
      'user_override_skip',
    );
    expect(verdict.analysisError).toBe('origin_denied: user override');
  });

  it('carries the snapshot URL through to the verdict', () => {
    const verdict = buildOriginSkippedVerdict(
      snapshotFixture({ url: 'https://mail.google.com/mail/u/0/#inbox' }),
      'Gmail',
      'deny_list_match',
    );
    expect(verdict.url).toBe('https://mail.google.com/mail/u/0/#inbox');
  });

  it('has empty probeResults and default-false behavioralFlags', () => {
    const verdict = buildOriginSkippedVerdict(
      snapshotFixture(),
      'Gmail',
      'deny_list_match',
    );
    expect(verdict.probeResults).toEqual([]);
    expect(verdict.behavioralFlags).toEqual({
      roleDrift: false,
      exfiltrationIntent: false,
      instructionFollowing: false,
      hiddenContentAwareness: false,
    });
    expect(verdict.mitigationsApplied).toEqual([]);
  });

  it('leaves canaryId null (no canary was consulted)', () => {
    const verdict = buildOriginSkippedVerdict(
      snapshotFixture(),
      'Gmail',
      'deny_list_match',
    );
    expect(verdict.canaryId).toBeNull();
  });
});
