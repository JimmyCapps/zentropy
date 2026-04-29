import type { Entity, EntityExtractor } from '../types.js';
import { shannon } from '../shannon.js';

interface NamedShape {
  readonly shape: string;
  readonly pattern: RegExp;
}

const NAMED_SHAPES: readonly NamedShape[] = [
  { shape: 'aws_access_key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { shape: 'github_pat', pattern: /\bghp_[A-Za-z0-9]{36,}\b/g },
  { shape: 'github_oauth', pattern: /\bgho_[A-Za-z0-9]{36,}\b/g },
  { shape: 'openai', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { shape: 'stripe_live', pattern: /\bsk_live_[A-Za-z0-9]{20,}\b/g },
  { shape: 'stripe_test', pattern: /\bsk_test_[A-Za-z0-9]{20,}\b/g },
];

const GENERIC_TOKEN_PATTERN = /\b[A-Za-z0-9_+/=-]{20,}\b/g;
const GENERIC_ENTROPY_THRESHOLD = 3.0;

export function extractApiKeys(text: string, offset = 0): readonly Entity[] {
  if (text.length === 0) return [];
  const out: Entity[] = [];
  const claimedSpans = new Set<string>();

  for (const { shape, pattern } of NAMED_SHAPES) {
    for (const match of text.matchAll(pattern)) {
      const value = match[0];
      const start = match.index ?? 0;
      const end = start + value.length;
      claimedSpans.add(`${start}:${end}`);
      out.push({
        type: 'api_key',
        value,
        span: [offset + start, offset + end],
        confidence: 0.95,
        metadata: Object.freeze({ shape }),
      });
    }
  }

  for (const match of text.matchAll(GENERIC_TOKEN_PATTERN)) {
    const value = match[0];
    const start = match.index ?? 0;
    const end = start + value.length;
    if (claimedSpans.has(`${start}:${end}`)) continue;
    const entropy = shannon(value);
    if (entropy < GENERIC_ENTROPY_THRESHOLD) continue;
    out.push({
      type: 'api_key',
      value,
      span: [offset + start, offset + end],
      confidence: 0.6,
      metadata: Object.freeze({ shape: 'high_entropy', entropy: Number(entropy.toFixed(3)) }),
    });
  }

  return out;
}

export const apiKeyExtractor: EntityExtractor = {
  type: 'api_key',
  extract: extractApiKeys,
};
