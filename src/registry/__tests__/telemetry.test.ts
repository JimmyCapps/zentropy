import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  recordRegistryHit,
  recordRegistryMiss,
  recordRegistryVerifyFailure,
  recordRegistryBundleLoaded,
  resetRegistryTelemetry,
  getRegistryStats,
} from '../telemetry.js';
import {
  STORAGE_KEY_REGISTRY_TELEMETRY,
  REGISTRY_MAX_ORIGINS_TRACKED,
  REGISTRY_STALE_BUNDLE_THRESHOLD_MS,
} from '@/shared/constants.js';

function installChromeStub(): Map<string, unknown> {
  const store = new Map<string, unknown>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async (keys?: string | string[] | null) => {
          if (keys === null || keys === undefined) {
            return Object.fromEntries(store);
          }
          const arr = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of arr) {
            if (store.has(k)) out[k] = store.get(k);
          }
          return out;
        },
        set: async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store.set(k, v);
        },
        remove: async (keys: string | string[]) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          for (const k of arr) store.delete(k);
        },
      },
    },
  };
  return store;
}

beforeEach(async () => {
  installChromeStub();
  vi.useRealTimers();
  await resetRegistryTelemetry();
});

describe('registry telemetry: fresh state', () => {
  it('returns zero counters and null bundle metadata before any activity', async () => {
    const stats = await getRegistryStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.verifyFailures).toBe(0);
    expect(stats.hitRate).toBeNull();
    expect(stats.bundleSignedAt).toBeNull();
    expect(stats.bundleLoadedAt).toBeNull();
    expect(stats.bundleAgeMs).toBeNull();
    expect(stats.staleBundle).toBe(false);
    expect(Object.keys(stats.perOrigin)).toEqual([]);
  });
});

describe('registry telemetry: counter mutations', () => {
  it('recordRegistryHit increments global hits and bumps per-origin hits + lastSeenAt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-30T10:00:00Z'));
    await recordRegistryHit('gmail.com');
    await recordRegistryHit('gmail.com');

    const stats = await getRegistryStats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(0);
    expect(stats.perOrigin['gmail.com']).toBeDefined();
    expect(stats.perOrigin['gmail.com']!.hits).toBe(2);
    expect(stats.perOrigin['gmail.com']!.misses).toBe(0);
    expect(stats.perOrigin['gmail.com']!.lastSeenAt).toBe(
      new Date('2026-04-30T10:00:00Z').getTime(),
    );
  });

  it('recordRegistryMiss increments global misses and bumps per-origin misses', async () => {
    await recordRegistryMiss('unknown.test');
    await recordRegistryMiss('unknown.test');
    await recordRegistryMiss('other.test');

    const stats = await getRegistryStats();
    expect(stats.misses).toBe(3);
    expect(stats.hits).toBe(0);
    expect(stats.perOrigin['unknown.test']!.misses).toBe(2);
    expect(stats.perOrigin['other.test']!.misses).toBe(1);
  });

  it('recordRegistryVerifyFailure increments global verifyFailures only (no per-origin)', async () => {
    await recordRegistryVerifyFailure();
    await recordRegistryVerifyFailure();

    const stats = await getRegistryStats();
    expect(stats.verifyFailures).toBe(2);
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(Object.keys(stats.perOrigin)).toEqual([]);
  });

  it('hitRate is hits / (hits + misses); 0/0 collapses to null', async () => {
    await recordRegistryHit('gmail.com');
    await recordRegistryHit('gmail.com');
    await recordRegistryHit('gmail.com');
    await recordRegistryMiss('unknown.test');

    const stats = await getRegistryStats();
    expect(stats.hitRate).toBeCloseTo(0.75, 6);
  });
});

describe('registry telemetry: bundle metadata + staleness', () => {
  it('recordRegistryBundleLoaded persists signedAt + loadedAt; getRegistryStats derives bundleAgeMs from now', async () => {
    vi.useFakeTimers();
    const signedAtTs = new Date('2026-04-15T00:00:00Z').getTime();
    const loadAtTs = new Date('2026-04-30T00:00:00Z').getTime();
    vi.setSystemTime(loadAtTs);

    await recordRegistryBundleLoaded(signedAtTs);
    const stats = await getRegistryStats();

    expect(stats.bundleSignedAt).toBe(signedAtTs);
    expect(stats.bundleLoadedAt).toBe(loadAtTs);
    expect(stats.bundleAgeMs).toBe(loadAtTs - signedAtTs);
    expect(stats.staleBundle).toBe(false);
  });

  it('staleBundle becomes true when bundleAgeMs exceeds REGISTRY_STALE_BUNDLE_THRESHOLD_MS', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-04-30T00:00:00Z').getTime();
    const ancientSignedAt = now - REGISTRY_STALE_BUNDLE_THRESHOLD_MS - 1;
    vi.setSystemTime(now);

    await recordRegistryBundleLoaded(ancientSignedAt);
    const stats = await getRegistryStats();

    expect(stats.staleBundle).toBe(true);
    expect(stats.bundleAgeMs).toBeGreaterThan(REGISTRY_STALE_BUNDLE_THRESHOLD_MS);
  });

  it('bundleAgeMs is computed against now() at read time, not stored', async () => {
    vi.useFakeTimers();
    const signedAt = new Date('2026-04-15T00:00:00Z').getTime();
    vi.setSystemTime(new Date('2026-04-15T00:00:01Z'));
    await recordRegistryBundleLoaded(signedAt);

    vi.setSystemTime(new Date('2026-05-15T00:00:00Z'));
    const stats = await getRegistryStats();

    const expected = new Date('2026-05-15T00:00:00Z').getTime() - signedAt;
    expect(stats.bundleAgeMs).toBe(expected);
  });
});

describe('registry telemetry: reset semantics', () => {
  it('resetRegistryTelemetry zeros counters + perOrigin + verifyFailures and sets lastResetAt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-29T00:00:00Z'));
    await recordRegistryHit('gmail.com');
    await recordRegistryMiss('other.test');
    await recordRegistryVerifyFailure();

    vi.setSystemTime(new Date('2026-04-30T00:00:00Z'));
    await resetRegistryTelemetry();

    const stats = await getRegistryStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.verifyFailures).toBe(0);
    expect(Object.keys(stats.perOrigin)).toEqual([]);
    expect(stats.lastResetAt).toBe(new Date('2026-04-30T00:00:00Z').getTime());
  });

  it('resetRegistryTelemetry preserves bundleSignedAt + bundleLoadedAt (bundle metadata is independent of counter lifetime)', async () => {
    vi.useFakeTimers();
    const signedAt = new Date('2026-04-15T00:00:00Z').getTime();
    const loadedAt = new Date('2026-04-29T00:00:00Z').getTime();
    vi.setSystemTime(loadedAt);
    await recordRegistryBundleLoaded(signedAt);
    await recordRegistryHit('gmail.com');

    vi.setSystemTime(new Date('2026-04-30T00:00:00Z'));
    await resetRegistryTelemetry();

    const stats = await getRegistryStats();
    expect(stats.bundleSignedAt).toBe(signedAt);
    expect(stats.bundleLoadedAt).toBe(loadedAt);
  });
});

describe('registry telemetry: per-origin LRU eviction', () => {
  it('caps perOrigin at REGISTRY_MAX_ORIGINS_TRACKED, evicting the oldest lastSeenAt entry first', async () => {
    vi.useFakeTimers();
    // Fill the table at consecutive timestamps so the LRU order is deterministic.
    for (let i = 0; i < REGISTRY_MAX_ORIGINS_TRACKED; i += 1) {
      vi.setSystemTime(new Date('2026-04-30T00:00:00Z').getTime() + i);
      await recordRegistryHit(`origin-${i}.test`);
    }

    // Confirm we filled to the cap.
    let stats = await getRegistryStats();
    expect(Object.keys(stats.perOrigin)).toHaveLength(REGISTRY_MAX_ORIGINS_TRACKED);
    expect(stats.perOrigin['origin-0.test']).toBeDefined();

    // Now add one more — origin-0.test should be evicted (oldest lastSeenAt).
    vi.setSystemTime(
      new Date('2026-04-30T00:00:00Z').getTime() + REGISTRY_MAX_ORIGINS_TRACKED,
    );
    await recordRegistryHit('newcomer.test');

    stats = await getRegistryStats();
    expect(Object.keys(stats.perOrigin)).toHaveLength(REGISTRY_MAX_ORIGINS_TRACKED);
    expect(stats.perOrigin['origin-0.test']).toBeUndefined();
    expect(stats.perOrigin['newcomer.test']).toBeDefined();
    expect(stats.perOrigin['origin-1.test']).toBeDefined();
  });

  it('re-touching an existing origin updates lastSeenAt without evicting any entry', async () => {
    vi.useFakeTimers();
    for (let i = 0; i < REGISTRY_MAX_ORIGINS_TRACKED; i += 1) {
      vi.setSystemTime(new Date('2026-04-30T00:00:00Z').getTime() + i);
      await recordRegistryHit(`origin-${i}.test`);
    }

    // Re-touch origin-0.test, making it the newest.
    vi.setSystemTime(
      new Date('2026-04-30T00:00:00Z').getTime() + REGISTRY_MAX_ORIGINS_TRACKED + 100,
    );
    await recordRegistryHit('origin-0.test');

    // Now add a newcomer — origin-1.test should be evicted (now the oldest).
    vi.setSystemTime(
      new Date('2026-04-30T00:00:00Z').getTime() + REGISTRY_MAX_ORIGINS_TRACKED + 200,
    );
    await recordRegistryHit('newcomer.test');

    const stats = await getRegistryStats();
    expect(Object.keys(stats.perOrigin)).toHaveLength(REGISTRY_MAX_ORIGINS_TRACKED);
    expect(stats.perOrigin['origin-0.test']).toBeDefined();
    expect(stats.perOrigin['origin-1.test']).toBeUndefined();
    expect(stats.perOrigin['newcomer.test']).toBeDefined();
  });
});

describe('registry telemetry: persistence across reads', () => {
  it('counters survive a fresh module read by reading from chrome.storage.local on every call (no in-memory cache)', async () => {
    await recordRegistryHit('gmail.com');
    await recordRegistryMiss('other.test');

    // Simulate SW restart by re-reading raw storage; the persisted shape
    // must be a structured-clonable object suitable for chrome.storage.local.
    const raw = await (globalThis as { chrome: typeof chrome }).chrome.storage.local.get(
      STORAGE_KEY_REGISTRY_TELEMETRY,
    );
    const persisted = raw[STORAGE_KEY_REGISTRY_TELEMETRY] as {
      hits: number;
      misses: number;
      perOrigin: Record<string, { hits: number; misses: number; lastSeenAt: number }>;
    };
    expect(persisted.hits).toBe(1);
    expect(persisted.misses).toBe(1);
    expect(persisted.perOrigin['gmail.com']!.hits).toBe(1);
    expect(persisted.perOrigin['other.test']!.misses).toBe(1);
  });

  it('recovers gracefully when stored telemetry is malformed (returns fresh state)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (globalThis as any).chrome.storage.local.set({
      [STORAGE_KEY_REGISTRY_TELEMETRY]: { junk: 'not a real telemetry object' },
    });

    const stats = await getRegistryStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.verifyFailures).toBe(0);
  });
});
