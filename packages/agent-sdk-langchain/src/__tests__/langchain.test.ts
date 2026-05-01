import { describe, expect, it, vi } from 'vitest';
import { DynamicTool } from '@langchain/core/tools';
import type { Analyzer, AnalyzerResult, SecurityVerdict } from '@honeyllm/agent-sdk-core';
import { HoneyLLMBlockedError } from '@honeyllm/agent-sdk-core';
import { wrapAsLangChainTool } from '../langchain.js';

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

function makeAnalyzer(result: AnalyzerResult): Analyzer {
  return { analyzeHtml: vi.fn(async () => result) };
}

describe('wrapAsLangChainTool', () => {
  it('returns a LangChain DynamicTool with the same name + description', () => {
    const fetcher = new DynamicTool({
      name: 'web-fetch',
      description: 'fetches the body of a URL',
      func: async () => '<html>raw</html>',
    });
    const wrapped = wrapAsLangChainTool(fetcher, {
      analyzer: makeAnalyzer({
        content: 'safe',
        verdict: makeVerdict('CLEAN'),
        mitigationsApplied: [],
      }),
    });
    expect(wrapped).toBeInstanceOf(DynamicTool);
    expect(wrapped.name).toBe('web-fetch');
    expect(wrapped.description).toBe('fetches the body of a URL');
  });

  it('returns sanitised content on CLEAN', async () => {
    const fetcher = new DynamicTool({
      name: 'web-fetch',
      description: 'fetches the body of a URL',
      func: async () => '<html>raw</html>',
    });
    const wrapped = wrapAsLangChainTool(fetcher, {
      analyzer: makeAnalyzer({
        content: 'sanitised',
        verdict: makeVerdict('CLEAN'),
        mitigationsApplied: [],
      }),
    });
    const out = await wrapped.invoke('https://example.com/');
    expect(out).toBe('sanitised');
  });

  it('throws HoneyLLMBlockedError on COMPROMISED', async () => {
    const fetcher = new DynamicTool({
      name: 'web-fetch',
      description: 'd',
      func: async () => '<html>tainted</html>',
    });
    const wrapped = wrapAsLangChainTool(fetcher, {
      analyzer: makeAnalyzer({
        content: 'tainted',
        verdict: makeVerdict('COMPROMISED'),
        mitigationsApplied: ['stripped:script'],
      }),
    });
    await expect(wrapped.invoke('https://example.com/')).rejects.toBeInstanceOf(
      HoneyLLMBlockedError,
    );
  });

  it('forwards URL string input as analyzer url hint', async () => {
    const fetcher = new DynamicTool({
      name: 'web-fetch',
      description: 'd',
      func: async () => '<html/>',
    });
    const analyzer = makeAnalyzer({
      content: '',
      verdict: makeVerdict('CLEAN'),
      mitigationsApplied: [],
    });
    const wrapped = wrapAsLangChainTool(fetcher, { analyzer });
    await wrapped.invoke('https://example.com/specific');
    expect(analyzer.analyzeHtml).toHaveBeenCalledWith({
      html: '<html/>',
      url: 'https://example.com/specific',
    });
  });

  it('respects flag-only policy (does not throw on COMPROMISED)', async () => {
    const fetcher = new DynamicTool({
      name: 'web-fetch',
      description: 'd',
      func: async () => '<html>x</html>',
    });
    const wrapped = wrapAsLangChainTool(fetcher, {
      analyzer: makeAnalyzer({
        content: 'tainted',
        verdict: makeVerdict('COMPROMISED'),
        mitigationsApplied: [],
      }),
      policy: 'flag-only',
    });
    const out = await wrapped.invoke('https://example.com/');
    expect(out).toBe('tainted');
  });

  it('forwards the underlying tool invocation input as a string', async () => {
    const innerFunc = vi.fn(async (input: string) => `body:${input}`);
    const fetcher = new DynamicTool({
      name: 'echo',
      description: 'd',
      func: innerFunc,
    });
    const wrapped = wrapAsLangChainTool(fetcher, {
      analyzer: makeAnalyzer({
        content: 'safe',
        verdict: makeVerdict('CLEAN'),
        mitigationsApplied: [],
      }),
    });
    await wrapped.invoke('https://example.com/x');
    expect(innerFunc).toHaveBeenCalled();
    expect(innerFunc.mock.calls[0]?.[0]).toBe('https://example.com/x');
  });
});
