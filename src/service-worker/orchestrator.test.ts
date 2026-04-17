import { describe, it, expect } from 'vitest';
import { mergeErrors } from './orchestrator.js';

describe('mergeErrors (Phase 4 Stage 4B)', () => {
  it('returns null when both inputs are null', () => {
    expect(mergeErrors(null, null)).toBeNull();
  });

  it('passes through the probe error when chunk error is null', () => {
    expect(mergeErrors('engine timeout', null)).toBe('engine timeout');
  });

  it('passes through the chunk error when probe error is null', () => {
    expect(mergeErrors(null, 'chunk_count_capped (8 chunks → kept first 4)')).toBe(
      'chunk_count_capped (8 chunks → kept first 4)',
    );
  });

  it('joins both errors with "; " so both signals survive downstream', () => {
    expect(
      mergeErrors('partial probe failure: summarization', 'chunk_count_capped (6 chunks → kept first 4)'),
    ).toBe('partial probe failure: summarization; chunk_count_capped (6 chunks → kept first 4)');
  });
});
