import { describe, expect, it, vi } from 'vitest';
import type { Analyzer, AnalyzerResult, SecurityVerdict } from '@honeyllm/agent-sdk-core';
import { HoneyLLMBlockedError } from '@honeyllm/agent-sdk-core';
import {
  wrapDocumentLoader,
  wrapWebBaseLoader,
  wrapPlaywrightURLLoader,
  type DocumentLike,
  type DocumentLoaderLike,
} from '../loaders.js';

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

function makeAnalyzer(result: AnalyzerResult | ((html: string) => AnalyzerResult)): Analyzer {
  const fn = typeof result === 'function' ? result : () => result;
  return {
    analyzeHtml: vi.fn(async (params) => fn(params.html)),
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
  mitigationsApplied: ['stripped:script'],
};

function fakeLoader(docs: DocumentLike[]): DocumentLoaderLike & { webPath?: string } {
  return { load: vi.fn(async () => docs) };
}

describe('wrapDocumentLoader', () => {
  it('returns a loader-like with load() method', () => {
    const loader = fakeLoader([]);
    const wrapped = wrapDocumentLoader(loader, { analyzer: makeAnalyzer(cleanResult) });
    expect(typeof wrapped.load).toBe('function');
  });

  it('preserves doc count and replaces pageContent with sanitised content', async () => {
    const loader = fakeLoader([
      { pageContent: '<html>raw1</html>', metadata: { source: 'https://a.test/' } },
      { pageContent: '<html>raw2</html>', metadata: { source: 'https://b.test/' } },
    ]);
    const wrapped = wrapDocumentLoader(loader, { analyzer: makeAnalyzer(cleanResult) });
    const docs = await wrapped.load();
    expect(docs).toHaveLength(2);
    expect(docs[0]?.pageContent).toBe('sanitised');
    expect(docs[1]?.pageContent).toBe('sanitised');
  });

  it('preserves metadata on each screened doc', async () => {
    const loader = fakeLoader([
      { pageContent: '<html/>', metadata: { source: 'https://a.test/', custom: 1 } },
    ]);
    const wrapped = wrapDocumentLoader(loader, { analyzer: makeAnalyzer(cleanResult) });
    const docs = await wrapped.load();
    expect(docs[0]?.metadata).toEqual({ source: 'https://a.test/', custom: 1 });
  });

  it('passes metadata.source as URL hint to analyzer', async () => {
    const analyzer = makeAnalyzer(cleanResult);
    const loader = fakeLoader([
      { pageContent: '<html/>', metadata: { source: 'https://a.test/path' } },
    ]);
    const wrapped = wrapDocumentLoader(loader, { analyzer });
    await wrapped.load();
    expect(analyzer.analyzeHtml).toHaveBeenCalledWith({
      html: '<html/>',
      url: 'https://a.test/path',
    });
  });

  it('falls back to loader.webPath when metadata.source is missing', async () => {
    const analyzer = makeAnalyzer(cleanResult);
    const loader = {
      webPath: 'https://example.com/from-loader',
      load: vi.fn(async () => [{ pageContent: '<html/>' } as DocumentLike]),
    };
    const wrapped = wrapDocumentLoader(loader, { analyzer });
    await wrapped.load();
    expect(analyzer.analyzeHtml).toHaveBeenCalledWith({
      html: '<html/>',
      url: 'https://example.com/from-loader',
    });
  });

  it('falls back to loader.urls[index] when metadata.source missing (PlaywrightURLLoader shape)', async () => {
    const analyzer = makeAnalyzer(cleanResult);
    const loader = {
      urls: ['https://a.test/', 'https://b.test/'],
      load: vi.fn(async () => [
        { pageContent: '<html>a</html>' } as DocumentLike,
        { pageContent: '<html>b</html>' } as DocumentLike,
      ]),
    };
    const wrapped = wrapDocumentLoader(loader, { analyzer });
    await wrapped.load();
    expect(analyzer.analyzeHtml).toHaveBeenNthCalledWith(1, {
      html: '<html>a</html>',
      url: 'https://a.test/',
    });
    expect(analyzer.analyzeHtml).toHaveBeenNthCalledWith(2, {
      html: '<html>b</html>',
      url: 'https://b.test/',
    });
  });

  it('omits URL hint when no source is recoverable', async () => {
    const analyzer = makeAnalyzer(cleanResult);
    const loader = fakeLoader([{ pageContent: '<html/>' }]);
    const wrapped = wrapDocumentLoader(loader, { analyzer });
    await wrapped.load();
    expect(analyzer.analyzeHtml).toHaveBeenCalledWith({ html: '<html/>' });
  });

  it('throws HoneyLLMBlockedError on COMPROMISED with default policy', async () => {
    const loader = fakeLoader([{ pageContent: '<html/>' }]);
    const wrapped = wrapDocumentLoader(loader, {
      analyzer: makeAnalyzer(compromisedResult),
    });
    await expect(wrapped.load()).rejects.toBeInstanceOf(HoneyLLMBlockedError);
  });

  it('does not throw on COMPROMISED under flag-only policy', async () => {
    const loader = fakeLoader([{ pageContent: '<html/>' }]);
    const wrapped = wrapDocumentLoader(loader, {
      analyzer: makeAnalyzer(compromisedResult),
      policy: 'flag-only',
    });
    const docs = await wrapped.load();
    expect(docs[0]?.pageContent).toBe('tainted');
  });

  it('honours custom getUrl when provided', async () => {
    const analyzer = makeAnalyzer(cleanResult);
    const loader = fakeLoader([{ pageContent: '<html/>', metadata: { custom: 'x' } }]);
    const wrapped = wrapDocumentLoader(loader, {
      analyzer,
      getUrl: () => 'https://override.example/',
    });
    await wrapped.load();
    expect(analyzer.analyzeHtml).toHaveBeenCalledWith({
      html: '<html/>',
      url: 'https://override.example/',
    });
  });

  it('stops at first blocked doc and does not screen subsequent ones', async () => {
    const calls: string[] = [];
    const analyzer: Analyzer = {
      analyzeHtml: vi.fn(async (params) => {
        calls.push(params.html);
        return params.html === '<html>1</html>' ? compromisedResult : cleanResult;
      }),
    };
    const loader = fakeLoader([
      { pageContent: '<html>1</html>' },
      { pageContent: '<html>2</html>' },
    ]);
    const wrapped = wrapDocumentLoader(loader, { analyzer });
    await expect(wrapped.load()).rejects.toBeInstanceOf(HoneyLLMBlockedError);
    expect(calls).toEqual(['<html>1</html>']);
  });

  it('returns empty array when loader returns no docs', async () => {
    const loader = fakeLoader([]);
    const wrapped = wrapDocumentLoader(loader, { analyzer: makeAnalyzer(cleanResult) });
    expect(await wrapped.load()).toEqual([]);
  });
});

describe('wrapWebBaseLoader', () => {
  it('aliases wrapDocumentLoader and screens load() output', async () => {
    const loader = {
      webPath: 'https://example.com/',
      load: vi.fn(async () => [
        { pageContent: '<html>raw</html>', metadata: { source: 'https://example.com/' } },
      ]),
    };
    const wrapped = wrapWebBaseLoader(loader, { analyzer: makeAnalyzer(cleanResult) });
    const docs = await wrapped.load();
    expect(docs[0]?.pageContent).toBe('sanitised');
  });
});

describe('wrapPlaywrightURLLoader', () => {
  it('aliases wrapDocumentLoader for the urls[]-shape loader', async () => {
    const loader = {
      urls: ['https://example.com/'],
      load: vi.fn(async () => [{ pageContent: '<html>raw</html>' } as DocumentLike]),
    };
    const wrapped = wrapPlaywrightURLLoader(loader, { analyzer: makeAnalyzer(cleanResult) });
    const docs = await wrapped.load();
    expect(docs[0]?.pageContent).toBe('sanitised');
  });
});
