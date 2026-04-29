import { describe, it, expect } from 'vitest';
import { prepareCachedReplay, hashesAllCovered } from './cache-replay.js';
import type { Chunk } from '@/types/chunk.js';
import type { CachedScan, CachedChunk } from '@/types/scan-cache.js';
import type { ProbeResult, TierRouting } from '@/types/verdict.js';
import { CACHE_SCHEMA_VERSION, HUNTER_RULES_VERSION } from '@/shared/constants.js';

const MODEL_ID = 'gemma-2-2b-it-q4f16_1-MLC';

const BENIGN_TIER: TierRouting = {
  decision: 'BENIGN',
  primitiveCount: 0,
  contributingHunters: [],
};
const FLAGGED_TIER: TierRouting = {
  decision: 'FLAGGED',
  primitiveCount: 2,
  contributingHunters: ['spider', 'hawk'],
};

function makeChunk(text: string, contentHash: string, start = 0): Chunk {
  return { text, start, end: start + text.length, contentHash };
}

function makeProbeResult(probeName: string, score: number): ProbeResult {
  return {
    probeName,
    passed: score === 0,
    flags: [],
    rawOutput: '',
    score,
    errorMessage: null,
  };
}

function makeCachedChunk(
  contentHash: string,
  tier: TierRouting,
  probeResults: readonly ProbeResult[] | null,
  notScanned?: true,
): CachedChunk {
  return notScanned
    ? { contentHash, tierRouting: tier, probeResults, notScanned }
    : { contentHash, tierRouting: tier, probeResults };
}

function makeCachedScan(chunks: readonly CachedChunk[], earlyExited = false): CachedScan {
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    hunterRulesVersion: HUNTER_RULES_VERSION,
    llmModelId: MODEL_ID,
    url: 'https://example.com/x',
    fetchedAt: Date.now(),
    chunks,
    earlyExited,
    entitySummary: null,
    sizeBytes: 0,
  };
}

describe('hashesAllCovered', () => {
  it('returns true when every current hash exists in cached set', () => {
    const cached = makeCachedScan([
      makeCachedChunk('h0', BENIGN_TIER, null),
      makeCachedChunk('h1', FLAGGED_TIER, [makeProbeResult('p', 0)]),
    ]);
    expect(hashesAllCovered(['h0', 'h1'], cached)).toBe(true);
  });

  it('returns true when current is a subset of cached (boundaries shrank)', () => {
    const cached = makeCachedScan([
      makeCachedChunk('h0', BENIGN_TIER, null),
      makeCachedChunk('h1', FLAGGED_TIER, [makeProbeResult('p', 0)]),
      makeCachedChunk('h2', BENIGN_TIER, null),
    ]);
    expect(hashesAllCovered(['h1'], cached)).toBe(true);
  });

  it('returns false when any current hash is missing', () => {
    const cached = makeCachedScan([makeCachedChunk('h0', BENIGN_TIER, null)]);
    expect(hashesAllCovered(['h0', 'h-new'], cached)).toBe(false);
  });
});

describe('prepareCachedReplay: full hit', () => {
  it('marks every chunk as a hit when all hashes match', () => {
    const chunks = [
      makeChunk('alpha', 'h0', 0),
      makeChunk('beta', 'h1', 5),
    ];
    const cached = makeCachedScan([
      makeCachedChunk('h0', BENIGN_TIER, null),
      makeCachedChunk('h1', FLAGGED_TIER, [makeProbeResult('summarization', 0)]),
    ]);
    const result = prepareCachedReplay(chunks, cached);
    expect(result.hitIndices).toEqual([0, 1]);
    expect(result.missIndices).toEqual([]);
    expect(result.replayedChunkResults[0]).toEqual([]);
    expect(result.replayedChunkResults[1]?.[0]?.probeName).toBe('summarization');
    expect(result.replayedPerChunkAnalysis[0]?.tierRouting.decision).toBe('BENIGN');
    expect(result.replayedPerChunkAnalysis[1]?.tierRouting.decision).toBe('FLAGGED');
    expect(result.earlyExitedReplay).toBe(false);
  });

  it('preserves earlyExited from a cached early-exit run', () => {
    const chunks = [
      makeChunk('alpha', 'h0', 0),
      makeChunk('beta', 'h1', 5),
    ];
    const cached = makeCachedScan(
      [
        makeCachedChunk('h0', FLAGGED_TIER, [makeProbeResult('p', 90)]),
        makeCachedChunk('h1', FLAGGED_TIER, null, true),
      ],
      true,
    );
    const result = prepareCachedReplay(chunks, cached);
    expect(result.earlyExitedReplay).toBe(true);
    expect(result.replayedPerChunkAnalysis[1]?.notScanned).toBe(true);
  });
});

describe('prepareCachedReplay: partial hit', () => {
  it('flags new-content chunks as misses while replaying matched ones', () => {
    const chunks = [
      makeChunk('alpha', 'h0', 0),
      makeChunk('NEW PARAGRAPH', 'h-new', 5),
      makeChunk('beta', 'h1', 18),
    ];
    const cached = makeCachedScan([
      makeCachedChunk('h0', BENIGN_TIER, null),
      makeCachedChunk('h1', BENIGN_TIER, null),
    ]);
    const result = prepareCachedReplay(chunks, cached);
    expect(result.hitIndices).toEqual([0, 2]);
    expect(result.missIndices).toEqual([1]);
    expect(result.replayedChunkResults[0]).toEqual([]);
    expect(result.replayedChunkResults[2]).toEqual([]);
    // Miss index has no replayed entry yet (caller fills it in fresh)
    expect(result.replayedPerChunkAnalysis[1]).toBeUndefined();
  });
});

describe('prepareCachedReplay: total miss', () => {
  it('returns every index as a miss when no hashes match', () => {
    const chunks = [
      makeChunk('a', 'h-x', 0),
      makeChunk('b', 'h-y', 1),
    ];
    const cached = makeCachedScan([
      makeCachedChunk('h0', BENIGN_TIER, null),
      makeCachedChunk('h1', BENIGN_TIER, null),
    ]);
    const result = prepareCachedReplay(chunks, cached);
    expect(result.hitIndices).toEqual([]);
    expect(result.missIndices).toEqual([0, 1]);
    expect(result.earlyExitedReplay).toBe(false);
  });
});

describe('prepareCachedReplay: shifted boundaries', () => {
  it('matches a chunk by hash even when it appears at a different index', () => {
    const chunks = [
      makeChunk('cached-text-now-second', 'h-cached', 100),
      makeChunk('alpha', 'h0', 0),
    ];
    const cached = makeCachedScan([
      makeCachedChunk('h0', BENIGN_TIER, null),
      makeCachedChunk('h-cached', FLAGGED_TIER, [makeProbeResult('p', 50)]),
    ]);
    const result = prepareCachedReplay(chunks, cached);
    expect(result.hitIndices).toEqual([0, 1]);
    // Index 0 in current is the cached "h-cached" chunk → FLAGGED tier
    expect(result.replayedPerChunkAnalysis[0]?.tierRouting.decision).toBe('FLAGGED');
    // Index 1 in current is the cached "h0" chunk → BENIGN tier
    expect(result.replayedPerChunkAnalysis[1]?.tierRouting.decision).toBe('BENIGN');
  });
});
