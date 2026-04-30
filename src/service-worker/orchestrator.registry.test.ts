// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import * as ed from '@noble/ed25519';

import type { PageSnapshot } from '@/types/snapshot.js';
import type { LanguageDetectionResult } from '@/hunters/hawk/language-router.js';
import type { Chunk } from '@/types/chunk.js';
import type { HuntReport } from '@/hunters/hunt-runner.js';
import type { RegistryEntry, RegistryZone } from '@/types/registry.js';

import { signRegistry } from '@/registry/sign.js';
import { extractZones } from '@/registry/extract-zones.js';
import { fingerprintZone } from '@/registry/fingerprint.js';
import { bytesToHex, type SignedRegistryBundle } from '@/registry/canonical-bundle.js';

// Register the same module mocks as the main integration test so the
// orchestrator wiring is identical except for the registry path.
const runHuntersMock = vi.fn<(hunters: unknown, chunk: string) => Promise<HuntReport>>();
vi.mock('@/hunters/hunt-runner.js', () => ({
  runHunters: (...args: [unknown, string]) => runHuntersMock(...args),
  SHORT_CIRCUIT_CONFIDENCE: 0.75,
}));

const chunkTextMock = vi.fn<(text: string) => Promise<readonly Chunk[]>>();
vi.mock('@/hunters/hawk/chunking.js', () => ({
  chunkText: (text: string) => chunkTextMock(text),
}));

const detectLanguageMock = vi.fn<(text: string) => Promise<LanguageDetectionResult>>();
vi.mock('@/hunters/hawk/language-router.js', () => ({
  detectLanguage: (text: string) => detectLanguageMock(text),
}));

vi.mock('./offscreen-manager.js', () => ({
  ensureOffscreenDocument: async () => undefined,
}));
vi.mock('./keepalive.js', () => ({
  connectOffscreenPort: () => undefined,
}));
interface MockPolicy {
  readonly action: 'scan' | 'skip';
  readonly reason: string;
  readonly matchedRule: string | null;
}
const resolveOriginPolicyMock = vi.fn<() => MockPolicy>(() => ({
  action: 'scan',
  reason: 'default_scan',
  matchedRule: null,
}));
vi.mock('@/policy/origin-policy.js', () => ({
  resolveOriginPolicy: () => resolveOriginPolicyMock(),
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
import { loadRegistryOnce, __resetRegistryForTests } from '@/registry/lookup.js';

const SAMPLE_HTML = `<!doctype html>
<html lang="en">
  <body>
    <header><a href="/">Acme</a></header>
    <nav><ul><li><a href="/x">X</a></li></ul></nav>
    <article><p>varies</p></article>
    <footer><p>© 2026 Acme</p></footer>
  </body>
</html>`;

const FRAME_SELECTORS = ['header', 'nav', 'footer'] as const;

let signerPrivHex: string;
let signerPubHex: string;
let bundle: SignedRegistryBundle;
let entry: RegistryEntry;

beforeAll(async () => {
  const priv = ed.utils.randomPrivateKey();
  signerPrivHex = bytesToHex(priv);
  signerPubHex = bytesToHex(await ed.getPublicKeyAsync(priv));

  const zones = extractZones(SAMPLE_HTML, [...FRAME_SELECTORS], []);
  const registryZones: RegistryZone[] = await Promise.all(
    zones.map(async (z) => ({
      zoneId: z.zoneId,
      selector: z.zoneId.split('#')[0]!,
      fingerprint: await fingerprintZone(z),
    })),
  );
  entry = {
    origin: 'acme.test',
    capturedAt: 1_700_000_000_000,
    schemaVersion: 1,
    zones: registryZones,
    excludedSelectors: [],
  };
  bundle = await signRegistry({
    entries: [entry],
    privateKeyHex: signerPrivHex,
    now: () => 1_700_000_000_999,
  });
});

function buildChunk(index: number, text: string): Chunk {
  const hex = (index + 1).toString(16).padStart(64, '0');
  return { text, start: index * 100, end: index * 100 + text.length, contentHash: hex };
}

function snapshotFixture(opts: { origin?: string; pageHtml?: string } = {}): PageSnapshot {
  return {
    visibleText: 'visible content',
    hiddenText: '',
    scriptFingerprints: [],
    metadata: {
      title: 'Test',
      url: `https://${opts.origin ?? 'acme.test'}/page`,
      origin: opts.origin ?? 'acme.test',
      description: '',
      ogTags: new Map<string, string>(),
      cspMeta: null,
      lang: 'en',
    },
    extractedAt: 1_700_000_000_000,
    charCount: 15,
    pageHtml: opts.pageHtml ?? SAMPLE_HTML,
  };
}

interface ChromeContext {
  runProbesCalls: { msg: { type: string; chunkIndex: number; tabId: number } }[];
  fetchMock: ReturnType<typeof vi.fn>;
  setBundleResponse(b: unknown | null, status?: number): void;
}

function setupChrome(): ChromeContext {
  const calls: ChromeContext['runProbesCalls'] = [];
  let listener: ((m: unknown) => void) | null = null;
  const sendMessage = vi.fn((msg: { type: string; tabId: number; chunkIndex: number }) => {
    if (msg.type === 'RUN_PROBES') {
      calls.push({ msg });
      Promise.resolve().then(() => {
        listener?.({
          type: 'PROBE_RESULTS',
          tabId: msg.tabId,
          chunkIndex: msg.chunkIndex,
          results: [],
          canaryId: 'gemma-2-2b-mlc',
          webgpuAdapterMode: 'core',
        });
      });
    }
  });
  const addListener = vi.fn((l: (m: unknown) => void) => { listener = l; });
  const removeListener = vi.fn(() => { listener = null; });

  let nextResp: { ok: boolean; status: number; body: unknown | null } = {
    ok: false, status: 404, body: null,
  };
  const fetchMock = vi.fn(async (_url: string) => ({
    ok: nextResp.ok,
    status: nextResp.status,
    json: async () => nextResp.body,
  }));

  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: { addListener, removeListener },
      sendMessage,
      getURL: (path: string) => `chrome-extension://test/${path}`,
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
    fetchMock,
    setBundleResponse(b, status = 200) {
      nextResp = b === null
        ? { ok: false, status, body: null }
        : { ok: true, status: 200, body: b };
    },
  };
}

describe('analyzeSnapshot registry short-circuit (SR-F / registry-#51)', () => {
  beforeEach(() => {
    runHuntersMock.mockReset();
    chunkTextMock.mockReset();
    detectLanguageMock.mockReset();
    detectLanguageMock.mockResolvedValue({ lang: 'und', confidence: 0, source: 'chrome-api' });
    resolveOriginPolicyMock.mockReset();
    resolveOriginPolicyMock.mockReturnValue({
      action: 'scan',
      reason: 'default_scan',
      matchedRule: null,
    });
    chunkTextMock.mockResolvedValue([buildChunk(0, 'visible content')]);
    runHuntersMock.mockResolvedValue({
      results: [],
      totalScore: 0,
      maxConfidence: 0,
      shouldSkipProbes: false,
      flags: [],
      aggregateError: null,
    });
    __resetRegistryForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('on registry hit, returns CLEAN verdict and never invokes the chunk-probes pipeline', async () => {
    const ctx = setupChrome();
    ctx.setBundleResponse(bundle);
    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });

    const verdict = await analyzeSnapshot(501, snapshotFixture({ origin: 'acme.test' }));

    expect(verdict.status).toBe('CLEAN');
    expect(verdict.analysisError).toMatch(/^registry_match: /);
    expect(verdict.probeResults).toEqual([]);
    expect(ctx.runProbesCalls.length).toBe(0);
    expect(runHuntersMock).not.toHaveBeenCalled();
    expect(chunkTextMock).not.toHaveBeenCalled();
  });

  it('on registry miss (origin not in bundle), falls through to the existing chunk pipeline', async () => {
    const ctx = setupChrome();
    ctx.setBundleResponse(bundle);
    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });

    const verdict = await analyzeSnapshot(
      502,
      snapshotFixture({ origin: 'unknown.test', pageHtml: SAMPLE_HTML }),
    );

    expect(verdict.status).toBe('CLEAN');
    expect(verdict.analysisError).toBeNull();
    expect(chunkTextMock).toHaveBeenCalled();
    expect(runHuntersMock).toHaveBeenCalled();
    expect(ctx.runProbesCalls.length).toBe(0);
  });

  it('when the registry bundle is missing (404), behaves identically to the pre-SR-F pipeline (Phase 2 fail-safe)', async () => {
    const ctx = setupChrome();
    ctx.setBundleResponse(null, 404);
    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });

    const verdict = await analyzeSnapshot(503, snapshotFixture({ origin: 'acme.test' }));

    expect(verdict.status).toBe('CLEAN');
    expect(verdict.analysisError).toBeNull();
    expect(chunkTextMock).toHaveBeenCalled();
    expect(runHuntersMock).toHaveBeenCalled();
    expect(ctx.runProbesCalls.length).toBe(0);
  });

  it('when verifyRegistry rejects the bundle (wrong trust root), all origins fall through (fail-safe)', async () => {
    const ctx = setupChrome();
    ctx.setBundleResponse(bundle);
    const wrongPriv = ed.utils.randomPrivateKey();
    const wrongPub = bytesToHex(await ed.getPublicKeyAsync(wrongPriv));
    await loadRegistryOnce({ trustedPublicKeyHex: wrongPub });

    const verdict = await analyzeSnapshot(504, snapshotFixture({ origin: 'acme.test' }));

    expect(verdict.analysisError).toBeNull();
    expect(chunkTextMock).toHaveBeenCalled();
  });

  it('on snapshot.pageHtml absent, registry misses and full pipeline runs (preserves Phase 2 byte-locked baseline contract)', async () => {
    const ctx = setupChrome();
    ctx.setBundleResponse(bundle);
    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });

    const noHtmlSnapshot: PageSnapshot = {
      ...snapshotFixture({ origin: 'acme.test' }),
      pageHtml: undefined,
    };
    const verdict = await analyzeSnapshot(505, noHtmlSnapshot);

    expect(verdict.analysisError).toBeNull();
    expect(chunkTextMock).toHaveBeenCalled();
    expect(ctx.runProbesCalls.length).toBe(0);
  });

  it('registry hit short-circuits BEFORE the #20 origin-policy check (registry runs even on opted-out origins per RFC §Q7)', async () => {
    const ctx = setupChrome();
    ctx.setBundleResponse(bundle);
    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });
    resolveOriginPolicyMock.mockReturnValue({
      action: 'skip',
      reason: 'user_override_skip',
      matchedRule: null,
    });

    const verdict = await analyzeSnapshot(506, snapshotFixture({ origin: 'acme.test' }));

    expect(verdict.status).toBe('CLEAN');
    expect(verdict.analysisError).toMatch(/^registry_match: /);
    expect(ctx.runProbesCalls.length).toBe(0);
  });

  it('registry hit names the matched zoneIds in analysisError so SR-G telemetry can attribute hits per-zone', async () => {
    setupChrome();
    const ctx = setupChrome();
    ctx.setBundleResponse(bundle);
    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });

    const verdict = await analyzeSnapshot(507, snapshotFixture({ origin: 'acme.test' }));

    expect(verdict.analysisError).not.toBeNull();
    for (const z of entry.zones) {
      expect(verdict.analysisError).toContain(z.zoneId);
    }
  });

  it('registry hit returns confidence=100 and totalScore=0 (CLEAN with no probe activity)', async () => {
    const ctx = setupChrome();
    ctx.setBundleResponse(bundle);
    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });

    const verdict = await analyzeSnapshot(508, snapshotFixture({ origin: 'acme.test' }));

    expect(verdict.confidence).toBe(100);
    expect(verdict.totalScore).toBe(0);
    expect(verdict.probeResults).toEqual([]);
    expect(verdict.perChunkAnalysis).toBeNull();
    expect(verdict.entitySummary).toBeNull();
    expect(verdict.stamp).toBeNull();
    void ctx;
  });
});
