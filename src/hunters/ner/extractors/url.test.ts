import { describe, it, expect } from 'vitest';

import { extractUrls } from './url.js';

describe('extractUrls', () => {
  it('extracts a simple https:// URL', () => {
    const e = extractUrls('visit https://example.com today');
    expect(e).toHaveLength(1);
    expect(e[0]!.value).toBe('https://example.com');
    expect(e[0]!.type).toBe('url');
  });

  it('extracts http:// URLs', () => {
    const e = extractUrls('http://insecure.example.org/');
    expect(e).toHaveLength(1);
    expect(e[0]!.value).toBe('http://insecure.example.org/');
  });

  it('extracts an IP-based URL with port and path', () => {
    const e = extractUrls('callback http://192.0.2.1:8080/path?x=1 done');
    expect(e).toHaveLength(1);
    expect(e[0]!.value).toBe('http://192.0.2.1:8080/path?x=1');
  });

  it('extracts a URL with query string and fragment', () => {
    const e = extractUrls('click https://example.com/a?b=1&c=2#section');
    expect(e[0]!.value).toBe('https://example.com/a?b=1&c=2#section');
  });

  it('extracts percent-encoded paths', () => {
    const e = extractUrls('see https://example.com/%E2%9C%93/ok');
    expect(e[0]!.value).toBe('https://example.com/%E2%9C%93/ok');
  });

  it('does NOT extract bare domains without scheme', () => {
    expect(extractUrls('example.com is a domain')).toEqual([]);
  });

  it('extracts multiple URLs from one block', () => {
    const e = extractUrls('a https://a.io b https://b.io c');
    expect(e).toHaveLength(2);
    expect(e.map((x) => x.value)).toEqual(['https://a.io', 'https://b.io']);
  });

  it('honors the offset argument when computing spans', () => {
    const e = extractUrls('https://example.com', 100);
    expect(e[0]!.span).toEqual([100, 100 + 'https://example.com'.length]);
  });

  it('span content matches the source slice', () => {
    const text = 'prefix https://example.com suffix';
    const e = extractUrls(text);
    expect(text.slice(e[0]!.span[0], e[0]!.span[1])).toBe(e[0]!.value);
  });

  it('confidence is 0.9 for https URLs and 0.85 for http URLs', () => {
    expect(extractUrls('https://x.io')[0]!.confidence).toBe(0.9);
    expect(extractUrls('http://x.io')[0]!.confidence).toBe(0.85);
  });

  it('does not include trailing punctuation in the URL value', () => {
    const e = extractUrls('see https://example.com.');
    expect(e[0]!.value).toBe('https://example.com');
  });

  it('returns [] for empty input', () => {
    expect(extractUrls('')).toEqual([]);
  });
});
