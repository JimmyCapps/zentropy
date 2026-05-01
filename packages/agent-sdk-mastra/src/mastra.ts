import type { Tool } from '@mastra/core/tools';
import {
  defaultExtractUrl,
  screenContentOrThrow,
  type Analyzer,
  type WrapPolicy,
} from '@honeyllm/agent-sdk-core';

export interface MastraToolLike<TContext = unknown> {
  readonly id?: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
  readonly outputSchema?: unknown;
  readonly execute?: (context: TContext, options?: unknown) => unknown | Promise<unknown>;
}

export interface WrapMastraToolOptions<TContext = unknown> {
  readonly analyzer: Analyzer;
  readonly policy?: WrapPolicy;
  readonly extractUrl?: (context: TContext) => string | undefined;
}

function defaultMastraExtractUrl(context: unknown): string | undefined {
  if (context !== null && typeof context === 'object') {
    const inner = (context as { context?: unknown }).context;
    const fromInput = defaultExtractUrl(inner);
    if (fromInput !== undefined) return fromInput;
  }
  return defaultExtractUrl(context);
}

export function wrapMastraTool<TContext = unknown>(
  source: MastraToolLike<TContext>,
  opts: WrapMastraToolOptions<TContext>,
): Tool {
  if (typeof source.execute !== 'function') {
    throw new Error('wrapMastraTool: source tool has no `execute` function');
  }
  const sourceExecute = source.execute;
  const extractUrl =
    opts.extractUrl ??
    ((context: TContext) => defaultMastraExtractUrl(context as unknown));

  const screenedExecute = async (
    context: TContext,
    options?: unknown,
  ): Promise<string> => {
    const raw = await sourceExecute(context, options);
    const html = typeof raw === 'string' ? raw : JSON.stringify(raw);
    const url = extractUrl(context);
    const screened = await screenContentOrThrow({
      html,
      analyzer: opts.analyzer,
      ...(url !== undefined ? { url } : {}),
      ...(opts.policy !== undefined ? { policy: opts.policy } : {}),
    });
    return screened.content;
  };

  const wrapped = {
    id: source.id,
    description: source.description,
    inputSchema: source.inputSchema,
    outputSchema: source.outputSchema,
    execute: screenedExecute,
  };

  return wrapped as unknown as Tool;
}
