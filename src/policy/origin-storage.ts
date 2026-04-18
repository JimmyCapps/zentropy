/**
 * chrome.storage.sync wrapper for per-origin scan overrides (issue #20).
 *
 * Thin layer that isolates chrome.* calls so origin-policy.ts stays pure
 * and unit-testable. All functions normalise the hostname to lowercase
 * before reading/writing so lookup is order-independent with the
 * resolver in origin-policy.ts.
 */
import { STORAGE_KEY_ORIGIN_OVERRIDES } from '@/shared/constants.js';
import type { OverrideMap, ScanAction } from './origin-policy.js';
import { extractHost } from './origin-policy.js';
import { createLogger } from '@/shared/logger.js';

const log = createLogger('OriginStorage');

export async function getOverrides(): Promise<OverrideMap> {
  const result = await chrome.storage.sync.get(STORAGE_KEY_ORIGIN_OVERRIDES);
  const raw = result[STORAGE_KEY_ORIGIN_OVERRIDES];
  if (raw === undefined || raw === null || typeof raw !== 'object') {
    return {};
  }
  // Defensive: coerce only valid entries so stale/garbage storage values
  // can't poison the resolver.
  const clean: Record<string, ScanAction> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === 'scan' || value === 'skip') {
      clean[key.toLowerCase()] = value;
    }
  }
  return clean;
}

export async function setOverride(origin: string, action: ScanAction): Promise<void> {
  const host = extractHost(origin);
  if (host === null) {
    log.warn(`Ignoring setOverride for unparseable origin: ${origin}`);
    return;
  }
  const current = await getOverrides();
  const next: Record<string, ScanAction> = { ...current, [host]: action };
  await chrome.storage.sync.set({ [STORAGE_KEY_ORIGIN_OVERRIDES]: next });
  log.info(`Override set: ${host} → ${action}`);
}

export async function clearOverride(origin: string): Promise<void> {
  const host = extractHost(origin);
  if (host === null) return;
  const current = await getOverrides();
  if (!(host in current)) return;
  const next: Record<string, ScanAction> = { ...current };
  delete next[host];
  await chrome.storage.sync.set({ [STORAGE_KEY_ORIGIN_OVERRIDES]: next });
  log.info(`Override cleared: ${host}`);
}
