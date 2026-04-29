import type { Entity, EntityExtractor } from '../types.js';

interface KeyedShape {
  readonly kind: string;
  readonly pattern: RegExp;
  readonly confidence: number;
}

const KEYED_SHAPES: readonly KeyedShape[] = [
  {
    kind: 'password',
    pattern: /\b(password|passwd|pwd)\s*[:=]\s*[^\s,;]{3,}/gi,
    confidence: 0.9,
  },
  {
    kind: 'token',
    pattern: /\b(token|access[_-]?token|api[_-]?token)\s*[:=]\s*[^\s,;]{6,}/gi,
    confidence: 0.9,
  },
  {
    kind: 'secret',
    pattern: /\b(secret|client[_-]?secret)\s*[:=]\s*[^\s,;]{6,}/gi,
    confidence: 0.9,
  },
  {
    kind: 'bearer',
    pattern: /\bauthorization\s*[:=]\s*Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,
    confidence: 0.85,
  },
];

export function extractCredentials(text: string, offset = 0): readonly Entity[] {
  if (text.length === 0) return [];
  const out: Entity[] = [];
  for (const { kind, pattern, confidence } of KEYED_SHAPES) {
    for (const match of text.matchAll(pattern)) {
      const value = match[0];
      const start = match.index ?? 0;
      out.push({
        type: 'credential',
        value,
        span: [offset + start, offset + start + value.length],
        confidence,
        metadata: Object.freeze({ kind }),
      });
    }
  }
  return out;
}

export const credentialExtractor: EntityExtractor = {
  type: 'credential',
  extract: extractCredentials,
};
