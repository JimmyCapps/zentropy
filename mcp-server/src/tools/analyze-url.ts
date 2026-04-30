import { runBrowse } from './browse.js';
import type { Fetcher } from './browse.js';
import type { LlmEndpoint } from '../probes/llm-endpoint.js';
import type { BrowseToolResult } from '../verdict/types.js';

export interface AnalyzeUrlInput {
  readonly url: string;
}

export interface AnalyzeUrlDeps {
  readonly fetcher: Fetcher;
  readonly now: () => number;
  readonly llmEndpoint?: LlmEndpoint;
}

export async function runAnalyzeUrl(
  input: AnalyzeUrlInput,
  deps: AnalyzeUrlDeps,
): Promise<BrowseToolResult> {
  const result = await runBrowse({ url: input.url }, deps);
  return { ...result, content: '' };
}
