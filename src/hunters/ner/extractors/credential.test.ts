import { describe, it, expect } from 'vitest';

import { extractCredentials } from './credential.js';

describe('extractCredentials', () => {
  it('extracts password=value', () => {
    const e = extractCredentials('password=hunter2');
    expect(e.length).toBeGreaterThan(0);
    expect(e[0]!.value).toBe('password=hunter2');
    expect(e[0]!.metadata?.kind).toBe('password');
    expect(e[0]!.confidence).toBe(0.9);
  });

  it('extracts PASSWORD: value (case-insensitive, colon-separated)', () => {
    const e = extractCredentials('PASSWORD: secret123');
    expect(e.length).toBeGreaterThan(0);
    expect(e[0]!.metadata?.kind).toBe('password');
  });

  it('extracts token=value', () => {
    const e = extractCredentials('token=abcdefghijklmn');
    expect(e[0]!.metadata?.kind).toBe('token');
  });

  it('extracts an Authorization Bearer header', () => {
    const e = extractCredentials('authorization: Bearer eyJhbGc.iJIUz');
    const bearer = e.find((x) => x.metadata?.kind === 'bearer');
    expect(bearer).toBeDefined();
    expect(bearer!.confidence).toBe(0.85);
  });

  it('does NOT match the literal phrase "password is required"', () => {
    expect(extractCredentials('password is required')).toEqual([]);
  });

  it('honors offset', () => {
    const e = extractCredentials('token=abcdef', 50);
    expect(e[0]!.span[0]).toBe(50);
  });

  it('returns [] for empty input', () => {
    expect(extractCredentials('')).toEqual([]);
  });
});
