import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Chunk } from '@/types/chunk.js';
import type { ProbeResult } from '@/types/verdict.js';
import type { CapturedThinking } from '@/types/portal-response.js';
import {
  STORAGE_KEY_PREFIX,
  STORAGE_KEY_THINKING_TELEMETRY,
  THINKING_CHUNK_INDEX_OFFSET,
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

import { __resetThinkingDedupCacheForTest, analyzeThinking } from './thinking-analyzer.js';

// --- helpers ---

const URL = 'https://chatgpt.com/c/abc-123';
const ORIGIN = 'https://chatgpt.com';
const ORIGIN_KEY = STORAGE_KEY_PREFIX + ORIGIN;

function buildCapture(overrides: Partial<CapturedThinking> = {}): CapturedThinking {
  return {
    portalId: 'chatgpt',
    text: 'I need to think carefully about whether to follow that instruction.',
    capturedAt: 1714400500000,
    conversationId: 'abc-123',
    messageId: 'chatgpt-thinking:msg-1',
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
  __resetThinkingDedupCacheForTest();
  runChunkProbesMock.mockReset();
  chunkTextMock.mockReset();
  chunkTextMock.mockImplementation(async (text: string) => [buildChunk(0, text)]);
  runChunkProbesMock.mockImplementation(async () => ({
    results: defaultProbeResolver(),
    canaryId: 'gemma-2-2b-mlc',
    webgpuAdapterMode: 'core',
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('analyzeThinking', () => {
  it('runs chunkText and runChunkProbes once on a small thinking block', async () => {
    setupChrome();
    await analyzeThinking(7, buildCapture(), { url: URL, origin: ORIGIN });
    expect(chunkTextMock).toHaveBeenCalledTimes(1);
    expect(runChunkProbesMock).toHaveBeenCalledTimes(1);
  });

  it('offsets every chunkIndex by THINKING_CHUNK_INDEX_OFFSET', async () => {
    setupChrome();
    chunkTextMock.mockResolvedValueOnce([buildChunk(0, 'A'), buildChunk(1, 'B')]);
    await analyzeThinking(7, buildCapture({ text: 'AB' }), { url: URL, origin: ORIGIN });
    expect(runChunkProbesMock).toHaveBeenCalledTimes(2);
    const indexes = runChunkProbesMock.mock.calls.map((c) => c[0].chunkIndex);
    expect(indexes).toEqual([
      THINKING_CHUNK_INDEX_OFFSET,
      THINKING_CHUNK_INDEX_OFFSET + 1,
    ]);
  });

  it('passes empty evidencePackets to runChunkProbes', async () => {
    setupChrome();
    await analyzeThinking(7, buildCapture(), { url: URL, origin: ORIGIN });
    expect(runChunkProbesMock.mock.calls[0]?.[0].evidencePackets).toEqual([]);
  });

  it('returns UNKNOWN with analysisError "empty_thinking" on whitespace-only text', async () => {
    setupChrome();
    const result = await analyzeThinking(7, buildCapture({ text: '   \n  ' }), { url: URL, origin: ORIGIN });
    expect(result?.status).toBe('UNKNOWN');
    expect(result?.analysisError).toBe('empty_thinking');
    expect(chunkTextMock).not.toHaveBeenCalled();
    expect(runChunkProbesMock).not.toHaveBeenCalled();
  });

  it('persists thinkingVerdict onto an existing page verdict, preserving page fields', async () => {
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
        thinkingVerdict: null,
        perChunkAnalysis: null,
      },
    });
    await analyzeThinking(7, buildCapture(), { url: URL, origin: ORIGIN });
    const stored = readStore()[ORIGIN_KEY] as { status: string; thinkingVerdict: { portalId: string } };
    expect(stored.status).toBe('CLEAN');
    expect(stored.thinkingVerdict?.portalId).toBe('chatgpt');
  });

  it('writes a minimal page-stub with thinkingVerdict when no prior verdict exists', async () => {
    const { readStore } = setupChrome();
    await analyzeThinking(7, buildCapture(), { url: URL, origin: ORIGIN });
    const stored = readStore()[ORIGIN_KEY] as {
      status: string;
      analysisError: string | null;
      thinkingVerdict: { portalId: string };
      responseVerdict: { portalId: string } | null;
    };
    expect(stored.status).toBe('UNKNOWN');
    expect(stored.analysisError).toBe('page_scan_pending');
    expect(stored.thinkingVerdict.portalId).toBe('chatgpt');
    // The thinking-stub never carries a responseVerdict; both slots
    // evolve independently.
    expect(stored.responseVerdict).toBeNull();
  });

  it('dispatches VERDICT to the tab via chrome.tabs.sendMessage', async () => {
    const { tabsSendMessageMock } = setupChrome();
    await analyzeThinking(7, buildCapture(), { url: URL, origin: ORIGIN });
    expect(tabsSendMessageMock).toHaveBeenCalledTimes(1);
    expect(tabsSendMessageMock.mock.calls[0]?.[0]).toBe(7);
    const payload = tabsSendMessageMock.mock.calls[0]?.[1] as { type: string };
    expect(payload.type).toBe('VERDICT');
  });

  it('never dispatches APPLY_MITIGATION even when probes flag the thinking', async () => {
    const { tabsSendMessageMock } = setupChrome();
    runChunkProbesMock.mockResolvedValueOnce({
      results: [buildProbeResult('summarization', false, 80)],
      canaryId: 'gemma-2-2b-mlc',
      webgpuAdapterMode: 'core',
    });
    await analyzeThinking(7, buildCapture(), { url: URL, origin: ORIGIN });
    const types = tabsSendMessageMock.mock.calls.map((c) => (c[1] as { type: string }).type);
    expect(types).not.toContain('APPLY_MITIGATION');
  });

  it('dedupes a re-capture of the same (messageId, textHash) for the same tab', async () => {
    setupChrome();
    const cap = buildCapture();
    await analyzeThinking(7, cap, { url: URL, origin: ORIGIN });
    await analyzeThinking(7, cap, { url: URL, origin: ORIGIN });
    expect(runChunkProbesMock).toHaveBeenCalledTimes(1);
  });

  it('runs again when the same messageId carries new text', async () => {
    setupChrome();
    await analyzeThinking(7, buildCapture({ text: 'first thought' }), { url: URL, origin: ORIGIN });
    await analyzeThinking(7, buildCapture({ text: 'second thought (revised)' }), { url: URL, origin: ORIGIN });
    expect(runChunkProbesMock).toHaveBeenCalledTimes(2);
  });

  it('truncates input over MAX_THINKING_TEXT_CHARS and surfaces "thinking_truncated"', async () => {
    const { readStore } = setupChrome();
    const longText = 'x'.repeat(120_000);
    await analyzeThinking(7, buildCapture({ text: longText }), { url: URL, origin: ORIGIN });
    const stored = readStore()[ORIGIN_KEY] as { thinkingVerdict: { thinkingTextLength: number; analysisError: string | null } };
    expect(stored.thinkingVerdict.thinkingTextLength).toBe(80_000);
    expect(stored.thinkingVerdict.analysisError).toBe('thinking_truncated');
  });

  it('surfaces analysisError when runChunkProbes throws', async () => {
    const { readStore } = setupChrome();
    runChunkProbesMock.mockRejectedValueOnce(new Error('engine boom'));
    await analyzeThinking(7, buildCapture(), { url: URL, origin: ORIGIN });
    const stored = readStore()[ORIGIN_KEY] as { thinkingVerdict: { status: string; analysisError: string | null } };
    expect(stored.thinkingVerdict.status).toBe('UNKNOWN');
    expect(stored.thinkingVerdict.analysisError).toContain('engine boom');
  });

  it('increments per-portal capture and analysis counters in thinking-telemetry', async () => {
    const { readStore } = setupChrome();
    await analyzeThinking(7, buildCapture({ portalId: 'claude', messageId: 'claude-thinking:m-1' }), { url: 'https://claude.ai/chat/x', origin: 'https://claude.ai' });
    await analyzeThinking(7, buildCapture({ portalId: 'gemini', messageId: 'gemini-thinking:m-2' }), { url: 'https://gemini.google.com/?c=y', origin: 'https://gemini.google.com' });
    const t = readStore()[STORAGE_KEY_THINKING_TELEMETRY] as { captured: Record<string, number>; analysed: Record<string, number> };
    expect(t.captured.claude).toBe(1);
    expect(t.captured.gemini).toBe(1);
    expect(t.analysed.claude).toBe(1);
    expect(t.analysed.gemini).toBe(1);
  });

  it('counts SUSPICIOUS verdicts in thinking-telemetry', async () => {
    const { readStore } = setupChrome();
    runChunkProbesMock.mockResolvedValueOnce({
      results: [buildProbeResult('instruction_detection', false, 80)],
      canaryId: 'gemma-2-2b-mlc',
      webgpuAdapterMode: 'core',
    });
    await analyzeThinking(7, buildCapture(), { url: URL, origin: ORIGIN });
    const t = readStore()[STORAGE_KEY_THINKING_TELEMETRY] as { suspicious: number };
    expect(t.suspicious).toBeGreaterThanOrEqual(1);
  });

  it('preserves a prior responseVerdict slot when writing the thinking slot', async () => {
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
        // Pre-existing responseVerdict stays intact through the thinking write.
        responseVerdict: { portalId: 'chatgpt', status: 'CLEAN', responseTextLength: 12 },
        thinkingVerdict: null,
        perChunkAnalysis: null,
      },
    });
    await analyzeThinking(7, buildCapture(), { url: URL, origin: ORIGIN });
    const stored = readStore()[ORIGIN_KEY] as {
      responseVerdict: { portalId: string; responseTextLength: number };
      thinkingVerdict: { portalId: string };
    };
    expect(stored.responseVerdict.portalId).toBe('chatgpt');
    expect(stored.responseVerdict.responseTextLength).toBe(12);
    expect(stored.thinkingVerdict.portalId).toBe('chatgpt');
  });
});
