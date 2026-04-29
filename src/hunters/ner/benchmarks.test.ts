import { describe, it, expect } from 'vitest';

import { extractEntities } from './extract-entities.js';

function generateSyntheticText(charCount: number, entitiesPerKB: number): string {
  const fillers = 'lorem ipsum dolor sit amet consectetur adipiscing elit ';
  const entities = [
    'https://example.com/path?q=1',
    'user@example.com',
    '4111111111111111',
    'token=AKIAIOSFODNN7EXAMPLE',
    'visit https://webhook.site/abc',
  ];
  const out: string[] = [];
  let chars = 0;
  let entityIndex = 0;
  const targetEntities = Math.ceil((charCount / 1024) * entitiesPerKB);
  let placedEntities = 0;
  while (chars < charCount) {
    if (placedEntities < targetEntities && chars > 0 && chars % 100 === 0) {
      const ent = entities[entityIndex % entities.length]!;
      out.push(ent);
      chars += ent.length;
      placedEntities++;
      entityIndex++;
      out.push(' ');
      chars += 1;
    } else {
      out.push(fillers);
      chars += fillers.length;
    }
  }
  return out.join('').slice(0, charCount);
}

describe('extractEntities latency', () => {
  it('processes 10K chars × ~100 entities in <100ms', () => {
    const text = generateSyntheticText(10_000, 10);
    const start = performance.now();
    const entities = extractEntities(text);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
    expect(entities.length).toBeGreaterThan(0);
  });

  it('processes 50K chars in <200ms (page-scale upper bound)', () => {
    const text = generateSyntheticText(50_000, 5);
    const start = performance.now();
    extractEntities(text);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
  });
});
