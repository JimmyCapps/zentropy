import { describe, it, expect, beforeEach } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import { IDBFactory } from 'fake-indexeddb';
import {
  lookupScan,
  writeScan,
  clearCache,
  getCacheStats,
  recordCacheHit,
  recordCacheMiss,
  resetCacheTelemetry,
} from './scan-cache.js';
import type { CachedScan } from '@/types/scan-cache.js';
import {
  CACHE_SCHEMA_VERSION,
  HUNTER_RULES_VERSION,
  CACHE_DEFAULT_TTL_MS,
  CACHE_DEFAULT_MAX_BYTES,
} from '@/shared/constants.js';

const MODEL_ID = 'gemma-2-2b-it-q4f16_1-MLC';
const STALE_MODEL_ID = 'old-model-id';

function makeRecord(overrides: Partial<CachedScan> = {}): CachedScan {
  const base: CachedScan = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    hunterRulesVersion: HUNTER_RULES_VERSION,
    llmModelId: MODEL_ID,
    url: 'https://example.com/page-a',
    fetchedAt: Date.now(),
    chunks: [
      {
        contentHash: 'hash-0',
        tierRouting: { decision: 'BENIGN', primitiveCount: 0, contributingHunters: [] },
        probeResults: null,
      },
    ],
    earlyExited: false,
    entitySummary: null,
    sizeBytes: 0,
  };
  return { ...base, ...overrides };
}

// fake-indexeddb auto-installs at vitest setup; reset its state between
// tests by replacing the factory and re-installing on globalThis.
// chrome.storage is also stubbed in-memory for telemetry persistence.
beforeEach(async () => {
  // Reset IndexedDB
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).indexedDB = new IDBFactory();
  // Reset chrome.storage.local stub
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
  await resetCacheTelemetry();
});

describe('scan-cache: lookup miss/hit', () => {
  it('returns null on empty cache', async () => {
    const result = await lookupScan('https://example.com/x', {
      hunterRulesVersion: HUNTER_RULES_VERSION,
      llmModelId: MODEL_ID,
    });
    expect(result).toBeNull();
  });

  it('round-trips a record', async () => {
    const rec = makeRecord();
    await writeScan(rec);
    const loaded = await lookupScan(rec.url, {
      hunterRulesVersion: HUNTER_RULES_VERSION,
      llmModelId: MODEL_ID,
    });
    expect(loaded).not.toBeNull();
    expect(loaded?.url).toBe(rec.url);
    expect(loaded?.chunks.length).toBe(1);
    expect(loaded?.chunks[0]?.contentHash).toBe('hash-0');
  });
});

describe('scan-cache: version-mismatch invalidation', () => {
  it('returns null when stored hunterRulesVersion differs', async () => {
    await writeScan(makeRecord({ hunterRulesVersion: '0.1.0' }));
    const result = await lookupScan('https://example.com/page-a', {
      hunterRulesVersion: HUNTER_RULES_VERSION,
      llmModelId: MODEL_ID,
    });
    expect(result).toBeNull();
  });

  it('returns null when stored llmModelId differs', async () => {
    await writeScan(makeRecord({ llmModelId: STALE_MODEL_ID }));
    const result = await lookupScan('https://example.com/page-a', {
      hunterRulesVersion: HUNTER_RULES_VERSION,
      llmModelId: MODEL_ID,
    });
    expect(result).toBeNull();
  });

  it('returns null when stored schemaVersion differs', async () => {
    // Forge a record with schemaVersion=0; lookup must reject.
    await writeScan(makeRecord({ schemaVersion: 0 as unknown as 1 }));
    const result = await lookupScan('https://example.com/page-a', {
      hunterRulesVersion: HUNTER_RULES_VERSION,
      llmModelId: MODEL_ID,
    });
    expect(result).toBeNull();
  });
});

describe('scan-cache: TTL eviction', () => {
  it('returns null when entry is older than configured TTL', async () => {
    const stale = makeRecord({ fetchedAt: Date.now() - (CACHE_DEFAULT_TTL_MS + 1000) });
    await writeScan(stale);
    const result = await lookupScan(stale.url, {
      hunterRulesVersion: HUNTER_RULES_VERSION,
      llmModelId: MODEL_ID,
    });
    expect(result).toBeNull();
  });

  it('respects custom TTL from chrome.storage', async () => {
    // Set a very short custom TTL: 100 ms.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (globalThis as any).chrome.storage.local.set({
      'honeyllm:cache-ttl-ms': 100,
    });
    const rec = makeRecord({ fetchedAt: Date.now() - 200 });
    await writeScan(rec);
    const result = await lookupScan(rec.url, {
      hunterRulesVersion: HUNTER_RULES_VERSION,
      llmModelId: MODEL_ID,
    });
    expect(result).toBeNull();
  });
});

describe('scan-cache: clearCache', () => {
  it('removes every entry', async () => {
    await writeScan(makeRecord({ url: 'https://example.com/a' }));
    await writeScan(makeRecord({ url: 'https://example.com/b' }));
    await clearCache();
    const stats = await getCacheStats();
    expect(stats.entries).toBe(0);
    expect(stats.sizeBytes).toBe(0);
  });

  it('resets telemetry counters', async () => {
    await recordCacheHit();
    await recordCacheHit();
    await recordCacheMiss();
    await clearCache();
    const stats = await getCacheStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.hitRate).toBeNull();
  });
});

describe('scan-cache: getCacheStats', () => {
  it('reports zero when empty', async () => {
    const stats = await getCacheStats();
    expect(stats.entries).toBe(0);
    expect(stats.sizeBytes).toBe(0);
    expect(stats.maxBytes).toBe(CACHE_DEFAULT_MAX_BYTES);
    expect(stats.ttlMs).toBe(CACHE_DEFAULT_TTL_MS);
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.hitRate).toBeNull();
  });

  it('aggregates entry count and bytes after writes', async () => {
    await writeScan(makeRecord({ url: 'https://example.com/a' }));
    await writeScan(makeRecord({ url: 'https://example.com/b' }));
    const stats = await getCacheStats();
    expect(stats.entries).toBe(2);
    expect(stats.sizeBytes).toBeGreaterThan(0);
  });

  it('computes hitRate from telemetry', async () => {
    await recordCacheHit();
    await recordCacheHit();
    await recordCacheHit();
    await recordCacheMiss();
    const stats = await getCacheStats();
    expect(stats.hits).toBe(3);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBeCloseTo(0.75);
  });
});

describe('scan-cache: LRU eviction on write', () => {
  it('evicts oldest fetchedAt entries until under maxBytes budget', async () => {
    // Set a tiny budget so two records exceed it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (globalThis as any).chrome.storage.local.set({
      'honeyllm:cache-max-bytes': 600,
    });
    const now = Date.now();
    // Three records, each ~250 bytes serialized. Budget=600 → after 3rd
    // write, oldest (a) must be evicted.
    await writeScan(makeRecord({ url: 'https://example.com/a', fetchedAt: now - 3000 }));
    await writeScan(makeRecord({ url: 'https://example.com/b', fetchedAt: now - 2000 }));
    await writeScan(makeRecord({ url: 'https://example.com/c', fetchedAt: now - 1000 }));
    const stats = await getCacheStats();
    expect(stats.sizeBytes).toBeLessThanOrEqual(600);
    // The oldest entry is gone; the two newest remain.
    expect(
      await lookupScan('https://example.com/a', {
        hunterRulesVersion: HUNTER_RULES_VERSION,
        llmModelId: MODEL_ID,
      }),
    ).toBeNull();
    expect(
      await lookupScan('https://example.com/c', {
        hunterRulesVersion: HUNTER_RULES_VERSION,
        llmModelId: MODEL_ID,
      }),
    ).not.toBeNull();
  });
});

describe('scan-cache: telemetry counters', () => {
  it('increments hits independently from misses', async () => {
    await recordCacheHit();
    await recordCacheMiss();
    await recordCacheHit();
    const stats = await getCacheStats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
  });
});
