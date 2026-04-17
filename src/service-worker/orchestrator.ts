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

const log = createLogger('Orchestrator');

const pendingChunks = new Map<number, ProbeResult[][]>();

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

export async function analyzeSnapshot(
  tabId: number,
  snapshot: PageSnapshot,
): Promise<SecurityVerdict> {
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

  // Phase 4 Stage 4B — serialize chunks. The previous Promise.all fanout
  // issued all RUN_PROBES messages concurrently into a single MLC engine,
  // which degraded after ~6 cumulative calls (Track B Stage B4 writeup).
  // Sequential awaits let the warm engine process one chunk at a time,
  // eliminating the multi-chunk variant of the false-negative bug.
  const allChunkResults: (readonly ProbeResult[])[] = [];
  let canaryId: string | null = null;
  for (let index = 0; index < chunks.length; index += 1) {
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
  pendingChunks.delete(tabId);

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
