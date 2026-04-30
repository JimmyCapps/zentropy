import type {
  CapturedThinking,
  PortalId,
} from '@/types/portal-response.js';
import type { ThinkingAdapter } from './types.js';
import { createStreamEndDebouncer } from '../../debounce.js';
import { STREAM_END_DEBOUNCE_MS, MAX_DEBOUNCE_LATENCY_MS } from '../../constants.js';
import { extractMarkdownText, firstAttribute, narrowToHTMLElement } from '../../dom-utils.js';

// Issue #131 (N7c) — ChatGPT thinking adapter.
//
// ChatGPT's o1/o3 reasoning summary is rendered inside the same assistant
// turn (`[data-message-author-role="assistant"]`) but in a sibling node
// to the `.markdown` answer subtree. Selectors are LOW-CONFIDENCE: this
// is the most uncertain portal of the three for thinking selectors,
// because the reasoning panel design has shifted multiple times and we
// have not pinned a stable DOM signature in this session.
//
// Selector ladder, broadest-to-most-specific so a redesign that adds new
// data-testid values still gets caught by the looser later candidates:
//   1. [data-message-author-role="reasoning"]   (hypothetical, mirrors response)
//   2. [data-testid*="reasoning" i]
//   3. [data-testid*="thinking" i]
//   4. details[data-testid]                     (collapsible chrome)
//   5. .reasoning-summary
//
// Stream-end heuristic: same copy/regenerate buttons used by the response
// adapter. They appear once the entire turn finishes, after thinking has
// already settled. Fall back to debounce.

const PORTAL_ID: PortalId = 'chatgpt';

const ASSISTANT_SELECTOR = '[data-message-author-role="assistant"]';
const THINKING_SELECTORS: readonly string[] = [
  '[data-message-author-role="reasoning"]',
  '[data-testid*="reasoning" i]',
  '[data-testid*="thinking" i]',
  'details[data-testid]',
  '.reasoning-summary',
];
const COMPLETION_MARKER_SELECTORS = [
  '[data-testid="copy-turn-action-button"]',
  '[data-testid="regenerate-response-button"]',
  'button[aria-label="Copy"]',
];

function matchesHost(host: string): boolean {
  return host === 'chatgpt.com' || host === 'chat.openai.com';
}

function findThinkingBlocks(root: ParentNode): readonly HTMLElement[] {
  const found = new Set<HTMLElement>();
  for (const sel of THINKING_SELECTORS) {
    const list = root.querySelectorAll<HTMLElement>(sel);
    for (const el of Array.from(list)) {
      // Limit to candidates that sit inside an assistant turn.
      if (el.closest(ASSISTANT_SELECTOR) !== null) found.add(el);
    }
  }
  return Array.from(found);
}

function getThinkingText(el: HTMLElement): string {
  return extractMarkdownText(el);
}

function getMessageId(el: HTMLElement): string {
  const turn = el.closest(ASSISTANT_SELECTOR) as HTMLElement | null;
  if (turn !== null) {
    const id = firstAttribute(turn, ['data-message-id']);
    if (id !== null) return `chatgpt-thinking:${id}`;
  }
  const prefix = (el.textContent ?? '').slice(0, 32).replace(/\s+/g, '_');
  return `chatgpt-thinking:fallback:${prefix}`;
}

function isThinkingComplete(el: HTMLElement): boolean {
  const turn = el.closest(ASSISTANT_SELECTOR);
  if (turn === null) return false;
  for (const sel of COMPLETION_MARKER_SELECTORS) {
    if (turn.querySelector(sel) !== null) return true;
  }
  return false;
}

function conversationIdFromLocation(): string | null {
  try {
    const m = window.location.pathname.match(/\/c\/([^/?#]+)/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

function buildCapture(el: HTMLElement, key: string): CapturedThinking {
  const messageId = key.split('|', 1)[0] ?? getMessageId(el);
  return {
    portalId: PORTAL_ID,
    text: getThinkingText(el),
    capturedAt: Date.now(),
    conversationId: conversationIdFromLocation(),
    messageId,
    streamComplete: isThinkingComplete(el),
  };
}

function attachThinkingObserver(
  root: ParentNode,
  callback: (cap: CapturedThinking) => void,
): () => void {
  const trackedByKey = new Map<string, HTMLElement>();
  const firedKeys = new Set<string>();

  const debouncer = createStreamEndDebouncer({
    debounceMs: STREAM_END_DEBOUNCE_MS,
    maxLatencyMs: MAX_DEBOUNCE_LATENCY_MS,
    onFire: (key) => {
      const el = trackedByKey.get(key);
      trackedByKey.delete(key);
      firedKeys.add(key);
      if (el === undefined || !el.isConnected) return;
      const cap = buildCapture(el, key);
      if (cap.text.trim().length === 0) return;
      callback(cap);
    },
  });

  function bumpForElement(el: HTMLElement): void {
    const messageId = getMessageId(el);
    const text = getThinkingText(el);
    const key = `${messageId}|${text.slice(0, 32)}`;
    if (firedKeys.has(key)) return;
    trackedByKey.set(key, el);
    debouncer.bump(key);
    if (isThinkingComplete(el)) debouncer.markComplete(key);
  }

  for (const el of findThinkingBlocks(root)) bumpForElement(el);

  const targetNode = (root as { documentElement?: Node }).documentElement ?? (root as unknown as Node);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target;
      const targetEl = narrowToHTMLElement(target as Node);
      if (targetEl !== null) {
        for (const sel of THINKING_SELECTORS) {
          const closest = (targetEl.closest?.(sel) ?? null) as HTMLElement | null;
          if (closest !== null && closest.closest(ASSISTANT_SELECTOR) !== null) {
            bumpForElement(closest);
            break;
          }
        }
      }
      for (const added of Array.from(record.addedNodes)) {
        const addedEl = narrowToHTMLElement(added);
        if (addedEl === null) continue;
        for (const sel of THINKING_SELECTORS) {
          if (addedEl.matches?.(sel) && addedEl.closest(ASSISTANT_SELECTOR) !== null) {
            bumpForElement(addedEl);
          }
          const sub = addedEl.querySelectorAll?.(sel) ?? [];
          for (const s of Array.from(sub)) {
            const candidate = s as HTMLElement;
            if (candidate.closest(ASSISTANT_SELECTOR) !== null) bumpForElement(candidate);
          }
        }
      }
    }
  });
  observer.observe(targetNode, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['data-message-id'],
  });

  return () => {
    observer.disconnect();
    debouncer.dispose();
    trackedByKey.clear();
  };
}

export const chatgptThinkingAdapter: ThinkingAdapter = {
  portalId: PORTAL_ID,
  matchesHost,
  findThinkingBlocks,
  attachThinkingObserver,
};
