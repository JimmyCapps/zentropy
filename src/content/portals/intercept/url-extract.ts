import { MAX_INTERCEPT_URLS_PER_PROMPT } from '@/shared/constants.js';

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}>'"`]+$/;

export function extractUrls(text: string): readonly string[] {
  if (text.length === 0) return [];
  const matches = text.match(URL_PATTERN) ?? [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of matches) {
    const cleaned = raw.replace(TRAILING_PUNCTUATION, '');
    if (cleaned.length === 0) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
    if (result.length >= MAX_INTERCEPT_URLS_PER_PROMPT) break;
  }
  return result;
}
