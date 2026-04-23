import { describe, it, expect } from 'vitest';
import { chunkByWords } from './chunking.js';

describe('chunkByWords', () => {
  it('returns the original text as a single chunk when shorter than window', () => {
    const short = 'only a few words here';
    const chunks = chunkByWords(short, 50, 25);
    expect(chunks).toEqual([short]);
  });

  it('emits overlapping sliding windows on longer text', () => {
    const words = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunkByWords(words, 50, 25);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.split(/\s+/).length).toBeLessThanOrEqual(50);
    }
  });

  it('covers the tail of the text so nothing is dropped at the end', () => {
    const words = Array.from({ length: 100 }, (_, i) => `w${i}`).join(' ');
    const chunks = chunkByWords(words, 50, 25);
    expect(chunks[chunks.length - 1]).toContain('w99');
  });
});
