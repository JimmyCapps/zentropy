import { describe, it, expect } from 'vitest';
import {
  mergeErrors,
  buildOriginSkippedVerdict,
  buildUnsupportedLanguageVerdict,
  swapInFlightController,
  AnalysisAbortedError,
  mergeProbeResults,
  computeAggregateError,
} from './orchestrator.js';
import type { PageSnapshot } from '@/types/snapshot.js';
import type { BehavioralFlags, ProbeResult } from '@/types/verdict.js';
import { evaluatePolicy } from '@/policy/engine.js';

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
    // Issue #210 — the chunk-split-layer "chunk_count_capped" error has been
    // replaced by the probe-dispatch-layer "probe_count_capped" error; the
    // mergeErrors helper itself doesn't care about the content, but using
    // the post-#210 string keeps this test documentation in sync.
    expect(mergeErrors(null, 'probe_count_capped (4 flagged chunk(s) skipped; budget=4)')).toBe(
      'probe_count_capped (4 flagged chunk(s) skipped; budget=4)',
    );
  });

  it('joins both errors with "; " so both signals survive downstream', () => {
    expect(
      mergeErrors('partial probe failure: summarization', 'probe_count_capped (2 flagged chunk(s) skipped; budget=4)'),
    ).toBe('partial probe failure: summarization; probe_count_capped (2 flagged chunk(s) skipped; budget=4)');
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

  it('emits stamp: null — origin-skipped verdicts are deliberately unstamped (issue #117)', () => {
    const denyList = buildOriginSkippedVerdict(
      snapshotFixture({ url: 'https://mail.google.com/' }),
      'Gmail',
      'deny_list_match',
    );
    expect(denyList.stamp).toBeNull();

    const userOverride = buildOriginSkippedVerdict(
      snapshotFixture(),
      null,
      'user_override_skip',
    );
    expect(userOverride.stamp).toBeNull();
  });
});

describe('buildUnsupportedLanguageVerdict (issue #48)', () => {
  it('produces UNKNOWN status with zero confidence and zero score', () => {
    const verdict = buildUnsupportedLanguageVerdict(snapshotFixture(), 'ja');
    expect(verdict.status).toBe('UNKNOWN');
    expect(verdict.confidence).toBe(0);
    expect(verdict.totalScore).toBe(0);
  });

  it('stamps analysisError with unsupported_language: prefix and the detected language', () => {
    const ja = buildUnsupportedLanguageVerdict(snapshotFixture(), 'ja');
    expect(ja.analysisError).toBe('unsupported_language: ja');

    const es = buildUnsupportedLanguageVerdict(snapshotFixture(), 'es');
    expect(es.analysisError).toBe('unsupported_language: es');

    const fr = buildUnsupportedLanguageVerdict(snapshotFixture(), 'fr');
    expect(fr.analysisError).toBe('unsupported_language: fr');
  });

  it('carries the snapshot URL through to the verdict', () => {
    const verdict = buildUnsupportedLanguageVerdict(
      snapshotFixture({ url: 'https://ja.wikipedia.org/wiki/Tokyo' }),
      'ja',
    );
    expect(verdict.url).toBe('https://ja.wikipedia.org/wiki/Tokyo');
  });

  it('has empty probeResults and default-false behavioralFlags', () => {
    const verdict = buildUnsupportedLanguageVerdict(snapshotFixture(), 'es');
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
    const verdict = buildUnsupportedLanguageVerdict(snapshotFixture(), 'ja');
    expect(verdict.canaryId).toBeNull();
  });

  it('emits stamp: null — unsupported-language verdicts mirror origin-skip (no scan attempted)', () => {
    const verdict = buildUnsupportedLanguageVerdict(snapshotFixture(), 'ja');
    expect(verdict.stamp).toBeNull();
  });

  it('emits perChunkAnalysis: null and entitySummary: null — chunk loop never ran', () => {
    const verdict = buildUnsupportedLanguageVerdict(snapshotFixture(), 'ja');
    expect(verdict.perChunkAnalysis).toBeNull();
    expect(verdict.entitySummary).toBeNull();
  });

  it('emits responseVerdict: null and thinkingVerdict: null — portal observers do not run', () => {
    const verdict = buildUnsupportedLanguageVerdict(snapshotFixture(), 'ja');
    expect(verdict.responseVerdict).toBeNull();
    expect(verdict.thinkingVerdict).toBeNull();
  });

  it('emits embeddingsFindings: null — chunk loop never ran (issue #129 Stage 5)', () => {
    const verdict = buildUnsupportedLanguageVerdict(snapshotFixture(), 'ja');
    expect(verdict.embeddingsFindings).toBeNull();
  });

  it('emits webgpuAdapterMode: null — engine was not consulted', () => {
    const verdict = buildUnsupportedLanguageVerdict(snapshotFixture(), 'ja');
    expect(verdict.webgpuAdapterMode).toBeNull();
  });
});

describe('swapInFlightController (issue #11)', () => {
  it('returns a fresh non-aborted controller on first call for a tab', () => {
    const c = swapInFlightController(1001);
    expect(c.signal.aborted).toBe(false);
  });

  it('aborts the prior controller when called again for the same tab', () => {
    const prior = swapInFlightController(1002);
    expect(prior.signal.aborted).toBe(false);
    const next = swapInFlightController(1002);
    expect(prior.signal.aborted).toBe(true);
    expect(next.signal.aborted).toBe(false);
    expect(next).not.toBe(prior);
  });

  it('stamps the abort reason on the prior controller', () => {
    const prior = swapInFlightController(1003);
    swapInFlightController(1003);
    expect(prior.signal.reason).toContain('superseded');
  });

  it('swaps independently per tab — different tabs do not interfere', () => {
    const a1 = swapInFlightController(1004);
    const b1 = swapInFlightController(1005);
    // Swapping tab 1004 should not abort the 1005 controller.
    swapInFlightController(1004);
    expect(a1.signal.aborted).toBe(true);
    expect(b1.signal.aborted).toBe(false);
  });

  it('does not double-abort an already-aborted prior controller', () => {
    const prior = swapInFlightController(1006);
    prior.abort('pre-existing abort');
    // swap should not throw or change the pre-existing reason
    swapInFlightController(1006);
    expect(prior.signal.reason).toBe('pre-existing abort');
  });
});

describe('AnalysisAbortedError (issue #11)', () => {
  it('is a distinguishable Error subclass', () => {
    const err = new AnalysisAbortedError('superseded');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AnalysisAbortedError);
    expect(err.name).toBe('AnalysisAbortedError');
    expect(err.message).toBe('superseded');
  });
});

// Issue #233B — partial probe failure must not surface as CLEAN(1.0). This
// integration test exercises the merge + aggregate + evaluate chain that
// `analyzeSnapshot` runs (orchestrator.ts:622-651) without standing up the
// full snapshot pipeline.
describe('partial probe failure → UNKNOWN (#233B integration)', () => {
  const FLAGS: BehavioralFlags = {
    roleDrift: false,
    exfiltrationIntent: false,
    instructionFollowing: false,
    hiddenContentAwareness: false,
  };

  function probe(overrides: Partial<ProbeResult>): ProbeResult {
    return {
      probeName: 'evidence_review',
      passed: true,
      flags: [],
      rawOutput: '',
      score: 0,
      errorMessage: null,
      ...overrides,
    };
  }

  it('one errored probe + two zero-score survivors aggregates to UNKNOWN, not CLEAN(1.0)', () => {
    const chunkResults = [
      [
        probe({ probeName: 'evidence_review', errorMessage: 'evidence_review timeout', passed: false }),
        probe({ probeName: 'instruction_detection', score: 0 }),
        probe({ probeName: 'adversarial_compliance', score: 0 }),
      ],
    ];
    const merged = mergeProbeResults(chunkResults);
    const aggregateError = computeAggregateError(merged);
    expect(aggregateError).toMatch(/partial probe failure: evidence_review/);

    const verdict = evaluatePolicy(merged, FLAGS, 'https://partial.example.com', aggregateError);
    expect(verdict.status).toBe('UNKNOWN');
    expect(verdict.confidence).toBe(0);
    expect(verdict.analysisError).toBe(aggregateError);
  });
});
