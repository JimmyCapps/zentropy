import { narrowToHTMLElement } from '@/content/portals/dom-utils.js';

export function querySelectorLadder(
  root: ParentNode,
  selectors: readonly string[],
): HTMLElement | null {
  for (const selector of selectors) {
    try {
      const node = root.querySelector(selector);
      if (node === null) continue;
      const el = narrowToHTMLElement(node);
      if (el !== null) return el;
    } catch {
      // Some test browsers don't support :has(); skip and try the next.
    }
  }
  return null;
}

export function readContentEditableText(input: HTMLElement): string {
  // For contenteditable divs, prefer textContent (preserves all visible text)
  // over innerText (which is layout-aware and absent in jsdom). Trim trailing
  // newlines and whitespace.
  return (input.textContent ?? '').trim();
}

export function readInputText(input: HTMLElement): string {
  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    return input.value.trim();
  }
  return readContentEditableText(input);
}
