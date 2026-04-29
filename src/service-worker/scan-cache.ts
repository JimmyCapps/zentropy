import type { CachedScan, CacheStats } from '@/types/scan-cache.js';
import {
  CACHE_DB_NAME,
  CACHE_DB_VERSION,
  CACHE_STORE_NAME,
  CACHE_SCHEMA_VERSION,
  CACHE_DEFAULT_TTL_MS,
  CACHE_DEFAULT_MAX_BYTES,
  STORAGE_KEY_CACHE_TTL_MS,
  STORAGE_KEY_CACHE_MAX_BYTES,
  STORAGE_KEY_CACHE_TELEMETRY,
  STORAGE_KEY_CANARY,
  DEFAULT_CANARY_ID,
  type CanaryId,
} from '@/shared/constants.js';
import { createLogger } from '@/shared/logger.js';

const log = createLogger('ScanCache');

interface CacheVersionGuard {
  readonly hunterRulesVersion: string;
  readonly llmModelId: string;
}

interface CacheTelemetry {
  readonly hits: number;
  readonly misses: number;
  readonly resetAt: number;
}

/**
 * Open the page-scan IndexedDB connection. Re-opens on every call: MV3
 * service workers can be terminated mid-session and a stale `IDBDatabase`
 * handle from a prior activation will throw `InvalidStateError` on use.
 * Opening per-call is the simple correctness-first approach; the open
 * itself is cheap (sub-millisecond once the schema exists).
 */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CACHE_STORE_NAME)) {
        const store = db.createObjectStore(CACHE_STORE_NAME, { keyPath: 'url' });
        // fetchedAt index drives the LRU eviction loop; sorting by it
        // lets us walk oldest→newest without a full table scan.
        store.createIndex('fetchedAt', 'fetchedAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB.open failed'));
  });
}

function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IDBRequest failed'));
  });
}

async function readConfigNumber(key: string, fallback: number): Promise<number> {
  try {
    const result = await chrome.storage.local.get(key);
    const value = result[key];
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

async function getTtlMs(): Promise<number> {
  return readConfigNumber(STORAGE_KEY_CACHE_TTL_MS, CACHE_DEFAULT_TTL_MS);
}

async function getMaxBytes(): Promise<number> {
  return readConfigNumber(STORAGE_KEY_CACHE_MAX_BYTES, CACHE_DEFAULT_MAX_BYTES);
}

function isValidCachedScan(value: unknown): value is CachedScan {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.schemaVersion === 'number' &&
    typeof v.hunterRulesVersion === 'string' &&
    typeof v.llmModelId === 'string' &&
    typeof v.url === 'string' &&
    typeof v.fetchedAt === 'number' &&
    Array.isArray(v.chunks) &&
    typeof v.earlyExited === 'boolean' &&
    typeof v.sizeBytes === 'number'
  );
}

/**
 * Look up a cached scan for the given URL, validating that the stored
 * record matches the current schema version, hunter rules version, and
 * LLM model id, and that it hasn't expired. Mismatches and TTL-expired
 * records return null AND lazily delete the stale record.
 */
export async function lookupScan(
  url: string,
  guard: CacheVersionGuard,
): Promise<CachedScan | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(CACHE_STORE_NAME, 'readonly');
    const store = tx.objectStore(CACHE_STORE_NAME);
    const raw = await promisifyRequest(store.get(url));
    if (!isValidCachedScan(raw)) return null;

    const ttl = await getTtlMs();
    const expired = Date.now() - raw.fetchedAt > ttl;
    const versionMismatch =
      raw.schemaVersion !== CACHE_SCHEMA_VERSION ||
      raw.hunterRulesVersion !== guard.hunterRulesVersion ||
      raw.llmModelId !== guard.llmModelId;

    if (expired || versionMismatch) {
      await deleteEntry(url).catch((err) => {
        log.warn(`Failed to evict stale cache entry for ${url}`, err);
      });
      return null;
    }
    return raw;
  } finally {
    db.close();
  }
}

/**
 * Persist a CachedScan record, recomputing `sizeBytes` from the
 * serialized form. Triggers LRU eviction if the post-write store size
 * exceeds the configured budget.
 */
export async function writeScan(record: CachedScan): Promise<void> {
  const sized: CachedScan = {
    ...record,
    sizeBytes: 0, // placeholder so JSON.stringify is deterministic
  };
  const sizeBytes = JSON.stringify(sized).length;
  const final: CachedScan = { ...record, sizeBytes };

  const db = await openDb();
  try {
    const tx = db.transaction(CACHE_STORE_NAME, 'readwrite');
    const store = tx.objectStore(CACHE_STORE_NAME);
    await promisifyRequest(store.put(final));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('writeScan tx failed'));
      tx.onabort = () => reject(tx.error ?? new Error('writeScan tx aborted'));
    });
  } finally {
    db.close();
  }
  await evictIfOverBudget();
}

async function deleteEntry(url: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(CACHE_STORE_NAME, 'readwrite');
    await promisifyRequest(tx.objectStore(CACHE_STORE_NAME).delete(url));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('deleteEntry tx failed'));
      tx.onabort = () => reject(tx.error ?? new Error('deleteEntry tx aborted'));
    });
  } finally {
    db.close();
  }
}

/**
 * Walk the fetchedAt index oldest→newest, deleting until the cumulative
 * size of remaining entries fits under maxBytes. Called after every
 * write so the cache cannot grow unbounded.
 */
async function evictIfOverBudget(): Promise<void> {
  const maxBytes = await getMaxBytes();
  const db = await openDb();
  try {
    // First read all entries via the fetchedAt index (sorted ascending).
    const tx = db.transaction(CACHE_STORE_NAME, 'readonly');
    const idx = tx.objectStore(CACHE_STORE_NAME).index('fetchedAt');
    const all = (await promisifyRequest(idx.getAll())) as CachedScan[];
    const totalBytes = all.reduce((sum, r) => sum + (r.sizeBytes ?? 0), 0);
    if (totalBytes <= maxBytes) return;

    let runningBytes = totalBytes;
    const toEvict: string[] = [];
    for (const entry of all) {
      if (runningBytes <= maxBytes) break;
      toEvict.push(entry.url);
      runningBytes -= entry.sizeBytes ?? 0;
    }
    if (toEvict.length === 0) return;
    log.info(`LRU eviction: removing ${toEvict.length} entries (${totalBytes - runningBytes} bytes)`);
  } finally {
    db.close();
  }
  // Perform the deletions in a fresh transaction to keep the read tx
  // short (large stores would otherwise hold the read tx open).
  await deleteOldestUntilFits(maxBytes);
}

async function deleteOldestUntilFits(maxBytes: number): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(CACHE_STORE_NAME, 'readwrite');
    const store = tx.objectStore(CACHE_STORE_NAME);
    const idx = store.index('fetchedAt');
    const all = (await promisifyRequest(idx.getAll())) as CachedScan[];
    let runningBytes = all.reduce((sum, r) => sum + (r.sizeBytes ?? 0), 0);
    for (const entry of all) {
      if (runningBytes <= maxBytes) break;
      await promisifyRequest(store.delete(entry.url));
      runningBytes -= entry.sizeBytes ?? 0;
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('eviction tx failed'));
      tx.onabort = () => reject(tx.error ?? new Error('eviction tx aborted'));
    });
  } finally {
    db.close();
  }
}

/**
 * Drop every cache entry. Used by the "Clear cache" button in the popup
 * and by global-invalidation paths (model change, schema bump). Also
 * resets the hit/miss telemetry counters so the popup's hit-rate stat
 * doesn't carry over across logical cache lifetimes.
 */
export async function clearCache(): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(CACHE_STORE_NAME, 'readwrite');
    await promisifyRequest(tx.objectStore(CACHE_STORE_NAME).clear());
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('clearCache tx failed'));
      tx.onabort = () => reject(tx.error ?? new Error('clearCache tx aborted'));
    });
  } finally {
    db.close();
  }
  await resetCacheTelemetry();
  log.info('Page-scan cache cleared');
}

async function readTelemetry(): Promise<CacheTelemetry> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY_CACHE_TELEMETRY);
    const value = result[STORAGE_KEY_CACHE_TELEMETRY];
    if (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as Record<string, unknown>).hits === 'number' &&
      typeof (value as Record<string, unknown>).misses === 'number'
    ) {
      const v = value as Record<string, unknown>;
      return {
        hits: v.hits as number,
        misses: v.misses as number,
        resetAt: typeof v.resetAt === 'number' ? (v.resetAt as number) : Date.now(),
      };
    }
  } catch (err) {
    log.warn('readTelemetry failed', err);
  }
  return { hits: 0, misses: 0, resetAt: Date.now() };
}

async function writeTelemetry(t: CacheTelemetry): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY_CACHE_TELEMETRY]: t });
  } catch (err) {
    log.warn('writeTelemetry failed', err);
  }
}

export async function recordCacheHit(): Promise<void> {
  const t = await readTelemetry();
  await writeTelemetry({ ...t, hits: t.hits + 1 });
}

export async function recordCacheMiss(): Promise<void> {
  const t = await readTelemetry();
  await writeTelemetry({ ...t, misses: t.misses + 1 });
}

export async function resetCacheTelemetry(): Promise<void> {
  await writeTelemetry({ hits: 0, misses: 0, resetAt: Date.now() });
}

/**
 * Read the user's preferred canary from storage.sync. Used as the
 * `llmModelId` cache key — a change in canary preference invalidates
 * every cached entry on next access.
 *
 * 'auto' is preserved as-is rather than resolved to a concrete engine:
 * the user's preference is the stable cache identity, and resolving
 * 'auto' would require offscreen-engine state that isn't available at
 * cache-lookup time. Tradeoff: if 'auto' flips between MLC and Nano
 * across visits (e.g. WebGPU lost), a stale-engine replay can occur
 * until the user manually clears cache. Acceptable for v1.
 */
export async function getEngineFingerprint(): Promise<CanaryId> {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage?.sync) {
      return DEFAULT_CANARY_ID;
    }
    const result = await chrome.storage.sync.get(STORAGE_KEY_CANARY);
    const raw = result[STORAGE_KEY_CANARY];
    if (typeof raw === 'string') {
      // CanaryId catalog lives in shared/constants; we trust the popup
      // to have written a valid value. Anything else collapses to
      // DEFAULT_CANARY_ID — an invalid preference shouldn't poison the
      // cache.
      return raw as CanaryId;
    }
  } catch (err) {
    log.warn('getEngineFingerprint failed; falling back to default', err);
  }
  return DEFAULT_CANARY_ID;
}

/**
 * Surface cache stats for the popup. Reads everything fresh — this is
 * called when the popup opens, not in any hot path, so the extra
 * IndexedDB scan is fine.
 */
export async function getCacheStats(): Promise<CacheStats> {
  const [telemetry, ttlMs, maxBytes] = await Promise.all([
    readTelemetry(),
    getTtlMs(),
    getMaxBytes(),
  ]);

  let entries = 0;
  let sizeBytes = 0;
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(CACHE_STORE_NAME, 'readonly');
      const all = (await promisifyRequest(tx.objectStore(CACHE_STORE_NAME).getAll())) as CachedScan[];
      entries = all.length;
      sizeBytes = all.reduce((sum, r) => sum + (r.sizeBytes ?? 0), 0);
    } finally {
      db.close();
    }
  } catch (err) {
    log.warn('getCacheStats: idb scan failed', err);
  }

  const totalLookups = telemetry.hits + telemetry.misses;
  const hitRate = totalLookups === 0 ? null : telemetry.hits / totalLookups;
  return {
    entries,
    sizeBytes,
    maxBytes,
    ttlMs,
    hits: telemetry.hits,
    misses: telemetry.misses,
    hitRate,
  };
}
