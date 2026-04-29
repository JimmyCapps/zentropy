import { describe, it, expect } from 'vitest';

import { extractEntities } from './extract-entities.js';

describe('extractEntities (aggregator)', () => {
  it('runs all six extractors over the input', () => {
    const text = 'Visit https://example.com email user@example.com card 4111111111111111 ' +
      'token=Bearer eyJhbGc.iJIUz exfil https://webhook.site/abc';
    const e = extractEntities(text);
    const types = new Set(e.map((x) => x.type));
    expect(types.has('url')).toBe(true);
    expect(types.has('email')).toBe(true);
    expect(types.has('credit_card')).toBe(true);
    expect(types.has('exfil_domain')).toBe(true);
  });

  it('preserves cross-type overlap (URL and exfil_domain on the same span)', () => {
    const e = extractEntities('drop https://webhook.site/abc');
    const url = e.find((x) => x.type === 'url');
    const exfil = e.find((x) => x.type === 'exfil_domain');
    expect(url).toBeDefined();
    expect(exfil).toBeDefined();
  });

  it('deduplicates same-type same-span entities, preferring higher confidence', () => {
    const text = 'AKIAIOSFODNN7EXAMPLE';
    const e = extractEntities(text);
    const apiKeys = e.filter((x) => x.type === 'api_key');
    expect(apiKeys).toHaveLength(1);
    expect(apiKeys[0]!.metadata?.shape).toBe('aws_access_key');
  });

  it('returns entities sorted by start offset ascending', () => {
    const text = 'card 4111111111111111 then https://example.com then a@b.io';
    const e = extractEntities(text);
    for (let i = 1; i < e.length; i++) {
      expect(e[i]!.span[0]).toBeGreaterThanOrEqual(e[i - 1]!.span[0]);
    }
  });

  it('returns [] for empty input', () => {
    expect(extractEntities('')).toEqual([]);
  });

  it('returns [] for benign prose', () => {
    expect(extractEntities('this is a perfectly normal paragraph')).toEqual([]);
  });

  it('span content matches the source slice for every extracted entity', () => {
    const text = 'mix https://example.com and 4111111111111111 done';
    const e = extractEntities(text);
    for (const ent of e) {
      expect(text.slice(ent.span[0], ent.span[1])).toBe(ent.value);
    }
  });
});
