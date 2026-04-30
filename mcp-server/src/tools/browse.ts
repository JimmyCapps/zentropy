import type { LlmEndpoint } from '../probes/llm-endpoint.js';
import type { PageRenderer } from '../extract/page-renderer.js';
import { htmlToText } from '../extract/html-to-text.js';
import type { BrowseToolResult } from '../verdict/types.js';
import {
  analyzeText,
  unknownResult,
  validateUrl,
} from '../verdict/signal-pipeline.js';

export interface FetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
}

export type Fetcher = (url: string) => Promise<FetchResponse>;

export interface BrowseInput {
  readonly url: string;
  readonly usePlaywright?: boolean;
}

export interface BrowseDeps {
  readonly fetcher: Fetcher;
  readonly now: () => number;
  readonly llmEndpoint?: LlmEndpoint;
  readonly renderer?: PageRenderer;
}

async function runViaRenderer(
  validatedUrl: string,
  timestamp: number,
  deps: BrowseDeps,
): Promise<BrowseToolResult> {
  if (deps.renderer === undefined) {
    return unknownResult(
      validatedUrl,
      timestamp,
      'usePlaywright requested but no renderer configured (install playwright + browsers)',
    );
  }
  let rendered;
  try {
    rendered = await deps.renderer.render(validatedUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return unknownResult(validatedUrl, timestamp, `renderer failed: ${message}`);
  }
  if (rendered.status !== 0 && (rendered.status < 200 || rendered.status >= 300)) {
    return unknownResult(
      rendered.url || validatedUrl,
      timestamp,
      `renderer reported HTTP ${rendered.status}`,
    );
  }
  const finalUrl = rendered.url || validatedUrl;
  return analyzeText(rendered.text, finalUrl, timestamp, deps.llmEndpoint);
}

async function runViaFetcher(
  validatedUrl: string,
  timestamp: number,
  deps: BrowseDeps,
): Promise<BrowseToolResult> {
  let response: FetchResponse;
  try {
    response = await deps.fetcher(validatedUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return unknownResult(validatedUrl, timestamp, `fetch failed: ${message}`);
  }
  if (!response.ok) {
    return unknownResult(validatedUrl, timestamp, `fetch failed: HTTP ${response.status}`);
  }
  const isHtml = response.contentType.toLowerCase().includes('html');
  const text = isHtml ? htmlToText(response.body) : response.body;
  return analyzeText(text, validatedUrl, timestamp, deps.llmEndpoint);
}

export async function runBrowse(
  input: BrowseInput,
  deps: BrowseDeps,
): Promise<BrowseToolResult> {
  const timestamp = deps.now();
  const validated = validateUrl(input.url);
  if (!validated.ok) return unknownResult(input.url, timestamp, validated.error);
  if (input.usePlaywright === true) {
    return runViaRenderer(validated.url, timestamp, deps);
  }
  return runViaFetcher(validated.url, timestamp, deps);
}
