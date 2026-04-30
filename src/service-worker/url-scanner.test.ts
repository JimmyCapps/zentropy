import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Chunk } from '@/types/chunk.js';
import type { ProbeResult } from '@/types/verdict.js';
import type { CachedChunk, CachedScan } from '@/types/scan-cache.js';
import type { PageSnapshot } from '@/types/snapshot.js';
import type { ParseHtmlResultMessage } from '@/types/messages.js';
import {
  CACHE_SCHEMA_VERSION,
  HUNTER_RULES_VERSION,
  INTERCEPT_CHUNK_INDEX_OFFSET,
  MAX_INTERCEPT_FETCH_BYTES,
  SCORE_INSTRUCTION_DETECTION,
} from '@/shared/constants.js';

// --- mocks must precede the SUT import ---

const runChunkProbesMock = vi.fn<
  (args: {
    tabId: number;
    chunk: string;
    chunkIndex: number;
    totalChunks: number;
    url: string;
    origin: string;
    evidencePackets: readonly unknown[];
  }) => Promise<{
    results: readonly ProbeResult[];
    canaryId: string | null;
    webgpuAdapterMode: string | null;
  }>
>();

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

const lookupScanMock = vi.fn<
  (url: string, guard: { hunterRulesVersion: string; llmModelId: string }) =>
    Promise<CachedScan | null>
>();
const writeScanMock = vi.fn<(record: CachedScan) => Promise<void>>();
const recordCacheHitMock = vi.fn<() => Promise<void>>();
const recordCacheMissMock = vi.fn<() => Promise<void>>();
const getEngineFingerprintMock = vi.fn<() => Promise<string>>();

vi.mock('./scan-cache.js', () => ({
  lookupScan: (...args: Parameters<typeof lookupScanMock>) => lookupScanMock(...args),
  writeScan: (record: CachedScan) => writeScanMock(record),
  recordCacheHit: () => recordCacheHitMock(),
  recordCacheMiss: () => recordCacheMissMock(),
  getEngineFingerprint: () => getEngineFingerprintMock(),
}));

import { scanUrl } from './url-scanner.js';

// --- helpers ---

function buildProbeResult(
  probeName: string,
  passed: boolean,
  score: number = 0,
  flags: readonly string[] = [],
): ProbeResult {
  return {
    probeName,
    passed,
    flags: passed ? [] : flags.length > 0 ? flags : [`${probeName}:flag`],
    rawOutput: 'ok',
    score,
    errorMessage: null,
  };
}

function buildChunk(index: number, text: string): Chunk {
  const hex = (index + 1).toString(16).padStart(64, '0');
  return { text, start: index * 100, end: index * 100 + text.length, contentHash: hex };
}

function buildCachedChunk(text: string, results: readonly ProbeResult[] | null): CachedChunk {
  return {
    contentHash: text,
    tierRouting: { decision: 'UNCERTAIN', primitiveCount: 0, contributingHunters: [] },
    probeResults: results,
  };
}

function buildCachedScan(url: string, chunks: readonly CachedChunk[]): CachedScan {
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    hunterRulesVersion: HUNTER_RULES_VERSION,
    llmModelId: 'gemma-2-2b-mlc',
    url,
    fetchedAt: Date.now(),
    chunks,
    earlyExited: false,
    entitySummary: null,
    sizeBytes: 0,
  };
}

interface FetchSpy {
  readonly fn: ReturnType<typeof vi.fn>;
  readonly calls: Array<{ url: string; init: RequestInit | undefined }>;
}

function setupFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): FetchSpy {
  const calls: FetchSpy['calls'] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return impl(url, init);
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

function htmlResponse(html: string, contentLength: number = html.length): Response {
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html', 'content-length': String(contentLength) },
  });
}

interface ChromeStub {
  readonly sendMessageMock: ReturnType<typeof vi.fn>;
  readonly storage: Record<string, unknown>;
}

function setupChrome(snapshot: PageSnapshot | null = buildSnapshot()): ChromeStub {
  const storage: Record<string, unknown> = {};
  const sendMessageMock = vi.fn(async (msg: { type: string; requestId?: string; html?: string; url?: string }) => {
    if (msg.type === 'PARSE_HTML_REQUEST') {
      const reply: ParseHtmlResultMessage = {
        type: 'PARSE_HTML_RESULT',
        requestId: msg.requestId ?? '',
        snapshot,
        errorMessage: snapshot === null ? 'parse_failed_in_offscreen' : null,
      };
      return reply;
    }
    return undefined;
  });
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (key?: string | string[] | null) => {
          if (key === undefined || key === null) return { ...storage };
          if (typeof key === 'string') {
            return key in storage ? { [key]: storage[key] } : {};
          }
          const out: Record<string, unknown> = {};
          for (const k of key) if (k in storage) out[k] = storage[k];
          return out;
        },
        set: async (items: Record<string, unknown>) => {
          Object.assign(storage, items);
        },
      },
    },
    runtime: {
      sendMessage: sendMessageMock,
      onMessage: { addListener: () => undefined, removeListener: () => undefined },
    },
  });
  return { sendMessageMock, storage };
}

function buildSnapshot(visibleText: string = 'hello world from a benign blog post'): PageSnapshot {
  return {
    visibleText,
    hiddenText: '',
    scriptFingerprints: [],
    metadata: {
      title: 't',
      url: 'https://target.example/page',
      origin: 'https://target.example',
      description: '',
      ogTags: new Map<string, string>(),
      cspMeta: null,
      lang: 'en',
    },
    extractedAt: 1714400000000,
    charCount: visibleText.length,
  };
}

const SCAN_URL = 'https://target.example/page';
const SCAN_ORIGIN = 'https://target.example';

// --- tests ---

describe('scanUrl', () => {
  beforeEach(() => {
    runChunkProbesMock.mockReset();
    chunkTextMock.mockReset();
    lookupScanMock.mockReset();
    writeScanMock.mockReset();
    recordCacheHitMock.mockReset();
    recordCacheMissMock.mockReset();
    getEngineFingerprintMock.mockReset();
    getEngineFingerprintMock.mockResolvedValue('gemma-2-2b-mlc');
    writeScanMock.mockResolvedValue(undefined);
    recordCacheHitMock.mockResolvedValue(undefined);
    recordCacheMissMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('returns instant CLEAN verdict on full cache hit (no fetch, no offscreen)', async () => {
    setupChrome(null); // null means: if PARSE_HTML_REQUEST is dispatched, the test fails
    const fetchSpy = setupFetch(() => {
      throw new Error('fetch should not be called on cache hit');
    });
    const cleanProbes = [
      buildProbeResult('summarization', true, 0),
      buildProbeResult('instruction_detection', true, 0),
      buildProbeResult('adversarial_compliance', true, 0),
    ];
    chunkTextMock.mockResolvedValue([buildChunk(0, 'a clean chunk text body')]);
    lookupScanMock.mockResolvedValue(
      buildCachedScan(SCAN_URL, [buildCachedChunk('a clean chunk text body', cleanProbes)]),
    );

    const verdict = await scanUrl({
      url: SCAN_URL,
      origin: SCAN_ORIGIN,
      portalId: 'chatgpt',
      tabId: 42,
    });

    expect(verdict.cacheHit).toBe(true);
    expect(verdict.scannedUrl).toBe(SCAN_URL);
    expect(verdict.status).toBe('CLEAN');
    expect(verdict.analysisError).toBeNull();
    expect(verdict.probeBreakdown.totalProbes).toBeGreaterThan(0);
    expect(verdict.probeBreakdown.suspiciousProbes).toBe(0);
    expect(verdict.probeBreakdown.compromisedProbes).toBe(0);
    expect(fetchSpy.fn).not.toHaveBeenCalled();
    expect(runChunkProbesMock).not.toHaveBeenCalled();
    expect(recordCacheHitMock).toHaveBeenCalledTimes(1);
    expect(recordCacheMissMock).not.toHaveBeenCalled();
  });

  it('cache miss: fetches with credentials:omit and Range header', async () => {
    setupChrome();
    const fetchSpy = setupFetch(() => Promise.resolve(htmlResponse('<html><body>ok</body></html>')));
    chunkTextMock.mockResolvedValue([buildChunk(0, 'hello world from a benign blog post')]);
    runChunkProbesMock.mockResolvedValue({
      results: [
        buildProbeResult('summarization', true, 0),
        buildProbeResult('instruction_detection', true, 0),
        buildProbeResult('adversarial_compliance', true, 0),
      ],
      canaryId: 'gemma-2-2b-mlc',
      webgpuAdapterMode: 'core',
    });
    lookupScanMock.mockResolvedValue(null);

    const verdict = await scanUrl({
      url: SCAN_URL,
      origin: SCAN_ORIGIN,
      portalId: 'chatgpt',
      tabId: 42,
    });

    expect(fetchSpy.fn).toHaveBeenCalledTimes(1);
    const call = fetchSpy.calls[0]!;
    expect(call.url).toBe(SCAN_URL);
    expect(call.init?.credentials).toBe('omit');
    const headers = call.init?.headers as Record<string, string> | undefined;
    expect(headers?.['Range']).toBe(`bytes=0-${MAX_INTERCEPT_FETCH_BYTES - 1}`);
    expect(headers?.['Authorization']).toBeUndefined();
    expect(headers?.['Cookie']).toBeUndefined();
    expect(verdict.cacheHit).toBe(false);
    expect(verdict.status).toBe('CLEAN');
    expect(recordCacheMissMock).toHaveBeenCalledTimes(1);
    expect(writeScanMock).toHaveBeenCalledTimes(1);
  });

  it('cache miss: chunk indices are offset by INTERCEPT_CHUNK_INDEX_OFFSET', async () => {
    setupChrome();
    setupFetch(() => Promise.resolve(htmlResponse('<html><body>ok</body></html>')));
    chunkTextMock.mockResolvedValue([
      buildChunk(0, 'first chunk body'),
      buildChunk(1, 'second chunk body'),
    ]);
    runChunkProbesMock.mockResolvedValue({
      results: [
        buildProbeResult('summarization', true, 0),
        buildProbeResult('instruction_detection', true, 0),
        buildProbeResult('adversarial_compliance', true, 0),
      ],
      canaryId: 'gemma-2-2b-mlc',
      webgpuAdapterMode: 'core',
    });
    lookupScanMock.mockResolvedValue(null);

    await scanUrl({
      url: SCAN_URL,
      origin: SCAN_ORIGIN,
      portalId: 'chatgpt',
      tabId: 42,
    });

    expect(runChunkProbesMock).toHaveBeenCalledTimes(2);
    const indices = runChunkProbesMock.mock.calls.map((c) => c[0].chunkIndex);
    expect(indices).toEqual([
      INTERCEPT_CHUNK_INDEX_OFFSET + 0,
      INTERCEPT_CHUNK_INDEX_OFFSET + 1,
    ]);
  });

  it('cache miss: SUSPICIOUS verdict surfaces probe breakdown counts', async () => {
    setupChrome();
    setupFetch(() => Promise.resolve(htmlResponse('<html><body>ok</body></html>')));
    chunkTextMock.mockResolvedValue([buildChunk(0, 'flagged chunk body')]);
    runChunkProbesMock.mockResolvedValue({
      results: [
        buildProbeResult('summarization', true, 0),
        buildProbeResult('instruction_detection', false, SCORE_INSTRUCTION_DETECTION, ['flag1']),
        buildProbeResult('adversarial_compliance', true, 0),
      ],
      canaryId: 'gemma-2-2b-mlc',
      webgpuAdapterMode: 'core',
    });
    lookupScanMock.mockResolvedValue(null);

    const verdict = await scanUrl({
      url: SCAN_URL,
      origin: SCAN_ORIGIN,
      portalId: 'chatgpt',
      tabId: 42,
    });

    expect(verdict.status).toBe('SUSPICIOUS');
    expect(verdict.probeBreakdown.suspiciousProbes).toBeGreaterThanOrEqual(1);
  });

  it('fetch failure surfaces UNKNOWN with analysisError=fetch_failed', async () => {
    setupChrome();
    setupFetch(() => Promise.reject(new TypeError('network error')));
    lookupScanMock.mockResolvedValue(null);

    const verdict = await scanUrl({
      url: SCAN_URL,
      origin: SCAN_ORIGIN,
      portalId: 'chatgpt',
      tabId: 42,
    });

    expect(verdict.status).toBe('UNKNOWN');
    expect(verdict.analysisError).toBe('fetch_failed');
    expect(verdict.cacheHit).toBe(false);
    expect(runChunkProbesMock).not.toHaveBeenCalled();
    expect(writeScanMock).not.toHaveBeenCalled();
  });

  it('non-2xx response surfaces UNKNOWN with analysisError=fetch_failed', async () => {
    setupChrome();
    setupFetch(() =>
      Promise.resolve(
        new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } }),
      ),
    );
    lookupScanMock.mockResolvedValue(null);

    const verdict = await scanUrl({
      url: SCAN_URL,
      origin: SCAN_ORIGIN,
      portalId: 'chatgpt',
      tabId: 42,
    });

    expect(verdict.status).toBe('UNKNOWN');
    expect(verdict.analysisError).toBe('fetch_failed');
  });

  it('oversize response (Content-Length above cap) returns response_too_large', async () => {
    setupChrome();
    setupFetch(() =>
      Promise.resolve(htmlResponse('<html></html>', MAX_INTERCEPT_FETCH_BYTES + 1)),
    );
    lookupScanMock.mockResolvedValue(null);

    const verdict = await scanUrl({
      url: SCAN_URL,
      origin: SCAN_ORIGIN,
      portalId: 'chatgpt',
      tabId: 42,
    });

    expect(verdict.status).toBe('UNKNOWN');
    expect(verdict.analysisError).toBe('response_too_large');
  });

  it('parse failure surfaces UNKNOWN with analysisError=parse_failed', async () => {
    setupChrome(null); // offscreen returns snapshot:null + error
    setupFetch(() => Promise.resolve(htmlResponse('<html><body>ok</body></html>')));
    lookupScanMock.mockResolvedValue(null);

    const verdict = await scanUrl({
      url: SCAN_URL,
      origin: SCAN_ORIGIN,
      portalId: 'chatgpt',
      tabId: 42,
    });

    expect(verdict.status).toBe('UNKNOWN');
    expect(verdict.analysisError).toBe('parse_failed');
    expect(runChunkProbesMock).not.toHaveBeenCalled();
  });

  it('timeout (>MAX_INTERCEPT_LATENCY_MS) returns UNKNOWN+intercept_timeout', async () => {
    vi.useFakeTimers();
    setupChrome();
    // Fetch never resolves → forces timeout path
    setupFetch(() => new Promise<Response>(() => undefined));
    lookupScanMock.mockResolvedValue(null);

    const promise = scanUrl({
      url: SCAN_URL,
      origin: SCAN_ORIGIN,
      portalId: 'chatgpt',
      tabId: 42,
    });
    await vi.advanceTimersByTimeAsync(31_000);
    const verdict = await promise;
    expect(verdict.status).toBe('UNKNOWN');
    expect(verdict.analysisError).toBe('intercept_timeout');
  });
});
