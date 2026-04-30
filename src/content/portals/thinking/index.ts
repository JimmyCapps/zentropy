import type { CapturedThinking } from '@/types/portal-response.js';
import type { ThinkingAdapter } from './adapters/types.js';
import { chatgptThinkingAdapter } from './adapters/chatgpt.js';
import { claudeThinkingAdapter } from './adapters/claude.js';
import { geminiThinkingAdapter } from './adapters/gemini.js';
import { sendThinkingCaptured } from './dispatch.js';

// Issue #131 (N7c) — thinking-observer bootstrap helper. Mirrors the
// intercept module's selectInterceptAdapter / attachInterceptObserver
// pair so portals/index.ts can attach a third observer alongside the
// response and intercept observers without growing the import surface
// or knowing about per-portal selectors.

const THINKING_ADAPTERS: readonly ThinkingAdapter[] = [
  chatgptThinkingAdapter,
  claudeThinkingAdapter,
  geminiThinkingAdapter,
];

export function selectThinkingAdapter(hostname: string): ThinkingAdapter | null {
  for (const a of THINKING_ADAPTERS) {
    if (a.matchesHost(hostname)) return a;
  }
  return null;
}

export interface AttachThinkingObserverOpts {
  readonly adapter: ThinkingAdapter;
  readonly metadata?: () => { readonly url: string; readonly origin: string };
}

function defaultMetadata(): { readonly url: string; readonly origin: string } {
  return { url: window.location.href, origin: window.location.origin };
}

/**
 * Attach the thinking observer for a portal. Returns a disposer that
 * detaches the underlying MutationObserver and clears the debouncer.
 * Dispatch errors are swallowed inside sendThinkingCaptured; this
 * wrapper only ensures the content-script callback path is safe.
 */
export function attachThinkingObserver(opts: AttachThinkingObserverOpts): () => void {
  const buildMetadata = opts.metadata ?? defaultMetadata;
  return opts.adapter.attachThinkingObserver(document, (cap: CapturedThinking) => {
    sendThinkingCaptured(cap, buildMetadata()).catch(() => {
      // dispatch.ts already swallows errors; belt-and-suspenders catch.
    });
  });
}
