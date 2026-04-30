import { describe, it, expect } from 'vitest';
import { buildServerTools, endpointFromEnv } from '../server-tools.js';

describe('buildServerTools', () => {
  it('exposes browse, read_page, analyze_html, analyze_url tools in Stage 5', () => {
    const tools = buildServerTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'analyze_html',
      'analyze_url',
      'browse',
      'read_page',
    ]);
  });

  it('declares browse with a required string url input', () => {
    const tools = buildServerTools();
    const browse = tools.find((t) => t.name === 'browse');
    expect(browse).toBeDefined();
    expect(browse?.inputSchema.type).toBe('object');
    expect(browse?.inputSchema.required).toEqual(['url']);
    expect(browse?.inputSchema.properties?.url?.type).toBe('string');
  });

  it('handler returns a tool-result payload with the four documented fields', async () => {
    const tools = buildServerTools({
      fetcher: async () => ({
        ok: true,
        status: 200,
        contentType: 'text/html',
        body: '<p>hello</p>',
      }),
      now: () => 42,
    });
    const browse = tools.find((t) => t.name === 'browse');
    const out = await browse!.handler({ url: 'https://example.com/' });
    expect(out).toHaveProperty('content');
    expect(out).toHaveProperty('verdict');
    expect(out).toHaveProperty('report');
    expect(out).toHaveProperty('mitigationsApplied');
  });

  it('handler surfaces invalid input as an analysisError UNKNOWN verdict, not a thrown error', async () => {
    const tools = buildServerTools({
      fetcher: async () => {
        throw new Error('should-not-be-called');
      },
      now: () => 1,
    });
    const browse = tools.find((t) => t.name === 'browse');
    const out = await browse!.handler({});
    expect(out.verdict.status).toBe('UNKNOWN');
    expect(out.verdict.analysisError).toBeTruthy();
  });

  it('declares read_page with a required string url input', () => {
    const tools = buildServerTools();
    const readPage = tools.find((t) => t.name === 'read_page');
    expect(readPage).toBeDefined();
    expect(readPage?.inputSchema.type).toBe('object');
    expect(readPage?.inputSchema.required).toEqual(['url']);
    expect(readPage?.inputSchema.properties?.url?.type).toBe('string');
  });

  it('read_page handler routes through the injected renderer', async () => {
    const tools = buildServerTools({
      now: () => 99,
      renderer: {
        async render() {
          return {
            url: 'https://example.com/spa',
            status: 200,
            text: 'rendered text from injected renderer',
          };
        },
      },
    });
    const readPage = tools.find((t) => t.name === 'read_page');
    const out = await readPage!.handler({ url: 'https://example.com/' });
    expect(out.content).toContain('rendered text from injected renderer');
    expect(out.verdict.status).toBe('CLEAN');
    expect(out.verdict.timestamp).toBe(99);
  });

  it('read_page handler returns UNKNOWN on missing url argument', async () => {
    const tools = buildServerTools({ now: () => 1 });
    const readPage = tools.find((t) => t.name === 'read_page');
    const out = await readPage!.handler({});
    expect(out.verdict.status).toBe('UNKNOWN');
    expect(out.verdict.analysisError).toBeTruthy();
  });

  it('declares analyze_html with required html input and optional url', () => {
    const tools = buildServerTools();
    const analyzeHtml = tools.find((t) => t.name === 'analyze_html');
    expect(analyzeHtml).toBeDefined();
    expect(analyzeHtml?.inputSchema.type).toBe('object');
    expect(analyzeHtml?.inputSchema.required).toEqual(['html']);
    expect(analyzeHtml?.inputSchema.properties?.html?.type).toBe('string');
    expect(analyzeHtml?.inputSchema.properties?.url?.type).toBe('string');
  });

  it('analyze_html handler runs the pipeline against caller HTML without invoking the fetcher', async () => {
    let fetcherCalled = false;
    const tools = buildServerTools({
      fetcher: async () => {
        fetcherCalled = true;
        throw new Error('should-not-be-called');
      },
      now: () => 99,
    });
    const analyzeHtml = tools.find((t) => t.name === 'analyze_html');
    const out = await analyzeHtml!.handler({
      html: '<p>The capital of France is Paris.</p>',
      url: 'https://example.com/',
    });
    expect(fetcherCalled).toBe(false);
    expect(out.verdict.status).toBe('CLEAN');
    expect(out.verdict.url).toBe('https://example.com/');
    expect(out.verdict.timestamp).toBe(99);
    expect(out.content).toContain('Paris');
  });

  it('analyze_html handler returns UNKNOWN when html argument is missing', async () => {
    const tools = buildServerTools({ now: () => 1 });
    const analyzeHtml = tools.find((t) => t.name === 'analyze_html');
    const out = await analyzeHtml!.handler({});
    expect(out.verdict.status).toBe('UNKNOWN');
    expect(out.verdict.analysisError).toBeTruthy();
  });

  it('declares analyze_url with required string url input', () => {
    const tools = buildServerTools();
    const analyzeUrl = tools.find((t) => t.name === 'analyze_url');
    expect(analyzeUrl).toBeDefined();
    expect(analyzeUrl?.inputSchema.required).toEqual(['url']);
    expect(analyzeUrl?.inputSchema.properties?.url?.type).toBe('string');
  });

  it('analyze_url handler returns the four-field shape with stripped content', async () => {
    const tools = buildServerTools({
      fetcher: async () => ({
        ok: true,
        status: 200,
        contentType: 'text/html',
        body: '<p>hello</p>',
      }),
      now: () => 42,
    });
    const analyzeUrl = tools.find((t) => t.name === 'analyze_url');
    const out = await analyzeUrl!.handler({ url: 'https://example.com/' });
    expect(out).toHaveProperty('verdict');
    expect(out).toHaveProperty('report');
    expect(out).toHaveProperty('mitigationsApplied');
    expect(out.content).toBe('');
    expect(out.verdict.timestamp).toBe(42);
  });

  it('analyze_url handler surfaces missing url as UNKNOWN', async () => {
    const tools = buildServerTools({
      fetcher: async () => {
        throw new Error('should-not-be-called');
      },
      now: () => 1,
    });
    const analyzeUrl = tools.find((t) => t.name === 'analyze_url');
    const out = await analyzeUrl!.handler({});
    expect(out.verdict.status).toBe('UNKNOWN');
    expect(out.verdict.analysisError).toBeTruthy();
    expect(out.content).toBe('');
  });
});

describe('endpointFromEnv', () => {
  it('returns undefined when HONEYLLM_LLM_BASE_URL is unset', () => {
    expect(endpointFromEnv({})).toBeUndefined();
  });

  it('returns undefined when HONEYLLM_LLM_MODEL is unset', () => {
    expect(endpointFromEnv({ HONEYLLM_LLM_BASE_URL: 'http://localhost:8001/v1' })).toBeUndefined();
  });

  it('constructs an endpoint when both BASE_URL and MODEL are set', () => {
    const ep = endpointFromEnv({
      HONEYLLM_LLM_BASE_URL: 'http://localhost:8001/v1',
      HONEYLLM_LLM_MODEL: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    });
    expect(ep).toBeDefined();
    expect(typeof ep!.call).toBe('function');
  });

  it('rejects empty-string BASE_URL', () => {
    expect(
      endpointFromEnv({ HONEYLLM_LLM_BASE_URL: '', HONEYLLM_LLM_MODEL: 'm' }),
    ).toBeUndefined();
  });
});
