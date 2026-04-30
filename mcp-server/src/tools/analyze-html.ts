import type { LlmEndpoint } from '../probes/llm-endpoint.js';
import { htmlToText } from '../extract/html-to-text.js';
import type { BrowseToolResult } from '../verdict/types.js';
import {
  analyzeText,
  unknownResult,
  validateUrl,
} from '../verdict/signal-pipeline.js';

export interface AnalyzeHtmlInput {
  readonly html: string;
  readonly url?: string;
}

export interface AnalyzeHtmlDeps {
  readonly now: () => number;
  readonly llmEndpoint?: LlmEndpoint;
}

export async function runAnalyzeHtml(
  input: AnalyzeHtmlInput,
  deps: AnalyzeHtmlDeps,
): Promise<BrowseToolResult> {
  const timestamp = deps.now();
  const rawUrl = input.url;
  let finalUrl = '';
  if (typeof rawUrl === 'string' && rawUrl.length > 0) {
    const validated = validateUrl(rawUrl);
    if (!validated.ok) return unknownResult(rawUrl, timestamp, validated.error);
    finalUrl = validated.url;
  }
  if (typeof input.html !== 'string') {
    return unknownResult(finalUrl, timestamp, 'html input must be a string');
  }
  const text = htmlToText(input.html);
  return analyzeText(text, finalUrl, timestamp, deps.llmEndpoint);
}
