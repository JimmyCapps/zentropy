import { describe, it, expect } from 'vitest';

import type { HunterResult } from '../base-hunter.js';
import { buildEmbeddingsFinding } from './finding.js';

function makeMatchResult(overrides: Partial<HunterResult> = {}): HunterResult {
  return {
    hunterName: 'embeddings',
    matched: true,
    flags: ['embeddings:injection-0042', 'lang:es', 'technique:role-play'],
    score: 40,
    confidence: 0.91,
    features: [
      {
        name: 'cosine_similarity',
        weight: 0.91,
        activations: [
          'injection-0042@0.910',
          'injection-0017@0.880',
          'injection-0099@0.860',
        ],
      },
    ],
    errorMessage: null,
    ...overrides,
  };
}

describe('buildEmbeddingsFinding', () => {
  it('flattens flags into a structured finding for a matched embeddings result', () => {
    const finding = buildEmbeddingsFinding(2, makeMatchResult());
    expect(finding).not.toBeNull();
    expect(finding!.chunkIndex).toBe(2);
    expect(finding!.topId).toBe('injection-0042');
    expect(finding!.topScore).toBe(0.91);
    expect(finding!.topLang).toBe('es');
    expect(finding!.topTechniques).toEqual(['role-play']);
    expect(finding!.activations).toEqual([
      'injection-0042@0.910',
      'injection-0017@0.880',
      'injection-0099@0.860',
    ]);
  });

  it('preserves multiple techniques on the top match', () => {
    const finding = buildEmbeddingsFinding(
      0,
      makeMatchResult({
        flags: [
          'embeddings:injection-0042',
          'lang:zh-CN',
          'technique:role-play',
          'technique:system-override',
        ],
      }),
    );
    expect(finding!.topTechniques).toEqual(['role-play', 'system-override']);
    expect(finding!.topLang).toBe('zh-CN');
  });

  it('returns null for a non-embeddings hunter result', () => {
    const finding = buildEmbeddingsFinding(
      0,
      makeMatchResult({ hunterName: 'spider' }),
    );
    expect(finding).toBeNull();
  });

  it('returns null for an unmatched embeddings result', () => {
    const finding = buildEmbeddingsFinding(
      0,
      makeMatchResult({ matched: false, flags: [], features: [] }),
    );
    expect(finding).toBeNull();
  });

  it('returns null when the cosine_similarity feature is missing', () => {
    const finding = buildEmbeddingsFinding(
      0,
      makeMatchResult({
        features: [{ name: 'other', weight: 0.5, activations: [] }],
      }),
    );
    expect(finding).toBeNull();
  });

  it('falls back to "unknown" when no lang flag is present', () => {
    const finding = buildEmbeddingsFinding(
      1,
      makeMatchResult({
        flags: ['embeddings:injection-0042', 'technique:role-play'],
      }),
    );
    expect(finding!.topLang).toBe('unknown');
    expect(finding!.topId).toBe('injection-0042');
  });

  it('emits empty topTechniques when no technique flags are present', () => {
    const finding = buildEmbeddingsFinding(
      1,
      makeMatchResult({ flags: ['embeddings:injection-0042', 'lang:en'] }),
    );
    expect(finding!.topTechniques).toEqual([]);
  });

  it('falls back to empty topId when the embeddings flag is missing', () => {
    const finding = buildEmbeddingsFinding(
      0,
      makeMatchResult({ flags: ['lang:en', 'technique:role-play'] }),
    );
    expect(finding!.topId).toBe('');
  });

  it('keeps activations array byte-identical (does not re-sort)', () => {
    const activations = ['a@0.9', 'b@0.95', 'c@0.85'];
    const finding = buildEmbeddingsFinding(
      0,
      makeMatchResult({
        features: [
          { name: 'cosine_similarity', weight: 0.9, activations },
        ],
      }),
    );
    expect(finding!.activations).toEqual(activations);
  });
});
