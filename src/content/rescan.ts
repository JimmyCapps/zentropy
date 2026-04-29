import type { PageSnapshot } from '@/types/snapshot.js';
import type { PageSnapshotMessage } from '@/types/messages.js';
import { extractPageSnapshot } from './ingestion/extractor.js';

/**
 * Issue #113 (N2) — TRIGGER_RESCAN handler. Called by the content
 * script's onMessage listener when the SW asks the page to re-extract
 * itself with mitigations forced on.
 *
 * Re-extracts the snapshot afresh (page state may have changed since
 * load) and re-sends PAGE_SNAPSHOT carrying the forceMitigation flag
 * so the SW dispatcher bypasses the testing-mode gate for this single
 * verdict. The persisted toggle is not mutated — observe-only mode
 * resumes for subsequent navigations.
 *
 * `tabId: 0` is a placeholder; the SW overwrites it with
 * `sender.tab.id` from the message frame on receipt. Returns the
 * extracted snapshot for callers / tests; logging is the caller's
 * responsibility.
 */
export async function rescanWithForcedMitigation(
  forceMitigation: boolean,
  extractor: () => Promise<PageSnapshot> = extractPageSnapshot,
): Promise<PageSnapshot> {
  const snapshot = await extractor();
  const msg: PageSnapshotMessage = {
    type: 'PAGE_SNAPSHOT',
    tabId: 0,
    snapshot,
    forceMitigation,
  };
  await chrome.runtime.sendMessage(msg);
  return snapshot;
}
