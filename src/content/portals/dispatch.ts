import type { CapturedResponse } from '@/types/portal-response.js';
import type { ResponseCapturedMessage } from '@/types/messages.js';

// Issue #126 (N7a) — content-script side of the RESPONSE_CAPTURED RPC.
// Fire-and-forget with a single retry on transient runtime errors
// (typical: SW just woke up, the listener isn't yet registered when
// `chrome.runtime.sendMessage` lands).

const TRANSIENT_ERROR_FRAGMENTS = [
  'Could not establish connection',
  'Receiving end does not exist',
  'message channel closed',
];

function isTransient(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return TRANSIENT_ERROR_FRAGMENTS.some((f) => m.includes(f));
}

async function trySend(msg: ResponseCapturedMessage): Promise<void> {
  await chrome.runtime.sendMessage(msg);
}

export async function sendResponseCaptured(
  capture: CapturedResponse,
  metadata: { readonly url: string; readonly origin: string },
): Promise<void> {
  const msg: ResponseCapturedMessage = {
    type: 'RESPONSE_CAPTURED',
    // tabId resolves to sender.tab?.id in the SW; the content-script side
    // sends 0 as a placeholder per the PageSnapshotMessage convention.
    tabId: 0,
    capture,
    metadata,
  };
  try {
    await trySend(msg);
  } catch (err) {
    if (isTransient(err)) {
      try {
        await trySend(msg);
      } catch {
        // Retry also failed — drop. The popup will show "no response yet"
        // until the next capture lands.
      }
      return;
    }
    // Non-transient errors are also dropped (logged at warn) — the
    // content script must never throw into the page's task queue.
  }
}
