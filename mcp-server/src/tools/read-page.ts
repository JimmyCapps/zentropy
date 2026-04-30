import type { LlmEndpoint } from '../probes/llm-endpoint.js';
import type { PageRenderer } from '../extract/page-renderer.js';
import type { BrowseToolResult } from '../verdict/types.js';
import {
  analyzeText,
  unknownResult,
  validateUrl,
} from '../verdict/signal-pipeline.js';

export interface ReadPageInput {
  readonly url: string;
}

export interface ReadPageDeps {
  readonly renderer: PageRenderer;
  readonly now: () => number;
  readonly llmEndpoint?: LlmEndpoint;
}

export async function runReadPage(
  input: ReadPageInput,
  deps: ReadPageDeps,
): Promise<BrowseToolResult> {
  const timestamp = deps.now();
  const validated = validateUrl(input.url);
  if (!validated.ok) return unknownResult(input.url, timestamp, validated.error);

  let rendered;
  try {
    rendered = await deps.renderer.render(validated.url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return unknownResult(validated.url, timestamp, `renderer failed: ${message}`);
  }
  if (rendered.status !== 0 && (rendered.status < 200 || rendered.status >= 300)) {
    return unknownResult(
      rendered.url || validated.url,
      timestamp,
      `renderer reported HTTP ${rendered.status}`,
    );
  }
  const finalUrl = rendered.url || validated.url;
  return analyzeText(rendered.text, finalUrl, timestamp, deps.llmEndpoint);
}
