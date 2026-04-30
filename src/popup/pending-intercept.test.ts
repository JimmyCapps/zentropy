// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STORAGE_KEY_PENDING_INTERCEPT,
  STORAGE_KEY_INTERCEPT_OVERRIDES,
  INTERCEPT_OVERRIDE_WHITELIST_THRESHOLD,
  INTERCEPT_OVERRIDE_WINDOW_MS,
  MAX_INTERCEPT_LATENCY_EXTENSION_MS,
} from '@/shared/constants.js';
import type { InterceptVerdict } from '@/types/messages.js';

import {
  renderPendingIntercept,
  type PendingInterceptRecord,
} from './pending-intercept.js';

interface StorageStub {
  readonly readStore: () => Record<string, unknown>;
  readonly writeStore: (patch: Record<string, unknown>) => void;
  readonly removeKey: (key: string) => void;
}

function setupChrome(initialStore: Record<string, unknown> = {}): StorageStub {
  const store: Record<string, unknown> = { ...initialStore };
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (key?: string | string[] | null) => {
          if (key === undefined || key === null) return { ...store };
          if (typeof key === 'string') {
            return key in store ? { [key]: store[key] } : {};
          }
          const out: Record<string, unknown> = {};
          for (const k of key) if (k in store) out[k] = store[k];
          return out;
        },
        set: async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        },
        remove: async (key: string | string[]) => {
          const keys = Array.isArray(key) ? key : [key];
          for (const k of keys) delete store[k];
        },
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
  return {
    readStore: () => ({ ...store }),
    writeStore: (patch) => Object.assign(store, patch),
    removeKey: (key) => {
      delete store[key];
    },
  };
}

function buildRoot(): HTMLElement {
  while (document.body.firstChild !== null) document.body.removeChild(document.body.firstChild);
  const div = document.createElement('div');
  div.id = 'pending-intercept-root';
  document.body.appendChild(div);
  return div;
}

function buildVerdict(overrides: Partial<InterceptVerdict> = {}): InterceptVerdict {
  return {
    status: 'CLEAN',
    scannedUrl: 'https://target.example/',
    probeBreakdown: { totalProbes: 3, suspiciousProbes: 0, compromisedProbes: 0 },
    totalScore: 0,
    cacheHit: false,
    timestamp: 0,
    analysisError: null,
    ...overrides,
  };
}

function buildRecord(overrides: Partial<PendingInterceptRecord> = {}): PendingInterceptRecord {
  const startedAt = Date.now();
  return {
    requestId: 'req-1',
    portalId: 'chatgpt',
    portalOrigin: 'https://chatgpt.com',
    scannedUrl: 'https://target.example/',
    status: 'scanning',
    verdict: null,
    startedAt,
    timeoutAt: startedAt + 30_000,
    timeoutExtended: false,
    ...overrides,
  };
}

describe('renderPendingIntercept', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = buildRoot();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders nothing when record is null', () => {
    setupChrome();
    renderPendingIntercept(root, null);
    expect(root.children.length).toBe(0);
  });

  it('scanning state shows Send-anyway / Cancel / Wait', () => {
    setupChrome();
    renderPendingIntercept(root, buildRecord({ status: 'scanning' }));
    const text = root.textContent ?? '';
    expect(text).toContain('Send anyway');
    expect(text).toContain('Cancel');
    expect(text).toContain('Wait');
  });

  it('verdict-ready CLEAN renders a clean badge, no buttons', () => {
    setupChrome();
    renderPendingIntercept(
      root,
      buildRecord({ status: 'verdict-ready', verdict: buildVerdict({ status: 'CLEAN' }) }),
    );
    const text = root.textContent ?? '';
    expect(text).toContain('CLEAN');
    expect(text).not.toContain('Wait');
  });

  it('verdict-ready SUSPICIOUS renders Send-anyway / Cancel only (no Wait)', () => {
    setupChrome();
    renderPendingIntercept(
      root,
      buildRecord({ status: 'verdict-ready', verdict: buildVerdict({ status: 'SUSPICIOUS' }) }),
    );
    const text = root.textContent ?? '';
    expect(text).toContain('SUSPICIOUS');
    expect(text).toContain('Send anyway');
    expect(text).toContain('Cancel');
    expect(text).not.toContain('Wait');
  });

  it('verdict-ready COMPROMISED renders block notice with Send-anyway / Cancel', () => {
    setupChrome();
    renderPendingIntercept(
      root,
      buildRecord({ status: 'verdict-ready', verdict: buildVerdict({ status: 'COMPROMISED' }) }),
    );
    const text = root.textContent ?? '';
    expect(text).toContain('COMPROMISED');
    expect(text).toContain('Send anyway');
    expect(text).toContain('Cancel');
  });

  it('UNKNOWN with intercept_timeout and timeoutExtended:false shows Wait', () => {
    setupChrome();
    renderPendingIntercept(
      root,
      buildRecord({
        status: 'verdict-ready',
        verdict: buildVerdict({ status: 'UNKNOWN', analysisError: 'intercept_timeout' }),
        timeoutExtended: false,
      }),
    );
    const text = root.textContent ?? '';
    expect(text).toContain('Wait');
    expect(text).toContain('Send anyway');
    expect(text).toContain('Cancel');
  });

  it('UNKNOWN with intercept_timeout and timeoutExtended:true hides Wait', () => {
    setupChrome();
    renderPendingIntercept(
      root,
      buildRecord({
        status: 'verdict-ready',
        verdict: buildVerdict({ status: 'UNKNOWN', analysisError: 'intercept_timeout' }),
        timeoutExtended: true,
      }),
    );
    const text = root.textContent ?? '';
    expect(text).not.toContain('Wait');
    expect(text).toContain('Send anyway');
  });

  it('Send anyway records an override and clears the pending record', async () => {
    const stub = setupChrome();
    renderPendingIntercept(
      root,
      buildRecord({ status: 'verdict-ready', verdict: buildVerdict({ status: 'SUSPICIOUS' }) }),
    );
    const sendAnyway = root.querySelector(
      'button[data-action="send-anyway"]',
    ) as HTMLButtonElement | null;
    expect(sendAnyway).not.toBeNull();
    sendAnyway!.click();
    // Async storage writes — flush microtasks.
    await Promise.resolve();
    await Promise.resolve();
    const store = stub.readStore();
    const overrides = store[STORAGE_KEY_INTERCEPT_OVERRIDES] as
      | Record<string, { count: number }>
      | undefined;
    expect(overrides).toBeDefined();
    expect(overrides!['chatgpt:target.example']?.count).toBe(1);
    expect(store[STORAGE_KEY_PENDING_INTERCEPT]).toBeUndefined();
  });

  it('Cancel clears the pending record without recording an override', async () => {
    const stub = setupChrome({ [STORAGE_KEY_PENDING_INTERCEPT]: buildRecord() });
    renderPendingIntercept(root, buildRecord({ status: 'verdict-ready', verdict: buildVerdict({ status: 'SUSPICIOUS' }) }));
    const cancel = root.querySelector('button[data-action="cancel"]') as HTMLButtonElement | null;
    expect(cancel).not.toBeNull();
    cancel!.click();
    await Promise.resolve();
    await Promise.resolve();
    const store = stub.readStore();
    expect(store[STORAGE_KEY_PENDING_INTERCEPT]).toBeUndefined();
    expect(store[STORAGE_KEY_INTERCEPT_OVERRIDES]).toBeUndefined();
  });

  it('Wait extends timeoutAt and sets timeoutExtended=true', async () => {
    const startedAt = 1_000_000;
    const initialTimeoutAt = startedAt + 30_000;
    const record = buildRecord({
      status: 'verdict-ready',
      verdict: buildVerdict({ status: 'UNKNOWN', analysisError: 'intercept_timeout' }),
      startedAt,
      timeoutAt: initialTimeoutAt,
      timeoutExtended: false,
    });
    const stub = setupChrome({ [STORAGE_KEY_PENDING_INTERCEPT]: record });
    renderPendingIntercept(root, record);
    const wait = root.querySelector('button[data-action="wait"]') as HTMLButtonElement | null;
    expect(wait).not.toBeNull();
    wait!.click();
    await Promise.resolve();
    await Promise.resolve();
    const stored = stub.readStore()[STORAGE_KEY_PENDING_INTERCEPT] as PendingInterceptRecord;
    expect(stored.timeoutExtended).toBe(true);
    expect(stored.timeoutAt).toBe(initialTimeoutAt + MAX_INTERCEPT_LATENCY_EXTENSION_MS);
  });

  it('reaching the override threshold renders a whitelist CTA', async () => {
    const overrideMap: Record<string, unknown> = {};
    overrideMap['chatgpt:target.example'] = {
      portalId: 'chatgpt',
      domain: 'target.example',
      count: INTERCEPT_OVERRIDE_WHITELIST_THRESHOLD,
      firstOverride: Date.now() - 1000,
      lastOverride: Date.now(),
    };
    setupChrome({ [STORAGE_KEY_INTERCEPT_OVERRIDES]: overrideMap });
    renderPendingIntercept(
      root,
      buildRecord({ status: 'verdict-ready', verdict: buildVerdict({ status: 'SUSPICIOUS' }) }),
    );
    // Drain the microtask queue + a macrotask tick so the async
    // shouldPromptWhitelist chain (storage.get → map lookup → render) completes.
    await new Promise((r) => setTimeout(r, 0));
    const text = root.textContent ?? '';
    expect(text.toLowerCase()).toContain('whitelist');
  });

  it('lowercases the URL host before keying overrides', async () => {
    const stub = setupChrome();
    renderPendingIntercept(
      root,
      buildRecord({
        status: 'verdict-ready',
        verdict: buildVerdict({ status: 'SUSPICIOUS', scannedUrl: 'https://Target.EXAMPLE/path' }),
        scannedUrl: 'https://Target.EXAMPLE/path',
      }),
    );
    const sendAnyway = root.querySelector('button[data-action="send-anyway"]') as HTMLButtonElement;
    sendAnyway.click();
    await Promise.resolve();
    await Promise.resolve();
    const overrides = stub.readStore()[STORAGE_KEY_INTERCEPT_OVERRIDES] as
      | Record<string, { count: number }>
      | undefined;
    expect(overrides).toBeDefined();
    expect(overrides!['chatgpt:target.example']?.count).toBe(1);
  });

  // Sanity: ensure the rolling window is interpreted correctly.
  it('does not surface the whitelist CTA if overrides are outside the window', async () => {
    const overrideMap: Record<string, unknown> = {};
    overrideMap['chatgpt:target.example'] = {
      portalId: 'chatgpt',
      domain: 'target.example',
      count: INTERCEPT_OVERRIDE_WHITELIST_THRESHOLD,
      firstOverride: Date.now() - INTERCEPT_OVERRIDE_WINDOW_MS - 10_000,
      lastOverride: Date.now() - INTERCEPT_OVERRIDE_WINDOW_MS - 10_000,
    };
    setupChrome({ [STORAGE_KEY_INTERCEPT_OVERRIDES]: overrideMap });
    renderPendingIntercept(
      root,
      buildRecord({ status: 'verdict-ready', verdict: buildVerdict({ status: 'SUSPICIOUS' }) }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect((root.textContent ?? '').toLowerCase()).not.toContain('whitelist');
  });
});
