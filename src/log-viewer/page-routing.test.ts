import { describe, it, expect } from 'vitest';
import { deriveTarget, urlToSlug } from './page-routing.js';
import type { LogEntry } from '@/shared/logger.js';

function entry(overrides: Partial<LogEntry>): LogEntry {
  return {
    seq: 1,
    timestampMs: 0,
    elapsedMs: 0,
    source: 'sw',
    context: 'Test',
    level: 'info',
    message: '',
    args: [],
    ...overrides,
  };
}

describe('urlToSlug', () => {
  it('hostname only when path is empty', () => {
    expect(urlToSlug('https://example.com/')).toBe('example-com');
  });

  it('joins host and path tokens', () => {
    expect(urlToSlug('https://www.officeworks.com.au/shop/officeworks/p/jbcpa5ct10')).toBe(
      'www-officeworks-com-au_shop-officeworks-p-jbcpa5ct10',
    );
  });

  it('drops query string and hash', () => {
    expect(urlToSlug('https://example.com/path?a=1&b=2#frag')).toBe('example-com_path');
  });

  it('caps long paths at 60 chars', () => {
    const long = 'https://x.com/' + 'a'.repeat(200);
    expect(urlToSlug(long).length).toBeLessThanOrEqual(60);
  });

  it('falls back to sanitized raw string for non-URL input', () => {
    expect(urlToSlug('Not A URL!!')).toBe('not-a-url');
  });

  it('returns "unknown" for empty / fully-invalid input', () => {
    expect(urlToSlug('')).toBe('unknown');
    expect(urlToSlug('!!!')).toBe('unknown');
  });
});

describe('deriveTarget', () => {
  it('routes to page bucket when pageUrl is set', () => {
    const t = deriveTarget(entry({ pageUrl: 'https://example.com/p/1', source: 'content' }));
    expect(t.kind).toBe('page');
    expect(t.filename).toBe('example-com_p-1.jsonl');
  });

  it('routes to source bucket when no pageUrl', () => {
    const t = deriveTarget(entry({ source: 'sw' }));
    expect(t).toEqual({ kind: 'source', key: '_sw', filename: '_sw.jsonl' });
  });

  it('routes offscreen entries to _offscreen.jsonl regardless of context', () => {
    const t = deriveTarget(entry({ source: 'offscreen', context: 'NerEngine' }));
    expect(t.filename).toBe('_offscreen.jsonl');
  });

  it('treats empty pageUrl string the same as undefined', () => {
    const t = deriveTarget(entry({ source: 'content', pageUrl: '' }));
    expect(t.kind).toBe('source');
  });
});
