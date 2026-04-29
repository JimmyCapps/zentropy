import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { HuntReport } from '@/hunters/hunt-runner.js';
import type { HunterResult } from '@/hunters/base-hunter.js';
import type { Chunk } from '@/types/chunk.js';
import type { PageSnapshot } from '@/types/snapshot.js';
import type { ProbeResult } from '@/types/verdict.js';

// Mocks must be declared before importing the orchestrator so vi.mock
// rewrites the module graph correctly.
const runHuntersMock = vi.fn<(hunters: unknown, chunk: string) => Promise<HuntReport>>();
vi.mock('@/hunters/hunt-runner.js', () => ({
  runHunters: (...args: [unknown, string]) => runHuntersMock(...args),
  SHORT_CIRCUIT_CONFIDENCE: 0.75,
}));

const chunkTextMock = vi.fn<(text: string) => Promise<readonly Chunk[]>>();
vi.mock('@/hunters/hawk/chunking.js', () => ({
  chunkText: (text: string) => chunkTextMock(text),
}));

vi.mock('./offscreen-manager.js', () => ({
  ensureOffscreenDocument: async () => undefined,
}));
vi.mock('./keepalive.js', () => ({
  connectOffscreenPort: () => undefined,
}));
vi.mock('@/policy/origin-policy.js', () => ({
  resolveOriginPolicy: () => ({ action: 'scan', reason: 'default_scan', matchedRule: null }),
}));
vi.mock('@/policy/origin-storage.js', () => ({
  getOverrides: async () => ({}),
}));
vi.mock('@/shared/install-secret.js', () => ({
  ensureInstallSecret: async () => new Uint8Array(32),
}));
vi.mock('./stamp.js', () => ({
  generateStamp: async () => null,
}));

import { analyzeSnapshot } from './orchestrator.js';

function buildHuntReport(
  matchedNames: readonly { name: string; matched: boolean }[],
  aggregateError: string | null = null,
): HuntReport {
  const results: HunterResult[] = matchedNames.map((m) => ({
    hunterName: m.name,
    matched: m.matched,
    flags: m.matched ? [`${m.name}:test`] : [],
    score: m.matched ? 30 : 0,
    confidence: m.matched ? 0.6 : 0,
    features: [],
    errorMessage: null,
  }));
  return {
    results,
    totalScore: results.reduce((s, r) => s + r.score, 0),
    maxConfidence: results.reduce((m, r) => (r.confidence > m ? r.confidence : m), 0),
    shouldSkipProbes: false,
    flags: results.flatMap((r) => r.flags),
    aggregateError,
  };
}

function buildChunk(index: number, text: string): Chunk {
  return {
    text,
    start: index * 100,
    end: index * 100 + text.length,
    contentHash: `hash-${index}`,
  };
}

function snapshotFixture(): PageSnapshot {
  return {
    visibleText: 'visible content',
    hiddenText: '',
    scriptFingerprints: [],
    metadata: {
      title: 'Test',
      url: 'https://example.com/page',
      origin: 'https://example.com',
      description: '',
      ogTags: new Map<string, string>(),
      cspMeta: null,
      lang: 'en',
    },
    extractedAt: 1_700_000_000_000,
    charCount: 15,
  };
}

interface ChromeContext {
  runProbesCalls: { msg: { type: string; chunkIndex: number; tabId: number } }[];
  reset(): void;
}

function setupChrome(probeResponse: readonly ProbeResult[]): ChromeContext {
  let listener: ((msg: unknown) => void) | null = null;
  const calls: { msg: { type: string; chunkIndex: number; tabId: number } }[] = [];

  const sendMessage = vi.fn((msg: { type: string; tabId: number; chunkIndex: number }) => {
    if (msg.type === 'RUN_PROBES') {
      calls.push({ msg });
      // Microtask-defer the response so the orchestrator's listener is fully
      // wired before we deliver PROBE_RESULTS.
      Promise.resolve().then(() => {
        listener?.({
          type: 'PROBE_RESULTS',
          tabId: msg.tabId,
          chunkIndex: msg.chunkIndex,
          results: probeResponse,
          canaryId: 'gemma-2-2b-mlc',
          webgpuAdapterMode: 'core',
        });
      });
    }
  });

  const addListener = vi.fn((l: (msg: unknown) => void) => {
    listener = l;
  });
  const removeListener = vi.fn(() => {
    listener = null;
  });

  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: { addListener, removeListener },
      sendMessage,
    },
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
      },
    },
  });

  return {
    runProbesCalls: calls,
    reset() {
      calls.length = 0;
    },
  };
}

const SAMPLE_PROBE_RESULT: ProbeResult = {
  probeName: 'instruction_detection',
  passed: true,
  flags: [],
  rawOutput: '{"found":false,"instructions":[]}',
  score: 0,
  errorMessage: null,
};

describe('analyzeSnapshot tier-router integration (issue #112)', () => {
  beforeEach(() => {
    runHuntersMock.mockReset();
    chunkTextMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips runChunkProbes entirely when the only chunk routes BENIGN', async () => {
    chunkTextMock.mockResolvedValue([buildChunk(0, 'plain text')]);
    runHuntersMock.mockResolvedValue(
      buildHuntReport([
        { name: 'spider', matched: false },
        { name: 'hawk', matched: false },
      ]),
    );
    const ctx = setupChrome([SAMPLE_PROBE_RESULT]);

    const verdict = await analyzeSnapshot(101, snapshotFixture());

    expect(ctx.runProbesCalls.length).toBe(0);
    expect(verdict.perChunkAnalysis).not.toBeNull();
    expect(verdict.perChunkAnalysis!.length).toBe(1);
    expect(verdict.perChunkAnalysis![0]!.tierRouting.decision).toBe('BENIGN');
    expect(verdict.perChunkAnalysis![0]!.probeResults).toBeNull();
  });

  it('calls runChunkProbes once when the chunk routes UNCERTAIN', async () => {
    chunkTextMock.mockResolvedValue([buildChunk(0, 'maybe sus')]);
    runHuntersMock.mockResolvedValue(
      buildHuntReport([
        { name: 'spider', matched: true },
        { name: 'hawk', matched: false },
      ]),
    );
    const ctx = setupChrome([SAMPLE_PROBE_RESULT]);

    const verdict = await analyzeSnapshot(102, snapshotFixture());

    expect(ctx.runProbesCalls.length).toBe(1);
    expect(verdict.perChunkAnalysis![0]!.tierRouting.decision).toBe('UNCERTAIN');
    expect(verdict.perChunkAnalysis![0]!.probeResults).not.toBeNull();
  });

  it('calls runChunkProbes once when the chunk routes FLAGGED (k=2)', async () => {
    chunkTextMock.mockResolvedValue([buildChunk(0, 'definitely sus')]);
    runHuntersMock.mockResolvedValue(
      buildHuntReport([
        { name: 'spider', matched: true },
        { name: 'hawk', matched: true },
      ]),
    );
    const ctx = setupChrome([SAMPLE_PROBE_RESULT]);

    const verdict = await analyzeSnapshot(103, snapshotFixture());

    expect(ctx.runProbesCalls.length).toBe(1);
    expect(verdict.perChunkAnalysis![0]!.tierRouting.decision).toBe('FLAGGED');
  });

  it('on a 3-chunk page (BENIGN/UNCERTAIN/FLAGGED), runChunkProbes is called exactly twice', async () => {
    chunkTextMock.mockResolvedValue([
      buildChunk(0, 'a'),
      buildChunk(1, 'b'),
      buildChunk(2, 'c'),
    ]);
    runHuntersMock
      .mockResolvedValueOnce(
        buildHuntReport([
          { name: 'spider', matched: false },
          { name: 'hawk', matched: false },
        ]),
      )
      .mockResolvedValueOnce(
        buildHuntReport([
          { name: 'spider', matched: true },
          { name: 'hawk', matched: false },
        ]),
      )
      .mockResolvedValueOnce(
        buildHuntReport([
          { name: 'spider', matched: true },
          { name: 'hawk', matched: true },
        ]),
      );
    const ctx = setupChrome([SAMPLE_PROBE_RESULT]);

    const verdict = await analyzeSnapshot(104, snapshotFixture());

    expect(ctx.runProbesCalls.length).toBe(2);
    expect(verdict.perChunkAnalysis!.length).toBe(3);
    expect(verdict.perChunkAnalysis![0]!.tierRouting.decision).toBe('BENIGN');
    expect(verdict.perChunkAnalysis![1]!.tierRouting.decision).toBe('UNCERTAIN');
    expect(verdict.perChunkAnalysis![2]!.tierRouting.decision).toBe('FLAGGED');
    expect(ctx.runProbesCalls[0]!.msg.chunkIndex).toBe(1);
    expect(ctx.runProbesCalls[1]!.msg.chunkIndex).toBe(2);
  });

  it('routes UNCERTAIN (fail-open) when hunters error, so probes still run', async () => {
    chunkTextMock.mockResolvedValue([buildChunk(0, 'page text')]);
    runHuntersMock.mockResolvedValue(
      buildHuntReport(
        [
          { name: 'spider', matched: false },
          { name: 'hawk', matched: false },
        ],
        'classifier load failed',
      ),
    );
    const ctx = setupChrome([SAMPLE_PROBE_RESULT]);

    const verdict = await analyzeSnapshot(105, snapshotFixture());

    expect(ctx.runProbesCalls.length).toBe(1);
    expect(verdict.perChunkAnalysis![0]!.tierRouting.decision).toBe('UNCERTAIN');
  });

  it('an all-BENIGN page produces a CLEAN verdict (not UNKNOWN) — empty probeResults treated as clean', async () => {
    chunkTextMock.mockResolvedValue([buildChunk(0, 'a'), buildChunk(1, 'b')]);
    runHuntersMock.mockResolvedValue(
      buildHuntReport([
        { name: 'spider', matched: false },
        { name: 'hawk', matched: false },
      ]),
    );
    const ctx = setupChrome([SAMPLE_PROBE_RESULT]);

    const verdict = await analyzeSnapshot(106, snapshotFixture());

    expect(ctx.runProbesCalls.length).toBe(0);
    expect(verdict.status).toBe('CLEAN');
    expect(verdict.totalScore).toBe(0);
    expect(verdict.analysisError).toBeNull();
  });

  it('perChunkAnalysis.length always equals chunks.length on completed runs', async () => {
    chunkTextMock.mockResolvedValue([
      buildChunk(0, 'a'),
      buildChunk(1, 'b'),
      buildChunk(2, 'c'),
      buildChunk(3, 'd'),
    ]);
    runHuntersMock.mockResolvedValue(
      buildHuntReport([
        { name: 'spider', matched: true },
        { name: 'hawk', matched: false },
      ]),
    );
    setupChrome([SAMPLE_PROBE_RESULT]);

    const verdict = await analyzeSnapshot(107, snapshotFixture());

    expect(verdict.perChunkAnalysis!.length).toBe(4);
    verdict.perChunkAnalysis!.forEach((entry, i) => {
      expect(entry.index).toBe(i);
      expect(entry.contentHash).toMatch(/^[0-9a-f]+$/);
    });
  });
});
