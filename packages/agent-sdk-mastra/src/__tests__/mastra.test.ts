import { describe, expect, it, vi } from 'vitest';
import type { Tool } from '@mastra/core/tools';
import type { Analyzer, AnalyzerResult, SecurityVerdict } from '@honeyllm/agent-sdk-core';
import { HoneyLLMBlockedError } from '@honeyllm/agent-sdk-core';
import { wrapMastraTool, type MastraToolLike } from '../mastra.js';

const baseVerdict = (status: SecurityVerdict['status']): SecurityVerdict => ({
  status,
  confidence: 0.95,
  totalScore: status === 'CLEAN' ? 0 : 50,
  url: 'https://example.com',
  timestamp: 1700000000000,
  analysisError: null,
});

function makeAnalyzer(
  status: SecurityVerdict['status'],
  content = 'sanitised',
): Analyzer {
  const result: AnalyzerResult = {
    content,
    verdict: baseVerdict(status),
    mitigationsApplied: [],
  };
  return {
    analyzeHtml: vi.fn(async () => result),
  };
}

function makeContext(input: unknown, extra: Record<string, unknown> = {}) {
  return {
    context: input,
    runtimeContext: { get: () => undefined } as unknown,
    ...extra,
  };
}

describe('wrapMastraTool', () => {
  it('preserves id, description, inputSchema, outputSchema', () => {
    const source: MastraToolLike = {
      id: 'browse-tool',
      description: 'browse a url',
      inputSchema: { foo: 'bar' },
      outputSchema: { baz: 'qux' },
      execute: async () => 'raw',
    };
    const wrapped = wrapMastraTool(source, { analyzer: makeAnalyzer('CLEAN') });
    expect(wrapped.id).toBe('browse-tool');
    expect(wrapped.description).toBe('browse a url');
    expect((wrapped as { inputSchema?: unknown }).inputSchema).toEqual({ foo: 'bar' });
    expect((wrapped as { outputSchema?: unknown }).outputSchema).toEqual({ baz: 'qux' });
  });

  it('routes original execute output through the analyzer (CLEAN passes content)', async () => {
    const source: MastraToolLike = {
      id: 'tool',
      description: 'd',
      execute: async () => 'raw page text',
    };
    const analyzer = makeAnalyzer('CLEAN', 'sanitised content');
    const wrapped = wrapMastraTool(source, { analyzer });
    const result = await wrapped.execute!(makeContext({ url: 'https://example.com' }) as never);
    expect(result).toBe('sanitised content');
    expect(analyzer.analyzeHtml).toHaveBeenCalledWith({
      html: 'raw page text',
      url: 'https://example.com',
    });
  });

  it('throws HoneyLLMBlockedError on COMPROMISED with default policy', async () => {
    const source: MastraToolLike = {
      id: 'tool',
      description: 'd',
      execute: async () => 'compromised page',
    };
    const wrapped = wrapMastraTool(source, { analyzer: makeAnalyzer('COMPROMISED') });
    await expect(wrapped.execute!(makeContext({}) as never)).rejects.toBeInstanceOf(
      HoneyLLMBlockedError,
    );
  });

  it('does not throw on COMPROMISED under flag-only policy', async () => {
    const source: MastraToolLike = {
      id: 'tool',
      description: 'd',
      execute: async () => 'compromised page',
    };
    const wrapped = wrapMastraTool(source, {
      analyzer: makeAnalyzer('COMPROMISED', 'still returned'),
      policy: 'flag-only',
    });
    const result = await wrapped.execute!(makeContext({}) as never);
    expect(result).toBe('still returned');
  });

  it('blocks SUSPICIOUS only under block-on-suspicious policy', async () => {
    const source: MastraToolLike = {
      id: 'tool',
      description: 'd',
      execute: async () => 'sus',
    };
    const lenient = wrapMastraTool(source, { analyzer: makeAnalyzer('SUSPICIOUS') });
    await expect(lenient.execute!(makeContext({}) as never)).resolves.toBeDefined();

    const strict = wrapMastraTool(source, {
      analyzer: makeAnalyzer('SUSPICIOUS'),
      policy: 'block-on-suspicious',
    });
    await expect(strict.execute!(makeContext({}) as never)).rejects.toBeInstanceOf(
      HoneyLLMBlockedError,
    );
  });

  it('passes UNKNOWN through (fail-open) under any blocking policy', async () => {
    const source: MastraToolLike = {
      id: 'tool',
      description: 'd',
      execute: async () => 'pass-through',
    };
    for (const policy of ['block-on-compromised', 'block-on-suspicious'] as const) {
      const wrapped = wrapMastraTool(source, {
        analyzer: makeAnalyzer('UNKNOWN', 'pass-through'),
        policy,
      });
      const result = await wrapped.execute!(makeContext({}) as never);
      expect(result).toBe('pass-through');
    }
  });

  it('passes the original context + options through to the underlying execute', async () => {
    const sourceExecute = vi.fn(async () => 'r');
    const source: MastraToolLike = {
      id: 'tool',
      description: 'd',
      execute: sourceExecute,
    };
    const wrapped = wrapMastraTool(source, { analyzer: makeAnalyzer('CLEAN', 'r') });
    const ctx = makeContext({ q: 1 }, { runId: 'run-7' });
    const opts = { toolCallId: 'call-1' };
    await wrapped.execute!(ctx as never, opts as never);
    expect(sourceExecute).toHaveBeenCalledWith(ctx, opts);
  });

  it('uses custom extractUrl when provided', async () => {
    const analyzer = makeAnalyzer('CLEAN', 'r');
    const source: MastraToolLike = {
      id: 'tool',
      description: 'd',
      execute: async () => 'r',
    };
    const wrapped = wrapMastraTool(source, {
      analyzer,
      extractUrl: () => 'https://override.example.com',
    });
    await wrapped.execute!(makeContext({ url: 'https://ignored.example.com' }) as never);
    expect(analyzer.analyzeHtml).toHaveBeenCalledWith({
      html: 'r',
      url: 'https://override.example.com',
    });
  });

  it('falls back to defaultExtractUrl walking context.context for url field', async () => {
    const analyzer = makeAnalyzer('CLEAN', 'r');
    const source: MastraToolLike = {
      id: 'tool',
      description: 'd',
      execute: async () => 'r',
    };
    const wrapped = wrapMastraTool(source, { analyzer });
    await wrapped.execute!(
      makeContext({ url: 'https://typed-input.example.com', other: 1 }) as never,
    );
    expect(analyzer.analyzeHtml).toHaveBeenCalledWith({
      html: 'r',
      url: 'https://typed-input.example.com',
    });
  });

  it('omits url hint when context.context has no recognised URL field', async () => {
    const analyzer = makeAnalyzer('CLEAN', 'r');
    const source: MastraToolLike = {
      id: 'tool',
      description: 'd',
      execute: async () => 'r',
    };
    const wrapped = wrapMastraTool(source, { analyzer });
    await wrapped.execute!(makeContext({ q: 'no-url' }) as never);
    expect(analyzer.analyzeHtml).toHaveBeenCalledWith({ html: 'r' });
  });

  it('coerces non-string execute returns to string before screening', async () => {
    const analyzer = makeAnalyzer('CLEAN', 'r');
    const source: MastraToolLike = {
      id: 'tool',
      description: 'd',
      execute: async () => ({ csvData: 'a,b,c' }),
    };
    const wrapped = wrapMastraTool(source, { analyzer });
    await wrapped.execute!(makeContext({}) as never);
    expect(analyzer.analyzeHtml).toHaveBeenCalledWith({
      html: '{"csvData":"a,b,c"}',
    });
  });

  it('propagates errors from the underlying execute', async () => {
    const source: MastraToolLike = {
      id: 'tool',
      description: 'd',
      execute: async () => {
        throw new Error('upstream-fail');
      },
    };
    const wrapped = wrapMastraTool(source, { analyzer: makeAnalyzer('CLEAN') });
    await expect(wrapped.execute!(makeContext({}) as never)).rejects.toThrow('upstream-fail');
  });

  it('attaches verdict + mitigations to BlockedError', async () => {
    const verdict = baseVerdict('COMPROMISED');
    const analyzer: Analyzer = {
      analyzeHtml: vi.fn(async () => ({
        content: 'discarded',
        verdict,
        mitigationsApplied: ['drop_canary_block'] as readonly string[],
      })),
    };
    const source: MastraToolLike = {
      id: 'tool',
      description: 'd',
      execute: async () => 'page',
    };
    const wrapped = wrapMastraTool(source, { analyzer });
    try {
      await wrapped.execute!(makeContext({}) as never);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HoneyLLMBlockedError);
      const err = e as HoneyLLMBlockedError;
      expect(err.verdict).toEqual(verdict);
      expect(err.mitigationsApplied).toEqual(['drop_canary_block']);
    }
  });

  it('throws if the source tool has no execute function', () => {
    const source: MastraToolLike = { id: 'tool', description: 'd' };
    expect(() => wrapMastraTool(source, { analyzer: makeAnalyzer('CLEAN') })).toThrowError(
      /execute/i,
    );
  });

  it('accepts a Tool produced by the @mastra/core createTool factory', async () => {
    const { createTool } = await import('@mastra/core/tools');
    const { z } = await import('zod');
    const source = createTool({
      id: 'my-tool',
      description: 'a real createTool result',
      inputSchema: z.object({ url: z.string() }),
      execute: (async () => 'real return') as never,
    });
    const wrapped = wrapMastraTool(source as unknown as MastraToolLike, {
      analyzer: makeAnalyzer('CLEAN', 'screened'),
    });
    expect(wrapped.id).toBe('my-tool');
    expect(wrapped.description).toBe('a real createTool result');
    const result = await wrapped.execute!(
      makeContext({ url: 'https://x.example.com' }) as never,
    );
    expect(result).toBe('screened');
  });

  it('returns a value structurally compatible with @mastra/core Tool', () => {
    const source: MastraToolLike = {
      id: 't',
      description: 'd',
      execute: async () => 'r',
    };
    const wrapped: Tool = wrapMastraTool(source, { analyzer: makeAnalyzer('CLEAN') });
    expect(typeof wrapped.id).toBe('string');
    expect(typeof wrapped.description).toBe('string');
    expect(typeof wrapped.execute).toBe('function');
  });
});
