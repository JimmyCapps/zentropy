import { describe, it, expect } from 'vitest';
import { extractUrls } from './url-extract.js';
import { MAX_INTERCEPT_URLS_PER_PROMPT } from '@/shared/constants.js';

describe('extractUrls', () => {
  it('returns empty array for empty input', () => {
    expect(extractUrls('')).toEqual([]);
  });

  it('returns empty array when no URL is present', () => {
    expect(extractUrls('hello world how are you today')).toEqual([]);
  });

  it('extracts a single https URL from prose', () => {
    expect(extractUrls('please look up https://example.com for me')).toEqual([
      'https://example.com',
    ]);
  });

  it('extracts a single http URL from prose', () => {
    expect(extractUrls('see http://insecure.example/page?q=1 thanks')).toEqual([
      'http://insecure.example/page?q=1',
    ]);
  });

  it('returns multiple URLs in document order', () => {
    expect(
      extractUrls('compare https://a.example and https://b.example please'),
    ).toEqual(['https://a.example', 'https://b.example']);
  });

  it('dedupes identical URLs', () => {
    expect(
      extractUrls('see https://a.example and again https://a.example'),
    ).toEqual(['https://a.example']);
  });

  it('skips ftp / mailto / javascript schemes', () => {
    expect(
      extractUrls(
        'mailto:a@b.com ftp://x.example javascript:alert(1) https://ok.example',
      ),
    ).toEqual(['https://ok.example']);
  });

  it('caps the result at MAX_INTERCEPT_URLS_PER_PROMPT', () => {
    const text = Array.from(
      { length: MAX_INTERCEPT_URLS_PER_PROMPT + 5 },
      (_v, i) => `https://h${i}.example`,
    ).join(' ');
    const out = extractUrls(text);
    expect(out).toHaveLength(MAX_INTERCEPT_URLS_PER_PROMPT);
    expect(out[0]).toBe('https://h0.example');
  });

  it('handles URLs with paths, queries, and fragments', () => {
    expect(
      extractUrls('see https://x.example/a/b?c=1&d=2#frag for details'),
    ).toEqual(['https://x.example/a/b?c=1&d=2#frag']);
  });

  it('strips a trailing comma / period that is clearly punctuation', () => {
    expect(extractUrls('go to https://x.example.')).toEqual(['https://x.example']);
    expect(extractUrls('compare https://a.example, https://b.example.')).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });

  it('does not split a URL on internal . or , inside the path', () => {
    expect(extractUrls('see https://x.example/a.b,c thanks')).toEqual([
      'https://x.example/a.b,c',
    ]);
  });

  it('handles a URL adjacent to leading whitespace and newlines', () => {
    expect(extractUrls('please scan\n\nhttps://a.example\n\nthanks')).toEqual([
      'https://a.example',
    ]);
  });
});
