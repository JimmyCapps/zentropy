import type { SecurityVerdict } from '@/types/verdict.js';
import { STORAGE_KEY_PREFIX } from '@/shared/constants.js';
import { createLogger } from '@/shared/logger.js';

const log = createLogger('Storage');

function originKey(url: string): string {
  try {
    return STORAGE_KEY_PREFIX + new URL(url).origin;
  } catch {
    return STORAGE_KEY_PREFIX + url;
  }
}

export async function persistVerdict(verdict: SecurityVerdict): Promise<void> {
  const key = originKey(verdict.url);

  await chrome.storage.local.set({
    [key]: {
      status: verdict.status,
      confidence: verdict.confidence,
      totalScore: verdict.totalScore,
      timestamp: verdict.timestamp,
      url: verdict.url,
      flags: verdict.probeResults.flatMap((r) => r.flags),
      behavioralFlags: verdict.behavioralFlags,
      // Phase 4 Stage 4A — surface analysisError on the persisted verdict so
      // the popup, window globals, and Track B harness can distinguish UNKNOWN
      // from CLEAN and see the underlying engine-failure reason.
      analysisError: verdict.analysisError,
      // Phase 4 Stage 4D.3 — record which canary produced this verdict so the
      // popup can display it and detect user-selection vs actual divergence.
      canaryId: verdict.canaryId,
      // Issue #117 (N13) — persist the page stamp so the popup can read
      // it on open and call VERIFY_STAMP if the LLM's returned stamp
      // matches. Null on origin-skipped or stamp-failure verdicts.
      stamp: verdict.stamp,
    },
  });

  log.info(`Persisted verdict for ${verdict.url}: ${verdict.status}`);
}

export async function getVerdict(url: string): Promise<SecurityVerdict | null> {
  const key = originKey(url);
  const result = await chrome.storage.local.get(key);
  const stored = result[key];
  if (stored === null || stored === undefined) return null;
  // Issue #117 — verdicts persisted before the stamp field was added
  // come back with `stamp === undefined`. Coalesce to null so callers
  // always observe the canonical SecurityVerdict shape.
  const restored = stored as SecurityVerdict & { stamp?: unknown };
  if (restored.stamp === undefined) {
    return { ...restored, stamp: null };
  }
  return restored as SecurityVerdict;
}

export async function getAllVerdicts(): Promise<Record<string, unknown>> {
  const all = await chrome.storage.local.get(null);
  const verdicts: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(STORAGE_KEY_PREFIX)) {
      verdicts[key.slice(STORAGE_KEY_PREFIX.length)] = value;
    }
  }

  return verdicts;
}

export async function clearVerdicts(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(STORAGE_KEY_PREFIX));
  await chrome.storage.local.remove(keys);
  log.info(`Cleared ${keys.length} verdict(s)`);
}
