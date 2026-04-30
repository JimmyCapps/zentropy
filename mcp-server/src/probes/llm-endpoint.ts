export interface LlmCall {
  readonly systemPrompt: string;
  readonly userMessage: string;
}

export interface LlmCallResult {
  readonly content: string;
}

export interface LlmEndpoint {
  call(c: LlmCall): Promise<LlmCallResult>;
}

export interface OpenAiCompatConfig {
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly fetchFn?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 15000;

interface OpenAiCompatResponse {
  readonly choices?: ReadonlyArray<{ readonly message?: { readonly content?: string } }>;
  readonly error?: unknown;
}

export function createOpenAiCompatEndpoint(cfg: OpenAiCompatConfig): LlmEndpoint {
  const fetchFn = cfg.fetchFn ?? fetch;
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  return {
    async call({ systemPrompt, userMessage }) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (cfg.apiKey !== undefined && cfg.apiKey.length > 0) {
        headers['Authorization'] = `Bearer ${cfg.apiKey}`;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetchFn(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: cfg.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userMessage },
            ],
            temperature: 0.1,
            max_tokens: 512,
          }),
          signal: controller.signal,
        });
      } catch (err) {
        if (err instanceof Error && (err.name === 'AbortError' || /aborted/i.test(err.message))) {
          throw new Error(`LLM endpoint timeout after ${timeoutMs}ms`);
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        throw new Error(`LLM endpoint HTTP ${res.status}`);
      }
      const data = (await res.json()) as OpenAiCompatResponse;
      if (data.error !== undefined) {
        throw new Error(`LLM endpoint error: ${JSON.stringify(data.error).slice(0, 200)}`);
      }
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        throw new Error('LLM endpoint response missing choices[0].message.content');
      }
      return { content };
    },
  };
}
