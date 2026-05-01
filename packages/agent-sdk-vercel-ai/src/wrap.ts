import { defaultExtractUrl } from './extract-url.js';
import { screenContentOrThrow } from './screen.js';
import type { Analyzer, WrapPolicy } from './types.js';

export interface InvokableTool<TInput = string> {
  readonly name: string;
  readonly description: string;
  readonly invoke: (input: TInput) => Promise<string>;
}

export interface WrapWebToolOptions<TInput = string> {
  readonly analyzer: Analyzer;
  readonly policy?: WrapPolicy;
  readonly extractUrl?: (input: TInput) => string | undefined;
}

export interface WrappedWebTool<TInput = string> {
  readonly name: string;
  readonly description: string;
  readonly invoke: (input: TInput) => Promise<string>;
}

export function wrapWebTool<TInput = string>(
  tool: InvokableTool<TInput>,
  opts: WrapWebToolOptions<TInput>,
): WrappedWebTool<TInput> {
  const extractUrl = opts.extractUrl ?? ((input: TInput) => defaultExtractUrl(input));
  return {
    name: tool.name,
    description: tool.description,
    invoke: async (input: TInput): Promise<string> => {
      const html = await tool.invoke(input);
      const url = extractUrl(input);
      const screened = await screenContentOrThrow({
        html,
        analyzer: opts.analyzer,
        ...(url !== undefined ? { url } : {}),
        ...(opts.policy !== undefined ? { policy: opts.policy } : {}),
      });
      return screened.content;
    },
  };
}
