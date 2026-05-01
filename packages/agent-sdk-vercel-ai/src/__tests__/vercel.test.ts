import { tool } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Analyzer, AnalyzerResult, SecurityVerdict } from '../types.js';
import { HoneyLLMBlockedError } from '../types.js';
import { wrapVercelAITool, type VercelAIToolLike } from '../vercel.js';

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

function fakeAnalyzer(result: AnalyzerResult): Analyzer {
  return { analyzeHtml: vi.fn(async () => result) };
}

function buildFetchTool(
  returnValue: string,
): VercelAIToolLike<{ url: string }> & {
  execute: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn(async () => returnValue);
  return {
    description: 'fetches a URL and returns body',
    inputSchema: z.object({ url: z.string().url() }),
    execute,
  };
}

const callOpts = { toolCallId: 't1', messages: [] } as const;

describe('wrapVercelAITool', () => {
  it('preserves description and inputSchema', () => {
    const original = buildFetchTool('<html/>');
    const wrapped = wrapVercelAITool(original, {
      analyzer: fakeAnalyzer(cleanResult),
    });
    expect((wrapped as VercelAIToolLike).description).toBe(
      'fetches a URL and returns body',
    );
    expect((wrapped as VercelAIToolLike).inputSchema).toBe(original.inputSchema);
  });

  it('routes original execute output through the analyzer (CLEAN passes content)', async () => {
    const original = buildFetchTool('<html>raw</html>');
    const analyzer = fakeAnalyzer(cleanResult);
    const wrapped = wrapVercelAITool(original, { analyzer });
    const result = await wrapped.execute!(
      { url: 'https://example.com/page' },
      callOpts as never,
    );
    expect(result).toBe('sanitised content');
    expect(analyzer.analyzeHtml).toHaveBeenCalledWith({
      html: '<html>raw</html>',
      url: 'https://example.com/page',
    });
  });

  it('throws HoneyLLMBlockedError on COMPROMISED with default policy', async () => {
    const original = buildFetchTool('<html>raw</html>');
    const wrapped = wrapVercelAITool(original, {
      analyzer: fakeAnalyzer(compromisedResult),
    });
    await expect(
      wrapped.execute!({ url: 'https://attacker.example/' }, callOpts as never),
    ).rejects.toBeInstanceOf(HoneyLLMBlockedError);
  });

  it('does not throw on COMPROMISED under flag-only policy', async () => {
    const original = buildFetchTool('<html>raw</html>');
    const wrapped = wrapVercelAITool(original, {
      analyzer: fakeAnalyzer(compromisedResult),
      policy: 'flag-only',
    });
    const result = await wrapped.execute!(
      { url: 'https://attacker.example/' },
      callOpts as never,
    );
    expect(result).toBe('tainted content');
  });

  it('passes the original input + options through to the underlying execute', async () => {
    const original = buildFetchTool('<html/>');
    const wrapped = wrapVercelAITool(original, {
      analyzer: fakeAnalyzer(cleanResult),
    });
    await wrapped.execute!(
      { url: 'https://example.com/specific' },
      callOpts as never,
    );
    expect(original.execute).toHaveBeenCalledWith(
      { url: 'https://example.com/specific' },
      callOpts,
    );
  });

  it('uses custom extractUrl when provided', async () => {
    const original: VercelAIToolLike<{ q: string }> = {
      description: 'd',
      inputSchema: z.object({ q: z.string() }),
      execute: vi.fn(async () => '<html/>'),
    };
    const analyzer = fakeAnalyzer(cleanResult);
    const wrapped = wrapVercelAITool(original, {
      analyzer,
      extractUrl: (input) => `https://search.example/?q=${input.q}`,
    });
    await wrapped.execute!({ q: 'cats' }, callOpts as never);
    expect(analyzer.analyzeHtml).toHaveBeenCalledWith({
      html: '<html/>',
      url: 'https://search.example/?q=cats',
    });
  });

  it('falls back to defaultExtractUrl on typed `url` field for url hint', async () => {
    const original = buildFetchTool('<html/>');
    const analyzer = fakeAnalyzer(cleanResult);
    const wrapped = wrapVercelAITool(original, { analyzer });
    await wrapped.execute!({ url: 'https://example.com/auto' }, callOpts as never);
    expect(analyzer.analyzeHtml).toHaveBeenCalledWith({
      html: '<html/>',
      url: 'https://example.com/auto',
    });
  });

  it('omits url hint when input has no recognised URL field', async () => {
    const original: VercelAIToolLike<{ q: string }> = {
      description: 'd',
      inputSchema: z.object({ q: z.string() }),
      execute: vi.fn(async () => '<html/>'),
    };
    const analyzer = fakeAnalyzer(cleanResult);
    const wrapped = wrapVercelAITool(original, { analyzer });
    await wrapped.execute!({ q: 'free text' }, callOpts as never);
    expect(analyzer.analyzeHtml).toHaveBeenCalledWith({ html: '<html/>' });
  });

  it('coerces non-string execute returns to string before screening', async () => {
    const original: VercelAIToolLike<{ url: string }> = {
      description: 'd',
      inputSchema: z.object({ url: z.string().url() }),
      execute: vi.fn(async () => 12345),
    };
    const analyzer = fakeAnalyzer(cleanResult);
    const wrapped = wrapVercelAITool(original, { analyzer });
    await wrapped.execute!({ url: 'https://example.com/' }, callOpts as never);
    expect(analyzer.analyzeHtml).toHaveBeenCalledWith({
      html: '12345',
      url: 'https://example.com/',
    });
  });

  it('propagates errors from the underlying execute', async () => {
    const original: VercelAIToolLike<{ url: string }> = {
      description: 'd',
      inputSchema: z.object({ url: z.string().url() }),
      execute: vi.fn(async () => {
        throw new Error('upstream fetch failed');
      }),
    };
    const wrapped = wrapVercelAITool(original, {
      analyzer: fakeAnalyzer(cleanResult),
    });
    await expect(
      wrapped.execute!({ url: 'https://example.com/' }, callOpts as never),
    ).rejects.toThrow('upstream fetch failed');
  });

  it('attaches verdict + mitigations to BlockedError', async () => {
    const original = buildFetchTool('<x/>');
    const wrapped = wrapVercelAITool(original, {
      analyzer: fakeAnalyzer(compromisedResult),
    });
    try {
      await wrapped.execute!(
        { url: 'https://attacker.example/' },
        callOpts as never,
      );
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HoneyLLMBlockedError);
      const err = e as HoneyLLMBlockedError;
      expect(err.verdict.status).toBe('COMPROMISED');
      expect(err.mitigationsApplied).toEqual(['stripped:script']);
    }
  });

  it('throws if the source tool has no execute function', () => {
    const noExec: VercelAIToolLike = {
      description: 'no-exec',
      inputSchema: z.object({ url: z.string().url() }),
    };
    expect(() =>
      wrapVercelAITool(noExec, { analyzer: fakeAnalyzer(cleanResult) }),
    ).toThrow(/execute/);
  });

  it('blocks SUSPICIOUS only under block-on-suspicious policy', async () => {
    const suspicious: AnalyzerResult = {
      content: 'borderline',
      verdict: makeVerdict('SUSPICIOUS', 20),
      mitigationsApplied: [],
    };
    const original = buildFetchTool('<x/>');
    const wrappedDefault = wrapVercelAITool(original, {
      analyzer: fakeAnalyzer(suspicious),
    });
    await expect(
      wrappedDefault.execute!({ url: 'https://example.com/' }, callOpts as never),
    ).resolves.toBe('borderline');

    const wrappedStrict = wrapVercelAITool(original, {
      analyzer: fakeAnalyzer(suspicious),
      policy: 'block-on-suspicious',
    });
    await expect(
      wrappedStrict.execute!({ url: 'https://example.com/' }, callOpts as never),
    ).rejects.toBeInstanceOf(HoneyLLMBlockedError);
  });

  it('passes UNKNOWN through (fail-open) under any blocking policy', async () => {
    const unknown: AnalyzerResult = {
      content: '',
      verdict: makeVerdict('UNKNOWN', 0),
      mitigationsApplied: [],
    };
    const original = buildFetchTool('<x/>');
    const wrapped = wrapVercelAITool(original, {
      analyzer: fakeAnalyzer(unknown),
      policy: 'block-on-suspicious',
    });
    await expect(
      wrapped.execute!({ url: 'https://example.com/' }, callOpts as never),
    ).resolves.toBe('');
  });

  it('accepts a Tool produced by the ai package `tool()` factory', () => {
    // Smoke-check that real `tool()` output is structurally compatible.
    const fromFactory = tool({
      description: 'fact-fetch',
      inputSchema: z.object({ url: z.string().url() }),
      execute: async ({ url: _url }) => '<html/>',
    });
    const wrapped = wrapVercelAITool(fromFactory as never, {
      analyzer: fakeAnalyzer(cleanResult),
    });
    expect((wrapped as VercelAIToolLike).description).toBe('fact-fetch');
    expect((wrapped as VercelAIToolLike).inputSchema).toBe(fromFactory.inputSchema);
  });
});
