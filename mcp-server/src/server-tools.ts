import { runBrowse } from './tools/browse.js';
import type { BrowseDeps, Fetcher } from './tools/browse.js';
import { runReadPage } from './tools/read-page.js';
import type { BrowseToolResult } from './verdict/types.js';
import { createOpenAiCompatEndpoint } from './probes/llm-endpoint.js';
import type { LlmEndpoint } from './probes/llm-endpoint.js';
import {
  createPlaywrightRenderer,
  type PageRenderer,
  type PlaywrightLauncher,
} from './extract/page-renderer.js';

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

export interface ServerToolsDeps extends Partial<BrowseDeps> {
  readonly renderer?: PageRenderer;
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

function asBool(input: Readonly<Record<string, unknown>>, key: string): boolean | undefined {
  const value = input[key];
  return typeof value === 'boolean' ? value : undefined;
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

let cachedDefaultRenderer: PageRenderer | undefined;

async function loadPlaywrightLauncher(): Promise<PlaywrightLauncher | undefined> {
  try {
    const mod = (await import('playwright')) as {
      readonly chromium?: PlaywrightLauncher;
    };
    return mod.chromium;
  } catch {
    return undefined;
  }
}

function defaultRenderer(): PageRenderer {
  if (cachedDefaultRenderer !== undefined) return cachedDefaultRenderer;
  const lazy: PageRenderer = {
    async render(url) {
      const launcher = await loadPlaywrightLauncher();
      if (launcher === undefined) {
        throw new Error(
          "playwright not installed; run `npm install playwright && npx playwright install chromium` in mcp-server/ to enable read_page",
        );
      }
      const real = createPlaywrightRenderer({ launcher });
      cachedDefaultRenderer = real;
      return real.render(url);
    },
  };
  return lazy;
}

export function buildServerTools(deps?: ServerToolsDeps): readonly ToolDescriptor[] {
  const resolved: BrowseDeps = {
    fetcher: deps?.fetcher ?? defaultFetcher,
    now: deps?.now ?? Date.now,
    ...(deps?.llmEndpoint !== undefined ? { llmEndpoint: deps.llmEndpoint } : {}),
    ...(deps?.renderer !== undefined ? { renderer: deps.renderer } : {}),
  };
  if (resolved.llmEndpoint === undefined) {
    const envEndpoint = endpointFromEnv();
    if (envEndpoint !== undefined) {
      (resolved as { llmEndpoint?: LlmEndpoint }).llmEndpoint = envEndpoint;
    }
  }
  const renderer: PageRenderer = deps?.renderer ?? defaultRenderer();

  const probeEnabled = resolved.llmEndpoint !== undefined;
  const browseDescription =
    'Fetch a URL and run the HoneyLLM Hawk + Spider hunters against the extracted text. ' +
    (probeEnabled
      ? 'When configured, also runs the instruction-detection canary probe against an OpenAI-compat LLM endpoint. '
      : '') +
    'Pass usePlaywright:true to render the page in headless Chromium for JS-heavy sites; default uses Node fetch + regex strip for speed. ' +
    'Returns post-extraction content, a security verdict, the hunter+probe report, and any mitigations applied.';

  const browse: ToolDescriptor = {
    name: 'browse',
    description: browseDescription,
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'http(s) URL to fetch and analyze' },
        usePlaywright: {
          type: 'boolean',
          description:
            'Optional. When true, render the page via headless Chromium instead of Node fetch (slower; needed for JS-rendered SPAs).',
        },
      },
      required: ['url'],
    },
    handler: async (input) => {
      const usePlaywright = asBool(input, 'usePlaywright');
      return runBrowse(
        {
          url: asUrl(input),
          ...(usePlaywright !== undefined ? { usePlaywright } : {}),
        },
        resolved,
      );
    },
  };

  const readPageDescription =
    'Fetch a URL using headless Chromium (Playwright) so JS-rendered DOM content settles before analysis, then run the HoneyLLM Hawk + Spider hunters against the rendered text. ' +
    (probeEnabled
      ? 'When configured, also runs the instruction-detection canary probe against an OpenAI-compat LLM endpoint. '
      : '') +
    'Returns post-render content, a security verdict, and the hunter+probe report.';

  const readPage: ToolDescriptor = {
    name: 'read_page',
    description: readPageDescription,
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'http(s) URL to render and analyze (use this for JS-heavy SPAs)',
        },
      },
      required: ['url'],
    },
    handler: async (input) =>
      runReadPage(
        { url: asUrl(input) },
        {
          renderer,
          now: resolved.now,
          ...(resolved.llmEndpoint !== undefined ? { llmEndpoint: resolved.llmEndpoint } : {}),
        },
      ),
  };

  return [browse, readPage];
}
