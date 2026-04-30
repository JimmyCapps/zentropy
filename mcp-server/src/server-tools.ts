import { runBrowse } from './tools/browse.js';
import type { BrowseDeps, Fetcher } from './tools/browse.js';
import type { BrowseToolResult } from './verdict/types.js';

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

export function buildServerTools(deps?: Partial<BrowseDeps>): readonly ToolDescriptor[] {
  const resolved: BrowseDeps = {
    fetcher: deps?.fetcher ?? defaultFetcher,
    now: deps?.now ?? Date.now,
  };

  const browse: ToolDescriptor = {
    name: 'browse',
    description:
      'Fetch a URL and run the HoneyLLM Hawk hunter against the extracted text. ' +
      'Returns post-extraction content, a security verdict, the hunter report, ' +
      'and any mitigations applied. Stage 1: Hawk only; LLM probes attach in later stages.',
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
