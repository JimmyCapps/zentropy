import { describe, expect, it, vi } from 'vitest';
import type { Analyzer, AnalyzerResult, SecurityVerdict } from '../types.js';
import { HoneyLLMBlockedError } from '../types.js';
import { screenContent, screenContentOrThrow } from '../screen.js';

function makeVerdict(status: SecurityVerdict['status'], score = 0): SecurityVerdict {
  return {
    status,
    confidence: status === 'UNKNOWN' ? 0 : 100,
    totalScore: score,
    url: 'https://example.com/',
    timestamp: 1_700_000_000_000,
    analysisError: null,
  };
}

function makeAnalyzer(result: AnalyzerResult): Analyzer {
  return {
    analyzeHtml: vi.fn(async () => result),
  };
}

const cleanResult: AnalyzerResult = {
  content: 'safe content',
  verdict: makeVerdict('CLEAN'),
  mitigationsApplied: [],
};

const compromisedResult: AnalyzerResult = {
  content: 'tainted content',
  verdict: makeVerdict('COMPROMISED', 80),
  mitigationsApplied: ['stripped:script'],
};

const suspiciousResult: AnalyzerResult = {
  content: 'borderline content',
  verdict: makeVerdict('SUSPICIOUS', 20),
  mitigationsApplied: [],
};

const unknownResult: AnalyzerResult = {
  content: '',
  verdict: makeVerdict('UNKNOWN', 0),
  mitigationsApplied: [],
};

describe('screenContent', () => {
  it('passes CLEAN content through under any policy', async () => {
    const analyzer = makeAnalyzer(cleanResult);
    const out = await screenContent({
      html: '<html>safe</html>',
      url: 'https://example.com/',
      analyzer,
      policy: 'block-on-suspicious',
    });
    expect(out.blocked).toBe(false);
    if (!out.blocked) {
      expect(out.content).toBe('safe content');
      expect(out.verdict.status).toBe('CLEAN');
    }
  });

  it('blocks COMPROMISED under block-on-compromised', async () => {
    const analyzer = makeAnalyzer(compromisedResult);
    const out = await screenContent({
      html: '<html>x</html>',
      analyzer,
      policy: 'block-on-compromised',
    });
    expect(out.blocked).toBe(true);
    if (out.blocked) {
      expect(out.verdict.status).toBe('COMPROMISED');
      expect(out.reason).toContain('COMPROMISED');
    }
  });

  it('does NOT block SUSPICIOUS under block-on-compromised', async () => {
    const analyzer = makeAnalyzer(suspiciousResult);
    const out = await screenContent({
      html: '<html>x</html>',
      analyzer,
      policy: 'block-on-compromised',
    });
    expect(out.blocked).toBe(false);
    if (!out.blocked) expect(out.verdict.status).toBe('SUSPICIOUS');
  });

  it('blocks SUSPICIOUS under block-on-suspicious', async () => {
    const analyzer = makeAnalyzer(suspiciousResult);
    const out = await screenContent({
      html: '<html>x</html>',
      analyzer,
      policy: 'block-on-suspicious',
    });
    expect(out.blocked).toBe(true);
  });

  it('passes UNKNOWN through (fail-open) under any blocking policy', async () => {
    const analyzer = makeAnalyzer(unknownResult);
    for (const policy of ['block-on-suspicious', 'block-on-compromised'] as const) {
      const out = await screenContent({ html: '<x/>', analyzer, policy });
      expect(out.blocked).toBe(false);
    }
  });

  it('flag-only never blocks even on COMPROMISED', async () => {
    const analyzer = makeAnalyzer(compromisedResult);
    const out = await screenContent({ html: '<x/>', analyzer, policy: 'flag-only' });
    expect(out.blocked).toBe(false);
    if (!out.blocked) expect(out.verdict.status).toBe('COMPROMISED');
  });

  it('forwards url to analyzer.analyzeHtml when provided', async () => {
    const spy = vi.fn(async () => cleanResult);
    const analyzer: Analyzer = { analyzeHtml: spy };
    await screenContent({
      html: '<x/>',
      url: 'https://example.com/page',
      analyzer,
      policy: 'flag-only',
    });
    expect(spy).toHaveBeenCalledWith({ html: '<x/>', url: 'https://example.com/page' });
  });

  it('omits url when not provided', async () => {
    const spy = vi.fn(async () => cleanResult);
    const analyzer: Analyzer = { analyzeHtml: spy };
    await screenContent({ html: '<x/>', analyzer, policy: 'flag-only' });
    expect(spy).toHaveBeenCalledWith({ html: '<x/>' });
  });

  it('uses default policy block-on-compromised when not specified', async () => {
    const analyzer = makeAnalyzer(compromisedResult);
    const out = await screenContent({ html: '<x/>', analyzer });
    expect(out.blocked).toBe(true);
  });
});

describe('screenContentOrThrow', () => {
  it('returns content on CLEAN', async () => {
    const analyzer = makeAnalyzer(cleanResult);
    const result = await screenContentOrThrow({
      html: '<x/>',
      analyzer,
      policy: 'block-on-suspicious',
    });
    expect(result.content).toBe('safe content');
    expect(result.verdict.status).toBe('CLEAN');
  });

  it('throws HoneyLLMBlockedError on COMPROMISED under blocking policy', async () => {
    const analyzer = makeAnalyzer(compromisedResult);
    await expect(
      screenContentOrThrow({
        html: '<x/>',
        analyzer,
        policy: 'block-on-compromised',
      }),
    ).rejects.toBeInstanceOf(HoneyLLMBlockedError);
  });

  it('attaches verdict + mitigationsApplied to thrown error', async () => {
    const analyzer = makeAnalyzer(compromisedResult);
    try {
      await screenContentOrThrow({
        html: '<x/>',
        analyzer,
        policy: 'block-on-compromised',
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HoneyLLMBlockedError);
      const err = e as HoneyLLMBlockedError;
      expect(err.verdict.status).toBe('COMPROMISED');
      expect(err.mitigationsApplied).toEqual(['stripped:script']);
    }
  });
});
