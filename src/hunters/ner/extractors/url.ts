import type { Entity, EntityExtractor } from '../types.js';

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/g;
const TRAILING_PUNCT = /[.,;:!?)\]}]+$/;

function trimTrailingPunct(value: string): string {
  return value.replace(TRAILING_PUNCT, '');
}

export function extractUrls(text: string, offset = 0): readonly Entity[] {
  if (text.length === 0) return [];
  const out: Entity[] = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0];
    const start = match.index ?? 0;
    const trimmed = trimTrailingPunct(raw);
    if (trimmed.length === 0) continue;
    const isHttps = trimmed.startsWith('https://');
    out.push({
      type: 'url',
      value: trimmed,
      span: [offset + start, offset + start + trimmed.length],
      confidence: isHttps ? 0.9 : 0.85,
    });
  }
  return out;
}

export const urlExtractor: EntityExtractor = {
  type: 'url',
  extract: extractUrls,
};
