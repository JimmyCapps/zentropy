import type { Entity, EntityExtractor } from '../types.js';

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

export function extractEmails(text: string, offset = 0): readonly Entity[] {
  if (text.length === 0) return [];
  const out: Entity[] = [];
  for (const match of text.matchAll(EMAIL_PATTERN)) {
    const value = match[0];
    const start = match.index ?? 0;
    out.push({
      type: 'email',
      value,
      span: [offset + start, offset + start + value.length],
      confidence: 0.9,
    });
  }
  return out;
}

export const emailExtractor: EntityExtractor = {
  type: 'email',
  extract: extractEmails,
};
