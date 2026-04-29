import type { Entity, EntitySummary, EntityType } from './types.js';

const MAX_SAMPLES = 10;

export function rollupEntities(entities: readonly Entity[]): EntitySummary {
  const counts: Partial<Record<EntityType, number>> = {};
  for (const e of entities) {
    counts[e.type] = (counts[e.type] ?? 0) + 1;
  }
  const seen = new Set<string>();
  const samples: Entity[] = [];
  for (const e of entities) {
    const key = `${e.type}:${e.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    samples.push(e);
    if (samples.length >= MAX_SAMPLES) break;
  }
  return { counts, samples };
}
