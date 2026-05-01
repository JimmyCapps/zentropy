import { describe, expect, it, vi } from 'vitest';
import { Runnable, RunnableLambda } from '@langchain/core/runnables';
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import type { Analyzer, AnalyzerResult, SecurityVerdict } from '../types.js';
import { HoneyLLMBlockedError } from '../types.js';
import { createHoneyLLMMiddleware } from '../middleware.js';

function makeVerdict(status: SecurityVerdict['status']): SecurityVerdict {
  return {
    status,
    confidence: 100,
    totalScore: status === 'COMPROMISED' ? 80 : 0,
    url: 'https://example.com/',
    timestamp: 1_700_000_000_000,
    analysisError: null,
  };
}

const cleanResult: AnalyzerResult = {
  content: 'sanitised',
  verdict: makeVerdict('CLEAN'),
  mitigationsApplied: [],
};

const compromisedResult: AnalyzerResult = {
  content: 'tainted',
  verdict: makeVerdict('COMPROMISED'),
  mitigationsApplied: [],
};

function makeAnalyzer(result: AnalyzerResult): Analyzer {
  return { analyzeHtml: vi.fn(async () => result) };
}

function singleToolBatch() {
  const ai = new AIMessage({
    content: '',
    tool_calls: [{ name: 'web_fetch', args: { url: 'https://example.com/' }, id: 't1' }],
  });
  const tm = new ToolMessage({
    content: '<html>raw</html>',
    tool_call_id: 't1',
    name: 'web_fetch',
  });
  return [ai, tm];
}

describe('createHoneyLLMMiddleware', () => {
  it('returns a LangChain Runnable instance', () => {
    const mw = createHoneyLLMMiddleware({ analyzer: makeAnalyzer(cleanResult) });
    expect(mw).toBeInstanceOf(Runnable);
  });

  it('accepts a BaseMessage[] input and returns the screened array', async () => {
    const mw = createHoneyLLMMiddleware({ analyzer: makeAnalyzer(cleanResult) });
    const out = await mw.invoke(singleToolBatch());
    expect(Array.isArray(out)).toBe(true);
    expect((out as readonly ToolMessage[])[1]?.content).toBe('sanitised');
  });

  it('accepts a {messages: BaseMessage[]} state input and returns {messages}', async () => {
    const mw = createHoneyLLMMiddleware({ analyzer: makeAnalyzer(cleanResult) });
    const out = await mw.invoke({ messages: singleToolBatch() });
    expect(out).toHaveProperty('messages');
    expect((out as { messages: readonly ToolMessage[] }).messages[1]?.content).toBe(
      'sanitised',
    );
  });

  it('throws HoneyLLMBlockedError on COMPROMISED via the Runnable', async () => {
    const mw = createHoneyLLMMiddleware({ analyzer: makeAnalyzer(compromisedResult) });
    await expect(mw.invoke(singleToolBatch())).rejects.toBeInstanceOf(HoneyLLMBlockedError);
  });

  it('composes with .pipe() — graph-level use', async () => {
    const mw = createHoneyLLMMiddleware({ analyzer: makeAnalyzer(cleanResult) });
    const tail = RunnableLambda.from((msgs: readonly ToolMessage[]) => {
      const last = msgs[msgs.length - 1];
      return last && typeof last.content === 'string' ? last.content.toUpperCase() : '';
    });
    const chain = mw.pipe(tail);
    const out = await chain.invoke(singleToolBatch());
    expect(out).toBe('SANITISED');
  });

  it('honours flag-only policy on COMPROMISED through the Runnable boundary', async () => {
    const mw = createHoneyLLMMiddleware({
      analyzer: makeAnalyzer(compromisedResult),
      policy: 'flag-only',
    });
    const out = await mw.invoke(singleToolBatch());
    expect((out as readonly ToolMessage[])[1]?.content).toBe('tainted');
  });
});
