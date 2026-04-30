import type {
  InterceptVerdict,
  ParseHtmlRequestMessage,
  ParseHtmlResultMessage,
  PortalId,
} from '@/types/messages.js';
import type { ProbeResult } from '@/types/verdict.js';
import type { CachedChunk, CachedScan } from '@/types/scan-cache.js';
import {
  CACHE_SCHEMA_VERSION,
  HUNTER_RULES_VERSION,
  INTERCEPT_CHUNK_INDEX_OFFSET,
  MAX_INTERCEPT_FETCH_BYTES,
  MAX_INTERCEPT_LATENCY_MS,
  SCORE_INSTRUCTION_DETECTION,
} from '@/shared/constants.js';
import { chunkText } from '@/hunters/hawk/chunking.js';
import { analyzeBehavior } from '@/analysis/behavioral-analyzer.js';
import { evaluatePolicy } from '@/policy/engine.js';
import { ensureOffscreenDocument } from './offscreen-manager.js';
import {
  computeAggregateError,
  mergeProbeResults,
  runChunkProbes,
} from './orchestrator.js';
import {
  getEngineFingerprint,
  lookupScan,
  recordCacheHit,
  recordCacheMiss,
  writeScan,
} from './scan-cache.js';
import { createLogger } from '@/shared/logger.js';

const log = createLogger('UrlScanner');

interface ScanUrlArgs {
  readonly url: string;
  readonly origin: string;
  readonly portalId: PortalId;
  readonly tabId: number;
}

export async function scanUrl(args: ScanUrlArgs): Promise<InterceptVerdict> {
  const timeoutPromise = new Promise<InterceptVerdict>((resolve) => {
    const t = setTimeout(() => resolve(buildErrorVerdict(args.url, 'intercept_timeout', false)), MAX_INTERCEPT_LATENCY_MS);
    // Allow node test workers to exit cleanly without a hanging handle
    if (typeof t === 'object' && t !== null && 'unref' in t && typeof (t as { unref?: () => void }).unref === 'function') {
      (t as { unref: () => void }).unref();
    }
  });
  return Promise.race([runScan(args), timeoutPromise]);
}

async function runScan(args: ScanUrlArgs): Promise<InterceptVerdict> {
  const fingerprint = await getEngineFingerprint().catch(() => 'unknown');

  // 1. Cache lookup
  let cachedScan: CachedScan | null = null;
  try {
    cachedScan = await lookupScan(args.url, {
      hunterRulesVersion: HUNTER_RULES_VERSION,
      llmModelId: fingerprint,
    });
  } catch (err) {
    log.warn('lookupScan failed; proceeding as miss', err);
  }
  if (cachedScan !== null && cachedScan.chunks.length > 0) {
    await recordCacheHit().catch(() => undefined);
    return projectCacheHit(args.url, cachedScan);
  }
  await recordCacheMiss().catch(() => undefined);

  // 2. Fetch the URL — credentials:'omit' + Range cap; abort on oversize.
  const fetched = await fetchUrl(args.url);
  if ('error' in fetched) return buildErrorVerdict(args.url, fetched.error, false);
  const html = fetched.html;

  // 3. Offscreen-mediated DOMParser → PageSnapshot
  let snapshot;
  try {
    await ensureOffscreenDocument();
    const requestId =
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `parse-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const req: ParseHtmlRequestMessage = {
      type: 'PARSE_HTML_REQUEST',
      requestId,
      html,
      url: args.url,
    };
    const reply = (await chrome.runtime.sendMessage(req)) as
      | ParseHtmlResultMessage
      | undefined;
    if (reply === undefined || reply.snapshot === null) {
      return buildErrorVerdict(args.url, 'parse_failed', false);
    }
    snapshot = reply.snapshot;
  } catch (err) {
    log.warn('PARSE_HTML_REQUEST failed', err);
    return buildErrorVerdict(args.url, 'parse_failed', false);
  }

  // 4. Chunk + probe — mirror response-analyzer.ts pattern
  const fullText = `${snapshot.visibleText}\n${snapshot.hiddenText}`.trim();
  if (fullText.length === 0) {
    // Empty body → no signal to analyse. Treat as UNKNOWN; cache nothing.
    return buildErrorVerdict(args.url, 'empty_response', false);
  }

  const chunks = await chunkText(fullText);
  const totalChunks = chunks.length;
  const perChunk: ProbeResult[][] = [];
  let chunkError: string | null = null;
  try {
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i]!;
      const r = await runChunkProbes({
        tabId: args.tabId,
        chunk: c.text,
        chunkIndex: i + INTERCEPT_CHUNK_INDEX_OFFSET,
        totalChunks,
        url: args.url,
        origin: args.origin,
        evidencePackets: [],
      });
      perChunk.push([...r.results]);
    }
  } catch (err) {
    chunkError = err instanceof Error ? err.message : String(err);
  }

  const merged = mergeProbeResults(perChunk);
  const behavioralFlags = analyzeBehavior(merged);
  const policy =
    chunkError !== null
      ? null
      : evaluatePolicy(
          merged,
          behavioralFlags,
          args.url,
          computeAggregateError(merged),
          null,
          null,
        );

  // 5. Cache write — best-effort, mirrors orchestrator's pattern
  if (chunkError === null && policy !== null) {
    const cachedChunks: readonly CachedChunk[] = chunks.map((c, i) => ({
      contentHash: c.contentHash,
      tierRouting: { decision: 'UNCERTAIN', primitiveCount: 0, contributingHunters: [] },
      probeResults: perChunk[i] ?? null,
    }));
    try {
      await writeScan({
        schemaVersion: CACHE_SCHEMA_VERSION,
        hunterRulesVersion: HUNTER_RULES_VERSION,
        llmModelId: fingerprint,
        url: args.url,
        fetchedAt: Date.now(),
        chunks: cachedChunks,
        earlyExited: false,
        entitySummary: null,
        sizeBytes: 0,
      });
    } catch (err) {
      log.warn('writeScan failed; verdict still returned', err);
    }
  }

  return {
    status: policy?.status ?? 'UNKNOWN',
    scannedUrl: args.url,
    probeBreakdown: countProbeBreakdown(merged),
    totalScore: policy?.totalScore ?? 0,
    cacheHit: false,
    timestamp: Date.now(),
    analysisError: chunkError ?? policy?.analysisError ?? null,
  };
}

type FetchOk = { readonly html: string };
type FetchErr = { readonly error: 'fetch_failed' | 'response_too_large' };

async function fetchUrl(url: string): Promise<FetchOk | FetchErr> {
  const ac = new AbortController();
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      headers: { Range: `bytes=0-${MAX_INTERCEPT_FETCH_BYTES - 1}` },
      signal: ac.signal,
      referrerPolicy: 'no-referrer',
    });
  } catch (err) {
    log.warn(`fetch failed for ${url}`, err);
    return { error: 'fetch_failed' };
  }
  // 200 OK or 206 Partial Content (server honoured the Range header) are
  // both acceptable. Anything else is an error path (404, 403, 5xx, etc.).
  if (resp.status !== 200 && resp.status !== 206) {
    return { error: 'fetch_failed' };
  }
  const contentLengthHeader = resp.headers.get('content-length');
  if (contentLengthHeader !== null) {
    const len = Number(contentLengthHeader);
    if (Number.isFinite(len) && len > MAX_INTERCEPT_FETCH_BYTES) {
      ac.abort();
      return { error: 'response_too_large' };
    }
  }
  let html: string;
  try {
    html = await resp.text();
  } catch {
    return { error: 'fetch_failed' };
  }
  if (html.length > MAX_INTERCEPT_FETCH_BYTES) {
    return { error: 'response_too_large' };
  }
  return { html };
}

function projectCacheHit(url: string, cached: CachedScan): InterceptVerdict {
  const allProbes: ProbeResult[][] = cached.chunks.map((c) => [...(c.probeResults ?? [])]);
  const merged = mergeProbeResults(allProbes);
  const behavioralFlags = analyzeBehavior(merged);
  const policy = evaluatePolicy(
    merged,
    behavioralFlags,
    url,
    computeAggregateError(merged),
    null,
    null,
  );
  return {
    status: policy.status,
    scannedUrl: url,
    probeBreakdown: countProbeBreakdown(merged),
    totalScore: policy.totalScore,
    cacheHit: true,
    timestamp: Date.now(),
    analysisError: policy.analysisError,
  };
}

function countProbeBreakdown(probes: readonly ProbeResult[]): InterceptVerdict['probeBreakdown'] {
  let suspiciousProbes = 0;
  let compromisedProbes = 0;
  for (const p of probes) {
    if (p.passed) continue;
    suspiciousProbes++;
    if (p.score >= SCORE_INSTRUCTION_DETECTION) compromisedProbes++;
  }
  return { totalProbes: probes.length, suspiciousProbes, compromisedProbes };
}

function buildErrorVerdict(
  url: string,
  reason:
    | 'fetch_failed'
    | 'parse_failed'
    | 'response_too_large'
    | 'intercept_timeout'
    | 'empty_response',
  cacheHit: boolean,
): InterceptVerdict {
  return {
    status: 'UNKNOWN',
    scannedUrl: url,
    probeBreakdown: { totalProbes: 0, suspiciousProbes: 0, compromisedProbes: 0 },
    totalScore: 0,
    cacheHit,
    timestamp: Date.now(),
    analysisError: reason,
  };
}
