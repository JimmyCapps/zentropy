import type { CapturedThinking, PortalId } from '@/types/portal-response.js';

// Issue #131 (N7c) — thinking-block (reasoning) adapter contract. Lives
// in a sibling subtree to intercept/ and the response adapters under
// adapters/. ThinkingAdapter is intentionally independent of
// PortalAdapter (response): the thinking observer watches a different
// DOM subtree, has its own debouncer key namespace, and feeds a
// separate SW analyzer + storage slot, so coupling them via an extended
// interface would conflate two unrelated concerns.

export interface ThinkingAdapter {
  readonly portalId: PortalId;
  matchesHost(hostname: string): boolean;
  /**
   * Locate every thinking/reasoning block currently rendered into the
   * given root. May return [] when the user is not in thinking mode on
   * this portal — that is the steady-state for most conversations on
   * most portals and must not be treated as a regression signal.
   */
  findThinkingBlocks(root: ParentNode): readonly HTMLElement[];
  /**
   * Begin observing the portal DOM for completed thinking blocks. The
   * adapter uses createStreamEndDebouncer (debounce.ts) plus its own
   * portal-specific stream-end heuristic to decide when to fire the
   * callback. Returns a disposer that detaches the observer.
   */
  attachThinkingObserver(
    root: ParentNode,
    callback: (cap: CapturedThinking) => void,
  ): () => void;
}
