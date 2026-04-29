import type { PageStamp } from '@/types/page-stamp.js';

/**
 * Issue #117 (N13) — DOM embed + persistence for the page stamp.
 *
 * Three nodes are embedded so the LLM ingestion path always sees at
 * least one form of the stamp:
 *  - visible badge (text content survives most LLM ingestion)
 *  - <meta name="honeyllm-stamp"> in head
 *  - invisible aria-hidden div (doesn't affect layout/a11y, available
 *    to assistive tech that reads structured content)
 *
 * MutationObserver guarding uses element-reference tracking, NOT a
 * count guard. A page that copies the `data-honeyllm-stamp` attribute
 * onto its own elements would defeat a count check; per-element-ref
 * tracking via `isConnected` correctly detects when our specific
 * nodes have been removed.
 *
 * Two observers are scoped tightly (head and body, no subtree) so a
 * SPA's heavy DOM churn doesn't fire thousands of callbacks per
 * second. Both badge and invisible div are direct children of body;
 * meta is a direct child of head.
 *
 * SPA navigation: MV3 content scripts survive history.pushState. The
 * navigation teardown listener removes the stamp nodes and
 * disconnects the observers on `popstate`/`hashchange` so an old-URL
 * stamp is never re-injected into a new page after a same-document
 * nav.
 */

const STAMP_DATA_ATTR = 'data-honeyllm-stamp';
const META_NAME = 'honeyllm-stamp';

export interface StampNodes {
  readonly badge: HTMLDivElement;
  readonly meta: HTMLMetaElement;
  readonly invisible: HTMLDivElement;
}

export interface StampObservers {
  readonly head: MutationObserver;
  readonly body: MutationObserver;
  disconnect(): void;
}

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function encodeStamp(stamp: PageStamp): string {
  const json = JSON.stringify(stamp);
  return bytesToBase64url(new TextEncoder().encode(json));
}

function removeExistingStamps(): void {
  const existing = document.querySelectorAll(`[${STAMP_DATA_ATTR}]`);
  existing.forEach((el) => el.remove());
}

function buildBadge(stamp: PageStamp): HTMLDivElement {
  const badge = document.createElement('div');
  badge.setAttribute(STAMP_DATA_ATTR, '1');
  badge.className = 'honeyllm-stamp-badge';
  badge.style.position = 'fixed';
  badge.style.top = '8px';
  badge.style.right = '8px';
  badge.style.zIndex = '2147483647';
  badge.style.padding = '4px 8px';
  badge.style.background = 'rgba(20,28,40,0.9)';
  badge.style.color = '#fff';
  badge.style.font = '11px/1.4 system-ui, -apple-system, sans-serif';
  badge.style.borderRadius = '4px';
  badge.style.pointerEvents = 'none';
  badge.textContent = `🛡️ HoneyLLM scanned · ${stamp.hmac.slice(0, 8)}`;
  return badge;
}

function buildMeta(stamp: PageStamp): HTMLMetaElement {
  const meta = document.createElement('meta');
  meta.setAttribute('name', META_NAME);
  meta.setAttribute(STAMP_DATA_ATTR, '1');
  meta.setAttribute('content', encodeStamp(stamp));
  return meta;
}

function buildInvisible(stamp: PageStamp): HTMLDivElement {
  const div = document.createElement('div');
  div.setAttribute(STAMP_DATA_ATTR, '1');
  div.setAttribute('aria-hidden', 'true');
  div.style.display = 'none';
  div.textContent = encodeStamp(stamp);
  return div;
}

export function embedStamp(stamp: PageStamp): StampNodes {
  removeExistingStamps();
  const badge = buildBadge(stamp);
  const meta = buildMeta(stamp);
  const invisible = buildInvisible(stamp);
  document.head.appendChild(meta);
  document.body.appendChild(badge);
  document.body.appendChild(invisible);
  return { badge, meta, invisible };
}

export function installStampObservers(initial: StampNodes, stamp: PageStamp): StampObservers {
  let current: StampNodes = initial;

  const reembedIfMissing = (): void => {
    if (
      !current.badge.isConnected ||
      !current.meta.isConnected ||
      !current.invisible.isConnected
    ) {
      current = embedStamp(stamp);
    }
  };

  const head = new MutationObserver(reembedIfMissing);
  head.observe(document.head, { childList: true });

  const body = new MutationObserver(reembedIfMissing);
  body.observe(document.body, { childList: true });

  return {
    head,
    body,
    disconnect(): void {
      head.disconnect();
      body.disconnect();
    },
  };
}

export function installNavigationTeardown(
  observers: StampObservers,
  _nodes: StampNodes,
): void {
  const teardown = (): void => {
    observers.disconnect();
    const remaining = document.querySelectorAll(`[${STAMP_DATA_ATTR}]`);
    remaining.forEach((el) => el.remove());
    window.removeEventListener('popstate', teardown);
    window.removeEventListener('hashchange', teardown);
  };
  window.addEventListener('popstate', teardown);
  window.addEventListener('hashchange', teardown);
}
