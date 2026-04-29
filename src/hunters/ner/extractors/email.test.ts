import { describe, it, expect } from 'vitest';

import { extractEmails } from './email.js';

describe('extractEmails', () => {
  it('extracts a standard email', () => {
    const e = extractEmails('contact user@example.com today');
    expect(e).toHaveLength(1);
    expect(e[0]!.value).toBe('user@example.com');
    expect(e[0]!.type).toBe('email');
  });

  it('extracts a plus-aliased email', () => {
    const e = extractEmails('reply user+filter@example.com');
    expect(e[0]!.value).toBe('user+filter@example.com');
  });

  it('extracts multiple emails', () => {
    const e = extractEmails('a@x.io b@y.io');
    expect(e.map((x) => x.value)).toEqual(['a@x.io', 'b@y.io']);
  });

  it('does NOT extract a lone @ in code', () => {
    expect(extractEmails('use @vitest-environment jsdom directive')).toEqual([]);
  });

  it('does NOT extract bare TLDs without local part', () => {
    expect(extractEmails('the .com tld')).toEqual([]);
  });

  it('honors offset', () => {
    const e = extractEmails('a@b.io', 50);
    expect(e[0]!.span).toEqual([50, 56]);
  });

  it('confidence is 0.9 for standard emails', () => {
    expect(extractEmails('a@b.io')[0]!.confidence).toBe(0.9);
  });

  it('extracts dots in local part', () => {
    const e = extractEmails('first.last@example.com');
    expect(e[0]!.value).toBe('first.last@example.com');
  });

  it('returns [] for empty input', () => {
    expect(extractEmails('')).toEqual([]);
  });
});
