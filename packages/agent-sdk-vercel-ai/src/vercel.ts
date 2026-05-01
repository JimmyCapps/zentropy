import type { Tool, ToolCallOptions } from 'ai';
import {
  defaultExtractUrl,
  screenContentOrThrow,
  type Analyzer,
  type ExtractUrl,
  type WrapPolicy,
} from '@honeyllm/agent-sdk-core';

export interface WrapVercelAIToolOptions<TInput = unknown> {
  readonly analyzer: Analyzer;
  readonly policy?: WrapPolicy;
  readonly extractUrl?: ExtractUrl<TInput>;
}

export interface VercelAIToolLike<TInput = unknown> {
  readonly description?: string;
  readonly inputSchema?: unknown;
  readonly execute?: (
    input: TInput,
    options: ToolCallOptions,
  ) => Promise<unknown> | unknown;
}

export function wrapVercelAITool<TInput = unknown>(
  source: VercelAIToolLike<TInput>,
  opts: WrapVercelAIToolOptions<TInput>,
): Tool<TInput, string> {
  const originalExecute = source.execute;
  if (typeof originalExecute !== 'function') {
    throw new Error(
      'wrapVercelAITool requires the source tool to define an execute function',
    );
  }
  const extractUrl: ExtractUrl<TInput> =
    opts.extractUrl ?? ((input: TInput) => defaultExtractUrl(input));
  const description = source.description ?? '';
  const inputSchema = source.inputSchema;
  const execute = async (input: TInput, options: ToolCallOptions): Promise<string> => {
    const raw = await originalExecute(input, options);
    const html = typeof raw === 'string' ? raw : String(raw);
    const url = extractUrl(input);
    const screened = await screenContentOrThrow({
      html,
      analyzer: opts.analyzer,
      ...(url !== undefined ? { url } : {}),
      ...(opts.policy !== undefined ? { policy: opts.policy } : {}),
    });
    return screened.content;
  };
  const wrapped: Record<string, unknown> = {
    description,
    inputSchema,
    execute,
  };
  return wrapped as unknown as Tool<TInput, string>;
}
