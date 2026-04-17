import type { PageSnapshot } from '@/types/snapshot.js';
import type { ProbeResult, SecurityVerdict } from '@/types/verdict.js';
import type { RunProbesMessage, ProbeResultsMessage } from '@/types/messages.js';
import { MAX_CHUNK_CHARS } from '@/shared/constants.js';
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
  const chunks = chunkText(fullText);

  log.info(`Split into ${chunks.length} chunk(s)`);

  pendingChunks.set(tabId, []);

  const probePromises = chunks.map(
    (chunk, index) =>
      new Promise<readonly ProbeResult[]>((resolve) => {
        const handler = (message: ProbeResultsMessage) => {
          if (
            message.type === 'PROBE_RESULTS' &&
            message.tabId === tabId &&
            message.chunkIndex === index
          ) {
            chrome.runtime.onMessage.removeListener(handler);
            resolve(message.results);
          }
        };
        chrome.runtime.onMessage.addListener(handler);

        const msg: RunProbesMessage = {
          type: 'RUN_PROBES',
          tabId,
          chunk,
          chunkIndex: index,
          totalChunks: chunks.length,
          metadata: {
            url: snapshot.metadata.url,
            origin: snapshot.metadata.origin,
          },
        };
        chrome.runtime.sendMessage(msg);
      }),
  );

  const allChunkResults = await Promise.all(probePromises);
  pendingChunks.delete(tabId);

  const mergedResults = mergeProbeResults(allChunkResults);
  const aggregateError = computeAggregateError(mergedResults);
  const behavioralFlags = analyzeBehavior(mergedResults);
  const verdict = evaluatePolicy(mergedResults, behavioralFlags, snapshot.metadata.url, aggregateError);

  await persistVerdict(verdict);

  log.info(`Verdict for ${snapshot.metadata.url}: ${verdict.status} (${verdict.confidence})${verdict.analysisError ? ` [analysisError: ${verdict.analysisError}]` : ''}`);

  return verdict;
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
