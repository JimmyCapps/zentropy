/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SecurityVerdict, SecurityStatus } from '@/types/verdict.js';
import type { PageStamp } from '@/types/page-stamp.js';
import type { HoneyLLMMessage, VerdictMessage } from '@/types/messages.js';

// Issue #230 + #231 — integration tests for the content-script
// onMessage handler. The handler dedups duplicate VERDICTs by
// timestamp and disposes the previous stamp lifecycle before
// installing a new one.

const stampSpies = vi.hoisted(() => ({
  embedStamp: vi.fn(),
  installStampObservers: vi.fn(),
  installNavigationTeardown: vi.fn(),
}));

const signalSpies = vi.hoisted(() => ({
  setWindowGlobals: vi.fn(),
  setSecurityMetaTag: vi.fn(),
}));

vi.mock('./signaling/page-stamp-embed.js', () => ({
  embedStamp: stampSpies.embedStamp,
  installStampObservers: stampSpies.installStampObservers,
  installNavigationTeardown: stampSpies.installNavigationTeardown,
}));

vi.mock('./signaling/window-globals.js', () => ({
  setWindowGlobals: signalSpies.setWindowGlobals,
}));

vi.mock('./signaling/meta-tag.js', () => ({
  setSecurityMetaTag: signalSpies.setSecurityMetaTag,
}));

vi.mock('./mitigation/network-guard.js', () => ({
  injectNetworkGuard: vi.fn(),
  activateNetworkGuard: vi.fn(),
}));

vi.mock('./mitigation/dom-sanitizer.js', () => ({
  sanitizeSuspiciousNodes: vi.fn(() => []),
}));

vi.mock('./mitigation/redirect-blocker.js', () => ({
  activateRedirectBlocker: vi.fn(),
}));

vi.mock('./rescan.js', () => ({
  rescanWithForcedMitigation: vi.fn(async () => undefined),
}));

vi.mock('./diagnostic-heartbeat.js', () => ({
  startHeartbeat: vi.fn(() => ({ stop: vi.fn() })),
}));

vi.mock('./ingestion/extractor.js', () => ({
  extractPageSnapshot: vi.fn(async () => ({})),
}));

const FIXTURE_STAMP: PageStamp = {
  v: 1,
  url: 'https://example.com/',
  status: 'CLEAN',
  timestamp: 1_700_000_000_000,
  nonce: 'fixture-nonce',
  hmac: 'a'.repeat(64),
};

function makeVerdict(timestamp: number, status: SecurityStatus = 'CLEAN'): SecurityVerdict {
  return {
    status,
    confidence: 0.9,
    totalScore: 0,
    probeResults: [],
    behavioralFlags: {
      roleDrift: false,
      exfiltrationIntent: false,
      instructionFollowing: false,
      hiddenContentAwareness: false,
    },
    mitigationsApplied: [],
    timestamp,
    url: 'https://example.com/',
    analysisError: null,
    canaryId: null,
    webgpuAdapterMode: null,
    stamp: FIXTURE_STAMP,
    perChunkAnalysis: null,
    entitySummary: null,
    responseVerdict: null,
    thinkingVerdict: null,
    embeddingsFindings: null,
  };
}

interface ChromeStub {
  runtime: {
    onMessage: { addListener: (fn: (m: HoneyLLMMessage) => void) => void };
    sendMessage: (msg: unknown) => Promise<unknown>;
  };
  tabs: {
    sendMessage: (tabId: number, msg: unknown) => Promise<unknown>;
  };
}

interface CapturedListener {
  fn: ((m: HoneyLLMMessage) => void) | null;
}

async function loadContentScript(): Promise<CapturedListener> {
  const captured: CapturedListener = { fn: null };

  // Force the local-harness short-circuit so injectNetworkGuard / run() are
  // skipped at module load. The onMessage.addListener call is unconditional
  // and runs regardless.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...window.location,
      hostname: '127.0.0.1',
      port: '8765',
      href: 'http://127.0.0.1:8765/',
    },
  });

  const chromeStub: ChromeStub = {
    runtime: {
      onMessage: {
        addListener: (fn: (m: HoneyLLMMessage) => void): void => {
          captured.fn = fn;
        },
      },
      sendMessage: vi.fn(async () => undefined),
    },
    tabs: {
      sendMessage: vi.fn(async () => undefined),
    },
  };
  vi.stubGlobal('chrome', chromeStub);

  // Reset module registry so each test gets a fresh module-scope state.
  vi.resetModules();
  await import('./index.js');
  if (captured.fn === null) throw new Error('content/index.ts did not register a listener');
  return captured;
}

describe('content/index.ts onMessage VERDICT handler — duplicate dedup (#230)', () => {
  beforeEach(() => {
    stampSpies.embedStamp.mockReset();
    stampSpies.installStampObservers.mockReset();
    stampSpies.installNavigationTeardown.mockReset();
    signalSpies.setWindowGlobals.mockReset();
    signalSpies.setSecurityMetaTag.mockReset();

    stampSpies.embedStamp.mockImplementation(() => ({}));
    stampSpies.installStampObservers.mockImplementation(() => ({ disconnect: vi.fn() }));
    stampSpies.installNavigationTeardown.mockImplementation(() => ({ teardown: vi.fn() }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('processes a fresh VERDICT (timestamp not seen before)', async () => {
    const captured = await loadContentScript();
    const msg: VerdictMessage = { type: 'VERDICT', verdict: makeVerdict(1) };
    captured.fn!(msg);
    expect(signalSpies.setWindowGlobals).toHaveBeenCalledTimes(1);
    expect(signalSpies.setSecurityMetaTag).toHaveBeenCalledTimes(1);
    expect(stampSpies.embedStamp).toHaveBeenCalledTimes(1);
    expect(stampSpies.installStampObservers).toHaveBeenCalledTimes(1);
    expect(stampSpies.installNavigationTeardown).toHaveBeenCalledTimes(1);
  });

  it('suppresses a duplicate VERDICT with the same timestamp', async () => {
    const captured = await loadContentScript();
    const verdict = makeVerdict(2);
    captured.fn!({ type: 'VERDICT', verdict });
    captured.fn!({ type: 'VERDICT', verdict });
    expect(signalSpies.setWindowGlobals).toHaveBeenCalledTimes(1);
    expect(stampSpies.embedStamp).toHaveBeenCalledTimes(1);
    expect(stampSpies.installStampObservers).toHaveBeenCalledTimes(1);
  });

  it('processes a VERDICT with a newer timestamp and tears down the previous stamp first (#231)', async () => {
    const captured = await loadContentScript();
    const teardown1 = vi.fn();
    const teardown2 = vi.fn();
    stampSpies.installNavigationTeardown
      .mockImplementationOnce(() => ({ teardown: teardown1 }))
      .mockImplementationOnce(() => ({ teardown: teardown2 }));

    captured.fn!({ type: 'VERDICT', verdict: makeVerdict(10) });
    expect(teardown1).not.toHaveBeenCalled();

    captured.fn!({ type: 'VERDICT', verdict: makeVerdict(11) });
    expect(teardown1).toHaveBeenCalledTimes(1);
    expect(teardown2).not.toHaveBeenCalled();
    expect(stampSpies.embedStamp).toHaveBeenCalledTimes(2);
    expect(stampSpies.installStampObservers).toHaveBeenCalledTimes(2);
  });

  it('a VERDICT with stamp=null skips the stamp pipeline entirely', async () => {
    const captured = await loadContentScript();
    const v: SecurityVerdict = { ...makeVerdict(20), stamp: null };
    captured.fn!({ type: 'VERDICT', verdict: v });
    expect(signalSpies.setWindowGlobals).toHaveBeenCalledTimes(1);
    expect(stampSpies.embedStamp).not.toHaveBeenCalled();
    expect(stampSpies.installStampObservers).not.toHaveBeenCalled();
  });
});
