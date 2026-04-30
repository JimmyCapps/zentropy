import type { Analyzer, AnalyzerResult, SecurityStatus, SecurityVerdict } from './types.js';

export interface McpCallToolParams {
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface McpToolResponse {
  readonly content?: ReadonlyArray<{
    readonly type?: string;
    readonly text?: string;
  }>;
}

export interface McpClientLike {
  readonly callTool: (params: McpCallToolParams) => Promise<McpToolResponse | unknown>;
}

export interface CreateMcpAnalyzerOptions {
  readonly client: McpClientLike;
  readonly toolName?: 'analyze_html' | 'analyze_url' | 'browse';
}

const VALID_STATUSES: ReadonlySet<string> = new Set([
  'CLEAN',
  'SUSPICIOUS',
  'COMPROMISED',
  'UNKNOWN',
]);

function unknownVerdict(reason: string, url: string): SecurityVerdict {
  return {
    status: 'UNKNOWN',
    confidence: 0,
    totalScore: 0,
    url,
    timestamp: Date.now(),
    analysisError: reason,
  };
}

function unknownResult(reason: string, url: string): AnalyzerResult {
  return {
    content: '',
    verdict: unknownVerdict(reason, url),
    mitigationsApplied: [],
  };
}

interface BrowseToolResultLike {
  readonly content?: unknown;
  readonly verdict?: {
    readonly status?: unknown;
    readonly confidence?: unknown;
    readonly totalScore?: unknown;
    readonly url?: unknown;
    readonly timestamp?: unknown;
    readonly analysisError?: unknown;
  };
  readonly mitigationsApplied?: unknown;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function asReadonlyStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function parseBrowseResult(text: string, url: string): AnalyzerResult {
  let parsed: BrowseToolResultLike;
  try {
    parsed = JSON.parse(text) as BrowseToolResultLike;
  } catch (e) {
    return unknownResult(`failed to parse MCP response: ${(e as Error).message}`, url);
  }
  const verdict = parsed.verdict;
  const status = verdict?.status;
  if (typeof status !== 'string' || !VALID_STATUSES.has(status)) {
    return unknownResult('MCP response shape invalid: missing or unknown verdict.status', url);
  }
  const built: SecurityVerdict = {
    status: status as SecurityStatus,
    confidence: asNumber(verdict?.confidence, 0),
    totalScore: asNumber(verdict?.totalScore, 0),
    url: asString(verdict?.url, url),
    timestamp: asNumber(verdict?.timestamp, Date.now()),
    analysisError:
      typeof verdict?.analysisError === 'string' ? verdict.analysisError : null,
  };
  return {
    content: asString(parsed.content, ''),
    verdict: built,
    mitigationsApplied: asReadonlyStringArray(parsed.mitigationsApplied),
  };
}

function isToolResponse(value: unknown): value is McpToolResponse {
  return typeof value === 'object' && value !== null && 'content' in value;
}

export function createMcpAnalyzer(opts: CreateMcpAnalyzerOptions): Analyzer {
  const toolName = opts.toolName ?? 'analyze_html';
  return {
    async analyzeHtml(params) {
      const url = params.url ?? '';
      const args: Record<string, unknown> = { html: params.html };
      if (params.url !== undefined) {
        args.url = params.url;
      }
      let response: unknown;
      try {
        response = await opts.client.callTool({
          name: toolName,
          arguments: args,
        });
      } catch (e) {
        return unknownResult(
          `MCP transport error: ${(e as Error).message ?? String(e)}`,
          url,
        );
      }
      if (!isToolResponse(response)) {
        return unknownResult('MCP response missing content array', url);
      }
      const content = response.content ?? [];
      const firstText = content.find((b) => b.type === 'text' && typeof b.text === 'string');
      if (!firstText || typeof firstText.text !== 'string') {
        return unknownResult('MCP response had no text content blocks', url);
      }
      return parseBrowseResult(firstText.text, url);
    },
  };
}
