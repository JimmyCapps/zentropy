import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chunkByWords, chunkText } from './chunking.js';
import { _resetForTesting } from './language-router.js';
import { MAX_CHUNK_TOKENS } from '@/shared/constants.js';

function langDeps(lang: string) {
  return {
    sendDetect: vi.fn(async () => ({
      lang,
      confidence: 0.99,
      source: 'chrome-api' as const,
    })),
  };
}

describe('chunkByWords', () => {
  it('returns the original text as a single chunk when shorter than window', () => {
    const short = 'only a few words here';
    const chunks = chunkByWords(short, 50, 25);
    expect(chunks).toEqual([short]);
  });

  it('normalizes whitespace on the short path so denominators stay stable', () => {
    // Both branches must emit single-space-joined text so downstream
    // text.length-normalized features (e.g. markerDensity) behave the
    // same whether or not the input already happened to be canonical.
    const messy = 'a\n\nb\t\tc   d';
    const chunks = chunkByWords(messy, 50, 25);
    expect(chunks).toEqual(['a b c d']);
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

describe('chunkText (canonical boundary-aware chunker)', () => {
  it('returns a single chunk with full hash on the fast path when text fits in maxChars', async () => {
    const text = 'short input that fits';
    const chunks = await chunkText(text, { maxChars: 100 });
    expect(chunks).toHaveLength(1);
    const [only] = chunks;
    expect(only!.text).toBe(text);
    expect(only!.start).toBe(0);
    expect(only!.end).toBe(text.length);
    expect(only!.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('prefers a paragraph break over a sentence break within the window', async () => {
    // maxChars=40, halfMark=20. \n\n at index 23 (>=20) wins; sentence at index 38 is later but loses.
    const text = 'aaaaaa. bbbbbb. cccccc.\n\ndddddd. eeeeee. ffffff. ggggg';
    const chunks = await chunkText(text, { maxChars: 40 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]!.end).toBe(24); // paragraphAt (23) + 1
    expect(chunks[0]!.text).toBe(text.slice(0, 24));
  });

  it('falls through to sentence boundary when no paragraph break is in range', async () => {
    // maxChars=30, halfMark=15. Last '. ' at index 28 wins; +1 = 29.
    const text = 'aaaa. bbbb. cccc. dddd. eeee. ffff';
    const chunks = await chunkText(text, { maxChars: 30 });
    expect(chunks[0]!.end).toBe(29);
    expect(chunks[0]!.text).toBe(text.slice(0, 29));
  });

  it('falls through to a word boundary when neither paragraph nor sentence is found', async () => {
    // maxChars=20. No '\n\n', no '. ', no '! ', no '? '. Last space ≤ 20 is index 18; +1 = 19.
    const text = 'one two three four five six seven eight nine ten';
    const chunks = await chunkText(text, { maxChars: 20 });
    expect(chunks[0]!.end).toBe(19);
    expect(chunks[0]!.text).toBe('one two three four ');
  });

  it('hard-cuts at exactly maxChars when no boundary exists', async () => {
    const maxChars = 10;
    const text = 'a'.repeat(maxChars * 2 + 5);
    const chunks = await chunkText(text, { maxChars });
    expect(chunks).toHaveLength(3);
    expect(chunks[0]!.end).toBe(maxChars);
    expect(chunks[1]!.end).toBe(maxChars * 2);
    expect(chunks[2]!.end).toBe(text.length);
  });

  it('produces chunks whose text matches source.slice(start, end) and reconstructs to the source', async () => {
    const text = 'aaaaaa. bbbbbb. cccccc.\n\ndddddd. eeeeee. ffffff. gggggg. hhhhhh.\n\niiiiii jjjjjj kkkkkk llllll';
    const chunks = await chunkText(text, { maxChars: 40 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text).toBe(text.slice(chunk.start, chunk.end));
    }
    expect(chunks.map((c) => c.text).join('')).toBe(text);
  });

  it("covers the tail so the last chunk's end equals text.length", async () => {
    const text = 'one two three four five six seven eight nine ten eleven twelve';
    const chunks = await chunkText(text, { maxChars: 20 });
    expect(chunks[chunks.length - 1]!.end).toBe(text.length);
  });

  it('produces deterministic contentHash values for identical text and different hashes for different text', async () => {
    const a = await chunkText('hello world', { maxChars: 100 });
    const b = await chunkText('hello world', { maxChars: 100 });
    const c = await chunkText('hello worlD', { maxChars: 100 });
    expect(a[0]!.contentHash).toBe(b[0]!.contentHash);
    expect(a[0]!.contentHash).not.toBe(c[0]!.contentHash);
  });

  it('regression: sentence-only input splits at the same offset as the prior orchestrator chunker', async () => {
    // The pre-#115 orchestrator chunker used:
    //   splitAt = lastIndexOf('. ', maxChars); if (-1 || < halfMark) splitAt = lastIndexOf(' ', ...);
    //   else splitAt += 1
    // For this input with maxChars=30: '. ' at 28 → splitAt = 29.
    const text = 'aaaa. bbbb. cccc. dddd. eeee. ffff gggg hhhh iiii';
    const chunks = await chunkText(text, { maxChars: 30 });
    expect(chunks[0]!.end).toBe(29);
    expect(chunks[0]!.text).toBe(text.slice(0, 29));
  });
});

describe('chunkText — language-aware dispatch', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it('C1: EN regression — paragraph offset preserved when injecting en deps', async () => {
    const text = 'aaaaaa. bbbbbb. cccccc.\n\ndddddd. eeeeee. ffffff. ggggg';
    const chunks = await chunkText(text, { maxChars: 40, detectDeps: langDeps('en') });
    expect(chunks[0]!.end).toBe(24);
  });

  it('C2: EN regression — sentence offset preserved', async () => {
    const text = 'aaaa. bbbb. cccc. dddd. eeee. ffff';
    const chunks = await chunkText(text, { maxChars: 30, detectDeps: langDeps('en') });
    expect(chunks[0]!.end).toBe(29);
  });

  it('C3: EN regression — word offset preserved', async () => {
    const text = 'one two three four five six seven eight nine ten';
    const chunks = await chunkText(text, { maxChars: 20, detectDeps: langDeps('en') });
    expect(chunks[0]!.end).toBe(19);
  });

  it('C4: EN regression — hard-cut preserved', async () => {
    const text = 'a'.repeat(20);
    const chunks = await chunkText(text, { maxChars: 5, detectDeps: langDeps('en') });
    expect(chunks).toHaveLength(4);
    expect(chunks.every((c) => c.text.length === 5)).toBe(true);
  });

  it('C5: ZH char budget defaults to MAX_CHUNK_TOKENS * 2.0 when no maxChars', async () => {
    const charBudget = MAX_CHUNK_TOKENS * 2;
    const text = '字'.repeat(charBudget + 10);
    const chunks = await chunkText(text, { detectDeps: langDeps('zh') });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]!.text.length).toBeLessThanOrEqual(charBudget);
  });

  it('C6: ZH `。` split — first chunk ends with terminator', async () => {
    const text = '甲'.repeat(50) + '。' + '乙'.repeat(50) + '。' + '丙'.repeat(20);
    const chunks = await chunkText(text, { maxChars: 80, detectDeps: langDeps('zh') });
    expect(chunks[0]!.text.endsWith('。')).toBe(true);
    expect(chunks.map((c) => c.text).join('')).toBe(text);
  });

  it('C7: JA mixed kanji/kana — non-final chunks end with `。`', async () => {
    const text = '私は毎日。それは良い。'.repeat(8);
    const chunks = await chunkText(text, { maxChars: 60, detectDeps: langDeps('ja') });
    for (let i = 0; i < chunks.length - 1; i++) {
      expect(chunks[i]!.text.endsWith('。')).toBe(true);
    }
  });

  it('C8: AR RTL paragraph break — first chunk ends with newline', async () => {
    const text = 'كلمة '.repeat(15) + '\n\n' + 'كلمة '.repeat(30);
    const chunks = await chunkText(text, { maxChars: 120, detectDeps: langDeps('ar') });
    expect(chunks[0]!.text.endsWith('\n')).toBe(true);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it('C9: AR char budget defaults to MAX_CHUNK_TOKENS * 3.5', async () => {
    const charBudget = Math.floor(MAX_CHUNK_TOKENS * 3.5);
    const text = 'ك'.repeat(charBudget + 10);
    const chunks = await chunkText(text, { detectDeps: langDeps('ar') });
    expect(chunks[0]!.text.length).toBeLessThanOrEqual(charBudget);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it('C10: HE char budget matches AR family (3.5)', async () => {
    const charBudget = Math.floor(MAX_CHUNK_TOKENS * 3.5);
    const text = 'ש'.repeat(charBudget + 10);
    const chunks = await chunkText(text, { detectDeps: langDeps('he') });
    expect(chunks[0]!.text.length).toBeLessThanOrEqual(charBudget);
  });

  it('C11: `und` graceful default routes to EN ruleset', async () => {
    const text = 'aaaaaa. bbbbbb. cccccc.\n\ndddddd. eeeeee. ffffff. ggggg';
    const chunks = await chunkText(text, { maxChars: 40, detectDeps: langDeps('und') });
    expect(chunks[0]!.end).toBe(24);
  });

  it('C12: xlm-roberta source treated as default (EN)', async () => {
    const text = 'aaaaaa. bbbbbb. cccccc.\n\ndddddd. eeeeee. ffffff. ggggg';
    const chunks = await chunkText(text, {
      maxChars: 40,
      detectDeps: {
        sendDetect: vi.fn(async () => ({
          lang: 'und',
          confidence: 0,
          source: 'xlm-roberta' as const,
        })),
      },
    });
    expect(chunks[0]!.end).toBe(24);
  });

  it('C13: detectLanguage rejection falls back to default ruleset, no throw', async () => {
    const text = 'aaaaaa. bbbbbb. cccccc.\n\ndddddd. eeeeee. ffffff. ggggg';
    const chunks = await chunkText(text, {
      maxChars: 40,
      detectDeps: {
        sendDetect: vi.fn(async () => {
          throw new Error('detection failure');
        }),
      },
    });
    expect(chunks[0]!.end).toBe(24);
  });

  it('C14: explicit opts.maxChars overrides per-language calibration', async () => {
    const text = '字'.repeat(60);
    const chunks = await chunkText(text, { maxChars: 30, detectDeps: langDeps('zh') });
    expect(chunks[0]!.text.length).toBeLessThanOrEqual(30);
  });
});
