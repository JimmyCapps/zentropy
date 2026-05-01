import { DynamicTool } from '@langchain/core/tools';
import {
  defaultExtractUrl,
  screenContentOrThrow,
  type Analyzer,
  type WrapPolicy,
} from '@honeyllm/agent-sdk-core';

export interface WrapAsLangChainToolOptions {
  readonly analyzer: Analyzer;
  readonly policy?: WrapPolicy;
  readonly extractUrl?: (input: string) => string | undefined;
}

interface LangChainToolLike {
  readonly name: string;
  readonly description: string;
  invoke(input: string): Promise<string>;
}

export function wrapAsLangChainTool(
  tool: LangChainToolLike,
  opts: WrapAsLangChainToolOptions,
): DynamicTool {
  const extractUrl = opts.extractUrl ?? defaultExtractUrl;
  return new DynamicTool({
    name: tool.name,
    description: tool.description,
    func: async (input: string): Promise<string> => {
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
  });
}

export function wrapRequestsGetTool(
  tool: LangChainToolLike,
  opts: WrapAsLangChainToolOptions,
): DynamicTool {
  return wrapAsLangChainTool(tool, opts);
}
