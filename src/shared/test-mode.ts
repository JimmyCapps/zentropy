import { STORAGE_KEY_TEST_MODE } from './constants.js';

/**
 * Phase 3 Track A test-mode gate.
 *
 * Returns `true` only when `chrome.storage.sync[STORAGE_KEY_TEST_MODE]` is
 * strictly the boolean `true`. Any other value (undefined, null, string 'true',
 * number 1, etc.) resolves to `false`. Chrome storage returning an error
 * resolves to `false`.
 *
 * Used by:
 *   - `src/offscreen/index.ts` (RUN_PROBE_DIRECT handler, Path 1)
 *   - `src/tests/phase3/builtin-harness.ts` (RUN_PROBE_BUILTIN handler, Path 2)
 */
export async function isTestModeEnabled(): Promise<boolean> {
  try {
    const result = await chrome.storage.sync.get(STORAGE_KEY_TEST_MODE);
    return result[STORAGE_KEY_TEST_MODE] === true;
  } catch {
    return false;
  }
}
