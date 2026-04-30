import { describe, expect, it, vi } from 'vitest';
import { createMcpAnalyzer } from '../stdio-analyzer.js';
import type { McpClientLike } from '../stdio-analyzer.js';

function makeClient(response: unknown): McpClientLike {
  return {
    callTool: vi.fn(async () => response),
  };
}

describe('createMcpAnalyzer', () => {
  it('calls analyze_html with the supplied html + url', async () => {
    const client = makeClient({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            content: 'safe',
            verdict: {
              status: 'CLEAN',
              confidence: 100,
              totalScore: 0,
              url: 'https://example.com/',
              timestamp: 1,
              analysisError: null,
            },
            report: { hunters: [], probes: [] },
            mitigationsApplied: [],
          }),
        },
      ],
    });
    const analyzer = createMcpAnalyzer({ client });
    await analyzer.analyzeHtml({ html: '<x/>', url: 'https://example.com/' });
    expect(client.callTool).toHaveBeenCalledWith({
      name: 'analyze_html',
      arguments: { html: '<x/>', url: 'https://example.com/' },
    });
  });

  it('omits url from arguments when not provided', async () => {
    const client = makeClient({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            content: 'safe',
            verdict: {
              status: 'CLEAN',
              confidence: 100,
              totalScore: 0,
              url: '',
              timestamp: 1,
              analysisError: null,
            },
            report: { hunters: [], probes: [] },
            mitigationsApplied: [],
          }),
        },
      ],
    });
    const analyzer = createMcpAnalyzer({ client });
    await analyzer.analyzeHtml({ html: '<x/>' });
    expect(client.callTool).toHaveBeenCalledWith({
      name: 'analyze_html',
      arguments: { html: '<x/>' },
    });
  });

  it('parses the BrowseToolResult shape from the first text content block', async () => {
    const client = makeClient({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            content: 'parsed-content',
            verdict: {
              status: 'SUSPICIOUS',
              confidence: 60,
              totalScore: 30,
              url: 'https://example.com/',
              timestamp: 42,
              analysisError: null,
            },
            report: { hunters: [], probes: [] },
            mitigationsApplied: ['stripped:script'],
          }),
        },
      ],
    });
    const analyzer = createMcpAnalyzer({ client });
    const result = await analyzer.analyzeHtml({ html: '<x/>' });
    expect(result.content).toBe('parsed-content');
    expect(result.verdict.status).toBe('SUSPICIOUS');
    expect(result.verdict.totalScore).toBe(30);
    expect(result.mitigationsApplied).toEqual(['stripped:script']);
  });

  it('returns UNKNOWN verdict when callTool throws', async () => {
    const client: McpClientLike = {
      callTool: vi.fn(async () => {
        throw new Error('transport closed');
      }),
    };
    const analyzer = createMcpAnalyzer({ client });
    const result = await analyzer.analyzeHtml({ html: '<x/>' });
    expect(result.verdict.status).toBe('UNKNOWN');
    expect(result.verdict.analysisError).toContain('transport closed');
    expect(result.content).toBe('');
  });

  it('returns UNKNOWN verdict when the response has no text content blocks', async () => {
    const client = makeClient({ content: [] });
    const analyzer = createMcpAnalyzer({ client });
    const result = await analyzer.analyzeHtml({ html: '<x/>' });
    expect(result.verdict.status).toBe('UNKNOWN');
    expect(result.verdict.analysisError).toContain('no text content');
  });

  it('returns UNKNOWN verdict when the JSON payload is malformed', async () => {
    const client = makeClient({
      content: [{ type: 'text', text: '{not-json' }],
    });
    const analyzer = createMcpAnalyzer({ client });
    const result = await analyzer.analyzeHtml({ html: '<x/>' });
    expect(result.verdict.status).toBe('UNKNOWN');
    expect(result.verdict.analysisError).toContain('parse');
  });

  it('returns UNKNOWN verdict when the parsed payload is missing verdict.status', async () => {
    const client = makeClient({
      content: [{ type: 'text', text: JSON.stringify({ content: 'x' }) }],
    });
    const analyzer = createMcpAnalyzer({ client });
    const result = await analyzer.analyzeHtml({ html: '<x/>' });
    expect(result.verdict.status).toBe('UNKNOWN');
    expect(result.verdict.analysisError).toContain('shape');
  });

  it('honours toolName override (uses analyze_url when configured)', async () => {
    const client = makeClient({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            content: '',
            verdict: {
              status: 'CLEAN',
              confidence: 100,
              totalScore: 0,
              url: 'https://example.com/',
              timestamp: 1,
              analysisError: null,
            },
            report: { hunters: [], probes: [] },
            mitigationsApplied: [],
          }),
        },
      ],
    });
    const analyzer = createMcpAnalyzer({ client, toolName: 'analyze_url' });
    await analyzer.analyzeHtml({ html: '<x/>' });
    expect(client.callTool).toHaveBeenCalledWith({
      name: 'analyze_url',
      arguments: { html: '<x/>' },
    });
  });
});
