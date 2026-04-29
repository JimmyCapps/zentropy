// Issue #126 (N7a) — small DOM utilities shared by every portal adapter.
// TypeScript-strict friendly: every input narrowed from `unknown` /
// `Node` rather than cast.

/**
 * Narrow a Node to HTMLElement when the runtime tag matches.
 * Safer than `node as HTMLElement` casts on MutationRecord.addedNodes,
 * which can carry text nodes, comments, or document fragments.
 */
export function narrowToHTMLElement(node: Node): HTMLElement | null {
  return node.nodeType === 1 ? (node as HTMLElement) : null;
}

/**
 * Extract user-visible text from a portal response container while
 * skipping toolbar/timestamp/action-button content. We rely on the
 * adapter to pass the markdown subtree (e.g. `.markdown` for ChatGPT,
 * `<message-content>` for Gemini), so this helper just normalises.
 *
 * - Collapses interior whitespace runs to single spaces.
 * - Trims leading/trailing whitespace.
 * - Preserves paragraph breaks as `\n\n` so probe behaviour matches the
 *   paste-style input it sees on page-content scans.
 */
export function extractMarkdownText(el: ParentNode): string {
  // Walk children, joining block-level boundaries with newlines.
  const blockLikeTags = new Set([
    'P',
    'DIV',
    'LI',
    'BLOCKQUOTE',
    'PRE',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
  ]);
  const parts: string[] = [];
  function walk(node: Node): void {
    if (node.nodeType === 3) {
      parts.push(node.textContent ?? '');
      return;
    }
    if (node.nodeType !== 1) return;
    const elNode = node as HTMLElement;
    const isBlock = blockLikeTags.has(elNode.tagName);
    if (isBlock && parts.length > 0) parts.push('\n\n');
    for (const child of Array.from(elNode.childNodes)) walk(child);
  }
  walk(el as Node);
  return parts.join('').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Read the first non-null value across a series of attribute names.
 * Returns null when none of the candidates are present. Used by
 * adapters whose primary data attribute may be absent (selector
 * fallback).
 */
export function firstAttribute(el: HTMLElement, names: readonly string[]): string | null {
  for (const name of names) {
    const v = el.getAttribute(name);
    if (v !== null && v.length > 0) return v;
  }
  return null;
}
