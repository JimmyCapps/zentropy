import { createLogger } from '@/shared/logger.js';
import type { LanguageDetectionResult } from '@/types/messages.js';

const log = createLogger('LangDetect');

const UND_CHROME: LanguageDetectionResult = {
  lang: 'und',
  confidence: 0,
  source: 'chrome-api',
};

const UND_XLM: LanguageDetectionResult = {
  lang: 'und',
  confidence: 0,
  source: 'xlm-roberta',
};

interface ChromeLanguageDetectorResult {
  readonly detectedLanguage: string;
  readonly confidence: number;
}

interface ChromeLanguageDetector {
  detect(text: string): Promise<readonly ChromeLanguageDetectorResult[]>;
}

interface ChromeLanguageDetectorAPI {
  availability(): Promise<'available' | 'downloadable' | 'downloading' | 'unavailable'>;
  create(): Promise<ChromeLanguageDetector>;
}

function getChromeLanguageDetector(): ChromeLanguageDetectorAPI | null {
  const api = (globalThis as unknown as { LanguageDetector?: ChromeLanguageDetectorAPI })
    .LanguageDetector;
  return api ?? null;
}

let chromeDetectorInstance: ChromeLanguageDetector | null = null;
let chromeDetectorInitPromise: Promise<ChromeLanguageDetector | null> | null = null;

async function getOrInitChromeDetector(
  api: ChromeLanguageDetectorAPI,
): Promise<ChromeLanguageDetector | null> {
  if (chromeDetectorInstance !== null) return chromeDetectorInstance;
  if (chromeDetectorInitPromise !== null) return chromeDetectorInitPromise;

  chromeDetectorInitPromise = (async () => {
    try {
      const availability = await api.availability();
      if (availability === 'unavailable') return null;
      const created = await api.create();
      chromeDetectorInstance = created;
      return created;
    } catch (err) {
      log.warn('LanguageDetector.create failed', err);
      return null;
    } finally {
      chromeDetectorInitPromise = null;
    }
  })();

  return chromeDetectorInitPromise;
}

async function getOrInitXlm(): Promise<never> {
  // Issue #119 ships the Chrome `LanguageDetector` path only. The
  // transformers.js xlm-roberta fallback is tracked in a follow-up
  // issue (filed after #119 merges). Until that ships, this throws so
  // the message handler returns the `und/xlm-roberta` graceful-
  // degradation result when the Chrome API is absent.
  throw new Error('xlm-roberta path not yet implemented — see follow-up issue');
}

export async function handleDetectLanguage(text: string): Promise<LanguageDetectionResult> {
  const api = getChromeLanguageDetector();
  if (api !== null) {
    try {
      const detector = await getOrInitChromeDetector(api);
      if (detector !== null) {
        const results = await detector.detect(text);
        const top = results[0];
        if (top !== undefined && top.detectedLanguage.length > 0) {
          return {
            lang: top.detectedLanguage,
            confidence: top.confidence,
            source: 'chrome-api',
          };
        }
        return UND_CHROME;
      }
    } catch (err) {
      log.warn('Chrome LanguageDetector path failed', err);
    }
  }

  try {
    await getOrInitXlm();
  } catch {
    // Expected: stub always throws until the xlm-roberta follow-up ships.
  }
  return UND_XLM;
}

export function _resetForTesting(): void {
  chromeDetectorInstance = null;
  chromeDetectorInitPromise = null;
}
