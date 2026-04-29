import { describe, it, expect } from 'vitest';

import { extractApiKeys } from './api-key.js';

describe('extractApiKeys', () => {
  it('extracts an AWS access key', () => {
    const e = extractApiKeys('aws_access_key_id=AKIAIOSFODNN7EXAMPLE');
    expect(e.length).toBeGreaterThan(0);
    const named = e.find((x) => x.metadata?.shape === 'aws_access_key');
    expect(named).toBeDefined();
    expect(named!.value).toBe('AKIAIOSFODNN7EXAMPLE');
    expect(named!.confidence).toBe(0.95);
  });

  it('extracts a GitHub PAT', () => {
    const e = extractApiKeys('token: ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    const named = e.find((x) => x.metadata?.shape === 'github_pat');
    expect(named).toBeDefined();
    expect(named!.confidence).toBe(0.95);
  });

  it('extracts an OpenAI sk- key', () => {
    const e = extractApiKeys('OPENAI_API_KEY=sk-proj-AbCdEf0123456789AbCdEf0123456789AbCdEf');
    const named = e.find((x) => x.metadata?.shape === 'openai');
    expect(named).toBeDefined();
  });

  it('extracts a Stripe live key', () => {
    const e = extractApiKeys('STRIPE=' + 'sk_' + 'live_' + 'x'.repeat(24));
    const named = e.find((x) => x.metadata?.shape === 'stripe_live');
    expect(named).toBeDefined();
  });

  it('extracts a generic high-entropy 32-char hex token (entropy > 3.0)', () => {
    const e = extractApiKeys('token=a1b2c3d4e5f6789012345678901234ab benign');
    const generic = e.find((x) => x.metadata?.shape === 'high_entropy');
    expect(generic).toBeDefined();
    expect(generic!.confidence).toBe(0.6);
    const entropy = generic!.metadata?.entropy;
    expect(typeof entropy).toBe('number');
    expect(entropy as number).toBeGreaterThan(3.0);
  });

  it('does NOT extract a low-entropy 32-char string', () => {
    const e = extractApiKeys('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const generic = e.find((x) => x.metadata?.shape === 'high_entropy');
    expect(generic).toBeUndefined();
  });

  it('does NOT extract short tokens (under 20 chars)', () => {
    expect(extractApiKeys('short_token12345')).toEqual([]);
  });

  it('honors offset', () => {
    const e = extractApiKeys('AKIAIOSFODNN7EXAMPLE', 50);
    const named = e.find((x) => x.metadata?.shape === 'aws_access_key');
    expect(named!.span[0]).toBe(50);
  });

  it('returns [] for empty input', () => {
    expect(extractApiKeys('')).toEqual([]);
  });
});
