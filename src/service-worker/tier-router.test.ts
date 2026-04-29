import { describe, it, expect } from 'vitest';
import type { HuntReport } from '@/hunters/hunt-runner.js';
import type { HunterResult } from '@/hunters/base-hunter.js';
import { routeChunk } from './tier-router.js';

function stubResult(name: string, matched: boolean): HunterResult {
  return {
    hunterName: name,
    matched,
    flags: matched ? [`${name}:test-flag`] : [],
    score: matched ? 30 : 0,
    confidence: matched ? 0.6 : 0,
    features: [],
    errorMessage: null,
  };
}

function makeReport(
  matchedNames: readonly { name: string; matched: boolean }[],
  aggregateError: string | null = null,
): HuntReport {
  const results = matchedNames.map((m) => stubResult(m.name, m.matched));
  return {
    results,
    totalScore: results.reduce((s, r) => s + r.score, 0),
    maxConfidence: results.reduce((m, r) => (r.confidence > m ? r.confidence : m), 0),
    shouldSkipProbes: false,
    flags: results.flatMap((r) => r.flags),
    aggregateError,
  };
}

describe('routeChunk (issue #112 N1)', () => {
  it('routes to BENIGN when no hunter matched', () => {
    const report = makeReport([
      { name: 'spider', matched: false },
      { name: 'hawk', matched: false },
    ]);
    const routing = routeChunk(report);
    expect(routing.decision).toBe('BENIGN');
    expect(routing.primitiveCount).toBe(0);
    expect(routing.contributingHunters).toEqual([]);
  });

  it('routes to UNCERTAIN when only spider matched', () => {
    const report = makeReport([
      { name: 'spider', matched: true },
      { name: 'hawk', matched: false },
    ]);
    const routing = routeChunk(report);
    expect(routing.decision).toBe('UNCERTAIN');
    expect(routing.primitiveCount).toBe(1);
    expect(routing.contributingHunters).toEqual(['spider']);
  });

  it('routes to UNCERTAIN when only hawk matched', () => {
    const report = makeReport([
      { name: 'spider', matched: false },
      { name: 'hawk', matched: true },
    ]);
    const routing = routeChunk(report);
    expect(routing.decision).toBe('UNCERTAIN');
    expect(routing.primitiveCount).toBe(1);
    expect(routing.contributingHunters).toEqual(['hawk']);
  });

  it('routes to FLAGGED when both hunters matched (k=2)', () => {
    const report = makeReport([
      { name: 'spider', matched: true },
      { name: 'hawk', matched: true },
    ]);
    const routing = routeChunk(report);
    expect(routing.decision).toBe('FLAGGED');
    expect(routing.primitiveCount).toBe(2);
    expect(routing.contributingHunters).toEqual(['spider', 'hawk']);
  });

  it('fails open to UNCERTAIN when hunters reported aggregateError', () => {
    // Hunter crash must NOT silently suppress the LLM tier — fall through
    // to probes for confirmation rather than mis-classifying as BENIGN.
    const report = makeReport(
      [
        { name: 'spider', matched: false },
        { name: 'hawk', matched: false },
      ],
      'classifier load failed',
    );
    const routing = routeChunk(report);
    expect(routing.decision).toBe('UNCERTAIN');
    expect(routing.primitiveCount).toBe(0);
    expect(routing.contributingHunters).toEqual([]);
  });

  it('preserves hunter ordering from the results array', () => {
    const report = makeReport([
      { name: 'hawk', matched: true },
      { name: 'spider', matched: true },
    ]);
    const routing = routeChunk(report);
    expect(routing.contributingHunters).toEqual(['hawk', 'spider']);
  });

  it('cannot reach FLAGGED with only one hunter in the input', () => {
    const report = makeReport([{ name: 'spider', matched: true }]);
    const routing = routeChunk(report);
    expect(routing.decision).toBe('UNCERTAIN');
    expect(routing.primitiveCount).toBe(1);
  });
});
