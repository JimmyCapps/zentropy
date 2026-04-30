import { describe, it, expect } from 'vitest';
import { buildServerTools } from '../server-tools.js';

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
