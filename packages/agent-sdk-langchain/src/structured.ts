import { DynamicStructuredTool } from '@langchain/core/tools';
import { defaultExtractUrl, type ExtractUrl } from './extract-url.js';
import { screenContentOrThrow } from './screen.js';
import type { Analyzer, WrapPolicy } from './types.js';

export interface WrapAsStructuredToolOptions<TInput> {
  readonly analyzer: Analyzer;
  readonly policy?: WrapPolicy;
  readonly extractUrl?: ExtractUrl<TInput>;
}

interface StructuredToolLike<TInput> {
  readonly name: string;
  readonly description: string;
  readonly schema: unknown;
  invoke(input: TInput): Promise<unknown>;
}

export function wrapAsStructuredTool<TInput extends Record<string, unknown>>(
  tool: StructuredToolLike<TInput>,
  opts: WrapAsStructuredToolOptions<TInput>,
): DynamicStructuredTool {
  const extractUrl: ExtractUrl<TInput> =
    opts.extractUrl ?? ((input: TInput) => defaultExtractUrl(input));
  return new DynamicStructuredTool({
    name: tool.name,
    description: tool.description,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema: tool.schema as any,
    func: async (input: TInput): Promise<string> => {
      const raw = await tool.invoke(input);
      const html = typeof raw === 'string' ? raw : JSON.stringify(raw);
      const url = extractUrl(input);
      const screened = await screenContentOrThrow({
        html,
        analyzer: opts.analyzer,
        ...(url !== undefined ? { url } : {}),
        ...(opts.policy !== undefined ? { policy: opts.policy } : {}),
      });
      return screened.content;
    },
  });
}
