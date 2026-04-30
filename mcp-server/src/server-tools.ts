import { runBrowse } from './tools/browse.js';
import type { BrowseDeps, Fetcher } from './tools/browse.js';
import type { BrowseToolResult } from './verdict/types.js';
import { createOpenAiCompatEndpoint } from './probes/llm-endpoint.js';
import type { LlmEndpoint } from './probes/llm-endpoint.js';

export interface JsonSchemaProperty {
  readonly type: string;
  readonly description?: string;
}

export interface JsonObjectSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, JsonSchemaProperty>>;
  readonly required: readonly string[];
}

export interface ToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonObjectSchema;
  readonly handler: (input: Readonly<Record<string, unknown>>) => Promise<BrowseToolResult>;
}

const defaultFetcher: Fetcher = async (url) => {
  const res = await fetch(url);
  const body = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    contentType: res.headers.get('content-type') ?? '',
    body,
  };
};

function asUrl(input: Readonly<Record<string, unknown>>): string {
  const value = input.url;
  return typeof value === 'string' ? value : '';
}

export function endpointFromEnv(env: NodeJS.ProcessEnv = process.env): LlmEndpoint | undefined {
  const baseUrl = env.HONEYLLM_LLM_BASE_URL;
  const model = env.HONEYLLM_LLM_MODEL;
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) return undefined;
  if (typeof model !== 'string' || model.length === 0) return undefined;
  const apiKey = env.HONEYLLM_LLM_API_KEY;
  const timeoutRaw = env.HONEYLLM_LLM_TIMEOUT_MS;
  const timeoutMs =
    typeof timeoutRaw === 'string' && timeoutRaw.length > 0 ? Number(timeoutRaw) : undefined;
  return createOpenAiCompatEndpoint({
    baseUrl,
    model,
    ...(typeof apiKey === 'string' && apiKey.length > 0 ? { apiKey } : {}),
    ...(typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) ? { timeoutMs } : {}),
  });
}

export function buildServerTools(deps?: Partial<BrowseDeps>): readonly ToolDescriptor[] {
  const resolved: BrowseDeps = {
    fetcher: deps?.fetcher ?? defaultFetcher,
    now: deps?.now ?? Date.now,
    ...(deps?.llmEndpoint !== undefined ? { llmEndpoint: deps.llmEndpoint } : {}),
  };
  if (resolved.llmEndpoint === undefined) {
    const envEndpoint = endpointFromEnv();
    if (envEndpoint !== undefined) {
      (resolved as { llmEndpoint?: LlmEndpoint }).llmEndpoint = envEndpoint;
    }
  }

  const probeEnabled = resolved.llmEndpoint !== undefined;
  const browse: ToolDescriptor = {
    name: 'browse',
    description:
      'Fetch a URL and run the HoneyLLM Hawk + Spider hunters against the extracted text. ' +
      (probeEnabled
        ? 'When configured, also runs the instruction-detection canary probe against an OpenAI-compat LLM endpoint. '
        : '') +
      'Returns post-extraction content, a security verdict, the hunter+probe report, and any mitigations applied.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'http(s) URL to fetch and analyze' },
      },
      required: ['url'],
    },
    handler: async (input) => runBrowse({ url: asUrl(input) }, resolved),
  };

  return [browse];
}
