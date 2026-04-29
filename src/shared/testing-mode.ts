import { STORAGE_KEY_TESTING_MODE } from './constants.js';

/**
 * Issue #113 (N2) — observe-only mode read.
 *
 * Returns `true` only when `chrome.storage.local[STORAGE_KEY_TESTING_MODE]`
 * is strictly the boolean `true`. Any other value (absent key, string,
 * number, null, false) resolves to `false`. The strict-equality check
 * defends against accidental persistence of stringified or coerced
 * values from older popups, since the gate must default to OFF.
 *
 * Not cached: the popup writes the flag at runtime via `setTestingMode`,
 * so an in-memory cache would go stale. The read is a single
 * chrome.storage round-trip on the verdict-dispatch path — negligible.
 */
export async function isTestingModeEnabled(): Promise<boolean> {
  const result = await chrome.storage.local.get(STORAGE_KEY_TESTING_MODE);
  return result[STORAGE_KEY_TESTING_MODE] === true;
}

/**
 * Issue #113 (N2) — observe-only mode write. Persists the boolean
 * verbatim into `chrome.storage.local`. Failures (quota, etc.) bubble
 * up so the popup can show a toast and refrain from claiming the
 * toggle was saved.
 */
export async function setTestingMode(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY_TESTING_MODE]: enabled });
}
