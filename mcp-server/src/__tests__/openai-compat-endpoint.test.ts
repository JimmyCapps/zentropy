import { describe, it, expect } from 'vitest';
import { createOpenAiCompatEndpoint } from '../probes/llm-endpoint.js';

interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

function fakeFetch(
  responseBody: unknown,
  { status = 200 }: { status?: number } = {},
): { fn: typeof fetch; calls: RecordedRequest[] } {
  const calls: RecordedRequest[] = [];
  const fn: typeof fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string' || input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      for (const k of Object.keys(h)) headers[k] = h[k]!;
    }
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url, method: init?.method ?? 'GET', headers, body });
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return { fn, calls };
}

describe('createOpenAiCompatEndpoint', () => {
  it('POSTs to <baseUrl>/chat/completions with the OpenAI-compat body shape', async () => {
    const { fn, calls } = fakeFetch({
      choices: [{ message: { content: '{"found":false}' } }],
    });
    const endpoint = createOpenAiCompatEndpoint({
      baseUrl: 'http://localhost:8001/v1',
      model: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
      fetchFn: fn,
    });
    await endpoint.call({ systemPrompt: 'sys', userMessage: 'usr' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://localhost:8001/v1/chat/completions');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers['Content-Type']).toBe('application/json');
    expect(calls[0]!.body).toMatchObject({
      model: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'usr' },
      ],
    });
  });

  it('strips trailing slash from baseUrl before appending /chat/completions', async () => {
    const { fn, calls } = fakeFetch({ choices: [{ message: { content: '{}' } }] });
    const endpoint = createOpenAiCompatEndpoint({
      baseUrl: 'http://localhost:8001/v1/',
      model: 'm',
      fetchFn: fn,
    });
    await endpoint.call({ systemPrompt: 's', userMessage: 'u' });
    expect(calls[0]!.url).toBe('http://localhost:8001/v1/chat/completions');
  });

  it('attaches Authorization: Bearer <key> when apiKey is provided', async () => {
    const { fn, calls } = fakeFetch({ choices: [{ message: { content: '{}' } }] });
    const endpoint = createOpenAiCompatEndpoint({
      baseUrl: 'http://localhost:8001/v1',
      model: 'm',
      apiKey: 'sk-test-123',
      fetchFn: fn,
    });
    await endpoint.call({ systemPrompt: 's', userMessage: 'u' });
    expect(calls[0]!.headers['Authorization']).toBe('Bearer sk-test-123');
  });

  it('omits Authorization when no apiKey is provided', async () => {
    const { fn, calls } = fakeFetch({ choices: [{ message: { content: '{}' } }] });
    const endpoint = createOpenAiCompatEndpoint({
      baseUrl: 'http://localhost:8001/v1',
      model: 'm',
      fetchFn: fn,
    });
    await endpoint.call({ systemPrompt: 's', userMessage: 'u' });
    expect(calls[0]!.headers['Authorization']).toBeUndefined();
  });

  it('returns the content string from choices[0].message.content', async () => {
    const { fn } = fakeFetch({
      choices: [{ message: { content: '{"found":true,"instructions":["x"]}' } }],
    });
    const endpoint = createOpenAiCompatEndpoint({
      baseUrl: 'http://localhost:8001/v1',
      model: 'm',
      fetchFn: fn,
    });
    const result = await endpoint.call({ systemPrompt: 's', userMessage: 'u' });
    expect(result.content).toBe('{"found":true,"instructions":["x"]}');
  });

  it('throws on non-OK HTTP status with the status code in the error', async () => {
    const { fn } = fakeFetch({ error: 'oops' }, { status: 500 });
    const endpoint = createOpenAiCompatEndpoint({
      baseUrl: 'http://localhost:8001/v1',
      model: 'm',
      fetchFn: fn,
    });
    await expect(endpoint.call({ systemPrompt: 's', userMessage: 'u' })).rejects.toThrow(/500/);
  });

  it('throws when the response body lacks choices[0].message.content', async () => {
    const { fn } = fakeFetch({ choices: [] });
    const endpoint = createOpenAiCompatEndpoint({
      baseUrl: 'http://localhost:8001/v1',
      model: 'm',
      fetchFn: fn,
    });
    await expect(endpoint.call({ systemPrompt: 's', userMessage: 'u' })).rejects.toThrow();
  });

  it('aborts and throws when the call exceeds timeoutMs', async () => {
    const slowFetch: typeof fetch = (async (_input: unknown, init?: RequestInit) => {
      return new Promise<Response>((resolve, reject) => {
        const t = setTimeout(
          () => resolve(new Response('{}', { status: 200 })),
          200,
        );
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    }) as typeof fetch;
    const endpoint = createOpenAiCompatEndpoint({
      baseUrl: 'http://localhost:8001/v1',
      model: 'm',
      timeoutMs: 10,
      fetchFn: slowFetch,
    });
    await expect(endpoint.call({ systemPrompt: 's', userMessage: 'u' })).rejects.toThrow(
      /timeout|abort/i,
    );
  });

  it('surfaces fetch network errors with a descriptive message', async () => {
    const networkErrorFetch: typeof fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const endpoint = createOpenAiCompatEndpoint({
      baseUrl: 'http://localhost:8001/v1',
      model: 'm',
      fetchFn: networkErrorFetch,
    });
    await expect(endpoint.call({ systemPrompt: 's', userMessage: 'u' })).rejects.toThrow(
      /fetch failed/,
    );
  });
});
