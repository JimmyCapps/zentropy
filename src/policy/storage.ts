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
      // Issue #112 (N1) — compact tier summary for the popup Hunter findings
      // accordion. Full perChunkAnalysis stays in-memory only (it duplicates
      // probeResults already covered by `flags`); storage gets only counts.
      // Issue #145 — exclude `notScanned` padding entries from tier counts
      // (their `tierRouting` is reused from the trigger chunk and would
      // inflate UNCERTAIN/FLAGGED). Surface separately via `notScannedChunks`.
      hunterSummary:
        verdict.perChunkAnalysis === null
          ? null
          : {
              benign: verdict.perChunkAnalysis.filter((c) => !c.notScanned && c.tierRouting.decision === 'BENIGN').length,
              uncertain: verdict.perChunkAnalysis.filter((c) => !c.notScanned && c.tierRouting.decision === 'UNCERTAIN').length,
              flagged: verdict.perChunkAnalysis.filter((c) => !c.notScanned && c.tierRouting.decision === 'FLAGGED').length,
              totalChunks: verdict.perChunkAnalysis.length,
              skippedChunks: verdict.perChunkAnalysis.filter((c) => !c.notScanned && c.probeResults === null).length,
              notScannedChunks: verdict.perChunkAnalysis.filter((c) => c.notScanned === true).length,
            },
      // Issue #122 (N14d) — persist the rolled-up entity summary so the popup
      // can render counts + samples without rerunning extraction. Null when
      // no chunks produced packets (origin-skipped, all-BENIGN, or
      // no-activations pages).
      entitySummary: verdict.entitySummary,
      // Issue #126 (N7a) — additive optional response verdict from the
      // chat-portal observer path. Null on origins where no portal response
      // was observed. Page and response verdicts coexist on the same record.
      responseVerdict: verdict.responseVerdict,
      // Issue #131 (N7c) — additive optional thinking verdict from the
      // chat-portal thinking observer path. Null on origins where no
      // thinking block was observed. Page, response, and thinking verdicts
      // all coexist on the same per-origin record.
      thinkingVerdict: verdict.thinkingVerdict,
    },
  });

  log.info(`Persisted verdict for ${verdict.url}: ${verdict.status}`);
}

/**
 * Issue #126 (N7a) — page-scan rescan helper. Reads the prior verdict
 * for the same origin and preserves any `responseVerdict` it carried,
 * so a fresh page scan never clobbers a recently-captured chat-portal
 * response analysis.
 *
 * Used by `analyzeSnapshot` → `persistVerdict`. The response-analyzer
 * uses `setResponseVerdictForOrigin` (below) instead, which writes only
 * the responseVerdict slot without touching page-scan fields.
 *
 * Returns the merged verdict; the caller is responsible for persisting it.
 */
export async function mergeWithStoredVerdict(verdict: SecurityVerdict): Promise<SecurityVerdict> {
  const prior = await getVerdict(verdict.url);
  if (prior === null) return verdict;
  // Preserve any prior response/thinking verdicts when this rescan's
  // verdict didn't carry one of its own. Both fields evolve independently
  // — a page rescan should never clobber a recently-captured chat-portal
  // analysis on either axis. Each slot is preserved per-axis.
  return {
    ...verdict,
    responseVerdict: verdict.responseVerdict !== null ? verdict.responseVerdict : prior.responseVerdict,
    thinkingVerdict: verdict.thinkingVerdict !== null ? verdict.thinkingVerdict : prior.thinkingVerdict,
  };
}

/**
 * Issue #126 (N7a) — write only the `responseVerdict` slot for an origin,
 * preserving every page-scan field on the prior record byte-for-byte.
 * The response analyzer uses this so it never has to round-trip
 * page-scan fields (probeResults → flags etc.) through persistVerdict.
 *
 * Returns true when the prior record existed and was updated. Returns
 * false when no prior record existed; the caller (analyzer) then writes
 * a minimal page stub via persistVerdict to give the popup a record to
 * read on open.
 */
export async function setResponseVerdictForOrigin(
  url: string,
  responseVerdict: SecurityVerdict['responseVerdict'],
): Promise<boolean> {
  const key = originKey(url);
  const result = await chrome.storage.local.get(key);
  const stored = result[key];
  if (stored === null || stored === undefined) return false;
  await chrome.storage.local.set({
    [key]: { ...(stored as Record<string, unknown>), responseVerdict },
  });
  return true;
}

/**
 * Issue #131 (N7c) — write only the `thinkingVerdict` slot for an origin,
 * preserving every page-scan field and the responseVerdict slot on the
 * prior record byte-for-byte. The thinking analyzer uses this so it
 * never has to round-trip page-scan fields through persistVerdict.
 *
 * Returns true when the prior record existed and was updated. Returns
 * false when no prior record existed; the caller (analyzer) then writes
 * a minimal page stub via persistVerdict to give the popup a record to
 * read on open.
 */
export async function setThinkingVerdictForOrigin(
  url: string,
  thinkingVerdict: SecurityVerdict['thinkingVerdict'],
): Promise<boolean> {
  const key = originKey(url);
  const result = await chrome.storage.local.get(key);
  const stored = result[key];
  if (stored === null || stored === undefined) return false;
  await chrome.storage.local.set({
    [key]: { ...(stored as Record<string, unknown>), thinkingVerdict },
  });
  return true;
}

export async function getVerdict(url: string): Promise<SecurityVerdict | null> {
  const key = originKey(url);
  const result = await chrome.storage.local.get(key);
  const stored = result[key];
  if (stored === null || stored === undefined) return null;
  // Issue #117 — verdicts persisted before the stamp field was added
  // come back with `stamp === undefined`. Coalesce to null so callers
  // always observe the canonical SecurityVerdict shape.
  // Issue #112 — same migration for perChunkAnalysis: pre-#112 verdicts
  // come back with `perChunkAnalysis === undefined`.
  // Issue #126 — same migration for responseVerdict: pre-#126 verdicts
  // come back with `responseVerdict === undefined`. Coalesce condition
  // is strictly `=== undefined` (never `=== null`) so a migrated record
  // re-saved with a null field round-trips without re-coalescing.
  // Issue #131 — same migration for thinkingVerdict: pre-#131 verdicts
  // come back with `thinkingVerdict === undefined`.
  const restored = stored as SecurityVerdict & {
    stamp?: unknown;
    perChunkAnalysis?: unknown;
    responseVerdict?: unknown;
    thinkingVerdict?: unknown;
  };
  if (
    restored.stamp === undefined ||
    restored.perChunkAnalysis === undefined ||
    restored.responseVerdict === undefined ||
    restored.thinkingVerdict === undefined
  ) {
    return {
      ...(restored as SecurityVerdict),
      stamp: restored.stamp === undefined ? null : (restored.stamp as SecurityVerdict['stamp']),
      perChunkAnalysis: restored.perChunkAnalysis === undefined
        ? null
        : (restored.perChunkAnalysis as SecurityVerdict['perChunkAnalysis']),
      responseVerdict: restored.responseVerdict === undefined
        ? null
        : (restored.responseVerdict as SecurityVerdict['responseVerdict']),
      thinkingVerdict: restored.thinkingVerdict === undefined
        ? null
        : (restored.thinkingVerdict as SecurityVerdict['thinkingVerdict']),
    };
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
