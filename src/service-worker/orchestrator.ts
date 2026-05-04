import type { PageSnapshot } from '@/types/snapshot.js';
import type { ProbeResult, SecurityVerdict, WebGPUAdapterMode, ChunkAnalysis } from '@/types/verdict.js';
import type { PageStamp } from '@/types/page-stamp.js';
import type { RunProbesMessage, ProbeResultsMessage } from '@/types/messages.js';
import {
  MAX_PROBES_PER_PAGE,
  EARLY_EXIT_ANALYSIS_ERROR,
  HUNTER_RULES_VERSION,
  CACHE_SCHEMA_VERSION,
  SUPPORTED_PROBE_LANGUAGES,
  CANARY_CATALOG,
  effectiveChunkTokenBudget,
} from '@/shared/constants.js';
import { chunkText } from '@/hunters/hawk/chunking.js';
import { detectLanguage } from '@/hunters/hawk/language-router.js';
import { runHunters } from '@/hunters/hunt-runner.js';
import { spiderHunter } from '@/hunters/spider/index.js';
import { hawkHunter } from '@/hunters/hawk/index.js';
import { embeddingsHunter } from './embeddings-bootstrap.js';
import { createLogger } from '@/shared/logger.js';
import { ensureOffscreenDocument } from './offscreen-manager.js';
import { connectOffscreenPort } from './keepalive.js';
import { analyzeBehavior } from '@/analysis/behavioral-analyzer.js';
import { evaluatePolicy } from '@/policy/engine.js';
import { persistVerdict } from '@/policy/storage.js';
import { resolveOriginPolicy } from '@/policy/origin-policy.js';
import { getOverrides } from '@/policy/origin-storage.js';
import { ensureInstallSecret } from '@/shared/install-secret.js';
import { generateStamp } from './stamp.js';
import { routeChunk } from './tier-router.js';
import { buildEvidencePackets } from '@/probes/evidence-builder.js';
import {
  lookupScan,
  writeScan,
  recordCacheHit,
  recordCacheMiss,
  getEngineFingerprint,
} from './scan-cache.js';
import { prepareCachedReplay } from './cache-replay.js';
import type { CachedScan, CachedChunk } from '@/types/scan-cache.js';
import { runNerForChunk } from './ner-router.js';
import { mergeNerIntoPackets } from '@/hunters/ner/merge-ner.js';
import type { EvidencePacket } from '@/probes/base-probe.js';
import type { Entity } from '@/hunters/ner/types.js';
import { rollupEntities } from '@/hunters/ner/rollup.js';
import { lookupRegistry } from '@/registry/lookup.js';
import type { EmbeddingsFinding } from '@/hunters/embeddings/types.js';
import { buildEmbeddingsFinding } from '@/hunters/embeddings/finding.js';

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
 * How many tabs currently have an in-flight analysis. Used by the
 * external status-ping handler (harness tells the user when the
 * extension is busy so they can choose whether to run a sweep).
 */
export function getInFlightCount(): number {
  return inFlightControllers.size;
}

export function getInFlightTabIds(): ReadonlyArray<number> {
  return [...inFlightControllers.keys()];
}

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
    webgpuAdapterMode: null,
    // Issue #117 — origin-skipped verdicts are deliberately unstamped.
    // The stamp attests to "we scanned this URL," contradicting "we
    // deliberately skipped." Structural rather than runtime-guarded.
    stamp: null,
    // Issue #112 — origin-skipped scans never entered the chunk loop, so
    // there are no per-chunk tier records to publish.
    perChunkAnalysis: null,
    // Issue #122 — origin-skipped scans never built evidence packets, so
    // no entities were extracted.
    entitySummary: null,
    // Issue #126 — origin-skipped origins never run portal observers; the
    // response-analyzer path is mutually exclusive with the page-skip path.
    responseVerdict: null,
    // Issue #131 — same exclusivity: origin-skipped pages never observe a
    // thinking block.
    thinkingVerdict: null,
    embeddingsFindings: null,
  };
}

/**
 * Build the synthetic "registry-match" verdict (SR-F / registry-#51).
 * The signed site-structure registry confirmed the snapshot's static
 * frame zones (header / nav / footer etc.) byte-match the committed
 * fingerprints for this origin — meaning the page chrome is the
 * known-clean baseline and no probe pipeline needs to run. The CLEAN
 * verdict carries `analysisError: 'registry_match: <zoneIds>'` as a
 * metadata channel so the popup + SR-G telemetry can attribute hits
 * per-zone. Stamp is null for the same reason as origin-skip:
 * we did not actually probe the page; the attestation contract on
 * stamps is "we scanned this URL", which a registry-skip does not
 * satisfy.
 */
export function buildRegistryMatchVerdict(
  snapshot: PageSnapshot,
  matchedZoneIds: readonly string[],
): SecurityVerdict {
  return {
    status: 'CLEAN',
    confidence: 100,
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
    analysisError: `registry_match: ${matchedZoneIds.join(',')}`,
    canaryId: null,
    webgpuAdapterMode: null,
    stamp: null,
    perChunkAnalysis: null,
    entitySummary: null,
    responseVerdict: null,
    thinkingVerdict: null,
    embeddingsFindings: null,
  };
}

/**
 * Build the synthetic "skipped because page language is outside the
 * probe stack's supported set" verdict (issue #48). Mirrors
 * buildOriginSkippedVerdict so popup/storage/icon paths render the
 * skip cleanly rather than as engine-failure UNKNOWN. The
 * `unsupported_language:` analysisError prefix is the contract popup
 * uses to render an informational message rather than the red error
 * card.
 */
export function buildUnsupportedLanguageVerdict(
  snapshot: PageSnapshot,
  detectedLang: string,
): SecurityVerdict {
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
    analysisError: `unsupported_language: ${detectedLang}`,
    canaryId: null,
    webgpuAdapterMode: null,
    stamp: null,
    perChunkAnalysis: null,
    entitySummary: null,
    responseVerdict: null,
    thinkingVerdict: null,
    embeddingsFindings: null,
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
  // SR-F (registry-#51) — content-blind static-frame registry skip. Per
  // RFC §Q7 + §Q8, the registry runs FIRST: ahead of #20 origin-policy
  // (so opted-out origins still get a CLEAN registry-match when their
  // chrome is unmodified) and ahead of the #127 page-scan cache (so a
  // registry hit avoids the IndexedDB lookup entirely). lookupRegistry
  // returns matched=false on every failure mode (registry not loaded,
  // origin missing, fingerprint drift, partial-zone match, empty
  // pageHtml) so the orchestrator falls through to the existing
  // pipeline — RFC §Q5 fail-safe.
  const registryHit = await lookupRegistry(
    snapshot.metadata.origin,
    snapshot.pageHtml ?? '',
  ).catch(() => null);
  if (registryHit !== null && registryHit.matched) {
    log.info(
      `Registry match for ${snapshot.metadata.url}: zones=${registryHit.zoneIds.join(',')} — skipping analysis`,
    );
    const verdict = buildRegistryMatchVerdict(snapshot, registryHit.zoneIds);
    await persistVerdict(verdict);
    return verdict;
  }

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

  // Issue #48 — pre-flight language gate. Probes are English-only;
  // running them on non-English text produces NotSupportedError
  // cascades (UNKNOWN with confusing engine-failure messages). Mirror
  // the origin-skip path: build a synthetic 'unsupported_language'
  // verdict and persist before any chunking / probe work. `'und'`
  // (returned for short text or detector failure) proceeds — only an
  // affirmatively-detected non-English lang triggers the skip.
  const langResult = await detectLanguage(fullText).catch(
    () => ({ lang: 'und' as const, confidence: 0, source: 'chrome-api' as const }),
  );
  if (
    langResult.lang !== 'und' &&
    !SUPPORTED_PROBE_LANGUAGES.includes(langResult.lang as typeof SUPPORTED_PROBE_LANGUAGES[number])
  ) {
    log.info(
      `Skipping analysis for ${snapshot.metadata.url} (unsupported language: ${langResult.lang})`,
    );
    const verdict = buildUnsupportedLanguageVerdict(snapshot, langResult.lang);
    await persistVerdict(verdict);
    releaseInFlightController(tabId, controller);
    return verdict;
  }

  // Issue #25 — size chunks for the loaded canary's context window instead
  // of the historical Gemma-only cap. `getEngineFingerprint()` returns the
  // user's preference (or 'auto' when unresolved); 'auto' falls back to the
  // conservative default budget. Hoisted ahead of chunking so the same id
  // can be reused for the cache lookup below.
  const engineFingerprint = await getEngineFingerprint();
  const canaryContextWindow =
    engineFingerprint !== 'auto' ? CANARY_CATALOG[engineFingerprint].contextWindow : null;
  const tokenBudget = effectiveChunkTokenBudget(canaryContextWindow);

  // Issue #210 — chunk-split is uncapped. Hunters run on every chunk
  // (cheap, deterministic) and feed the #127 IndexedDB cache so revisits
  // can dedupe across the whole page. Only LLM probe dispatch is bounded
  // (see MAX_PROBES_PER_PAGE budget enforced inside the chunk loop below).
  const chunks = await chunkText(fullText, { tokenBudget });
  log.info(`Split into ${chunks.length} chunk(s)`);
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i]!;
    log.debug(`chunk_created: index=${i}, size=${chunk.end - chunk.start}`);
  }

  pendingChunks.set(tabId, []);

  // Issue #127 (N11) — consult page-scan cache before doing any work.
  // chunkText already produced stable contentHash per chunk; lookupScan
  // checks schema/hunter-rules/llm-model versions and TTL. A hit can
  // skip hunters/NER/probes entirely on covered chunks. The lookup
  // failure mode is benign — caches are an optimization, not
  // correctness — so swallow errors and proceed as if missed.
  let cachedScan: CachedScan | null = null;
  try {
    cachedScan = await lookupScan(snapshot.metadata.url, {
      hunterRulesVersion: HUNTER_RULES_VERSION,
      llmModelId: engineFingerprint,
    });
  } catch (err) {
    log.warn('scan-cache lookup failed; proceeding without cache', err);
  }
  const replay = cachedScan === null ? null : prepareCachedReplay(chunks, cachedScan);
  const hitSet = new Set(replay?.hitIndices ?? []);
  const fullCacheHit =
    replay !== null && replay.missIndices.length === 0 && chunks.length > 0;
  if (fullCacheHit) {
    log.info(`Cache hit (full): bypassing ${chunks.length} chunk(s) of probe work`);
    await recordCacheHit().catch(() => undefined);
  } else if (hitSet.size > 0) {
    log.info(`Cache hit (partial): ${hitSet.size}/${chunks.length} chunks reused from cache`);
    await recordCacheHit().catch(() => undefined);
  } else {
    await recordCacheMiss().catch(() => undefined);
  }

  try {
    // Phase 4 Stage 4B — serialize chunks. The previous Promise.all fanout
    // issued all RUN_PROBES messages concurrently into a single MLC engine,
    // which degraded after ~6 cumulative calls (Track B Stage B4 writeup).
    // Sequential awaits let the warm engine process one chunk at a time,
    // eliminating the multi-chunk variant of the false-negative bug.
    const allChunkResults: (readonly ProbeResult[])[] = [];
    const perChunkAnalysis: ChunkAnalysis[] = [];
    // Issue #122 (N14d) — accumulate entities across every chunk's
    // evidencePackets so the verdict can carry a rolled-up EntitySummary.
    const allEntities: Entity[] = [];
    // Issue #129 Stage 5 — collect popup-render-friendly summaries of every
    // chunk's embeddings-Hunter match. Empty after all chunks → null on the
    // verdict so the popup renders the "no embeddings matches" placeholder
    // (preserving the Phase 2 byte-locked baseline contract: with the index
    // empty / hunter no-op, no chunks match and the field stays null).
    const embeddingsFindingsAcc: EmbeddingsFinding[] = [];
    let canaryId: string | null = null;
    let webgpuAdapterMode: WebGPUAdapterMode | null = null;
    // Issue #145 — flipped when a chunk's HuntReport.shouldSkipProbes is true,
    // signalling that subsequent chunks were padded out and the chunk loop
    // exited early. Folded into aggregateError so popup/storage callers can
    // distinguish early-exit from a normal completion.
    // Issue #127 — preserved across cache replays: a fully-hit early-exited
    // page replays as earlyExited=true so EARLY_EXIT_ANALYSIS_ERROR carries
    // forward identically.
    let earlyExited = fullCacheHit && cachedScan !== null ? cachedScan.earlyExited : false;
    // Issue #210 — track probe-dispatch budget. BENIGN chunks and cache
    // hits don't consume the budget; only fresh non-BENIGN chunks that
    // actually call runChunkProbes do. When the budget is exhausted,
    // remaining non-BENIGN fresh chunks are marked notScanned: true and
    // probe_count_capped is folded into the verdict's aggregateError.
    let probesDispatched = 0;
    let probeBudgetExceededCount = 0;
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

      // Issue #127 (N11) — cache replay shortcut. A hit means we have
      // cached probeResults + tierRouting for this chunk; reuse them and
      // skip hunters/NER/probes entirely. mergeProbeResults treats an
      // empty array (BENIGN cached chunks) as a no-op contribution, so
      // the aggregate stays consistent with the fresh-scan path.
      if (replay !== null && hitSet.has(index)) {
        const cachedAnalysis = replay.replayedPerChunkAnalysis[index];
        const cachedResults = replay.replayedChunkResults[index];
        if (cachedAnalysis !== undefined && cachedResults !== undefined) {
          allChunkResults.push(cachedResults);
          perChunkAnalysis.push(cachedAnalysis);
          continue;
        }
        // Defensive: cachedAnalysis missing despite hitSet membership.
        // Fall through to the fresh-pipeline path so the chunk still
        // gets analyzed; do not fail the whole verdict.
        log.warn(`Cache replay slot ${index} marked hit but missing data; falling through`);
      }

      const chunk = chunks[index]!.text;
      const contentHash = chunks[index]!.contentHash;

      // Issue #112 (N1) — Hunters first; k=2 router gates the LLM tier.
      // BENIGN chunks skip probes entirely. Hunter aggregateError → UNCERTAIN
      // (fail-open) so a hunter crash never silently suppresses detection.
      // Issue #129 Stage 4 — embeddingsHunter is the SW-side bootstrap proxy
      // (`embeddings-bootstrap.ts`). On first SW wakeup it loads the
      // populated corpus from `dist/data/injection-corpus.json`, builds the
      // in-memory cosine-similarity index, and wires the `EMBED_TEXT`
      // offscreen bridge as the chunk embed function. Until the bootstrap
      // resolves the proxy returns a clean (no-op) result so the Phase 2
      // byte-locked baseline (162 rows in inbrowser-results.json) stays
      // byte-identical during the cold-load window. Bootstrap failure
      // (missing corpus / verify error / fetch failure) falls back to the
      // Stage 3 no-op hunter — the baseline contract is preserved on every
      // failure path.
      const huntReport = await runHunters(
        [spiderHunter, hawkHunter, embeddingsHunter],
        chunk,
      );
      // Issue #129 Stage 5 — surface the embeddings-Hunter signal. Pure
      // projection over the existing HunterResult; no scoring/routing
      // change here (tier routing still consumes huntReport unchanged).
      for (const result of huntReport.results) {
        const finding = buildEmbeddingsFinding(index, result);
        if (finding !== null) embeddingsFindingsAcc.push(finding);
      }
      const tierRouting = routeChunk(huntReport);
      log.info(
        `Chunk ${index}: tier=${tierRouting.decision} (primitives=${tierRouting.primitiveCount})`,
      );

      if (tierRouting.decision === 'BENIGN') {
        // Empty per-chunk results contributes nothing in mergeProbeResults;
        // the all-BENIGN page produces a CLEAN verdict via evaluatePolicy.
        allChunkResults.push([]);
        perChunkAnalysis.push({ index, contentHash, tierRouting, probeResults: null });
        continue;
      }

      // Issue #210 — non-BENIGN chunk needs LLM probes. Enforce the
      // per-page budget here (NOT at chunk-split — Phase 4 Stage 4B.1's
      // original cap site, which blinded #127's chunk-cache layer on
      // chunks ≥5 of long pages). Chunks that exceed the budget are
      // marked notScanned: true with their real Hunter-derived
      // tierRouting preserved (cf. early-exit's pad which reuses the
      // trigger chunk's tierRouting because Hunters never ran on padded
      // chunks; here Hunters DID run, so the routing is honest).
      if (probesDispatched >= MAX_PROBES_PER_PAGE) {
        probeBudgetExceededCount += 1;
        allChunkResults.push([]);
        perChunkAnalysis.push({
          index,
          contentHash,
          tierRouting,
          probeResults: null,
          notScanned: true,
        });
        continue;
      }

      // Issue #118 (N12) — build evidence packets from this chunk's hunt
      // report. Empty array → probe-runner falls through to the existing
      // 3-probe stack (Hawk-only chunk-level signal). Non-empty → runs
      // evidence-review per packet + summarization.
      const regexPackets = buildEvidencePackets(chunks[index]!, huntReport);

      // Issue #156 — additive freeform NER over the chunk text. One RPC per
      // chunk (sha256-cached in ner-router so repeats no-op). The merge
      // pass intersects chunk-absolute NER spans with each packet's
      // absolute window (flaggedAbsStart + before/flagged/after lengths)
      // and re-bases to packet-relative offsets so evidence-review and
      // popup rendering see uniform span semantics with regex entities.
      // Skip the RPC entirely when there are no packets to enrich; benign
      // chunks short-circuit to the existing CLEAN path.
      let evidencePackets = regexPackets;
      if (regexPackets.length > 0) {
        try {
          const nerEntities = await runNerForChunk(chunks[index]!.text, 0);
          evidencePackets = mergeNerIntoPackets(regexPackets, nerEntities);
        } catch (err) {
          log.warn('NER merge failed; proceeding with regex-only entities', err);
        }
      }

      for (const packet of evidencePackets) {
        for (const entity of packet.entities) {
          allEntities.push(entity);
        }
      }

      const { results, canaryId: chunkCanaryId, webgpuAdapterMode: chunkAdapterMode } = await runChunkProbes({
        tabId,
        chunk,
        chunkIndex: index,
        totalChunks: chunks.length,
        url: snapshot.metadata.url,
        origin: snapshot.metadata.origin,
        evidencePackets,
      });
      probesDispatched += 1;
      allChunkResults.push(results);
      perChunkAnalysis.push({ index, contentHash, tierRouting, probeResults: results });
      // Prefer the first non-null canaryId we see. All chunks in a single
      // analysis run share the same offscreen engine, so they should all
      // report the same id; defensive merge just in case.
      if (canaryId === null && chunkCanaryId !== null) {
        canaryId = chunkCanaryId;
      }
      // Issue #59 — same first-non-null merge for adapter mode. All chunks
      // share the same WebGPU introspection result since initEngine() runs
      // once per offscreen lifetime.
      if (webgpuAdapterMode === null && chunkAdapterMode !== null) {
        webgpuAdapterMode = chunkAdapterMode;
      }

      // Issue #145 — page-level early-exit. The Hunter pre-pass on this chunk
      // hit compromise-band confidence+score (HuntReport.shouldSkipProbes);
      // any further LLM probing is by definition redundant. Pad the remaining
      // chunks with NOT_SCANNED entries so perChunkAnalysis.length stays
      // honest (the existing length === chunks.length invariant), then break.
      if (huntReport.shouldSkipProbes) {
        const padded = chunks.length - index - 1;
        for (let pad = index + 1; pad < chunks.length; pad += 1) {
          // Issue #127 — record the real contentHash on padded entries so a
          // future revisit can hash-match the unscanned chunks and replay
          // the early-exit verdict instead of falling back to a partial-cache
          // miss that would re-scan chunks the original run intentionally
          // skipped.
          perChunkAnalysis.push({
            index: pad,
            contentHash: chunks[pad]!.contentHash,
            tierRouting,
            probeResults: null,
            notScanned: true,
          });
        }
        earlyExited = true;
        log.info(
          `Chunk ${index}: shouldSkipProbes — early-exit, padded ${padded} chunk(s) as NOT_SCANNED`,
        );
        break;
      }
    }

    const mergedResults = mergeProbeResults(allChunkResults);
    // Issue #210 — replace `chunk_count_capped` (Phase 4 Stage 4B.1, fired
    // at chunk-split) with `probe_count_capped` (fires at probe-dispatch
    // when SUSPICIOUS chunks are dropped because the per-page LLM budget
    // was exhausted). A page with >MAX_PROBES_PER_PAGE chunks where all
    // chunks are BENIGN no longer carries the legacy "capped" label —
    // Hunters covered the full page and the verdict reflects that.
    if (probeBudgetExceededCount > 0) {
      log.warn(
        `Probe budget exhausted: ${probeBudgetExceededCount} non-BENIGN chunk(s) marked notScanned (budget=${MAX_PROBES_PER_PAGE})`,
      );
    }
    const aggregateError = mergeErrors(
      mergeErrors(
        computeAggregateError(mergedResults),
        probeBudgetExceededCount > 0
          ? `probe_count_capped (${probeBudgetExceededCount} flagged chunk(s) skipped; budget=${MAX_PROBES_PER_PAGE})`
          : null,
      ),
      earlyExited ? EARLY_EXIT_ANALYSIS_ERROR : null,
    );
    const behavioralFlags = analyzeBehavior(mergedResults);
    const verdict0 = evaluatePolicy(
      mergedResults,
      behavioralFlags,
      snapshot.metadata.url,
      aggregateError,
      canaryId,
      webgpuAdapterMode,
    );

    // Issue #117 (N13) — stamp the verdict with an HMAC-bound page
    // stamp. Origin-skipped verdicts already short-circuited above with
    // stamp: null in their literal; here we attempt to stamp every
    // post-evaluatePolicy verdict (engine-failure UNKNOWN included —
    // the scan was attempted, the stamp attests to that). If the
    // install secret can't be loaded or the HMAC compute throws, fall
    // back to stamp: null and surface via the logger rather than
    // failing the whole verdict.
    let stamp: PageStamp | null = null;
    try {
      const secret = await ensureInstallSecret();
      stamp = await generateStamp(verdict0, secret);
    } catch (err) {
      log.error('Failed to generate page stamp', err);
    }
    const entitySummary = allEntities.length > 0 ? rollupEntities(allEntities) : null;
    const embeddingsFindings =
      embeddingsFindingsAcc.length > 0 ? embeddingsFindingsAcc : null;
    const verdict: SecurityVerdict = {
      ...verdict0,
      stamp,
      perChunkAnalysis,
      entitySummary,
      embeddingsFindings,
    };

    await persistVerdict(verdict);

    // Issue #127 (N11) — write the per-chunk results back to the cache
    // so the next revisit can replay them. Failures here are non-fatal;
    // the verdict is already persisted via persistVerdict above. We
    // re-read the engine fingerprint at write time in case the user
    // changed canary preference mid-scan (rare, but the version-mismatch
    // invariant should hold across writes too).
    try {
      const writeFingerprint = await getEngineFingerprint();
      const cachedChunks: CachedChunk[] = perChunkAnalysis.map((a) => {
        const base: CachedChunk = a.notScanned
          ? {
              contentHash: a.contentHash,
              tierRouting: a.tierRouting,
              probeResults: a.probeResults,
              notScanned: true,
            }
          : {
              contentHash: a.contentHash,
              tierRouting: a.tierRouting,
              probeResults: a.probeResults,
            };
        return base;
      });
      const newCache: CachedScan = {
        schemaVersion: CACHE_SCHEMA_VERSION,
        hunterRulesVersion: HUNTER_RULES_VERSION,
        llmModelId: writeFingerprint,
        url: snapshot.metadata.url,
        fetchedAt: Date.now(),
        chunks: cachedChunks,
        earlyExited,
        entitySummary,
        sizeBytes: 0, // recomputed by writeScan
      };
      await writeScan(newCache);
    } catch (err) {
      log.warn('scan-cache write failed; verdict persisted but cache not updated', err);
    }

    log.info(`Verdict for ${snapshot.metadata.url}: ${verdict.status} (${verdict.confidence})${verdict.analysisError ? ` [analysisError: ${verdict.analysisError}]` : ''}`);

    // Issue #226 — log verdict emission for observability pipeline
    log.debug(`verdict_emitted: status=${verdict.status}, confidence=${verdict.confidence.toFixed(2)}, probeCount=${verdict.probeResults.length}`);

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
  readonly evidencePackets: readonly EvidencePacket[];
}

interface ChunkProbeResult {
  readonly results: readonly ProbeResult[];
  readonly canaryId: string | null;
  readonly webgpuAdapterMode: WebGPUAdapterMode | null;
}

// Exported so integration tests can vi.spyOn this dispatch boundary and
// assert that BENIGN chunks never reach the offscreen probe call.
export function runChunkProbes(args: RunChunkArgs): Promise<ChunkProbeResult> {
  return new Promise((resolve) => {
    const handler = (message: ProbeResultsMessage) => {
      if (
        message.type === 'PROBE_RESULTS' &&
        message.tabId === args.tabId &&
        message.chunkIndex === args.chunkIndex
      ) {
        chrome.runtime.onMessage.removeListener(handler);
        // Issue #226 — log probe execution for observability
        log.debug(
          `probe_run: chunk=${args.chunkIndex}, probes=${message.results.length}, errors=${message.results.filter((r) => r.errorMessage !== null).length}`,
        );
        resolve({
          results: message.results,
          canaryId: message.canaryId ?? null,
          webgpuAdapterMode: message.webgpuAdapterMode ?? null,
        });
      }
    };
    chrome.runtime.onMessage.addListener(handler);

    // Issue #226 — log probe selection for observability
    log.debug(
      `probe_selected: chunk=${args.chunkIndex}, packets=${args.evidencePackets.length}`,
    );

    const msg: RunProbesMessage = {
      type: 'RUN_PROBES',
      tabId: args.tabId,
      chunk: args.chunk,
      chunkIndex: args.chunkIndex,
      totalChunks: args.totalChunks,
      metadata: { url: args.url, origin: args.origin },
      evidencePackets: args.evidencePackets,
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

// Issue #126 — exported so the response-analyzer can dedup probe results
// across response chunks using the same "highest-score non-error wins"
// rule the page scan uses.
export function mergeProbeResults(chunkResults: readonly (readonly ProbeResult[])[]): readonly ProbeResult[] {
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

// Issue #126 — exported so the response-analyzer surfaces the same
// engine-failure error semantics as the page scan.
export function computeAggregateError(mergedResults: readonly ProbeResult[]): string | null {
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
