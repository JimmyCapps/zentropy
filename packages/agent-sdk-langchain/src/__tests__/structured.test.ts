import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';
import type { Analyzer, AnalyzerResult, SecurityVerdict } from '@honeyllm/agent-sdk-core';
import { HoneyLLMBlockedError } from '@honeyllm/agent-sdk-core';
import { wrapAsStructuredTool } from '../structured.js';

function makeVerdict(status: SecurityVerdict['status'], score = 0): SecurityVerdict {
  return {
    status,
    confidence: 100,
    totalScore: score,
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
  verdict: makeVerdict('COMPROMISED', 80),
  mitigationsApplied: ['stripped:script'],
};

const fetchSchema = z.object({
  url: z.string(),
  timeout: z.number().optional(),
});

function makeFetcher(body = '<html>raw</html>') {
  return new DynamicStructuredTool({
    name: 'web-fetch',
    description: 'fetches the body of a URL',
    schema: fetchSchema,
    func: async () => body,
  });
}

describe('wrapAsStructuredTool', () => {
  it('returns a DynamicStructuredTool with same name + description + schema', () => {
    const fetcher = makeFetcher();
    const wrapped = wrapAsStructuredTool(fetcher, {
      analyzer: makeAnalyzer(cleanResult),
    });
    expect(wrapped).toBeInstanceOf(DynamicStructuredTool);
    expect(wrapped.name).toBe('web-fetch');
    expect(wrapped.description).toBe('fetches the body of a URL');
    expect(wrapped.schema).toBe(fetchSchema);
  });

  it('returns sanitised content on CLEAN', async () => {
    const fetcher = makeFetcher();
    const wrapped = wrapAsStructuredTool(fetcher, {
      analyzer: makeAnalyzer(cleanResult),
    });
    const out = await wrapped.invoke({ url: 'https://example.com/' });
    expect(out).toBe('sanitised');
  });

  it('throws HoneyLLMBlockedError on COMPROMISED with default policy', async () => {
    const fetcher = makeFetcher();
    const wrapped = wrapAsStructuredTool(fetcher, {
      analyzer: makeAnalyzer(compromisedResult),
    });
    await expect(wrapped.invoke({ url: 'https://example.com/' })).rejects.toBeInstanceOf(
      HoneyLLMBlockedError,
    );
  });

  it('does not throw on COMPROMISED under flag-only policy', async () => {
    const fetcher = makeFetcher();
    const wrapped = wrapAsStructuredTool(fetcher, {
      analyzer: makeAnalyzer(compromisedResult),
      policy: 'flag-only',
    });
    const out = await wrapped.invoke({ url: 'https://example.com/' });
    expect(out).toBe('tainted');
  });

  it('extracts url field from typed input by default', async () => {
    const fetcher = makeFetcher();
    const analyzer = makeAnalyzer(cleanResult);
    const wrapped = wrapAsStructuredTool(fetcher, { analyzer });
    await wrapped.invoke({ url: 'https://example.com/specific' });
    expect(analyzer.analyzeHtml).toHaveBeenCalledWith({
      html: '<html>raw</html>',
      url: 'https://example.com/specific',
    });
  });

  it('honours custom extractUrl when provided', async () => {
    const customSchema = z.object({ target: z.string() });
    const fetcher = new DynamicStructuredTool({
      name: 'fetch',
      description: 'd',
      schema: customSchema,
      func: async () => '<html/>',
    });
    const analyzer = makeAnalyzer(cleanResult);
    const wrapped = wrapAsStructuredTool<{ target: string }>(fetcher, {
      analyzer,
      extractUrl: (input) => input.target,
    });
    await wrapped.invoke({ target: 'https://other.example/' });
    expect(analyzer.analyzeHtml).toHaveBeenCalledWith({
      html: '<html/>',
      url: 'https://other.example/',
    });
  });

  it('forwards typed input to underlying func unchanged', async () => {
    const innerFunc = vi.fn(
      async (_input: { url: string; timeout?: number }) => '<html/>',
    );
    const fetcher = new DynamicStructuredTool({
      name: 'fetch',
      description: 'd',
      schema: z.object({ url: z.string(), timeout: z.number().optional() }),
      func: innerFunc,
    });
    const wrapped = wrapAsStructuredTool(fetcher, {
      analyzer: makeAnalyzer(cleanResult),
    });
    await wrapped.invoke({ url: 'https://example.com/', timeout: 5000 });
    expect(innerFunc).toHaveBeenCalled();
    const firstCallArgs = innerFunc.mock.calls[0]?.[0];
    expect(firstCallArgs).toMatchObject({ url: 'https://example.com/', timeout: 5000 });
  });

  it('preserves verdict + mitigations on BlockedError', async () => {
    const fetcher = makeFetcher();
    const wrapped = wrapAsStructuredTool(fetcher, {
      analyzer: makeAnalyzer(compromisedResult),
    });
    try {
      await wrapped.invoke({ url: 'https://example.com/' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HoneyLLMBlockedError);
      const err = e as HoneyLLMBlockedError;
      expect(err.verdict.status).toBe('COMPROMISED');
      expect(err.mitigationsApplied).toEqual(['stripped:script']);
    }
  });

  it('falls through to default extractUrl object heuristic for url-less inputs', async () => {
    const schema = z.object({ q: z.string() });
    const fetcher = new DynamicStructuredTool({
      name: 'search',
      description: 'd',
      schema,
      func: async () => '<html/>',
    });
    const analyzer = makeAnalyzer(cleanResult);
    const wrapped = wrapAsStructuredTool(fetcher, { analyzer });
    await wrapped.invoke({ q: 'kittens' });
    expect(analyzer.analyzeHtml).toHaveBeenCalledWith({ html: '<html/>' });
  });

  it('extracts href field when input uses href instead of url', async () => {
    const schema = z.object({ href: z.string() });
    const fetcher = new DynamicStructuredTool({
      name: 'fetch',
      description: 'd',
      schema,
      func: async () => '<html/>',
    });
    const analyzer = makeAnalyzer(cleanResult);
    const wrapped = wrapAsStructuredTool(fetcher, { analyzer });
    await wrapped.invoke({ href: 'https://example.com/' });
    expect(analyzer.analyzeHtml).toHaveBeenCalledWith({
      html: '<html/>',
      url: 'https://example.com/',
    });
  });

  it('propagates errors from underlying func', async () => {
    const fetcher = new DynamicStructuredTool({
      name: 'fetch',
      description: 'd',
      schema: z.object({ url: z.string() }),
      func: async () => {
        throw new Error('upstream broke');
      },
    });
    const wrapped = wrapAsStructuredTool(fetcher, {
      analyzer: makeAnalyzer(cleanResult),
    });
    await expect(wrapped.invoke({ url: 'https://example.com/' })).rejects.toThrow(
      'upstream broke',
    );
  });
});
