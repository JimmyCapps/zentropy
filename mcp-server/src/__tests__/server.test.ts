import { describe, it, expect } from 'vitest';
import { buildServerTools, endpointFromEnv } from '../server-tools.js';

describe('buildServerTools', () => {
  it('exposes exactly the browse tool in Stage 1', () => {
    const tools = buildServerTools();
    expect(tools.map((t) => t.name)).toEqual(['browse']);
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
