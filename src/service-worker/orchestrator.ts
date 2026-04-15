import type { PageSnapshot } from '@/types/snapshot.js';
import type { ProbeResult, SecurityVerdict, BehavioralFlags } from '@/types/verdict.js';
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
  const behavioralFlags = analyzeBehavior(mergedResults);
  const verdict = evaluatePolicy(mergedResults, behavioralFlags, snapshot.metadata.url);

  await persistVerdict(verdict);

  log.info(`Verdict for ${snapshot.metadata.url}: ${verdict.status} (${verdict.confidence})`);

  return verdict;
}

function mergeProbeResults(chunkResults: readonly (readonly ProbeResult[])[]): readonly ProbeResult[] {
  const byProbe = new Map<string, ProbeResult>();

  for (const results of chunkResults) {
    for (const result of results) {
      const existing = byProbe.get(result.probeName);
      if (existing === undefined || result.score > existing.score) {
        byProbe.set(result.probeName, {
          ...result,
          flags: existing
            ? [...new Set([...existing.flags, ...result.flags])]
            : [...result.flags],
        });
      }
    }
  }

  return [...byProbe.values()];
}
