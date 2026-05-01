import { type Runnable, RunnableLambda } from '@langchain/core/runnables';
import {
  defaultExtractUrl,
  screenContentOrThrow,
  type Analyzer,
  type ExtractUrl,
  type WrapPolicy,
} from '@honeyllm/agent-sdk-core';

export interface InvokableLike<TInput> {
  readonly invoke: (input: TInput) => Promise<string>;
}

export interface WrapAsRunnableOptions<TInput> {
  readonly analyzer: Analyzer;
  readonly policy?: WrapPolicy;
  readonly extractUrl?: ExtractUrl<TInput>;
}

export function wrapAsRunnable<TInput, TOutput extends string = string>(
  tool: InvokableLike<TInput>,
  opts: WrapAsRunnableOptions<TInput>,
): Runnable<TInput, TOutput> {
  const extractUrl: ExtractUrl<TInput> =
    opts.extractUrl ?? ((input: TInput) => defaultExtractUrl(input));
  return RunnableLambda.from(async (input: TInput): Promise<TOutput> => {
    const html = await tool.invoke(input);
    const url = extractUrl(input);
    const screened = await screenContentOrThrow({
      html,
      analyzer: opts.analyzer,
      ...(url !== undefined ? { url } : {}),
      ...(opts.policy !== undefined ? { policy: opts.policy } : {}),
    });
    return screened.content as TOutput;
  });
}
