import type { Entity, EntityExtractor } from './types.js';
import { urlExtractor } from './extractors/url.js';
import { emailExtractor } from './extractors/email.js';
import { creditCardExtractor } from './extractors/credit-card.js';
import { apiKeyExtractor } from './extractors/api-key.js';
import { credentialExtractor } from './extractors/credential.js';
import { exfilDomainExtractor } from './extractors/exfil-domain.js';

export const ALL_EXTRACTORS: readonly EntityExtractor[] = [
  urlExtractor,
  emailExtractor,
  creditCardExtractor,
  apiKeyExtractor,
  credentialExtractor,
  exfilDomainExtractor,
];

function dedupe(entities: readonly Entity[]): readonly Entity[] {
  const byKey = new Map<string, Entity>();
  for (const e of entities) {
    const key = `${e.type}:${e.span[0]}:${e.span[1]}`;
    const existing = byKey.get(key);
    if (existing === undefined || e.confidence > existing.confidence) {
      byKey.set(key, e);
    }
  }
  return Array.from(byKey.values());
}

export function extractEntities(text: string, offset = 0): readonly Entity[] {
  if (text.length === 0) return [];
  const all: Entity[] = [];
  for (const extractor of ALL_EXTRACTORS) {
    for (const e of extractor.extract(text, offset)) {
      all.push(e);
    }
  }
  return dedupe(all)
    .slice()
    .sort((a, b) => a.span[0] - b.span[0]);
}
