import type { SecurityStatus } from './verdict.js';
import { STAMP_VERSION } from '@/shared/constants.js';

/**
 * Issue #117 (N13) — cryptographically-bound page stamp.
 *
 * Embedded in the DOM after a successful scan so an LLM consumer's
 * "what did you read?" can be verified back to "did the LLM see the
 * post-mitigation page?" The HMAC is computed in the service worker
 * with a per-install secret that never leaves device.
 *
 * Canonical input for the HMAC is `${v}\n${url}\n${status}\n${timestamp}\n${nonce}`
 * where `url` has been passed through `normaliseStampUrl`. See
 * `src/service-worker/stamp.ts` for the implementation.
 */
export interface PageStamp {
  readonly v: typeof STAMP_VERSION;
  readonly url: string;
  readonly status: SecurityStatus;
  readonly timestamp: number;
  readonly nonce: string;
  readonly hmac: string;
}

/**
 * Result of `verifyStamp`. The `mismatchReason` discriminator lets
 * callers distinguish operator-friendly failure modes:
 *   - 'malformed'        — input shape didn't pass narrowing
 *   - 'unknown-version'  — `v` is not the current STAMP_VERSION
 *   - 'wrong-url'        — caller-supplied URL doesn't match stamp URL
 *                          (after normalisation)
 *   - 'wrong-secret'     — HMAC differs (constant-time compared)
 *
 * No 'expired' value: TTL is a caller-side policy, not a stamp-side
 * property. Callers who need freshness compare `stamp.timestamp` to
 * `Date.now()` themselves.
 */
export type VerifyStampResult =
  | { readonly valid: true }
  | {
      readonly valid: false;
      readonly mismatchReason: 'wrong-secret' | 'wrong-url' | 'malformed' | 'unknown-version';
    };

export { STAMP_VERSION };
