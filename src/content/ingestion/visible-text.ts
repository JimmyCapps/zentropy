import { MAX_VISIBLE_TEXT_CHARS } from '@/shared/constants.js';

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'TEMPLATE']);

export function extractVisibleText(): string {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (parent === null) return NodeFilter.FILTER_REJECT;
      if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;

      const style = getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return NodeFilter.FILTER_REJECT;
      }

      const text = node.textContent?.trim();
      if (!text || text.length === 0) return NodeFilter.FILTER_REJECT;

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const parts: string[] = [];
  let totalLength = 0;

  while (walker.nextNode()) {
    const text = walker.currentNode.textContent?.trim() ?? '';
    if (totalLength + text.length > MAX_VISIBLE_TEXT_CHARS) {
      parts.push(text.slice(0, MAX_VISIBLE_TEXT_CHARS - totalLength));
      break;
    }
    parts.push(text);
    totalLength += text.length;
  }

  return parts.join(' ');
}
