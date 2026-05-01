import { AIMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { type Runnable, RunnableLambda } from '@langchain/core/runnables';
import { defaultExtractUrl, type ExtractUrl } from './extract-url.js';
import { screenContentOrThrow } from './screen.js';
import type { Analyzer, WrapPolicy } from './types.js';

export interface HoneyLLMMiddlewareOptions {
  readonly analyzer: Analyzer;
  readonly policy?: WrapPolicy;
  readonly toolNames?: readonly string[];
  readonly extractUrl?: ExtractUrl<unknown>;
}

function isAIMessage(m: BaseMessage): m is AIMessage {
  return m._getType() === 'ai';
}

function findTailToolBatchStart(messages: readonly BaseMessage[]): number {
  let i = messages.length - 1;
  while (i >= 0 && messages[i] instanceof ToolMessage) {
    i -= 1;
  }
  return i + 1;
}

function findToolCallArgs(
  messages: readonly BaseMessage[],
  batchStart: number,
  toolCallId: string,
): unknown {
  for (let j = batchStart - 1; j >= 0; j -= 1) {
    const m = messages[j];
    if (!m || !isAIMessage(m)) continue;
    const calls = m.tool_calls ?? [];
    const match = calls.find((c) => c.id === toolCallId);
    if (match) return match.args;
    return undefined;
  }
  return undefined;
}

function rebuildToolMessage(original: ToolMessage, content: string): ToolMessage {
  return new ToolMessage({
    content,
    tool_call_id: original.tool_call_id,
    ...(original.name !== undefined ? { name: original.name } : {}),
    ...(original.status !== undefined ? { status: original.status } : {}),
    ...(original.additional_kwargs !== undefined
      ? { additional_kwargs: original.additional_kwargs }
      : {}),
    ...(original.response_metadata !== undefined
      ? { response_metadata: original.response_metadata }
      : {}),
    ...(original.id !== undefined ? { id: original.id } : {}),
    ...(original.artifact !== undefined ? { artifact: original.artifact } : {}),
  });
}

export async function screenToolMessages(
  messages: readonly BaseMessage[],
  opts: HoneyLLMMiddlewareOptions,
): Promise<readonly BaseMessage[]> {
  if (messages.length === 0) return messages;
  const batchStart = findTailToolBatchStart(messages);
  if (batchStart === messages.length) return messages;

  const extractUrl = opts.extractUrl ?? ((args: unknown) => defaultExtractUrl(args));
  const allowed = opts.toolNames ? new Set(opts.toolNames) : null;

  const out: BaseMessage[] = messages.slice();
  for (let k = batchStart; k < messages.length; k += 1) {
    const tm = messages[k] as ToolMessage;
    if (allowed && (tm.name === undefined || !allowed.has(tm.name))) continue;
    if (tm.status === 'error') continue;
    if (typeof tm.content !== 'string') continue;

    const args = findToolCallArgs(messages, batchStart, tm.tool_call_id);
    const url = args !== undefined ? extractUrl(args) : undefined;

    const screened = await screenContentOrThrow({
      html: tm.content,
      analyzer: opts.analyzer,
      ...(url !== undefined ? { url } : {}),
      ...(opts.policy !== undefined ? { policy: opts.policy } : {}),
    });
    out[k] = rebuildToolMessage(tm, screened.content);
  }
  return out;
}

export type MiddlewareInput =
  | readonly BaseMessage[]
  | { readonly messages: readonly BaseMessage[] };

export type MiddlewareOutput =
  | readonly BaseMessage[]
  | { readonly messages: readonly BaseMessage[] };

function isStateShape(
  input: MiddlewareInput,
): input is { readonly messages: readonly BaseMessage[] } {
  return !Array.isArray(input) && typeof input === 'object' && input !== null && 'messages' in input;
}

export function createHoneyLLMMiddleware(
  opts: HoneyLLMMiddlewareOptions,
): Runnable<MiddlewareInput, MiddlewareOutput> {
  return RunnableLambda.from(async (input: MiddlewareInput): Promise<MiddlewareOutput> => {
    if (isStateShape(input)) {
      const screened = await screenToolMessages(input.messages, opts);
      return { messages: screened };
    }
    return await screenToolMessages(input, opts);
  });
}
