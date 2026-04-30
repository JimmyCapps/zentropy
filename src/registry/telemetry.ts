import {
  STORAGE_KEY_REGISTRY_TELEMETRY,
  REGISTRY_MAX_ORIGINS_TRACKED,
  REGISTRY_STALE_BUNDLE_THRESHOLD_MS,
} from '@/shared/constants.js';
import { createLogger } from '@/shared/logger.js';

const log = createLogger('RegistryTelemetry');

interface PerOriginCounters {
  readonly hits: number;
  readonly misses: number;
  readonly lastSeenAt: number;
}

interface RegistryTelemetry {
  readonly hits: number;
  readonly misses: number;
  readonly verifyFailures: number;
  readonly bundleSignedAt: number | null;
  readonly bundleLoadedAt: number | null;
  readonly perOrigin: Record<string, PerOriginCounters>;
  readonly lastResetAt: number;
}

export interface RegistryStats {
  readonly hits: number;
  readonly misses: number;
  readonly verifyFailures: number;
  readonly hitRate: number | null;
  readonly bundleSignedAt: number | null;
  readonly bundleLoadedAt: number | null;
  readonly bundleAgeMs: number | null;
  readonly staleBundle: boolean;
  readonly perOrigin: Record<string, PerOriginCounters>;
  readonly lastResetAt: number;
}

function freshTelemetry(): RegistryTelemetry {
  return {
    hits: 0,
    misses: 0,
    verifyFailures: 0,
    bundleSignedAt: null,
    bundleLoadedAt: null,
    perOrigin: {},
    lastResetAt: Date.now(),
  };
}

function isPerOrigin(value: unknown): value is PerOriginCounters {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.hits === 'number' &&
    typeof v.misses === 'number' &&
    typeof v.lastSeenAt === 'number'
  );
}

function isTelemetry(value: unknown): value is RegistryTelemetry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (
    typeof v.hits !== 'number' ||
    typeof v.misses !== 'number' ||
    typeof v.verifyFailures !== 'number' ||
    typeof v.lastResetAt !== 'number'
  ) {
    return false;
  }
  if (v.bundleSignedAt !== null && typeof v.bundleSignedAt !== 'number') return false;
  if (v.bundleLoadedAt !== null && typeof v.bundleLoadedAt !== 'number') return false;
  if (typeof v.perOrigin !== 'object' || v.perOrigin === null) return false;
  for (const entry of Object.values(v.perOrigin as Record<string, unknown>)) {
    if (!isPerOrigin(entry)) return false;
  }
  return true;
}

async function readTelemetry(): Promise<RegistryTelemetry> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY_REGISTRY_TELEMETRY);
    const value = result[STORAGE_KEY_REGISTRY_TELEMETRY];
    if (isTelemetry(value)) return value;
  } catch (err) {
    log.warn('readTelemetry failed', err);
  }
  return freshTelemetry();
}

async function writeTelemetry(t: RegistryTelemetry): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY_REGISTRY_TELEMETRY]: t });
  } catch (err) {
    log.warn('writeTelemetry failed', err);
  }
}

/**
 * Insert/update a per-origin bucket and enforce the LRU cap. Returns a
 * fresh `perOrigin` record; never mutates the input. When the bump would
 * push the table past REGISTRY_MAX_ORIGINS_TRACKED, drop the entry with
 * the smallest `lastSeenAt` (deterministic — ties resolve to insertion
 * order, which matters only in tests with collapsed timestamps).
 */
function bumpOrigin(
  perOrigin: Record<string, PerOriginCounters>,
  origin: string,
  delta: { hits?: number; misses?: number },
  now: number,
): Record<string, PerOriginCounters> {
  const existing = perOrigin[origin];
  const next: Record<string, PerOriginCounters> = { ...perOrigin };
  next[origin] = {
    hits: (existing?.hits ?? 0) + (delta.hits ?? 0),
    misses: (existing?.misses ?? 0) + (delta.misses ?? 0),
    lastSeenAt: now,
  };

  if (Object.keys(next).length <= REGISTRY_MAX_ORIGINS_TRACKED) return next;

  let evictKey: string | null = null;
  let evictAt = Infinity;
  for (const [k, v] of Object.entries(next)) {
    if (k === origin) continue;
    if (v.lastSeenAt < evictAt) {
      evictAt = v.lastSeenAt;
      evictKey = k;
    }
  }
  if (evictKey !== null) delete next[evictKey];
  return next;
}

export async function recordRegistryHit(origin: string): Promise<void> {
  const now = Date.now();
  const t = await readTelemetry();
  await writeTelemetry({
    ...t,
    hits: t.hits + 1,
    perOrigin: bumpOrigin(t.perOrigin, origin, { hits: 1 }, now),
  });
}

export async function recordRegistryMiss(origin: string): Promise<void> {
  const now = Date.now();
  const t = await readTelemetry();
  await writeTelemetry({
    ...t,
    misses: t.misses + 1,
    perOrigin: bumpOrigin(t.perOrigin, origin, { misses: 1 }, now),
  });
}

export async function recordRegistryVerifyFailure(): Promise<void> {
  const t = await readTelemetry();
  await writeTelemetry({ ...t, verifyFailures: t.verifyFailures + 1 });
}

export async function recordRegistryBundleLoaded(signedAt: number): Promise<void> {
  const t = await readTelemetry();
  await writeTelemetry({
    ...t,
    bundleSignedAt: signedAt,
    bundleLoadedAt: Date.now(),
  });
}

export async function resetRegistryTelemetry(): Promise<void> {
  const t = await readTelemetry();
  await writeTelemetry({
    hits: 0,
    misses: 0,
    verifyFailures: 0,
    bundleSignedAt: t.bundleSignedAt,
    bundleLoadedAt: t.bundleLoadedAt,
    perOrigin: {},
    lastResetAt: Date.now(),
  });
}

export async function getRegistryStats(): Promise<RegistryStats> {
  const t = await readTelemetry();
  const totalLookups = t.hits + t.misses;
  const hitRate = totalLookups === 0 ? null : t.hits / totalLookups;
  const now = Date.now();
  const bundleAgeMs = t.bundleSignedAt === null ? null : now - t.bundleSignedAt;
  const staleBundle =
    bundleAgeMs !== null && bundleAgeMs > REGISTRY_STALE_BUNDLE_THRESHOLD_MS;
  return {
    hits: t.hits,
    misses: t.misses,
    verifyFailures: t.verifyFailures,
    hitRate,
    bundleSignedAt: t.bundleSignedAt,
    bundleLoadedAt: t.bundleLoadedAt,
    bundleAgeMs,
    staleBundle,
    perOrigin: t.perOrigin,
    lastResetAt: t.lastResetAt,
  };
}
