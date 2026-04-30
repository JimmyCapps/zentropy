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

describe('injection-corpus.json schema invariants', () => {
  const corpus = loadCorpus();

  it('declares schema_version 1', () => {
    expect(corpus.schema_version).toBe(1);
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

  it('Stage 1: embedding is null for every entry', () => {
    for (const entry of corpus.entries) {
      expect(entry.embedding).toBeNull();
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
