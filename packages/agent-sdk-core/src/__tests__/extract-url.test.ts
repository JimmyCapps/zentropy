import { describe, expect, it } from 'vitest';
import { defaultExtractUrl } from '../extract-url.js';

describe('defaultExtractUrl', () => {
  it('returns http URL string verbatim', () => {
    expect(defaultExtractUrl('http://example.com/')).toBe('http://example.com/');
  });

  it('returns https URL string verbatim', () => {
    expect(defaultExtractUrl('https://example.com/path?q=1')).toBe(
      'https://example.com/path?q=1',
    );
  });

  it('treats string scheme match case-insensitively', () => {
    expect(defaultExtractUrl('HTTPS://example.com/')).toBe('HTTPS://example.com/');
  });

  it('returns undefined for non-URL strings', () => {
    expect(defaultExtractUrl('search query')).toBeUndefined();
    expect(defaultExtractUrl('')).toBeUndefined();
  });

  it('returns undefined for non-http(s) schemes', () => {
    expect(defaultExtractUrl('ftp://example.com/')).toBeUndefined();
    expect(defaultExtractUrl('file:///etc/passwd')).toBeUndefined();
    expect(defaultExtractUrl('javascript:alert(1)')).toBeUndefined();
  });

  it('extracts url field from object input', () => {
    expect(defaultExtractUrl({ url: 'https://example.com/' })).toBe(
      'https://example.com/',
    );
  });

  it('extracts href field from object input when url is absent', () => {
    expect(defaultExtractUrl({ href: 'https://example.com/' })).toBe(
      'https://example.com/',
    );
  });

  it('extracts webPath field from object input (LangChain WebBaseLoader)', () => {
    expect(defaultExtractUrl({ webPath: 'https://example.com/' })).toBe(
      'https://example.com/',
    );
  });

  it('prefers url over href over webPath when multiple are present', () => {
    expect(
      defaultExtractUrl({
        url: 'https://primary.example/',
        href: 'https://other.example/',
        webPath: 'https://third.example/',
      }),
    ).toBe('https://primary.example/');
    expect(
      defaultExtractUrl({
        href: 'https://other.example/',
        webPath: 'https://third.example/',
      }),
    ).toBe('https://other.example/');
  });

  it('rejects object fields that are not http(s)', () => {
    expect(defaultExtractUrl({ url: 'ftp://example.com/' })).toBeUndefined();
    expect(defaultExtractUrl({ url: 'not-a-url' })).toBeUndefined();
  });

  it('rejects object fields that are not strings', () => {
    expect(defaultExtractUrl({ url: 42 })).toBeUndefined();
    expect(defaultExtractUrl({ url: null })).toBeUndefined();
    expect(defaultExtractUrl({ url: { nested: 'https://x' } })).toBeUndefined();
  });

  it('returns undefined for objects without recognised URL fields', () => {
    expect(defaultExtractUrl({ q: 'x' })).toBeUndefined();
    expect(defaultExtractUrl({ query: 'https://example.com/' })).toBeUndefined();
  });

  it('returns undefined for null / undefined / non-object scalars', () => {
    expect(defaultExtractUrl(null)).toBeUndefined();
    expect(defaultExtractUrl(undefined)).toBeUndefined();
    expect(defaultExtractUrl(42)).toBeUndefined();
    expect(defaultExtractUrl(true)).toBeUndefined();
  });

  it('returns undefined for arrays (no recognised fields)', () => {
    expect(defaultExtractUrl(['https://example.com/'])).toBeUndefined();
  });
});
