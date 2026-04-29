import { createLogger } from '@/shared/logger.js';
import type { LanguageDetectionResult } from '@/types/messages.js';
import { loadTransformers } from './transformers-runtime.js';

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

/**
 * Issue #156 — replaces the throwing stub from #119 with a real
 * transformers.js text-classification fallback. Closes #151.
 *
 * Model: `Xenova/xlm-roberta-base-language-detection` (q8). Returns ISO
 * 639-1 codes covering 100+ languages, complementing the Chrome
 * LanguageDetector which is only available on Chrome ≥ 138.
 */
const XLM_MODEL_ID = 'Xenova/xlm-roberta-base-language-detection';
const XLM_DEVICE = 'wasm' as const;
const XLM_DTYPE = 'q8' as const;
const XLM_COLD_LOAD_TIMEOUT_MS = 30_000;

interface XlmHit {
  readonly label: string;
  readonly score: number;
}

interface XlmPipeline {
  (text: string): Promise<readonly XlmHit[]>;
}

interface XlmDetector {
  detect(text: string): Promise<readonly XlmHit[]>;
}

let xlmInstance: XlmDetector | null = null;
let xlmInitPromise: Promise<XlmDetector | null> | null = null;
let xlmFactoryOverride: (() => Promise<XlmDetector | null>) | null = null;

function timeoutSignal(ms: number): Promise<null> {
  return new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));
}

async function defaultXlmFactory(): Promise<XlmDetector | null> {
  const tf = await loadTransformers();
  const pipe = await tf.pipeline('text-classification', XLM_MODEL_ID, {
    dtype: XLM_DTYPE,
    device: XLM_DEVICE,
  });
  const callable = pipe as unknown as XlmPipeline;
  return {
    detect: async (text: string) => callable(text),
  };
}

async function getOrInitXlm(): Promise<XlmDetector | null> {
  if (xlmInstance !== null) return xlmInstance;
  if (xlmInitPromise !== null) return xlmInitPromise;

  const factory = xlmFactoryOverride ?? defaultXlmFactory;

  xlmInitPromise = (async (): Promise<XlmDetector | null> => {
    try {
      const result = await Promise.race([factory(), timeoutSignal(XLM_COLD_LOAD_TIMEOUT_MS)]);
      if (result === null) {
        log.warn('xlm-roberta cold-load timed out');
        return null;
      }
      xlmInstance = result;
      return result;
    } catch (err) {
      log.warn('xlm-roberta init failed', err);
      return null;
    } finally {
      xlmInitPromise = null;
    }
  })();

  return xlmInitPromise;
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
    const xlm = await getOrInitXlm();
    if (xlm !== null) {
      const hits = await xlm.detect(text);
      const top = hits[0];
      if (top !== undefined && top.label.length > 0 && top.label !== 'und') {
        return {
          lang: top.label,
          confidence: top.score,
          source: 'xlm-roberta',
        };
      }
    }
  } catch (err) {
    log.warn('xlm-roberta detect failed', err);
  }
  return UND_XLM;
}

export function _setXlmFactoryForTesting(
  factory: (() => Promise<XlmDetector | null>) | null,
): void {
  xlmFactoryOverride = factory;
}

export function _resetForTesting(): void {
  chromeDetectorInstance = null;
  chromeDetectorInitPromise = null;
  xlmInstance = null;
  xlmInitPromise = null;
  xlmFactoryOverride = null;
}
