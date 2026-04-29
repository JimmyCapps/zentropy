import { describe, it, expect } from 'vitest';

import { extractExfilDomains } from './exfil-domain.js';
import { BLOCKED_PATTERNS } from '@/shared/blocked-patterns.js';

describe('extractExfilDomains', () => {
  it.each([
    'webhook.site/abc',
    'https://requestbin.com/r/abc',
    'data leak via pipedream.com/source',
    'hookbin.net/post',
    'tunnel via foo.ngrok.io/upload',
    'burpcollaborator.net/x',
    'callback http://x.interact.sh',
    'oastify.com',
    'beeceptor endpoint',
  ] as const)('matches the blocked pattern in %s', (text) => {
    const e = extractExfilDomains(text);
    expect(e.length).toBeGreaterThan(0);
    expect(e[0]!.confidence).toBe(0.95);
    expect(e[0]!.metadata?.pattern).toBeDefined();
  });

  it('does NOT match benign domains', () => {
    expect(extractExfilDomains('see https://example.com today')).toEqual([]);
    expect(extractExfilDomains('wikipedia.org article')).toEqual([]);
  });

  it('emits one entity per pattern hit', () => {
    const e = extractExfilDomains('webhook.site/a and requestbin.com/b');
    expect(e).toHaveLength(2);
  });

  it('honors offset', () => {
    const e = extractExfilDomains('webhook.site/x', 100);
    expect(e[0]!.span[0]).toBe(100);
  });

  it('all BLOCKED_PATTERNS in the shared module are matchable by extractor', () => {
    expect(BLOCKED_PATTERNS.length).toBeGreaterThan(0);
  });

  it('returns [] for empty input', () => {
    expect(extractExfilDomains('')).toEqual([]);
  });
});
