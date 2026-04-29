import type { Entity, EntityExtractor } from '../types.js';
import { luhnValid, iinNetwork } from '../luhn.js';

const CC_PATTERN = /\b(?:\d[ -]?){12,18}\d\b/g;

export function extractCreditCards(text: string, offset = 0): readonly Entity[] {
  if (text.length === 0) return [];
  const out: Entity[] = [];
  for (const match of text.matchAll(CC_PATTERN)) {
    const value = match[0];
    const start = match.index ?? 0;
    if (!luhnValid(value)) continue;
    const network = iinNetwork(value);
    if (network === null) continue;
    out.push({
      type: 'credit_card',
      value,
      span: [offset + start, offset + start + value.length],
      confidence: 0.95,
      metadata: Object.freeze({ luhn_valid: true, network }),
    });
  }
  return out;
}

export const creditCardExtractor: EntityExtractor = {
  type: 'credit_card',
  extract: extractCreditCards,
};
