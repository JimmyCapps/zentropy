import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  detectLanguage,
  MIN_DETECT_CHARS,
  _resetForTesting,
  type LanguageRouterDeps,
} from './language-router.js';
import type { LanguageDetectionResult } from '@/types/messages.js';

const EN_TEXT =
  'The quick brown fox jumps over the lazy dog every single morning before dawn.';
const ES_TEXT =
  'El veloz murciélago hindú comía feliz cardillo y kiwi mientras navegaba el río oscuro.';
const ZH_TEXT = '中国是一个拥有悠久历史和灿烂文化的伟大国家位于亚洲东部濒临太平洋。';

function makeDeps(
  resultByText: (text: string) => LanguageDetectionResult,
): { deps: LanguageRouterDeps; spy: ReturnType<typeof vi.fn> } {
  const spy = vi.fn(async (text: string) => resultByText(text));
  return { deps: { sendDetect: spy }, spy };
}

describe('detectLanguage', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  afterEach(() => {
    _resetForTesting();
  });

  it('returns und for empty input without invoking the detector', async () => {
    const { deps, spy } = makeDeps(() => {
      throw new Error('should not be called');
    });
    const result = await detectLanguage('', deps);
    expect(result).toEqual({ lang: 'und', confidence: 0, source: 'chrome-api' });
    expect(spy).not.toHaveBeenCalled();
  });

  it(`returns und for text shorter than MIN_DETECT_CHARS (${MIN_DETECT_CHARS})`, async () => {
    const { deps, spy } = makeDeps(() => {
      throw new Error('should not be called');
    });
    const short = 'a'.repeat(MIN_DETECT_CHARS - 1);
    const result = await detectLanguage(short, deps);
    expect(result.lang).toBe('und');
    expect(result.source).toBe('chrome-api');
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns English with chrome-api source', async () => {
    const { deps } = makeDeps(() => ({
      lang: 'en',
      confidence: 0.97,
      source: 'chrome-api',
    }));
    const result = await detectLanguage(EN_TEXT, deps);
    expect(result.lang).toBe('en');
    expect(result.confidence).toBeGreaterThan(0.9);
    expect(result.source).toBe('chrome-api');
  });

  it('returns Spanish with chrome-api source', async () => {
    const { deps } = makeDeps(() => ({
      lang: 'es',
      confidence: 0.94,
      source: 'chrome-api',
    }));
    const result = await detectLanguage(ES_TEXT, deps);
    expect(result.lang).toBe('es');
    expect(result.source).toBe('chrome-api');
  });

  it('returns Chinese (zh) with chrome-api source', async () => {
    const { deps } = makeDeps(() => ({
      lang: 'zh',
      confidence: 0.99,
      source: 'chrome-api',
    }));
    const result = await detectLanguage(ZH_TEXT, deps);
    expect(result.lang).toBe('zh');
    expect(result.source).toBe('chrome-api');
  });

  it('caches by content: same text twice → detector invoked once', async () => {
    const { deps, spy } = makeDeps(() => ({
      lang: 'en',
      confidence: 0.97,
      source: 'chrome-api',
    }));
    await detectLanguage(EN_TEXT, deps);
    await detectLanguage(EN_TEXT, deps);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('cache miss for distinct inputs: detector invoked twice', async () => {
    const { deps, spy } = makeDeps((text) =>
      text === EN_TEXT
        ? { lang: 'en', confidence: 0.95, source: 'chrome-api' }
        : { lang: 'es', confidence: 0.92, source: 'chrome-api' },
    );
    await detectLanguage(EN_TEXT, deps);
    await detectLanguage(ES_TEXT, deps);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('preserves xlm-roberta source on the fallback path', async () => {
    const { deps } = makeDeps(() => ({
      lang: 'fr',
      confidence: 0.81,
      source: 'xlm-roberta',
    }));
    const longFrench = 'Voici un texte assez long pour franchir le seuil de détection.';
    const result = await detectLanguage(longFrench, deps);
    expect(result.source).toBe('xlm-roberta');
  });

  it('returns und with chrome-api source when the detector rejects (graceful degradation)', async () => {
    const { deps } = makeDeps(() => {
      throw new Error('detector exploded');
    });
    const result = await detectLanguage(EN_TEXT, deps);
    expect(result.lang).toBe('und');
    expect(result.confidence).toBe(0);
    expect(result.source).toBe('chrome-api');
  });

  it('does not cache failed lookups: a second call after rejection retries', async () => {
    let attempt = 0;
    const spy = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('first attempt fails');
      return { lang: 'en', confidence: 0.95, source: 'chrome-api' as const };
    });
    const deps: LanguageRouterDeps = { sendDetect: spy };
    const first = await detectLanguage(EN_TEXT, deps);
    expect(first.lang).toBe('und');
    const second = await detectLanguage(EN_TEXT, deps);
    expect(second.lang).toBe('en');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('_resetForTesting clears the cache', async () => {
    const { deps, spy } = makeDeps(() => ({
      lang: 'en',
      confidence: 0.97,
      source: 'chrome-api',
    }));
    await detectLanguage(EN_TEXT, deps);
    _resetForTesting();
    await detectLanguage(EN_TEXT, deps);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('single-flight: concurrent calls for the same text invoke detector once', async () => {
    let resolveDetect!: (r: LanguageDetectionResult) => void;
    const spy = vi.fn(
      () =>
        new Promise<LanguageDetectionResult>((resolve) => {
          resolveDetect = resolve;
        }),
    );
    const deps: LanguageRouterDeps = { sendDetect: spy };
    const a = detectLanguage(EN_TEXT, deps);
    const b = detectLanguage(EN_TEXT, deps);
    // Wait for both calls to register in the inflight map (each awaits
    // sha256Hex first), then resolve the shared detector promise.
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    resolveDetect({ lang: 'en', confidence: 0.95, source: 'chrome-api' });
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toEqual(rb);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('uses chrome.runtime.sendMessage when deps are omitted (production default)', async () => {
    const sendMessage = vi.fn(async (msg: unknown) => {
      const m = msg as { type: string; text: string };
      expect(m.type).toBe('DETECT_LANGUAGE');
      expect(typeof m.text).toBe('string');
      return {
        type: 'LANGUAGE_RESULT' as const,
        result: { lang: 'en', confidence: 0.95, source: 'chrome-api' as const },
      };
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    try {
      const result = await detectLanguage(EN_TEXT);
      expect(result).toEqual({ lang: 'en', confidence: 0.95, source: 'chrome-api' });
      expect(sendMessage).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
