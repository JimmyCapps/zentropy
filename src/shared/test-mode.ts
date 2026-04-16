import { STORAGE_KEY_TEST_MODE } from './constants.js';

/**
 * Phase 3 Track A test-mode gate.
 *
 * Preference order:
 *   1. URL query string `?testMode=true` on the hosting page (offscreen doc
 *      or builtin-harness tab). The Stage 5 runner sets this when it opens
 *      those contexts. This is a synchronous read that bypasses
 *      `chrome.storage` entirely, avoiding cross-context consistency lag
 *      observed in Stage 5 (SW wrote `honeyllm:test-mode=true`, the
 *      offscreen read empty within the same tick and the gate resolved
 *      false anyway).
 *   2. `chrome.storage.local[STORAGE_KEY_TEST_MODE] === true` — future
 *      production path if a UI ever toggles this; today unused outside
 *      tests.
 *   3. `false`.
 *
 * Used by:
 *   - `src/offscreen/index.ts` (RUN_PROBE_DIRECT handler, Path 1)
 *   - `src/tests/phase3/builtin-harness.ts` (RUN_PROBE_BUILTIN handler, Path 2)
 */
export async function isTestModeEnabled(): Promise<boolean> {
  try {
    const params = new URLSearchParams(globalThis.location?.search ?? '');
    if (params.get('testMode') === 'true') return true;
  } catch {
    // location unavailable (non-browser context); fall through.
  }
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY_TEST_MODE);
    return result[STORAGE_KEY_TEST_MODE] === true;
  } catch {
    return false;
  }
}
