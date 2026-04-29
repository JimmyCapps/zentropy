import type { Entity, EntityExtractor } from '../types.js';
import { BLOCKED_PATTERNS } from '@/shared/blocked-patterns.js';

function makeGlobal(pattern: RegExp): RegExp {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
}

const GLOBAL_BLOCKED_PATTERNS: readonly RegExp[] = BLOCKED_PATTERNS.map(makeGlobal);

export function extractExfilDomains(text: string, offset = 0): readonly Entity[] {
  if (text.length === 0) return [];
  const out: Entity[] = [];
  for (let i = 0; i < GLOBAL_BLOCKED_PATTERNS.length; i++) {
    const pattern = GLOBAL_BLOCKED_PATTERNS[i]!;
    for (const match of text.matchAll(pattern)) {
      const value = match[0];
      const start = match.index ?? 0;
      out.push({
        type: 'exfil_domain',
        value,
        span: [offset + start, offset + start + value.length],
        confidence: 0.95,
        metadata: Object.freeze({ pattern: BLOCKED_PATTERNS[i]!.source }),
      });
    }
  }
  return out;
}

export const exfilDomainExtractor: EntityExtractor = {
  type: 'exfil_domain',
  extract: extractExfilDomains,
};
