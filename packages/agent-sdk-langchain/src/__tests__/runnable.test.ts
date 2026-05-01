import { describe, expect, it, vi } from 'vitest';
import { Runnable, RunnableLambda } from '@langchain/core/runnables';
import type { Analyzer, AnalyzerResult, SecurityVerdict } from '@honeyllm/agent-sdk-core';
import { HoneyLLMBlockedError } from '@honeyllm/agent-sdk-core';
import { wrapAsRunnable } from '../runnable.js';

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

function fakeTool(body = '<html>raw</html>') {
  return {
    name: 'web-fetch',
    description: 'fetches URL',
    invoke: vi.fn(async (_input: string) => body),
  };
}

describe('wrapAsRunnable', () => {
  it('returns a LangChain Runnable', () => {
    const wrapped = wrapAsRunnable(fakeTool(), { analyzer: makeAnalyzer(cleanResult) });
    expect(wrapped).toBeInstanceOf(Runnable);
  });

  it('exposes invoke() that returns sanitised content on CLEAN', async () => {
    const wrapped = wrapAsRunnable(fakeTool(), { analyzer: makeAnalyzer(cleanResult) });
    const out = await wrapped.invoke('https://example.com/');
    expect(out).toBe('sanitised');
  });

  it('throws HoneyLLMBlockedError on COMPROMISED with default policy', async () => {
    const wrapped = wrapAsRunnable(fakeTool(), {
      analyzer: makeAnalyzer(compromisedResult),
    });
    await expect(wrapped.invoke('https://example.com/')).rejects.toBeInstanceOf(
      HoneyLLMBlockedError,
    );
  });

  it('does not throw on COMPROMISED under flag-only policy', async () => {
    const wrapped = wrapAsRunnable(fakeTool(), {
      analyzer: makeAnalyzer(compromisedResult),
      policy: 'flag-only',
    });
    const out = await wrapped.invoke('https://example.com/');
    expect(out).toBe('tainted');
  });

  it('passes URL string input as analyzer hint via default extractor', async () => {
    const analyzer = makeAnalyzer(cleanResult);
    const wrapped = wrapAsRunnable(fakeTool(), { analyzer });
    await wrapped.invoke('https://example.com/path');
    expect(analyzer.analyzeHtml).toHaveBeenCalledWith({
      html: '<html>raw</html>',
      url: 'https://example.com/path',
    });
  });

  it('extracts url field from typed object input', async () => {
    const tool = {
      name: 'fetch',
      description: 'd',
      invoke: vi.fn(async (_input: { url: string }) => '<html/>'),
    };
    const analyzer = makeAnalyzer(cleanResult);
    const wrapped = wrapAsRunnable(tool, { analyzer });
    await wrapped.invoke({ url: 'https://example.com/' });
    expect(analyzer.analyzeHtml).toHaveBeenCalledWith({
      html: '<html/>',
      url: 'https://example.com/',
    });
  });

  it('composes with .pipe() — graph-level use', async () => {
    const wrapped = wrapAsRunnable(fakeTool(), { analyzer: makeAnalyzer(cleanResult) });
    const upper = RunnableLambda.from((s: string) => s.toUpperCase());
    const chain = wrapped.pipe(upper);
    const out = await chain.invoke('https://example.com/');
    expect(out).toBe('SANITISED');
  });

  it('honours custom extractUrl', async () => {
    const tool = {
      name: 'fetch',
      description: 'd',
      invoke: vi.fn(async (_input: { target: string }) => '<html/>'),
    };
    const analyzer = makeAnalyzer(cleanResult);
    const wrapped = wrapAsRunnable<{ target: string }, string>(tool, {
      analyzer,
      extractUrl: (input) => input.target,
    });
    await wrapped.invoke({ target: 'https://other.example/' });
    expect(analyzer.analyzeHtml).toHaveBeenCalledWith({
      html: '<html/>',
      url: 'https://other.example/',
    });
  });

  it('forwards underlying tool errors', async () => {
    const tool = {
      name: 't',
      description: 'd',
      invoke: vi.fn(async (_input: string) => {
        throw new Error('upstream failure');
      }),
    };
    const wrapped = wrapAsRunnable(tool, { analyzer: makeAnalyzer(cleanResult) });
    await expect(wrapped.invoke('https://example.com/')).rejects.toThrow('upstream failure');
  });
});
