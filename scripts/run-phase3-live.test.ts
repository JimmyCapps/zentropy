import { describe, it, expect } from 'vitest';
import {
  STORAGE_KEY_VERDICT_PREFIX,
  PROBE_ERROR_FLAG,
  verdictStorageKey,
  liveRowKey,
  buildLiveRow,
  resolveFixtureUrl,
  selectFixtures,
  parseArgs,
  normalizeFlags,
  normalizeBehavioralFlags,
  hasProbeError,
  LOCAL_FIXTURES_9,
  PUBLIC_FIXTURES_3,
  SMOKE_FIXTURES,
  ALL_FIXTURE_IDS,
  type FixtureSpec,
  type Phase3LiveRow,
  type VerdictStoragePayload,
} from './run-phase3-live-helpers.js';

const GEMMA = 'gemma-2-2b-it-q4f16_1-MLC';

function sampleLocal(): FixtureSpec {
  return LOCAL_FIXTURES_9[0]!;
}

function samplePublic(): FixtureSpec {
  return PUBLIC_FIXTURES_3[0]!;
}

describe('verdictStorageKey — production-key parity', () => {
  it('uses URL.origin for localhost URLs (not full href)', () => {
    expect(verdictStorageKey('http://localhost:8080/clean/simple-article.html')).toBe(
      'honeyllm:verdict:http://localhost:8080',
    );
  });

  it('uses URL.origin for https URLs', () => {
    expect(verdictStorageKey('https://en.wikipedia.org/wiki/Sourdough')).toBe(
      'honeyllm:verdict:https://en.wikipedia.org',
    );
  });

  it('strips path, query, hash from origin', () => {
    expect(
      verdictStorageKey('https://arxiv.org/abs/2402.06196?foo=bar#section-2'),
    ).toBe('honeyllm:verdict:https://arxiv.org');
  });

  it('includes non-default port in origin', () => {
    expect(verdictStorageKey('http://localhost:65432/x.html')).toBe(
      'honeyllm:verdict:http://localhost:65432',
    );
  });

  it('falls back to raw string on URL parse failure', () => {
    // "not a url" has no scheme — URL constructor throws.
    const key = verdictStorageKey('not a url');
    expect(key).toBe(STORAGE_KEY_VERDICT_PREFIX + 'not a url');
  });
});

describe('hasProbeError — false-negative retry sentinel', () => {
  it('detects the probe_error flag', () => {
    expect(hasProbeError(['probe_error', 'probe_error', 'probe_error'])).toBe(true);
    expect(hasProbeError(['injection_detected', PROBE_ERROR_FLAG])).toBe(true);
  });

  it('returns false when all flags are real', () => {
    expect(hasProbeError(['injection_detected', 'instructionFollowing'])).toBe(false);
    expect(hasProbeError([])).toBe(false);
  });
});

describe('normalizeFlags', () => {
  it('passes arrays of strings through', () => {
    expect(normalizeFlags(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('filters out non-string entries', () => {
    expect(normalizeFlags(['a', 1, null, 'b'])).toEqual(['a', 'b']);
  });

  it('returns [] for non-array inputs', () => {
    expect(normalizeFlags(undefined)).toEqual([]);
    expect(normalizeFlags(null)).toEqual([]);
    expect(normalizeFlags('single')).toEqual([]);
    expect(normalizeFlags({ foo: true })).toEqual([]);
  });
});

describe('normalizeBehavioralFlags — production Record<string, boolean> shape', () => {
  it('extracts truthy keys from BehavioralFlags object', () => {
    // Matches src/types/verdict.ts BehavioralFlags shape.
    const bf = {
      roleDrift: true,
      exfiltrationIntent: false,
      instructionFollowing: true,
      hiddenContentAwareness: false,
    };
    expect(normalizeBehavioralFlags(bf).sort()).toEqual(['instructionFollowing', 'roleDrift']);
  });

  it('returns [] when every flag is false', () => {
    expect(
      normalizeBehavioralFlags({
        roleDrift: false,
        exfiltrationIntent: false,
      }),
    ).toEqual([]);
  });

  it('tolerates array input (forward-compat)', () => {
    expect(normalizeBehavioralFlags(['roleDrift', 'exfil'])).toEqual(['roleDrift', 'exfil']);
  });

  it('returns [] for null/undefined/primitives', () => {
    expect(normalizeBehavioralFlags(null)).toEqual([]);
    expect(normalizeBehavioralFlags(undefined)).toEqual([]);
    expect(normalizeBehavioralFlags('roleDrift')).toEqual([]);
    expect(normalizeBehavioralFlags(7)).toEqual([]);
  });

  it('skips keys whose values are not strictly true', () => {
    // Only === true qualifies — avoids falsy-but-non-boolean keys leaking in.
    expect(
      normalizeBehavioralFlags({
        a: true,
        b: 1 as unknown as boolean, // truthy but not === true
        c: 'yes' as unknown as boolean,
      }),
    ).toEqual(['a']);
  });
});

describe('buildLiveRow with production-shape storage payload', () => {
  const fixture = sampleLocal();
  const url = 'http://localhost:8080/clean/simple-article.html';

  it('merges probe flags (array) and behavioral flags (object) into one string[]', () => {
    const payload: VerdictStoragePayload = {
      status: 'SUSPICIOUS',
      confidence: 0.67,
      flags: ['adversarialCompliance:complied'],
      behavioralFlags: {
        roleDrift: false,
        exfiltrationIntent: true,
        instructionFollowing: true,
        hiddenContentAwareness: false,
      },
    };
    const row = buildLiveRow({
      fixture,
      fixture_url: url,
      extension_mode: 'on',
      canary_model: GEMMA,
      verdict_payload: payload,
      verdict_latency_ms: 45000,
      error_message: null,
      skipped_reason: null,
    });
    expect(row.verdict).toBe('SUSPICIOUS');
    expect(row.verdict_flags).toEqual([
      'adversarialCompliance:complied',
      'exfiltrationIntent',
      'instructionFollowing',
    ]);
  });

  it('does not crash if flags is non-array or behavioralFlags is missing', () => {
    const payload: VerdictStoragePayload = {
      status: 'CLEAN',
      flags: 'unexpected-string' as unknown, // storage drift
      // behavioralFlags absent entirely
    };
    const row = buildLiveRow({
      fixture,
      fixture_url: url,
      extension_mode: 'on',
      canary_model: GEMMA,
      verdict_payload: payload,
      verdict_latency_ms: 1000,
      error_message: null,
      skipped_reason: null,
    });
    expect(row.verdict).toBe('CLEAN');
    expect(row.verdict_flags).toEqual([]);
  });
});

describe('liveRowKey', () => {
  it('distinguishes ON from OFF for the same fixture', () => {
    const on = liveRowKey('clean/simple-article.html', 'on');
    const off = liveRowKey('clean/simple-article.html', 'off');
    expect(on).not.toBe(off);
  });

  it('is stable for the same inputs', () => {
    expect(liveRowKey('x', 'on')).toBe(liveRowKey('x', 'on'));
  });
});

describe('buildLiveRow', () => {
  const fixture = sampleLocal();
  const url = 'http://localhost:8080/clean/simple-article.html';

  it('ON row with full verdict payload populates verdict + flags + confidence', () => {
    const payload: VerdictStoragePayload = {
      status: 'CLEAN',
      confidence: 0.92,
      totalScore: 5,
      timestamp: 1_700_000_000_000,
      url,
      flags: ['probe:summarization:ok'],
      behavioralFlags: ['no-role-drift'],
    };
    const row = buildLiveRow({
      fixture,
      fixture_url: url,
      extension_mode: 'on',
      canary_model: GEMMA,
      verdict_payload: payload,
      verdict_latency_ms: 2431,
      error_message: null,
      skipped_reason: null,
    });
    expect(row.verdict).toBe('CLEAN');
    expect(row.verdict_confidence).toBe(0.92);
    expect(row.verdict_flags).toEqual(['probe:summarization:ok', 'no-role-drift']);
    expect(row.verdict_latency_ms).toBe(2431);
    expect(row.extension_mode).toBe('on');
    expect(row.expected_verdict).toBe('CLEAN');
    expect(row.engine_model).toBe(GEMMA);
    // Probe-level fields are always null on verdict-level rows.
    expect(row.probe).toBeNull();
    expect(row.complied).toBeNull();
    expect(row.leaked_prompt).toBeNull();
  });

  it('OFF row always yields verdict=null + empty flags even if a payload is passed', () => {
    const payload: VerdictStoragePayload = { status: 'COMPROMISED', confidence: 0.9 };
    const row = buildLiveRow({
      fixture,
      fixture_url: url,
      extension_mode: 'off',
      canary_model: GEMMA,
      verdict_payload: payload,
      verdict_latency_ms: null,
      error_message: null,
      skipped_reason: null,
    });
    expect(row.verdict).toBeNull();
    expect(row.verdict_confidence).toBeNull();
    expect(row.verdict_flags).toEqual([]);
    expect(row.extension_mode).toBe('off');
  });

  it('ON row with no payload (timeout) leaves verdict=null and records error', () => {
    const row = buildLiveRow({
      fixture,
      fixture_url: url,
      extension_mode: 'on',
      canary_model: GEMMA,
      verdict_payload: null,
      verdict_latency_ms: null,
      error_message: 'verdict-timeout after 30000ms',
      skipped_reason: null,
    });
    expect(row.verdict).toBeNull();
    expect(row.verdict_flags).toEqual([]);
    expect(row.error_message).toContain('verdict-timeout');
  });

  it('propagates manual-only fields as null on automatable rows', () => {
    const row = buildLiveRow({
      fixture,
      fixture_url: url,
      extension_mode: 'on',
      canary_model: GEMMA,
      verdict_payload: { status: 'CLEAN' },
      verdict_latency_ms: 1000,
      error_message: null,
      skipped_reason: null,
    });
    expect(row.surface).toBeNull();
    expect(row.attachment_mode).toBeNull();
    expect(row.agent_mode).toBeNull();
    expect(row.llm_final_response_text).toBeNull();
    expect(row.did_llm_comply).toBeNull();
    expect(row.phase1_baseline_complied).toBeNull();
    expect(row.extension_fired_before_model_saw_content).toBeNull();
  });
});

describe('resolveFixtureUrl', () => {
  it('composes localhost URL for local fixtures', () => {
    expect(resolveFixtureUrl(sampleLocal(), 12345)).toBe(
      'http://localhost:12345/clean/simple-article.html',
    );
  });

  it('returns public_url as-is for public fixtures', () => {
    expect(resolveFixtureUrl(samplePublic(), 12345)).toBe(
      'https://en.wikipedia.org/wiki/Sourdough',
    );
  });

  it('throws if local fixture is missing manifest_file', () => {
    const broken: FixtureSpec = { ...sampleLocal(), manifest_file: null };
    expect(() => resolveFixtureUrl(broken, 1)).toThrow(/missing manifest_file/);
  });

  it('throws if public fixture is missing public_url', () => {
    const broken: FixtureSpec = { ...samplePublic(), public_url: null };
    expect(() => resolveFixtureUrl(broken, 1)).toThrow(/missing public_url/);
  });
});

describe('parseArgs', () => {
  it('parses flags independently', () => {
    const args = parseArgs(['--dry-run']);
    expect(args.dryRun).toBe(true);
    expect(args.smoke).toBe(false);
    expect(args.includePublic).toBe(false);
    expect(args.fixtures).toBeNull();
  });

  it('parses --fixtures comma list and validates ids', () => {
    const args = parseArgs([
      '--fixtures',
      'clean/simple-article.html,injected/hidden-div-basic.html',
    ]);
    expect(args.fixtures).toEqual([
      'clean/simple-article.html',
      'injected/hidden-div-basic.html',
    ]);
  });

  it('rejects unknown fixture ids', () => {
    expect(() => parseArgs(['--fixtures', 'does/not/exist.html'])).toThrow(
      /unknown id/,
    );
  });

  it('rejects --smoke combined with --fixtures', () => {
    expect(() =>
      parseArgs(['--smoke', '--fixtures', 'clean/simple-article.html']),
    ).toThrow(/mutually exclusive/);
  });

  it('rejects unknown arguments', () => {
    expect(() => parseArgs(['--bogus'])).toThrow(/Unknown argument/);
  });
});

describe('selectFixtures', () => {
  it('--smoke returns the 3 category-representative fixtures', () => {
    const fixtures = selectFixtures({
      fixtures: null,
      dryRun: false,
      smoke: true,
      includePublic: false,
    });
    expect(fixtures).toEqual(SMOKE_FIXTURES);
    expect(fixtures).toHaveLength(3);
  });

  it('default (no flags) returns the 9 local fixtures only', () => {
    const fixtures = selectFixtures({
      fixtures: null,
      dryRun: false,
      smoke: false,
      includePublic: false,
    });
    expect(fixtures).toHaveLength(9);
    expect(fixtures.every((f) => f.fixture_source === 'local')).toBe(true);
  });

  it('--public-urls expands to 12 (9 local + 3 public)', () => {
    const fixtures = selectFixtures({
      fixtures: null,
      dryRun: false,
      smoke: false,
      includePublic: true,
    });
    expect(fixtures).toHaveLength(12);
    expect(fixtures.filter((f) => f.fixture_source === 'public')).toHaveLength(3);
  });

  it('--fixtures narrows the selection (preserves catalog order)', () => {
    const fixtures = selectFixtures({
      fixtures: ['injected/hidden-div-basic.html', 'clean/simple-article.html'],
      dryRun: false,
      smoke: false,
      includePublic: false,
    });
    expect(fixtures.map((f) => f.fixture_id)).toEqual([
      'clean/simple-article.html',
      'injected/hidden-div-basic.html',
    ]);
  });
});

describe('fixture catalog invariants', () => {
  it('9 local fixtures distributed evenly across categories', () => {
    const counts = LOCAL_FIXTURES_9.reduce<Record<string, number>>((acc, f) => {
      acc[f.category] = (acc[f.category] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts.clean).toBe(3);
    expect(counts.injected).toBe(3);
    expect(counts.borderline).toBe(3);
  });

  it('public fixtures cover clean + borderline (injected is local-only)', () => {
    const cats = new Set(PUBLIC_FIXTURES_3.map((f) => f.category));
    expect(cats.has('clean')).toBe(true);
    expect(cats.has('borderline')).toBe(true);
    expect(cats.has('injected')).toBe(false);
  });

  it('ALL_FIXTURE_IDS is unique', () => {
    expect(new Set(ALL_FIXTURE_IDS).size).toBe(ALL_FIXTURE_IDS.length);
  });

  it('every expected_verdict is one of CLEAN/SUSPICIOUS/COMPROMISED', () => {
    for (const f of [...LOCAL_FIXTURES_9, ...PUBLIC_FIXTURES_3]) {
      expect(['CLEAN', 'SUSPICIOUS', 'COMPROMISED']).toContain(f.expected_verdict);
    }
  });
});

describe('row-schema completeness', () => {
  it('row has every Phase3LiveRow field (no drift between type and builder)', () => {
    const fixture = sampleLocal();
    const row = buildLiveRow({
      fixture,
      fixture_url: 'http://localhost:1/x',
      extension_mode: 'on',
      canary_model: GEMMA,
      verdict_payload: { status: 'CLEAN' },
      verdict_latency_ms: 1,
      error_message: null,
      skipped_reason: null,
    });
    // Compile-time check by explicit property enumeration — if a field is
    // added to Phase3LiveRow without updating buildLiveRow, TS will fail
    // this destructure with "is missing" at the usage below.
    const expected: Record<keyof Phase3LiveRow, unknown> = {
      provider: row.provider,
      engine_runtime: row.engine_runtime,
      engine_model: row.engine_model,
      model: row.model,
      probe: row.probe,
      input: row.input,
      category: row.category,
      output: row.output,
      complied: row.complied,
      leaked_prompt: row.leaked_prompt,
      included_url: row.included_url,
      blocked_by_safety: row.blocked_by_safety,
      inference_ms: row.inference_ms,
      skipped_reason: row.skipped_reason,
      fp_review: row.fp_review,
      fixture_id: row.fixture_id,
      fixture_source: row.fixture_source,
      fixture_url: row.fixture_url,
      expected_verdict: row.expected_verdict,
      extension_mode: row.extension_mode,
      verdict: row.verdict,
      verdict_confidence: row.verdict_confidence,
      verdict_flags: row.verdict_flags,
      verdict_latency_ms: row.verdict_latency_ms,
      extension_fired_before_model_saw_content: row.extension_fired_before_model_saw_content,
      surface: row.surface,
      attachment_mode: row.attachment_mode,
      agent_mode: row.agent_mode,
      llm_final_response_text: row.llm_final_response_text,
      did_llm_comply: row.did_llm_comply,
      phase1_baseline_complied: row.phase1_baseline_complied,
      error_message: row.error_message,
    };
    expect(Object.keys(expected).length).toBeGreaterThan(25);
  });
});
