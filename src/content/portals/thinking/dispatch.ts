import type { CapturedThinking } from '@/types/portal-response.js';
import type { ThinkingCapturedMessage } from '@/types/messages.js';

// Issue #131 (N7c) — content-script side of the THINKING_CAPTURED RPC.
// Mirrors dispatch.ts (#126) verbatim with retry-once on transient
// runtime errors (typical: SW just woke up, the listener isn't yet
// registered when chrome.runtime.sendMessage lands).

const TRANSIENT_ERROR_FRAGMENTS = [
  'Could not establish connection',
  'Receiving end does not exist',
  'message channel closed',
];

function isTransient(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return TRANSIENT_ERROR_FRAGMENTS.some((f) => m.includes(f));
}

async function trySend(msg: ThinkingCapturedMessage): Promise<void> {
  await chrome.runtime.sendMessage(msg);
}

export async function sendThinkingCaptured(
  capture: CapturedThinking,
  metadata: { readonly url: string; readonly origin: string },
): Promise<void> {
  const msg: ThinkingCapturedMessage = {
    type: 'THINKING_CAPTURED',
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
        // Retry also failed — drop. The popup will show "no thinking
        // analysed" until the next capture lands.
      }
      return;
    }
    // Non-transient errors are also dropped — the content script must
    // never throw into the page's task queue.
  }
}
