import { runHawk } from '../probes/hawk-runner.js';
import { htmlToText } from '../extract/html-to-text.js';
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

const STATUS_FROM_HUNTER: Readonly<Record<string, McpSecurityStatus>> = {
  high: 'COMPROMISED',
  med: 'SUSPICIOUS',
};

function statusForHunter(matched: boolean, score: number): McpSecurityStatus {
  if (!matched || score === 0) return 'CLEAN';
  if (score >= 40) return STATUS_FROM_HUNTER.high;
  return STATUS_FROM_HUNTER.med;
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

  const hunter = await runHawk(text);
  const status = statusForHunter(hunter.matched, hunter.score);
  const verdict: McpVerdict = {
    status,
    confidence: hunter.confidence,
    totalScore: hunter.score,
    url: validated.url,
    timestamp,
    analysisError: hunter.errorMessage,
  };

  return {
    content: text,
    verdict,
    report: { hunters: [hunter] },
    mitigationsApplied: [],
  };
}
