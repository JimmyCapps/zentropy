import { describe, expect, it, vi } from 'vitest';
import { DynamicTool } from '@langchain/core/tools';
import type { Analyzer, AnalyzerResult, SecurityVerdict } from '../types.js';
import { HoneyLLMBlockedError } from '../types.js';
import { wrapRequestsGetTool } from '../langchain.js';

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
  content: 'sanitised body',
  verdict: makeVerdict('CLEAN'),
  mitigationsApplied: [],
};

const compromisedResult: AnalyzerResult = {
  content: 'tainted body',
  verdict: makeVerdict('COMPROMISED'),
  mitigationsApplied: ['stripped:script'],
};

function fakeRequestsTool() {
  return new DynamicTool({
    name: 'requests_get',
    description: 'Issues an HTTP GET request to a URL.',
    func: async (input: string) => `<html>body of ${input}</html>`,
  });
}

describe('wrapRequestsGetTool', () => {
  it('returns a DynamicTool with same name + description', () => {
    const wrapped = wrapRequestsGetTool(fakeRequestsTool(), {
      analyzer: makeAnalyzer(cleanResult),
    });
    expect(wrapped).toBeInstanceOf(DynamicTool);
    expect(wrapped.name).toBe('requests_get');
    expect(wrapped.description).toBe('Issues an HTTP GET request to a URL.');
  });

  it('returns sanitised body on CLEAN', async () => {
    const wrapped = wrapRequestsGetTool(fakeRequestsTool(), {
      analyzer: makeAnalyzer(cleanResult),
    });
    const out = await wrapped.invoke('https://example.com/');
    expect(out).toBe('sanitised body');
  });

  it('forwards the URL string to analyzer as url hint', async () => {
    const analyzer = makeAnalyzer(cleanResult);
    const wrapped = wrapRequestsGetTool(fakeRequestsTool(), { analyzer });
    await wrapped.invoke('https://example.com/path');
    expect(analyzer.analyzeHtml).toHaveBeenCalledWith({
      html: '<html>body of https://example.com/path</html>',
      url: 'https://example.com/path',
    });
  });

  it('throws HoneyLLMBlockedError on COMPROMISED', async () => {
    const wrapped = wrapRequestsGetTool(fakeRequestsTool(), {
      analyzer: makeAnalyzer(compromisedResult),
    });
    await expect(wrapped.invoke('https://example.com/')).rejects.toBeInstanceOf(
      HoneyLLMBlockedError,
    );
  });

  it('respects flag-only policy', async () => {
    const wrapped = wrapRequestsGetTool(fakeRequestsTool(), {
      analyzer: makeAnalyzer(compromisedResult),
      policy: 'flag-only',
    });
    const out = await wrapped.invoke('https://example.com/');
    expect(out).toBe('tainted body');
  });
});
