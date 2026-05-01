import type { ProbeResult, SecurityVerdict } from '@/types/verdict.js';
import type {
  CapturedResponse,
  PortalId,
  ResponseVerdict,
} from '@/types/portal-response.js';
import type { VerdictMessage } from '@/types/messages.js';
import {
  MAX_RESPONSE_TEXT_CHARS,
  RESPONSE_CHUNK_INDEX_OFFSET,
  STORAGE_KEY_RESPONSE_TELEMETRY,
} from '@/shared/constants.js';
import { sha256Hex } from '@/shared/hash.js';
import { chunkText } from '@/hunters/hawk/chunking.js';
import { analyzeBehavior } from '@/analysis/behavioral-analyzer.js';
import { evaluatePolicy } from '@/policy/engine.js';
import { persistVerdict, setResponseVerdictForOrigin } from '@/policy/storage.js';
import { ensureOffscreenDocument } from './offscreen-manager.js';
import {
  computeAggregateError,
  mergeProbeResults,
  runChunkProbes,
} from './orchestrator.js';
import { createLogger } from '@/shared/logger.js';

const log = createLogger('ResponseAnalyzer');

/** Per-tab dedup cache: tabId → set of `${messageId}:${hashPrefix}` keys. */
const dedupCache = new Map<number, Set<string>>();

interface PerPortalCounts {
  readonly chatgpt: number;
  readonly claude: number;
  readonly gemini: number;
}

interface ResponseTelemetry {
  readonly captured: PerPortalCounts;
  readonly analysed: PerPortalCounts;
  readonly suspicious: number;
  readonly compromised: number;
  readonly errors: number;
  readonly lastResetAt: number;
}

const ZERO_COUNTS: PerPortalCounts = { chatgpt: 0, claude: 0, gemini: 0 };

function emptyTelemetry(now: number): ResponseTelemetry {
  return {
    captured: { ...ZERO_COUNTS },
    analysed: { ...ZERO_COUNTS },
    suspicious: 0,
    compromised: 0,
    errors: 0,
    lastResetAt: now,
  };
}

async function readTelemetry(): Promise<ResponseTelemetry> {
  try {
    const r = await chrome.storage.local.get(STORAGE_KEY_RESPONSE_TELEMETRY);
    const v = r[STORAGE_KEY_RESPONSE_TELEMETRY];
    if (
      typeof v === 'object' &&
      v !== null &&
      typeof (v as ResponseTelemetry).suspicious === 'number'
    ) {
      return v as ResponseTelemetry;
    }
  } catch (err) {
    log.warn('readTelemetry failed', err);
  }
  return emptyTelemetry(Date.now());
}

async function writeTelemetry(t: ResponseTelemetry): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY_RESPONSE_TELEMETRY]: t });
  } catch (err) {
    log.warn('writeTelemetry failed', err);
  }
}

function bumpPortal(counts: PerPortalCounts, portalId: PortalId): PerPortalCounts {
  return { ...counts, [portalId]: counts[portalId] + 1 };
}

async function recordTelemetry(
  portalId: PortalId,
  outcome: { analysed: boolean; status: ResponseVerdict['status']; error: boolean },
): Promise<void> {
  const prior = await readTelemetry();
  const next: ResponseTelemetry = {
    ...prior,
    captured: bumpPortal(prior.captured, portalId),
    analysed: outcome.analysed ? bumpPortal(prior.analysed, portalId) : prior.analysed,
    suspicious: outcome.status === 'SUSPICIOUS' ? prior.suspicious + 1 : prior.suspicious,
    compromised: outcome.status === 'COMPROMISED' ? prior.compromised + 1 : prior.compromised,
    errors: outcome.error ? prior.errors + 1 : prior.errors,
  };
  await writeTelemetry(next);
}

function buildMinimalPageStub(url: string, timestamp: number, responseVerdict: ResponseVerdict): SecurityVerdict {
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
    responseVerdict,
    // Issue #131 — the response-analyzer's stub never carries a thinking
    // verdict; the thinking analyzer writes its own slot independently.
    thinkingVerdict: null,
    // Issue #129 Stage 5 — response-analyzer stubs never produce embeddings
    // findings; only the page-scan path's chunk loop populates this slot.
    embeddingsFindings: null,
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

function buildResponseVerdict(args: {
  readonly capture: CapturedResponse;
  readonly truncated: boolean;
  readonly status: ResponseVerdict['status'];
  readonly confidence: number;
  readonly totalScore: number;
  readonly probeResults: readonly ProbeResult[];
  readonly behavioralFlags: ResponseVerdict['behavioralFlags'];
  readonly responseTextHash: string;
  readonly responseTextLength: number;
  readonly analysisError: string | null;
  readonly canaryId: string | null;
  readonly timestamp: number;
}): ResponseVerdict {
  const { capture } = args;
  return {
    portalId: capture.portalId,
    status: args.status,
    confidence: args.confidence,
    totalScore: args.totalScore,
    probeResults: args.probeResults,
    behavioralFlags: args.behavioralFlags,
    timestamp: args.timestamp,
    responseTextHash: args.responseTextHash,
    responseTextLength: args.responseTextLength,
    conversationId: capture.conversationId,
    messageId: capture.messageId,
    analysisError: args.truncated ? mergeAnalysisError('response_truncated', args.analysisError) : args.analysisError,
    canaryId: args.canaryId,
  };
}

function mergeAnalysisError(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return `${a}; ${b}`;
}


/**
 * Issue #126 (N7a) — entry point dispatched from the SW's
 * `RESPONSE_CAPTURED` handler. Runs the existing 3-probe stack against
 * the captured chat-portal response text and writes a `ResponseVerdict`
 * onto the per-origin `SecurityVerdict`. Never applies mitigations:
 * response mitigations are out of Stage 2 scope.
 */
export async function analyzeResponse(
  tabId: number,
  capture: CapturedResponse,
  metadata: { readonly url: string; readonly origin: string },
): Promise<ResponseVerdict | null> {
  const trimmed = capture.text.trim();
  const timestamp = Date.now();
  const truncated = capture.text.length > MAX_RESPONSE_TEXT_CHARS;
  const effectiveText = truncated ? capture.text.slice(0, MAX_RESPONSE_TEXT_CHARS) : capture.text;

  // Empty-response short-circuit: no chunking, no probes.
  if (trimmed.length === 0) {
    const verdict: ResponseVerdict = buildResponseVerdict({
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
      responseTextHash: await sha256Hex(''),
      responseTextLength: 0,
      analysisError: 'empty_response',
      canaryId: null,
      timestamp,
    });
    await writeVerdict(tabId, capture, verdict, metadata.url, timestamp);
    await recordTelemetry(capture.portalId, { analysed: false, status: 'UNKNOWN', error: false });
    return verdict;
  }

  const responseTextHash = await sha256Hex(effectiveText);
  const key = dedupKey(capture.messageId, responseTextHash);
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
        chunkIndex: i + RESPONSE_CHUNK_INDEX_OFFSET,
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
  // When the probe stack threw, evaluatePolicy on an empty probeResults
  // would fall through to score-0 CLEAN — silently masking the engine
  // failure. Force UNKNOWN with confidence 0 so the popup distinguishes
  // "analysed and clean" from "couldn't analyse."
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

  const responseVerdict = buildResponseVerdict({
    capture,
    truncated,
    status: verdict0?.status ?? 'UNKNOWN',
    confidence: verdict0?.confidence ?? 0,
    totalScore: verdict0?.totalScore ?? 0,
    probeResults,
    behavioralFlags,
    responseTextHash,
    responseTextLength: effectiveText.length,
    analysisError: chunkError ?? verdict0?.analysisError ?? null,
    canaryId,
    timestamp,
  });

  await writeVerdict(tabId, capture, responseVerdict, metadata.url, timestamp);
  await recordTelemetry(capture.portalId, {
    analysed: chunkError === null,
    status: responseVerdict.status,
    error: chunkError !== null,
  });

  log.info(
    `[${capture.portalId}] response analysed: status=${responseVerdict.status} chars=${responseVerdict.responseTextLength}`,
  );
  return responseVerdict;
}

async function writeVerdict(
  tabId: number,
  _capture: CapturedResponse,
  responseVerdict: ResponseVerdict,
  url: string,
  timestamp: number,
): Promise<void> {
  const updated = await setResponseVerdictForOrigin(url, responseVerdict);
  if (!updated) {
    // No prior page record — write a minimal stub so the popup has a
    // record to read on open. The eventual page scan will use
    // mergeWithStoredVerdict to retain the responseVerdict written here.
    const stub = buildMinimalPageStub(url, timestamp, responseVerdict);
    await persistVerdict(stub);
    await notifyTab(tabId, stub);
    return;
  }
  // The popup is the source of truth via storage; the VERDICT message
  // is a refresh trigger. The verdict payload here is best-effort.
  const stub = buildMinimalPageStub(url, timestamp, responseVerdict);
  await notifyTab(tabId, stub);
}

/** Test-only helper — clears the per-tab dedup cache. */
export function __resetDedupCacheForTest(): void {
  dedupCache.clear();
}
