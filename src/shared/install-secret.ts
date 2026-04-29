import { STORAGE_KEY_INSTALL_SECRET } from './constants.js';

/**
 * Issue #117 (N13) — per-install HMAC secret used to sign page stamps.
 *
 * The secret is generated lazily on first use, stored in
 * `chrome.storage.local`, and never leaves the SW context. MV3 service
 * workers terminate after ~30s idle, so the in-memory cache here is
 * session-scoped — the read-before-write path on next wakeup recovers
 * the persisted secret without rotating it.
 *
 * `chrome.runtime.onInstalled` fires on every extension UPDATE, not
 * just first install; the read-before-write idempotency is what
 * prevents the secret from rotating on update (which would invalidate
 * every stamp embedded in already-loaded pages).
 *
 * If `chrome.storage.local.set` rejects, we propagate the error rather
 * than caching a never-persisted secret. Per the #94 precedent: surface
 * persistence failures, never silently swallow.
 */

const SECRET_BYTES = 32;

let cached: string | null = null;
let inFlight: Promise<string> | null = null;

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function compute(): Promise<string> {
  const stored = await chrome.storage.local.get(STORAGE_KEY_INSTALL_SECRET);
  const existing = stored[STORAGE_KEY_INSTALL_SECRET];
  if (typeof existing === 'string' && existing.length > 0) {
    return existing;
  }
  const bytes = new Uint8Array(SECRET_BYTES);
  crypto.getRandomValues(bytes);
  const secret = bytesToBase64url(bytes);
  await chrome.storage.local.set({ [STORAGE_KEY_INSTALL_SECRET]: secret });
  return secret;
}

export async function ensureInstallSecret(): Promise<string> {
  if (cached !== null) return cached;
  if (inFlight !== null) return inFlight;

  inFlight = compute();
  try {
    cached = await inFlight;
    return cached;
  } catch (err) {
    inFlight = null;
    throw err;
  }
}

export function _resetForTesting(): void {
  cached = null;
  inFlight = null;
}
