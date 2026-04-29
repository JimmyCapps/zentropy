import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  handleDetectLanguage,
  _resetForTesting,
  _setXlmFactoryForTesting,
} from './lang-detect-engine.js';

describe('handleDetectLanguage', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    _resetForTesting();
    // Default for legacy tests: xlm factory unavailable so fallback behaves
    // identically to the pre-#156 stub (returns UND_XLM).
    _setXlmFactoryForTesting(async () => null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    _resetForTesting();
  });

  it('falls through to xlm-roberta stub when LanguageDetector is absent', async () => {
    const result = await handleDetectLanguage('A long enough English sentence to detect.');
    expect(result).toEqual({ lang: 'und', confidence: 0, source: 'xlm-roberta' });
  });

  it('falls through when availability returns "unavailable"', async () => {
    vi.stubGlobal('LanguageDetector', {
      availability: vi.fn(async () => 'unavailable'),
      create: vi.fn(),
    });
    const result = await handleDetectLanguage('A long enough English sentence to detect.');
    expect(result.source).toBe('xlm-roberta');
    expect(result.lang).toBe('und');
  });

  it('falls through when create() throws', async () => {
    vi.stubGlobal('LanguageDetector', {
      availability: vi.fn(async () => 'available'),
      create: vi.fn(async () => {
        throw new Error('create exploded');
      }),
    });
    const result = await handleDetectLanguage('A long enough English sentence to detect.');
    expect(result.source).toBe('xlm-roberta');
    expect(result.lang).toBe('und');
  });

  it('returns top-ranked Chrome detection result on the happy path', async () => {
    const detectSpy = vi.fn(async () => [
      { detectedLanguage: 'en', confidence: 0.97 },
      { detectedLanguage: 'fr', confidence: 0.02 },
    ]);
    vi.stubGlobal('LanguageDetector', {
      availability: vi.fn(async () => 'available'),
      create: vi.fn(async () => ({ detect: detectSpy })),
    });
    const result = await handleDetectLanguage('A long enough English sentence to detect.');
    expect(result).toEqual({ lang: 'en', confidence: 0.97, source: 'chrome-api' });
    expect(detectSpy).toHaveBeenCalledTimes(1);
  });

  it('T9: xlm-roberta classifies when Chrome API is absent', async () => {
    _setXlmFactoryForTesting(async () => ({
      detect: async () => [
        { label: 'fr', score: 0.94 },
        { label: 'en', score: 0.05 },
      ],
    }));
    const result = await handleDetectLanguage('Bonjour le monde, comment allez-vous?');
    expect(result).toEqual({ lang: 'fr', confidence: 0.94, source: 'xlm-roberta' });
  });

  it('T10: xlm-roberta init failure → UND_XLM', async () => {
    _setXlmFactoryForTesting(async () => {
      throw new Error('model load failed');
    });
    const result = await handleDetectLanguage('Some text in an obscure tongue.');
    expect(result).toEqual({ lang: 'und', confidence: 0, source: 'xlm-roberta' });
  });

  it('T11: Chrome API present + working → xlm factory never called', async () => {
    let xlmCalls = 0;
    _setXlmFactoryForTesting(async () => {
      xlmCalls++;
      return null;
    });
    vi.stubGlobal('LanguageDetector', {
      availability: vi.fn(async () => 'available'),
      create: vi.fn(async () => ({
        detect: async () => [{ detectedLanguage: 'es', confidence: 0.9 }],
      })),
    });
    const result = await handleDetectLanguage('Hola mundo, ¿cómo estás?');
    expect(result.source).toBe('chrome-api');
    expect(xlmCalls).toBe(0);
  });

  it('T12: xlm-roberta single-flight — concurrent calls trigger one factory invocation', async () => {
    let factoryCalls = 0;
    _setXlmFactoryForTesting(async () => {
      factoryCalls++;
      return {
        detect: async () => [{ label: 'de', score: 0.91 }],
      };
    });

    const promises = [
      handleDetectLanguage('Hallo Welt eins.'),
      handleDetectLanguage('Hallo Welt zwei.'),
      handleDetectLanguage('Hallo Welt drei.'),
    ];
    const results = await Promise.all(promises);
    expect(factoryCalls).toBe(1);
    for (const r of results) {
      expect(r.source).toBe('xlm-roberta');
      expect(r.lang).toBe('de');
    }
  });

  it('xlm returning empty hits → UND_XLM', async () => {
    _setXlmFactoryForTesting(async () => ({ detect: async () => [] }));
    const result = await handleDetectLanguage('inscrutable');
    expect(result).toEqual({ lang: 'und', confidence: 0, source: 'xlm-roberta' });
  });

  it('xlm detect() throws → UND_XLM (graceful)', async () => {
    _setXlmFactoryForTesting(async () => ({
      detect: async () => {
        throw new Error('inference exploded');
      },
    }));
    const result = await handleDetectLanguage('some text');
    expect(result).toEqual({ lang: 'und', confidence: 0, source: 'xlm-roberta' });
  });
});
