import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleDetectLanguage, _resetForTesting } from './lang-detect-engine.js';

describe('handleDetectLanguage', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    _resetForTesting();
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
});
