import { runHawk } from '../probes/hawk-runner.js';
import { runSpider } from '../probes/spider-runner.js';
import { htmlToText } from '../extract/html-to-text.js';
import type { HunterResult } from '../../../src/hunters/base-hunter.js';
import type {
  BrowseToolResult,
  McpReport,
  McpSecurityStatus,
  McpVerdict,
} from '../verdict/types.js';

export interface FetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
}

export type Fetcher = (url: string) => Promise<FetchResponse>;

export interface BrowseInput {
  readonly url: string;
}

export interface BrowseDeps {
  readonly fetcher: Fetcher;
  readonly now: () => number;
}

interface CombinedScore {
  readonly status: McpSecurityStatus;
  readonly totalScore: number;
  readonly confidence: number;
  readonly analysisError: string | null;
}

function combineHunters(hunters: readonly HunterResult[]): CombinedScore {
  const totalScore = hunters.reduce((acc, h) => acc + h.score, 0);
  const anyMatched = hunters.some((h) => h.matched);
  const allErrored =
    hunters.length > 0 && hunters.every((h) => h.errorMessage !== null);
  const analysisError = allErrored
    ? hunters.map((h) => `${h.hunterName}: ${h.errorMessage}`).join('; ')
    : null;
  if (!anyMatched || totalScore === 0) {
    return { status: 'CLEAN', totalScore: 0, confidence: 0, analysisError };
  }
  const confidence = Math.max(...hunters.map((h) => h.confidence));
  const status: McpSecurityStatus = totalScore >= 40 ? 'COMPROMISED' : 'SUSPICIOUS';
  return { status, totalScore, confidence, analysisError };
}

function unknownVerdict(url: string, timestamp: number, error: string): McpVerdict {
  return {
    status: 'UNKNOWN',
    confidence: 0,
    totalScore: 0,
    url,
    timestamp,
    analysisError: error,
  };
}

function emptyReport(): McpReport {
  return { hunters: [] };
}

function failed(url: string, timestamp: number, error: string): BrowseToolResult {
  return {
    content: '',
    verdict: unknownVerdict(url, timestamp, error),
    report: emptyReport(),
    mitigationsApplied: [],
  };
}

function validateUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: `invalid url: ${raw}` };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: `unsupported scheme: ${parsed.protocol}` };
  }
  return { ok: true, url: parsed.toString() };
}

export async function runBrowse(
  input: BrowseInput,
  deps: BrowseDeps,
): Promise<BrowseToolResult> {
  const timestamp = deps.now();
  const validated = validateUrl(input.url);
  if (!validated.ok) return failed(input.url, timestamp, validated.error);

  let response: FetchResponse;
  try {
    response = await deps.fetcher(validated.url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failed(validated.url, timestamp, `fetch failed: ${message}`);
  }
  if (!response.ok) {
    return failed(validated.url, timestamp, `fetch failed: HTTP ${response.status}`);
  }

  const isHtml = response.contentType.toLowerCase().includes('html');
  const text = isHtml ? htmlToText(response.body) : response.body;

  const hunters = await Promise.all([runHawk(text), runSpider(text)]);
  const combined = combineHunters(hunters);

  const verdict: McpVerdict = {
    status: combined.status,
    confidence: combined.confidence,
    totalScore: combined.totalScore,
    url: validated.url,
    timestamp,
    analysisError: combined.analysisError,
  };

  return {
    content: text,
    verdict,
    report: { hunters },
    mitigationsApplied: [],
  };
}
