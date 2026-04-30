import { describe, expect, it, vi } from 'vitest';
import type { Analyzer, AnalyzerResult, SecurityVerdict } from '../types.js';
import { HoneyLLMBlockedError } from '../types.js';
import { wrapWebTool } from '../wrap.js';

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

const cleanResult: AnalyzerResult = {
  content: 'sanitised content',
  verdict: makeVerdict('CLEAN'),
  mitigationsApplied: [],
};

const compromisedResult: AnalyzerResult = {
  content: 'tainted content',
  verdict: makeVerdict('COMPROMISED', 80),
  mitigationsApplied: ['stripped:script'],
};

function fakeTool(returnValue: string): {
  name: string;
  description: string;
  invoke: (input: string) => Promise<string>;
} {
  return {
    name: 'web-fetch',
    description: 'fetches a URL and returns body',
    invoke: vi.fn(async () => returnValue),
  };
}

function fakeAnalyzer(result: AnalyzerResult): Analyzer {
  return { analyzeHtml: vi.fn(async () => result) };
}

describe('wrapWebTool', () => {
  it('preserves name + description', () => {
    const wrapped = wrapWebTool(fakeTool('<html/>'), {
      analyzer: fakeAnalyzer(cleanResult),
    });
    expect(wrapped.name).toBe('web-fetch');
    expect(wrapped.description).toBe('fetches a URL and returns body');
  });

  it('routes the original tool output through the analyzer', async () => {
    const tool = fakeTool('<html>raw</html>');
    const analyzer = fakeAnalyzer(cleanResult);
    const wrapped = wrapWebTool(tool, { analyzer });
    // non-URL string input — default extractor should not attach a url hint
    await wrapped.invoke('search query that is not a url');
    expect(analyzer.analyzeHtml).toHaveBeenCalledWith({ html: '<html>raw</html>' });
  });

  it('returns sanitised content on CLEAN', async () => {
    const wrapped = wrapWebTool(fakeTool('<html>raw</html>'), {
      analyzer: fakeAnalyzer(cleanResult),
    });
    const result = await wrapped.invoke('https://example.com/');
    expect(result).toBe('sanitised content');
  });

  it('throws HoneyLLMBlockedError on COMPROMISED with default policy', async () => {
    const wrapped = wrapWebTool(fakeTool('<html>raw</html>'), {
      analyzer: fakeAnalyzer(compromisedResult),
    });
    await expect(wrapped.invoke('https://example.com/')).rejects.toBeInstanceOf(
      HoneyLLMBlockedError,
    );
  });

  it('does not throw on COMPROMISED under flag-only policy', async () => {
    const wrapped = wrapWebTool(fakeTool('<html>raw</html>'), {
      analyzer: fakeAnalyzer(compromisedResult),
      policy: 'flag-only',
    });
    const result = await wrapped.invoke('https://example.com/');
    expect(result).toBe('tainted content');
  });

  it('passes input string as URL hint when extractUrl is omitted (string input heuristic)', async () => {
    const tool = fakeTool('<html/>');
    const analyzer = fakeAnalyzer(cleanResult);
    const wrapped = wrapWebTool(tool, { analyzer });
    await wrapped.invoke('https://example.com/path');
    expect(analyzer.analyzeHtml).toHaveBeenCalledWith({
      html: '<html/>',
      url: 'https://example.com/path',
    });
  });

  it('uses custom extractUrl when provided', async () => {
    const tool = {
      name: 't',
      description: 'd',
      invoke: vi.fn(async () => '<html/>'),
    };
    const analyzer = fakeAnalyzer(cleanResult);
    const wrapped = wrapWebTool(tool, {
      analyzer,
      extractUrl: (input) =>
        typeof input === 'object' && input !== null && 'url' in input
          ? String((input as { url: unknown }).url)
          : undefined,
    });
    await wrapped.invoke({ url: 'https://other.example/' } as never);
    expect(analyzer.analyzeHtml).toHaveBeenCalledWith({
      html: '<html/>',
      url: 'https://other.example/',
    });
  });

  it('passes the original input through to the underlying tool', async () => {
    const tool = fakeTool('<html/>');
    const wrapped = wrapWebTool(tool, { analyzer: fakeAnalyzer(cleanResult) });
    await wrapped.invoke('https://example.com/specific');
    expect(tool.invoke).toHaveBeenCalledWith('https://example.com/specific');
  });

  it('propagates errors from the underlying tool', async () => {
    const tool = {
      name: 't',
      description: 'd',
      invoke: vi.fn(async () => {
        throw new Error('upstream fetch failed');
      }),
    };
    const wrapped = wrapWebTool(tool, { analyzer: fakeAnalyzer(cleanResult) });
    await expect(wrapped.invoke('https://example.com/')).rejects.toThrow(
      'upstream fetch failed',
    );
  });

  it('attaches verdict + mitigations to BlockedError', async () => {
    const wrapped = wrapWebTool(fakeTool('<x/>'), {
      analyzer: fakeAnalyzer(compromisedResult),
    });
    try {
      await wrapped.invoke('https://example.com/');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HoneyLLMBlockedError);
      const err = e as HoneyLLMBlockedError;
      expect(err.verdict.status).toBe('COMPROMISED');
      expect(err.mitigationsApplied).toEqual(['stripped:script']);
    }
  });

  it('does not pass non-string input as URL hint', async () => {
    const tool = {
      name: 't',
      description: 'd',
      invoke: vi.fn(async () => '<html/>'),
    };
    const analyzer = fakeAnalyzer(cleanResult);
    const wrapped = wrapWebTool(tool, { analyzer });
    await wrapped.invoke({ q: 'x' } as never);
    expect(analyzer.analyzeHtml).toHaveBeenCalledWith({ html: '<html/>' });
  });
});
