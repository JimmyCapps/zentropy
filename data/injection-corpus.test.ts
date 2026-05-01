import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface CorpusEntry {
  readonly id: string;
  readonly source: string;
  readonly text: string;
  readonly lang: 'en' | 'es' | 'zh-CN';
  readonly techniques: readonly string[];
  readonly embedding: null | readonly number[];
}

interface Corpus {
  readonly schema_version: number;
  readonly generated_at: string;
  readonly count: number;
  readonly entries: readonly CorpusEntry[];
}

function loadCorpus(): Corpus {
  const path = resolve(__dirname, 'injection-corpus.json');
  return JSON.parse(readFileSync(path, 'utf-8'));
}

const EMBEDDING_DIM = 384;

describe('injection-corpus.json schema invariants', () => {
  const corpus = loadCorpus();

  it('declares schema_version 1 or 2', () => {
    // v1: Stage 1 — embedding fields are null
    // v2: Stage 2 — embedding fields are length-EMBEDDING_DIM number arrays
    expect([1, 2]).toContain(corpus.schema_version);
  });

  it('count matches entries.length', () => {
    expect(corpus.count).toBe(corpus.entries.length);
  });

  it('has at least 30 entries (Stage 1 minimum)', () => {
    expect(corpus.entries.length).toBeGreaterThanOrEqual(30);
  });

  it('every id is a non-empty string', () => {
    for (const entry of corpus.entries) {
      expect(typeof entry.id).toBe('string');
      expect(entry.id.length).toBeGreaterThan(0);
    }
  });

  it('all ids are unique', () => {
    const ids = corpus.entries.map((e) => e.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('every text field is non-empty', () => {
    for (const entry of corpus.entries) {
      expect(typeof entry.text).toBe('string');
      expect(entry.text.length).toBeGreaterThan(0);
    }
  });

  it('every lang is one of en/es/zh-CN', () => {
    const valid = new Set(['en', 'es', 'zh-CN']);
    for (const entry of corpus.entries) {
      expect(valid.has(entry.lang)).toBe(true);
    }
  });

  it('techniques is always an array', () => {
    for (const entry of corpus.entries) {
      expect(Array.isArray(entry.techniques)).toBe(true);
    }
  });

  it('source is non-empty', () => {
    for (const entry of corpus.entries) {
      expect(typeof entry.source).toBe('string');
      expect(entry.source.length).toBeGreaterThan(0);
    }
  });

  it('embedding is either null (v1) or a length-EMBEDDING_DIM number array (v2)', () => {
    for (const entry of corpus.entries) {
      if (entry.embedding === null) continue;
      expect(Array.isArray(entry.embedding)).toBe(true);
      expect(entry.embedding.length).toBe(EMBEDDING_DIM);
      for (const v of entry.embedding) expect(typeof v).toBe('number');
    }
  });

  it('schema v2 implies every embedding is populated and non-null', () => {
    if (corpus.schema_version !== 2) return;
    for (const entry of corpus.entries) {
      expect(entry.embedding).not.toBeNull();
    }
  });

  it('schema v2 embeddings are L2-normalised within rounding tolerance', () => {
    if (corpus.schema_version !== 2) return;
    for (const entry of corpus.entries) {
      if (entry.embedding === null) continue;
      let sumSq = 0;
      for (const v of entry.embedding) sumSq += v * v;
      const norm = Math.sqrt(sumSq);
      expect(norm).toBeGreaterThan(0.99);
      expect(norm).toBeLessThan(1.01);
    }
  });

  it('covers all three languages', () => {
    const langs = new Set(corpus.entries.map((e) => e.lang));
    expect(langs.has('en')).toBe(true);
    expect(langs.has('es')).toBe(true);
    expect(langs.has('zh-CN')).toBe(true);
  });

  it('mixes honeypot and dm4 sources', () => {
    const ids = corpus.entries.map((e) => e.id);
    expect(ids.some((id) => id.startsWith('honeypot/'))).toBe(true);
    expect(ids.some((id) => id.startsWith('dm4/'))).toBe(true);
  });
});
