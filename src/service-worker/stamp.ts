import type { PageStamp, VerifyStampResult } from '@/types/page-stamp.js';
import type { SecurityStatus } from '@/types/verdict.js';
import { STAMP_VERSION } from '@/shared/constants.js';

/**
 * Issue #117 (N13) — page stamp generation and verification.
 *
 * Canonical HMAC input is `${v}\n${normalisedUrl}\n${status}\n${timestamp}\n${nonce}`.
 * URLs are normalised on both sign and verify so trivially equivalent
 * forms (case, fragment, trailing slash) verify successfully without
 * widening the cryptographic surface.
 *
 * `verifyStamp` ordering: shape → version → URL → HMAC. The first three
 * checks short-circuit before any crypto compute (URL and version are
 * already public — they're embedded in the meta tag, so no timing
 * oracle exists for them). The HMAC step uses a constant-time byte
 * comparison after `crypto.subtle.sign`.
 *
 * No TTL: stamps attest to a scan event at a specific timestamp;
 * freshness is a caller-side policy. `'expired'` is deliberately not in
 * the `mismatchReason` union.
 */

const NONCE_BYTES = 16;

interface PageStampLike {
  readonly v: number;
  readonly url: string;
  readonly status: SecurityStatus;
  readonly timestamp: number;
  readonly nonce: string;
  readonly hmac: string;
}

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function base64urlToBytes(s: string): Uint8Array {
  const standard = s.replaceAll('-', '+').replaceAll('_', '/');
  const padLen = (4 - (standard.length % 4)) % 4;
  const binary = atob(standard + '='.repeat(padLen));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function normaliseStampUrl(input: string): string {
  const u = new URL(input);
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  u.protocol = u.protocol.toLowerCase();
  let pathname = u.pathname;
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }
  const portPart = u.port ? `:${u.port}` : '';
  return `${u.protocol}//${u.hostname}${portPart}${pathname}${u.search}`;
}

interface CanonicalInput {
  readonly v: number;
  readonly url: string;
  readonly status: SecurityStatus;
  readonly timestamp: number;
  readonly nonce: string;
}

function buildCanonicalInput(parts: CanonicalInput): Uint8Array {
  const canonical = `${parts.v}\n${parts.url}\n${parts.status}\n${parts.timestamp}\n${parts.nonce}`;
  return new TextEncoder().encode(canonical);
}

async function importHmacKey(secretBase64url: string): Promise<CryptoKey> {
  const secretBytes = base64urlToBytes(secretBase64url);
  return crypto.subtle.importKey(
    'raw',
    secretBytes as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

function isSecurityStatus(value: unknown): value is SecurityStatus {
  return (
    value === 'CLEAN' ||
    value === 'SUSPICIOUS' ||
    value === 'COMPROMISED' ||
    value === 'UNKNOWN'
  );
}

function isPageStampShape(input: unknown): input is PageStampLike {
  if (input === null || typeof input !== 'object') return false;
  const o = input as Record<string, unknown>;
  return (
    typeof o.v === 'number' &&
    typeof o.url === 'string' &&
    isSecurityStatus(o.status) &&
    typeof o.timestamp === 'number' &&
    typeof o.nonce === 'string' &&
    typeof o.hmac === 'string'
  );
}

export interface GenerateStampInput {
  readonly url: string;
  readonly status: SecurityStatus;
  readonly timestamp: number;
}

export async function generateStamp(
  input: GenerateStampInput,
  secret: string,
): Promise<PageStamp> {
  const normalisedUrl = normaliseStampUrl(input.url);
  const nonceBytes = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(nonceBytes);
  const nonce = bytesToBase64url(nonceBytes);

  const key = await importHmacKey(secret);
  const data = buildCanonicalInput({
    v: STAMP_VERSION,
    url: normalisedUrl,
    status: input.status,
    timestamp: input.timestamp,
    nonce,
  });
  const sig = await crypto.subtle.sign('HMAC', key, data as BufferSource);
  const hmac = bytesToBase64url(new Uint8Array(sig));

  return {
    v: STAMP_VERSION,
    url: normalisedUrl,
    status: input.status,
    timestamp: input.timestamp,
    nonce,
    hmac,
  };
}

export async function verifyStamp(
  input: unknown,
  secret: string,
  currentUrl: string,
): Promise<VerifyStampResult> {
  if (!isPageStampShape(input)) {
    return { valid: false, mismatchReason: 'malformed' };
  }
  if (input.v !== STAMP_VERSION) {
    return { valid: false, mismatchReason: 'unknown-version' };
  }

  let normalisedCurrent: string;
  let normalisedStampUrl: string;
  try {
    normalisedCurrent = normaliseStampUrl(currentUrl);
    normalisedStampUrl = normaliseStampUrl(input.url);
  } catch {
    return { valid: false, mismatchReason: 'malformed' };
  }
  if (normalisedCurrent !== normalisedStampUrl) {
    return { valid: false, mismatchReason: 'wrong-url' };
  }

  let actual: Uint8Array;
  try {
    actual = base64urlToBytes(input.hmac);
  } catch {
    return { valid: false, mismatchReason: 'malformed' };
  }

  const key = await importHmacKey(secret);
  const data = buildCanonicalInput({
    v: input.v,
    url: normalisedStampUrl,
    status: input.status,
    timestamp: input.timestamp,
    nonce: input.nonce,
  });
  const sig = await crypto.subtle.sign('HMAC', key, data as BufferSource);
  const expected = new Uint8Array(sig);

  if (!constantTimeEqual(actual, expected)) {
    return { valid: false, mismatchReason: 'wrong-secret' };
  }
  return { valid: true };
}
