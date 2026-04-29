import { sha256Hex } from '@/shared/hash.js';
import type {
  DetectLanguageMessage,
  LanguageDetectionResult,
  LanguageResultMessage,
} from '@/types/messages.js';

export type { LanguageDetectionResult } from '@/types/messages.js';

export const MIN_DETECT_CHARS = 20;

const UND_CHROME: LanguageDetectionResult = {
  lang: 'und',
  confidence: 0,
  source: 'chrome-api',
};

export interface LanguageRouterDeps {
  readonly sendDetect: (text: string) => Promise<LanguageDetectionResult>;
}

const cache = new Map<string, LanguageDetectionResult>();
const inflight = new Map<string, Promise<LanguageDetectionResult>>();

async function defaultSendDetect(text: string): Promise<LanguageDetectionResult> {
  const message: DetectLanguageMessage = { type: 'DETECT_LANGUAGE', text };
  const reply = (await chrome.runtime.sendMessage(message)) as LanguageResultMessage;
  return reply.result;
}

const defaultDeps: LanguageRouterDeps = { sendDetect: defaultSendDetect };

export async function detectLanguage(
  text: string,
  deps: LanguageRouterDeps = defaultDeps,
): Promise<LanguageDetectionResult> {
  if (text.length < MIN_DETECT_CHARS) return UND_CHROME;

  const key = await sha256Hex(text);

  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const pending = inflight.get(key);
  if (pending !== undefined) return pending;

  const promise = (async () => {
    try {
      const result = await deps.sendDetect(text);
      cache.set(key, result);
      return result;
    } catch {
      return UND_CHROME;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

export function _resetForTesting(): void {
  cache.clear();
  inflight.clear();
}
