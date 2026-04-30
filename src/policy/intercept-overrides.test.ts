import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STORAGE_KEY_INTERCEPT_OVERRIDES,
  INTERCEPT_OVERRIDE_WINDOW_MS,
  INTERCEPT_OVERRIDE_WHITELIST_THRESHOLD,
} from '@/shared/constants.js';

import {
  recordOverride,
  getOverrideCount,
  shouldPromptWhitelist,
  __clearOverridesForTest,
} from './intercept-overrides.js';

interface ChromeStub {
  readonly readStore: () => Record<string, unknown>;
}

function setupChrome(initial: Record<string, unknown> = {}): ChromeStub {
  const store: Record<string, unknown> = { ...initial };
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
      },
    },
  });
  return { readStore: () => store };
}

describe('intercept-overrides', () => {
  beforeEach(() => {
    __clearOverridesForTest();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('recordOverride creates a record on first override', async () => {
    setupChrome();
    await recordOverride('chatgpt', 'attacker.example');
    const count = await getOverrideCount('chatgpt', 'attacker.example');
    expect(count).toBe(1);
  });

  it('recordOverride increments count on subsequent overrides', async () => {
    setupChrome();
    await recordOverride('chatgpt', 'a.example');
    await recordOverride('chatgpt', 'a.example');
    await recordOverride('chatgpt', 'a.example');
    expect(await getOverrideCount('chatgpt', 'a.example')).toBe(3);
  });

  it('records are isolated per portalId', async () => {
    setupChrome();
    await recordOverride('chatgpt', 'a.example');
    await recordOverride('claude', 'a.example');
    expect(await getOverrideCount('chatgpt', 'a.example')).toBe(1);
    expect(await getOverrideCount('claude', 'a.example')).toBe(1);
    expect(await getOverrideCount('gemini', 'a.example')).toBe(0);
  });

  it('records are isolated per domain', async () => {
    setupChrome();
    await recordOverride('chatgpt', 'a.example');
    await recordOverride('chatgpt', 'b.example');
    expect(await getOverrideCount('chatgpt', 'a.example')).toBe(1);
    expect(await getOverrideCount('chatgpt', 'b.example')).toBe(1);
  });

  it('returns 0 if the most recent override is older than the rolling window', async () => {
    vi.useFakeTimers();
    const start = new Date('2026-01-01T00:00:00Z').getTime();
    vi.setSystemTime(start);
    setupChrome();
    await recordOverride('chatgpt', 'a.example');
    expect(await getOverrideCount('chatgpt', 'a.example')).toBe(1);
    vi.setSystemTime(start + INTERCEPT_OVERRIDE_WINDOW_MS + 1000);
    expect(await getOverrideCount('chatgpt', 'a.example')).toBe(0);
  });

  it('shouldPromptWhitelist returns true at threshold within the window', async () => {
    setupChrome();
    for (let i = 0; i < INTERCEPT_OVERRIDE_WHITELIST_THRESHOLD; i++) {
      await recordOverride('chatgpt', 'a.example');
    }
    expect(await shouldPromptWhitelist('chatgpt', 'a.example')).toBe(true);
  });

  it('shouldPromptWhitelist returns false below threshold', async () => {
    setupChrome();
    for (let i = 0; i < INTERCEPT_OVERRIDE_WHITELIST_THRESHOLD - 1; i++) {
      await recordOverride('chatgpt', 'a.example');
    }
    expect(await shouldPromptWhitelist('chatgpt', 'a.example')).toBe(false);
  });

  it('persists records under STORAGE_KEY_INTERCEPT_OVERRIDES', async () => {
    const stub = setupChrome();
    await recordOverride('chatgpt', 'a.example');
    const stored = stub.readStore()[STORAGE_KEY_INTERCEPT_OVERRIDES];
    expect(stored).toBeDefined();
    const map = stored as Record<string, { count: number }>;
    expect(map['chatgpt:a.example']?.count).toBe(1);
  });

  it('lowercases the domain before keying', async () => {
    setupChrome();
    await recordOverride('chatgpt', 'A.Example');
    expect(await getOverrideCount('chatgpt', 'a.example')).toBe(1);
  });
});
