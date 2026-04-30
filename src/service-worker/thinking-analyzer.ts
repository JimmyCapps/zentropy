import type { ProbeResult, SecurityVerdict } from '@/types/verdict.js';
import type {
  CapturedThinking,
  PortalId,
  ThinkingVerdict,
} from '@/types/portal-response.js';
import type { VerdictMessage } from '@/types/messages.js';
import {
  MAX_THINKING_TEXT_CHARS,
  STORAGE_KEY_THINKING_TELEMETRY,
  THINKING_CHUNK_INDEX_OFFSET,
} from '@/shared/constants.js';
import { sha256Hex } from '@/shared/hash.js';
import { chunkText } from '@/hunters/hawk/chunking.js';
import { analyzeBehavior } from '@/analysis/behavioral-analyzer.js';
import { evaluatePolicy } from '@/policy/engine.js';
import { persistVerdict, setThinkingVerdictForOrigin } from '@/policy/storage.js';
import { ensureOffscreenDocument } from './offscreen-manager.js';
import {
  computeAggregateError,
  mergeProbeResults,
  runChunkProbes,
} from './orchestrator.js';
import { createLogger } from '@/shared/logger.js';

const log = createLogger('ThinkingAnalyzer');

/** Per-tab dedup cache: tabId → set of `${messageId}:${hashPrefix}` keys. */
const dedupCache = new Map<number, Set<string>>();

interface PerPortalCounts {
  readonly chatgpt: number;
  readonly claude: number;
  readonly gemini: number;
}

interface ThinkingTelemetry {
  readonly captured: PerPortalCounts;
  readonly analysed: PerPortalCounts;
  readonly suspicious: number;
  readonly compromised: number;
  readonly errors: number;
  readonly lastResetAt: number;
}

const ZERO_COUNTS: PerPortalCounts = { chatgpt: 0, claude: 0, gemini: 0 };

function emptyTelemetry(now: number): ThinkingTelemetry {
  return {
    captured: { ...ZERO_COUNTS },
    analysed: { ...ZERO_COUNTS },
    suspicious: 0,
    compromised: 0,
    errors: 0,
    lastResetAt: now,
  };
}

async function readTelemetry(): Promise<ThinkingTelemetry> {
  try {
    const r = await chrome.storage.local.get(STORAGE_KEY_THINKING_TELEMETRY);
    const v = r[STORAGE_KEY_THINKING_TELEMETRY];
    if (
      typeof v === 'object' &&
      v !== null &&
      typeof (v as ThinkingTelemetry).suspicious === 'number'
    ) {
      return v as ThinkingTelemetry;
    }
  } catch (err) {
    log.warn('readTelemetry failed', err);
  }
  return emptyTelemetry(Date.now());
}

async function writeTelemetry(t: ThinkingTelemetry): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY_THINKING_TELEMETRY]: t });
  } catch (err) {
    log.warn('writeTelemetry failed', err);
  }
}

function bumpPortal(counts: PerPortalCounts, portalId: PortalId): PerPortalCounts {
  return { ...counts, [portalId]: counts[portalId] + 1 };
}

async function recordTelemetry(
  portalId: PortalId,
  outcome: { analysed: boolean; status: ThinkingVerdict['status']; error: boolean },
): Promise<void> {
  const prior = await readTelemetry();
  const next: ThinkingTelemetry = {
    ...prior,
    captured: bumpPortal(prior.captured, portalId),
    analysed: outcome.analysed ? bumpPortal(prior.analysed, portalId) : prior.analysed,
    suspicious: outcome.status === 'SUSPICIOUS' ? prior.suspicious + 1 : prior.suspicious,
    compromised: outcome.status === 'COMPROMISED' ? prior.compromised + 1 : prior.compromised,
    errors: outcome.error ? prior.errors + 1 : prior.errors,
  };
  await writeTelemetry(next);
}

function buildMinimalPageStub(url: string, timestamp: number, thinkingVerdict: ThinkingVerdict): SecurityVerdict {
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
    timestamp,
    url,
    analysisError: 'page_scan_pending',
    canaryId: null,
    webgpuAdapterMode: null,
    stamp: null,
    perChunkAnalysis: null,
    entitySummary: null,
    responseVerdict: null,
    thinkingVerdict,
  };
}

async function notifyTab(tabId: number, verdict: SecurityVerdict): Promise<void> {
  const msg: VerdictMessage = { type: 'VERDICT', verdict };
  try {
    await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    // Tab may have closed or content script may not be listening yet —
    // popup will pick up the verdict from storage on next open.
  }
}

function dedupKey(messageId: string, hash: string): string {
  return `${messageId}:${hash.slice(0, 16)}`;
}

function isDuplicate(tabId: number, key: string): boolean {
  const seen = dedupCache.get(tabId);
  return seen?.has(key) === true;
}

function markSeen(tabId: number, key: string): void {
  let seen = dedupCache.get(tabId);
  if (seen === undefined) {
    seen = new Set<string>();
    dedupCache.set(tabId, seen);
  }
  seen.add(key);
}

function buildThinkingVerdict(args: {
  readonly capture: CapturedThinking;
  readonly truncated: boolean;
  readonly status: ThinkingVerdict['status'];
  readonly confidence: number;
  readonly totalScore: number;
  readonly probeResults: readonly ProbeResult[];
  readonly behavioralFlags: ThinkingVerdict['behavioralFlags'];
  readonly thinkingTextHash: string;
  readonly thinkingTextLength: number;
  readonly analysisError: string | null;
  readonly canaryId: string | null;
  readonly timestamp: number;
}): ThinkingVerdict {
  const { capture } = args;
  return {
    portalId: capture.portalId,
    status: args.status,
    confidence: args.confidence,
    totalScore: args.totalScore,
    probeResults: args.probeResults,
    behavioralFlags: args.behavioralFlags,
    timestamp: args.timestamp,
    thinkingTextHash: args.thinkingTextHash,
    thinkingTextLength: args.thinkingTextLength,
    conversationId: capture.conversationId,
    messageId: capture.messageId,
    analysisError: args.truncated ? mergeAnalysisError('thinking_truncated', args.analysisError) : args.analysisError,
    canaryId: args.canaryId,
  };
}

function mergeAnalysisError(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return `${a}; ${b}`;
}

/**
 * Issue #131 (N7c) — entry point dispatched from the SW's
 * `THINKING_CAPTURED` handler. Runs the existing 3-probe stack against
 * the captured thinking-block text and writes a `ThinkingVerdict` onto
 * the per-origin `SecurityVerdict`. Never applies mitigations.
 */
export async function analyzeThinking(
  tabId: number,
  capture: CapturedThinking,
  metadata: { readonly url: string; readonly origin: string },
): Promise<ThinkingVerdict | null> {
  const trimmed = capture.text.trim();
  const timestamp = Date.now();
  const truncated = capture.text.length > MAX_THINKING_TEXT_CHARS;
  const effectiveText = truncated ? capture.text.slice(0, MAX_THINKING_TEXT_CHARS) : capture.text;

  // Empty-thinking short-circuit: no chunking, no probes. Empty thinking
  // is the dominant case across portals (most conversations are not in
  // thinking mode); we want this path to be cheap.
  if (trimmed.length === 0) {
    const verdict: ThinkingVerdict = buildThinkingVerdict({
      capture,
      truncated: false,
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
      thinkingTextHash: await sha256Hex(''),
      thinkingTextLength: 0,
      analysisError: 'empty_thinking',
      canaryId: null,
      timestamp,
    });
    await writeVerdict(tabId, verdict, metadata.url, timestamp);
    await recordTelemetry(capture.portalId, { analysed: false, status: 'UNKNOWN', error: false });
    return verdict;
  }

  const thinkingTextHash = await sha256Hex(effectiveText);
  const key = dedupKey(capture.messageId, thinkingTextHash);
  if (isDuplicate(tabId, key)) {
    log.info(`[${capture.portalId}] dedup-skip messageId=${capture.messageId}`);
    return null;
  }
  markSeen(tabId, key);

  await ensureOffscreenDocument();

  let probeResults: readonly ProbeResult[];
  let canaryId: string | null = null;
  let chunkError: string | null = null;
  try {
    const chunks = await chunkText(effectiveText);
    const totalChunks = chunks.length;
    const perChunk: ProbeResult[][] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      const r = await runChunkProbes({
        tabId,
        chunk: chunk.text,
        chunkIndex: i + THINKING_CHUNK_INDEX_OFFSET,
        totalChunks,
        url: metadata.url,
        origin: metadata.origin,
        evidencePackets: [],
      });
      perChunk.push([...r.results]);
      if (r.canaryId !== null) canaryId = r.canaryId;
    }
    probeResults = mergeProbeResults(perChunk);
  } catch (err) {
    chunkError = err instanceof Error ? err.message : String(err);
    probeResults = [];
  }

  const behavioralFlags = analyzeBehavior(probeResults);
  // Force UNKNOWN on engine failure so a probe-stack error doesn't
  // silently emerge as score-0 CLEAN; mirrors response-analyzer.ts.
  const verdict0 = chunkError !== null
    ? null
    : evaluatePolicy(
        probeResults,
        behavioralFlags,
        metadata.url,
        computeAggregateError(probeResults),
        canaryId,
        null,
      );

  const thinkingVerdict = buildThinkingVerdict({
    capture,
    truncated,
    status: verdict0?.status ?? 'UNKNOWN',
    confidence: verdict0?.confidence ?? 0,
    totalScore: verdict0?.totalScore ?? 0,
    probeResults,
    behavioralFlags,
    thinkingTextHash,
    thinkingTextLength: effectiveText.length,
    analysisError: chunkError ?? verdict0?.analysisError ?? null,
    canaryId,
    timestamp,
  });

  await writeVerdict(tabId, thinkingVerdict, metadata.url, timestamp);
  await recordTelemetry(capture.portalId, {
    analysed: chunkError === null,
    status: thinkingVerdict.status,
    error: chunkError !== null,
  });

  log.info(
    `[${capture.portalId}] thinking analysed: status=${thinkingVerdict.status} chars=${thinkingVerdict.thinkingTextLength}`,
  );
  return thinkingVerdict;
}

async function writeVerdict(
  tabId: number,
  thinkingVerdict: ThinkingVerdict,
  url: string,
  timestamp: number,
): Promise<void> {
  const updated = await setThinkingVerdictForOrigin(url, thinkingVerdict);
  if (!updated) {
    // No prior page record — write a minimal stub so the popup has a
    // record to read on open. The eventual page scan will use
    // mergeWithStoredVerdict to retain the thinkingVerdict written here.
    const stub = buildMinimalPageStub(url, timestamp, thinkingVerdict);
    await persistVerdict(stub);
    await notifyTab(tabId, stub);
    return;
  }
  // The popup is the source of truth via storage; the VERDICT message
  // is a refresh trigger. The verdict payload here is best-effort.
  const stub = buildMinimalPageStub(url, timestamp, thinkingVerdict);
  await notifyTab(tabId, stub);
}

/** Test-only helper — clears the per-tab dedup cache. */
export function __resetThinkingDedupCacheForTest(): void {
  dedupCache.clear();
}
