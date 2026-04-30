import type { PortalId } from '@/types/messages.js';
import {
  INTERCEPT_OVERRIDE_WHITELIST_THRESHOLD,
  INTERCEPT_OVERRIDE_WINDOW_MS,
  STORAGE_KEY_INTERCEPT_OVERRIDES,
} from '@/shared/constants.js';

interface InterceptOverrideRecord {
  readonly portalId: PortalId;
  readonly domain: string;
  readonly count: number;
  readonly firstOverride: number;
  readonly lastOverride: number;
}

type OverrideMap = Record<string, InterceptOverrideRecord>;

function recordKey(portalId: PortalId, domain: string): string {
  return `${portalId}:${domain.toLowerCase()}`;
}

async function readMap(): Promise<OverrideMap> {
  try {
    const r = await chrome.storage.local.get(STORAGE_KEY_INTERCEPT_OVERRIDES);
    const v = r[STORAGE_KEY_INTERCEPT_OVERRIDES];
    if (typeof v === 'object' && v !== null) {
      return v as OverrideMap;
    }
  } catch {
    /* fall through */
  }
  return {};
}

async function writeMap(map: OverrideMap): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY_INTERCEPT_OVERRIDES]: map });
}

function isWithinWindow(record: InterceptOverrideRecord, now: number): boolean {
  return now - record.lastOverride <= INTERCEPT_OVERRIDE_WINDOW_MS;
}

export async function recordOverride(portalId: PortalId, domain: string): Promise<void> {
  const key = recordKey(portalId, domain);
  const now = Date.now();
  const map = await readMap();
  const prior = map[key];
  // If the prior record is outside the rolling window, reset count to 1
  // rather than continuing to accumulate forever.
  const priorWithin = prior !== undefined && isWithinWindow(prior, now);
  const next: InterceptOverrideRecord = {
    portalId,
    domain: domain.toLowerCase(),
    count: priorWithin ? prior.count + 1 : 1,
    firstOverride: priorWithin ? prior.firstOverride : now,
    lastOverride: now,
  };
  await writeMap({ ...map, [key]: next });
}

export async function getOverrideCount(portalId: PortalId, domain: string): Promise<number> {
  const key = recordKey(portalId, domain);
  const now = Date.now();
  const map = await readMap();
  const prior = map[key];
  if (prior === undefined) return 0;
  if (!isWithinWindow(prior, now)) return 0;
  return prior.count;
}

export async function shouldPromptWhitelist(
  portalId: PortalId,
  domain: string,
): Promise<boolean> {
  const count = await getOverrideCount(portalId, domain);
  return count >= INTERCEPT_OVERRIDE_WHITELIST_THRESHOLD;
}

/** Test-only helper — clears in-memory caches if any are added later. */
export function __clearOverridesForTest(): void {
  /* no in-memory state currently; reserved for future per-process caching */
}
