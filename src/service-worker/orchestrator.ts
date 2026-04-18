import type { PageSnapshot } from '@/types/snapshot.js';
import type { ProbeResult, SecurityVerdict } from '@/types/verdict.js';
import type { RunProbesMessage, ProbeResultsMessage } from '@/types/messages.js';
import { MAX_CHUNK_CHARS, MAX_CHUNKS_PER_PAGE } from '@/shared/constants.js';
import { createLogger } from '@/shared/logger.js';
import { ensureOffscreenDocument } from './offscreen-manager.js';
import { connectOffscreenPort } from './keepalive.js';
import { analyzeBehavior } from '@/analysis/behavioral-analyzer.js';
import { evaluatePolicy } from '@/policy/engine.js';
import { persistVerdict } from '@/policy/storage.js';
import { resolveOriginPolicy } from '@/policy/origin-policy.js';
import { getOverrides } from '@/policy/origin-storage.js';

const log = createLogger('Orchestrator');

const pendingChunks = new Map<number, ProbeResult[][]>();

/**
 * Per-tab AbortController for in-flight analyses (issue #11).
 *
 * When a new `PAGE_SNAPSHOT` arrives for a tab that already has an analysis
 * in flight (typical: user refreshes Wikipedia mid-scan), we abort the
 * prior controller and start a fresh one. Without this, both analyses run
 * concurrently and the offscreen engine's single warm session sees
 * interleaved probe calls — exactly the failure mode that issue #11
 * observed on Wikipedia.
 *
 * The signal is checked between chunks (before dispatching each chunk to
 * the offscreen doc) rather than mid-generation. An already-running probe
 * call can't be cleanly aborted on the MLC path — WebLLM doesn't surface
 * a cancel primitive for `chat.completions.create`. So worst case the
 * currently-running chunk completes and its result is discarded; the
 * remaining chunks skip. On a 4-chunk page aborted after chunk 0 that
 * saves 3 chunks × 3 probes = 9 probe calls, bringing latency saving
 * to roughly 75% of the remaining work.
 */
const inFlightControllers = new Map<number, AbortController>();

/**
 * Error thrown by `analyzeSnapshot` when a prior in-flight controller
 * was aborted. Callers can differentiate real analysis errors from
 * supersede-by-newer-snapshot.
 */
export class AnalysisAbortedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'AnalysisAbortedError';
  }
}

function chunkText(text: string): readonly string[] {
  if (text.length <= MAX_CHUNK_CHARS) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_CHUNK_CHARS) {
      chunks.push(remaining);
      break;
    }

    let splitAt = remaining.lastIndexOf('. ', MAX_CHUNK_CHARS);
    if (splitAt === -1 || splitAt < MAX_CHUNK_CHARS * 0.5) {
      splitAt = remaining.lastIndexOf(' ', MAX_CHUNK_CHARS);
    }
    if (splitAt === -1) {
      splitAt = MAX_CHUNK_CHARS;
    } else {
      splitAt += 1;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  return chunks;
}

function buildAnalysisText(snapshot: PageSnapshot): string {
  const parts = [
    `[VISIBLE TEXT]\n${snapshot.visibleText}`,
    snapshot.hiddenText.length > 0 ? `\n[HIDDEN TEXT]\n${snapshot.hiddenText}` : '',
    snapshot.scriptFingerprints.length > 0
      ? `\n[SCRIPTS]\n${snapshot.scriptFingerprints.map((s) => s.preview).join('\n---\n')}`
      : '',
  ];
  return parts.filter(Boolean).join('\n');
}

/**
 * Build the synthetic "skipped by policy" verdict (issue #20). No probes run,
 * no offscreen document is touched. The verdict shape remains compatible with
 * the existing pipeline (toolbar icon, persisted storage, popup read path)
 * but carries a prefix on `analysisError` that the popup can detect to
 * distinguish policy-skip from engine-failure UNKNOWN.
 */
export function buildOriginSkippedVerdict(
  snapshot: PageSnapshot,
  matchedRule: string | null,
  reason: 'user_override_skip' | 'deny_list_match',
): SecurityVerdict {
  const errorSuffix = reason === 'user_override_skip'
    ? 'user override'
    : matchedRule !== null
      ? `default deny-list (${matchedRule})`
      : 'default deny-list';
  return {
    status: 'UNKNOWN',
    confidence: 0,
    totalScore: 0,
    probeResults: [],
    behavioralFlags: {
      roleDrift: false,
      exfiltrationIntent: false,
      instructionFollowing: false,
      hiddenContentAwareness: false,
    },
    mitigationsApplied: [],
    timestamp: Date.now(),
    url: snapshot.metadata.url,
    analysisError: `origin_denied: ${errorSuffix}`,
    canaryId: null,
  };
}

/**
 * Abort any in-flight analysis for `tabId`, returning a fresh
 * `AbortController` for the new run. Called at the start of every
 * `analyzeSnapshot` so a refresh mid-scan cancels the prior work. Issue #11.
 *
 * Exported for unit-testing the swap behaviour without touching the full
 * `analyzeSnapshot` pipeline.
 */
export function swapInFlightController(tabId: number): AbortController {
  const prior = inFlightControllers.get(tabId);
  if (prior !== undefined && !prior.signal.aborted) {
    prior.abort('superseded by newer PAGE_SNAPSHOT');
    log.info(`Aborted prior analysis for tab ${tabId} (superseded by newer snapshot)`);
  }
  const next = new AbortController();
  inFlightControllers.set(tabId, next);
  return next;
}

/**
 * Clear the in-flight controller for a tab once its analysis completes.
 * Called from the `finally` path of `analyzeSnapshot` regardless of
 * success / error / abort. Prevents the map from leaking stale
 * controllers for closed tabs.
 */
function releaseInFlightController(tabId: number, controller: AbortController): void {
  const current = inFlightControllers.get(tabId);
  // Only release if we're still the active controller — otherwise a
  // newer analysis has already replaced us and we shouldn't clear its
  // entry.
  if (current === controller) {
    inFlightControllers.delete(tabId);
  }
}

export async function analyzeSnapshot(
  tabId: number,
  snapshot: PageSnapshot,
): Promise<SecurityVerdict> {
  // Issue #20 — short-circuit before any ingestion or offscreen work if the
  // origin is on the deny-list or explicitly skipped by the user. Persisting
  // the synthetic verdict means the popup + toolbar icon still have a signal
  // for the tab; they can detect the `origin_denied:` prefix on
  // analysisError to render the right UI state.
  const overrides = await getOverrides();
  const policy = resolveOriginPolicy(snapshot.metadata.origin, overrides);
  if (policy.action === 'skip') {
    log.info(
      `Skipping analysis for ${snapshot.metadata.url} (${policy.reason}${policy.matchedRule ? `: ${policy.matchedRule}` : ''})`,
    );
    // `user_override_skip` and `deny_list_match` are the only two reasons
    // that resolve to 'skip'; the type system guarantees this but narrow
    // explicitly so buildOriginSkippedVerdict gets the right literal type.
    const reason =
      policy.reason === 'user_override_skip' ? 'user_override_skip' : 'deny_list_match';
    const verdict = buildOriginSkippedVerdict(snapshot, policy.matchedRule, reason);
    await persistVerdict(verdict);
    return verdict;
  }

  // Issue #11 — abort any in-flight analysis for this tab before starting
  // the new one. Takes over the controller slot atomically.
  const controller = swapInFlightController(tabId);

  log.info(`Starting analysis for ${snapshot.metadata.url}`);

  await ensureOffscreenDocument();
  connectOffscreenPort();

  const fullText = buildAnalysisText(snapshot);
  const allChunks = chunkText(fullText);

  // Phase 4 Stage 4B — enforce MAX_CHUNKS_PER_PAGE cap to bound latency and
  // avoid the sustained-engine-use failure mode. Truncation is recorded via
  // the chunk-count-capped analysisError so downstream analysis sees the
  // signal rather than silently dropping it.
  const capped = allChunks.length > MAX_CHUNKS_PER_PAGE;
  const chunks = capped ? allChunks.slice(0, MAX_CHUNKS_PER_PAGE) : allChunks;

  if (capped) {
    log.warn(`Page produced ${allChunks.length} chunks; capped at ${MAX_CHUNKS_PER_PAGE}`);
  }
  log.info(`Split into ${chunks.length} chunk(s)${capped ? ` (capped from ${allChunks.length})` : ''}`);

  pendingChunks.set(tabId, []);

  try {
    // Phase 4 Stage 4B — serialize chunks. The previous Promise.all fanout
    // issued all RUN_PROBES messages concurrently into a single MLC engine,
    // which degraded after ~6 cumulative calls (Track B Stage B4 writeup).
    // Sequential awaits let the warm engine process one chunk at a time,
    // eliminating the multi-chunk variant of the false-negative bug.
    const allChunkResults: (readonly ProbeResult[])[] = [];
    let canaryId: string | null = null;
    for (let index = 0; index < chunks.length; index += 1) {
      // Issue #11 — check the signal before dispatching each chunk. A new
      // PAGE_SNAPSHOT arriving mid-analysis flips this flag; reject rather
      // than dispatching wasted probe calls into the offscreen doc.
      if (controller.signal.aborted) {
        const reason = typeof controller.signal.reason === 'string'
          ? controller.signal.reason
          : 'superseded by newer PAGE_SNAPSHOT';
        log.info(`Analysis for ${snapshot.metadata.url} aborted between chunks (${reason})`);
        throw new AnalysisAbortedError(reason);
      }
      const chunk = chunks[index]!;
      const { results, canaryId: chunkCanaryId } = await runChunkProbes({
        tabId,
        chunk,
        chunkIndex: index,
        totalChunks: chunks.length,
        url: snapshot.metadata.url,
        origin: snapshot.metadata.origin,
      });
      allChunkResults.push(results);
      // Prefer the first non-null canaryId we see. All chunks in a single
      // analysis run share the same offscreen engine, so they should all
      // report the same id; defensive merge just in case.
      if (canaryId === null && chunkCanaryId !== null) {
        canaryId = chunkCanaryId;
      }
    }

    const mergedResults = mergeProbeResults(allChunkResults);
    const aggregateError = mergeErrors(
      computeAggregateError(mergedResults),
      capped ? `chunk_count_capped (${allChunks.length} chunks → kept first ${MAX_CHUNKS_PER_PAGE})` : null,
    );
    const behavioralFlags = analyzeBehavior(mergedResults);
    const verdict = evaluatePolicy(mergedResults, behavioralFlags, snapshot.metadata.url, aggregateError, canaryId);

    await persistVerdict(verdict);

    log.info(`Verdict for ${snapshot.metadata.url}: ${verdict.status} (${verdict.confidence})${verdict.analysisError ? ` [analysisError: ${verdict.analysisError}]` : ''}`);

    return verdict;
  } finally {
    pendingChunks.delete(tabId);
    releaseInFlightController(tabId, controller);
  }
}

interface RunChunkArgs {
  readonly tabId: number;
  readonly chunk: string;
  readonly chunkIndex: number;
  readonly totalChunks: number;
  readonly url: string;
  readonly origin: string;
}

interface ChunkProbeResult {
  readonly results: readonly ProbeResult[];
  readonly canaryId: string | null;
}

function runChunkProbes(args: RunChunkArgs): Promise<ChunkProbeResult> {
  return new Promise((resolve) => {
    const handler = (message: ProbeResultsMessage) => {
      if (
        message.type === 'PROBE_RESULTS' &&
        message.tabId === args.tabId &&
        message.chunkIndex === args.chunkIndex
      ) {
        chrome.runtime.onMessage.removeListener(handler);
        resolve({ results: message.results, canaryId: message.canaryId ?? null });
      }
    };
    chrome.runtime.onMessage.addListener(handler);

    const msg: RunProbesMessage = {
      type: 'RUN_PROBES',
      tabId: args.tabId,
      chunk: args.chunk,
      chunkIndex: args.chunkIndex,
      totalChunks: args.totalChunks,
      metadata: { url: args.url, origin: args.origin },
    };
    chrome.runtime.sendMessage(msg);
  });
}

/**
 * Exported for unit testing. Combines the probe-aggregate error (from
 * computeAggregateError) with the orchestrator-level chunk-cap error into
 * a single analysisError string. Null inputs drop out; two non-null inputs
 * are joined by "; " so both signals are visible downstream.
 */
export function mergeErrors(probeError: string | null, chunkError: string | null): string | null {
  if (probeError === null) return chunkError;
  if (chunkError === null) return probeError;
  return `${probeError}; ${chunkError}`;
}

function mergeProbeResults(chunkResults: readonly (readonly ProbeResult[])[]): readonly ProbeResult[] {
  const byProbe = new Map<string, ProbeResult>();

  for (const results of chunkResults) {
    for (const result of results) {
      const existing = byProbe.get(result.probeName);
      // Prefer the chunk-run with real output over one that errored: a probe
      // that succeeded on any chunk is treated as succeeded overall. When both
      // have real output, keep the highest-scoring chunk (pre-Phase 4 behavior).
      if (existing === undefined) {
        byProbe.set(result.probeName, { ...result, flags: [...result.flags] });
        continue;
      }

      const existingErrored = existing.errorMessage !== null;
      const resultErrored = result.errorMessage !== null;

      // Prefer non-errored over errored.
      if (existingErrored && !resultErrored) {
        byProbe.set(result.probeName, { ...result, flags: [...result.flags] });
        continue;
      }
      if (!existingErrored && resultErrored) {
        continue;
      }

      // Both errored or both succeeded: fall back to max-score merge.
      if (result.score > existing.score) {
        byProbe.set(result.probeName, {
          ...result,
          flags: [...new Set([...existing.flags, ...result.flags])],
        });
      } else {
        byProbe.set(result.probeName, {
          ...existing,
          flags: [...new Set([...existing.flags, ...result.flags])],
        });
      }
    }
  }

  return [...byProbe.values()];
}

function computeAggregateError(mergedResults: readonly ProbeResult[]): string | null {
  if (mergedResults.length === 0) return null;
  const erroredResults = mergedResults.filter((r) => r.errorMessage !== null);
  if (erroredResults.length === 0) return null;
  if (erroredResults.length === mergedResults.length) {
    // Every probe errored across every chunk → surface first error verbatim.
    return erroredResults[0]!.errorMessage;
  }
  // Partial failure: note which probes errored but keep the score-derived verdict.
  const names = erroredResults.map((r) => r.probeName).join(', ');
  return `partial probe failure: ${names}`;
}
