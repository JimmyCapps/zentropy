import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Chunk } from '@/types/chunk.js';
import type { ProbeResult } from '@/types/verdict.js';
import type { CapturedResponse } from '@/types/portal-response.js';
import {
  RESPONSE_CHUNK_INDEX_OFFSET,
  STORAGE_KEY_PREFIX,
  STORAGE_KEY_RESPONSE_TELEMETRY,
} from '@/shared/constants.js';

// --- mocks must precede the SUT import ---

const runChunkProbesMock =
  vi.fn<(args: { tabId: number; chunk: string; chunkIndex: number; totalChunks: number; url: string; origin: string; evidencePackets: readonly unknown[] }) =>
    Promise<{ results: readonly ProbeResult[]; canaryId: string | null; webgpuAdapterMode: string | null }>>();

vi.mock('./orchestrator.js', async () => {
  const actual = await vi.importActual<typeof import('./orchestrator.js')>('./orchestrator.js');
  return {
    ...actual,
    runChunkProbes: (args: Parameters<typeof runChunkProbesMock>[0]) => runChunkProbesMock(args),
  };
});

const chunkTextMock = vi.fn<(text: string) => Promise<readonly Chunk[]>>();
vi.mock('@/hunters/hawk/chunking.js', () => ({
  chunkText: (text: string) => chunkTextMock(text),
}));

vi.mock('./offscreen-manager.js', () => ({
  ensureOffscreenDocument: async () => undefined,
}));

import { __resetDedupCacheForTest, analyzeResponse } from './response-analyzer.js';

// --- helpers ---

const URL = 'https://chatgpt.com/c/abc-123';
const ORIGIN = 'https://chatgpt.com';
const ORIGIN_KEY = STORAGE_KEY_PREFIX + ORIGIN;

function buildCapture(overrides: Partial<CapturedResponse> = {}): CapturedResponse {
  return {
    portalId: 'chatgpt',
    text: 'The answer is 4.',
    capturedAt: 1714400000000,
    conversationId: 'abc-123',
    messageId: 'msg-1',
    streamComplete: true,
    ...overrides,
  };
}

function buildChunk(index: number, text: string): Chunk {
  const hex = (index + 1).toString(16).padStart(64, '0');
  return { text, start: index * 100, end: index * 100 + text.length, contentHash: hex };
}

function buildProbeResult(probeName: string, passed: boolean, score: number = 0): ProbeResult {
  return { probeName, passed, flags: passed ? [] : [`${probeName}:flag`], rawOutput: 'ok', score, errorMessage: null };
}

interface ChromeContext {
  readonly readStore: () => Record<string, unknown>;
  readonly tabsSendMessageMock: ReturnType<typeof vi.fn>;
}

function setupChrome(initialStore: Record<string, unknown> = {}): ChromeContext {
  const store: Record<string, unknown> = { ...initialStore };
  const tabsSendMessageMock = vi.fn(async (_tabId: number, _msg: unknown) => undefined);
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (key?: string | string[] | null) => {
          if (key === undefined || key === null) return { ...store };
          if (Array.isArray(key)) {
            const out: Record<string, unknown> = {};
            for (const k of key) if (k in store) out[k] = store[k];
            return out;
          }
          return key in store ? { [key]: store[key] } : {};
        },
        set: async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        },
        remove: async () => undefined,
      },
    },
    tabs: { sendMessage: tabsSendMessageMock },
  });
  return { readStore: () => store, tabsSendMessageMock };
}

function defaultProbeResolver(): readonly ProbeResult[] {
  return [
    buildProbeResult('summarization', true, 0),
    buildProbeResult('instruction_detection', true, 0),
    buildProbeResult('adversarial_compliance', true, 0),
  ];
}

beforeEach(() => {
  vi.unstubAllGlobals();
  __resetDedupCacheForTest();
  runChunkProbesMock.mockReset();
  chunkTextMock.mockReset();
  // Default: chunkText returns one chunk equal to the text.
  chunkTextMock.mockImplementation(async (text: string) => [buildChunk(0, text)]);
  // Default: probes return CLEAN.
  runChunkProbesMock.mockImplementation(async () => ({
    results: defaultProbeResolver(),
    canaryId: 'gemma-2-2b-mlc',
    webgpuAdapterMode: 'core',
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('analyzeResponse', () => {
  it('runs chunkText and runChunkProbes once on a small response', async () => {
    setupChrome();
    await analyzeResponse(7, buildCapture(), { url: URL, origin: ORIGIN });
    expect(chunkTextMock).toHaveBeenCalledTimes(1);
    expect(runChunkProbesMock).toHaveBeenCalledTimes(1);
  });

  it('offsets every chunkIndex by RESPONSE_CHUNK_INDEX_OFFSET', async () => {
    setupChrome();
    chunkTextMock.mockResolvedValueOnce([buildChunk(0, 'A'), buildChunk(1, 'B')]);
    await analyzeResponse(7, buildCapture({ text: 'AB' }), { url: URL, origin: ORIGIN });
    expect(runChunkProbesMock).toHaveBeenCalledTimes(2);
    const indexes = runChunkProbesMock.mock.calls.map((c) => c[0].chunkIndex);
    expect(indexes).toEqual([
      RESPONSE_CHUNK_INDEX_OFFSET,
      RESPONSE_CHUNK_INDEX_OFFSET + 1,
    ]);
  });

  it('passes empty evidencePackets to runChunkProbes', async () => {
    setupChrome();
    await analyzeResponse(7, buildCapture(), { url: URL, origin: ORIGIN });
    expect(runChunkProbesMock.mock.calls[0]?.[0].evidencePackets).toEqual([]);
  });

  it('returns UNKNOWN with analysisError "empty_response" on whitespace-only text', async () => {
    setupChrome();
    const result = await analyzeResponse(7, buildCapture({ text: '   \n  ' }), { url: URL, origin: ORIGIN });
    expect(result?.status).toBe('UNKNOWN');
    expect(result?.analysisError).toBe('empty_response');
    expect(chunkTextMock).not.toHaveBeenCalled();
    expect(runChunkProbesMock).not.toHaveBeenCalled();
  });

  it('persists responseVerdict onto an existing page verdict, preserving page fields', async () => {
    const { readStore } = setupChrome({
      [ORIGIN_KEY]: {
        status: 'CLEAN',
        confidence: 0.95,
        totalScore: 0,
        timestamp: 1700000000000,
        url: URL,
        flags: [],
        behavioralFlags: { roleDrift: false, exfiltrationIntent: false, instructionFollowing: false, hiddenContentAwareness: false },
        analysisError: null,
        canaryId: 'gemma-2-2b-mlc',
        stamp: null,
        hunterSummary: null,
        entitySummary: null,
        responseVerdict: null,
        perChunkAnalysis: null,
      },
    });
    await analyzeResponse(7, buildCapture(), { url: URL, origin: ORIGIN });
    const stored = readStore()[ORIGIN_KEY] as { status: string; responseVerdict: { portalId: string } };
    expect(stored.status).toBe('CLEAN');
    expect(stored.responseVerdict?.portalId).toBe('chatgpt');
  });

  it('writes a minimal page-stub when no prior verdict exists', async () => {
    const { readStore } = setupChrome();
    await analyzeResponse(7, buildCapture(), { url: URL, origin: ORIGIN });
    const stored = readStore()[ORIGIN_KEY] as { status: string; analysisError: string | null; responseVerdict: { portalId: string } };
    expect(stored.status).toBe('UNKNOWN');
    expect(stored.analysisError).toBe('page_scan_pending');
    expect(stored.responseVerdict.portalId).toBe('chatgpt');
  });

  it('dispatches VERDICT to the tab via chrome.tabs.sendMessage', async () => {
    const { tabsSendMessageMock } = setupChrome();
    await analyzeResponse(7, buildCapture(), { url: URL, origin: ORIGIN });
    expect(tabsSendMessageMock).toHaveBeenCalledTimes(1);
    expect(tabsSendMessageMock.mock.calls[0]?.[0]).toBe(7);
    const payload = tabsSendMessageMock.mock.calls[0]?.[1] as { type: string };
    expect(payload.type).toBe('VERDICT');
  });

  it('never dispatches APPLY_MITIGATION even when probes flag the response', async () => {
    const { tabsSendMessageMock } = setupChrome();
    runChunkProbesMock.mockResolvedValueOnce({
      results: [buildProbeResult('summarization', false, 80)],
      canaryId: 'gemma-2-2b-mlc',
      webgpuAdapterMode: 'core',
    });
    await analyzeResponse(7, buildCapture(), { url: URL, origin: ORIGIN });
    const types = tabsSendMessageMock.mock.calls.map((c) => (c[1] as { type: string }).type);
    expect(types).not.toContain('APPLY_MITIGATION');
  });

  it('dedupes a re-capture of the same (messageId, textHash) for the same tab', async () => {
    setupChrome();
    const cap = buildCapture();
    await analyzeResponse(7, cap, { url: URL, origin: ORIGIN });
    await analyzeResponse(7, cap, { url: URL, origin: ORIGIN });
    expect(runChunkProbesMock).toHaveBeenCalledTimes(1);
  });

  it('runs again when a regenerate produces new text under the same messageId', async () => {
    setupChrome();
    await analyzeResponse(7, buildCapture({ text: 'first' }), { url: URL, origin: ORIGIN });
    await analyzeResponse(7, buildCapture({ text: 'second (regenerated)' }), { url: URL, origin: ORIGIN });
    expect(runChunkProbesMock).toHaveBeenCalledTimes(2);
  });

  it('truncates input over MAX_RESPONSE_TEXT_CHARS and surfaces "response_truncated"', async () => {
    const { readStore } = setupChrome();
    const longText = 'x'.repeat(120_000);
    await analyzeResponse(7, buildCapture({ text: longText }), { url: URL, origin: ORIGIN });
    const stored = readStore()[ORIGIN_KEY] as { responseVerdict: { responseTextLength: number; analysisError: string | null } };
    expect(stored.responseVerdict.responseTextLength).toBe(80_000);
    expect(stored.responseVerdict.analysisError).toBe('response_truncated');
  });

  it('surfaces analysisError when runChunkProbes throws', async () => {
    const { readStore } = setupChrome();
    runChunkProbesMock.mockRejectedValueOnce(new Error('engine boom'));
    await analyzeResponse(7, buildCapture(), { url: URL, origin: ORIGIN });
    const stored = readStore()[ORIGIN_KEY] as { responseVerdict: { status: string; analysisError: string | null } };
    expect(stored.responseVerdict.status).toBe('UNKNOWN');
    expect(stored.responseVerdict.analysisError).toContain('engine boom');
  });

  it('increments per-portal capture and analysis counters in telemetry', async () => {
    const { readStore } = setupChrome();
    await analyzeResponse(7, buildCapture({ portalId: 'claude', messageId: 'm-1' }), { url: 'https://claude.ai/chat/x', origin: 'https://claude.ai' });
    await analyzeResponse(7, buildCapture({ portalId: 'gemini', messageId: 'm-2' }), { url: 'https://gemini.google.com/?c=y', origin: 'https://gemini.google.com' });
    const t = readStore()[STORAGE_KEY_RESPONSE_TELEMETRY] as { captured: Record<string, number>; analysed: Record<string, number> };
    expect(t.captured.claude).toBe(1);
    expect(t.captured.gemini).toBe(1);
    expect(t.analysed.claude).toBe(1);
    expect(t.analysed.gemini).toBe(1);
  });

  it('counts SUSPICIOUS verdicts in telemetry', async () => {
    const { readStore } = setupChrome();
    // instruction_detection's score is capped at SCORE_INSTRUCTION_DETECTION
    // (40) which lands above THRESHOLD_SUSPICIOUS (30) but below
    // THRESHOLD_COMPROMISED (65) — yields SUSPICIOUS.
    runChunkProbesMock.mockResolvedValueOnce({
      results: [buildProbeResult('instruction_detection', false, 80)],
      canaryId: 'gemma-2-2b-mlc',
      webgpuAdapterMode: 'core',
    });
    await analyzeResponse(7, buildCapture(), { url: URL, origin: ORIGIN });
    const t = readStore()[STORAGE_KEY_RESPONSE_TELEMETRY] as { suspicious: number };
    expect(t.suspicious).toBeGreaterThanOrEqual(1);
  });
});
