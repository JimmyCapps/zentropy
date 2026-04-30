import type { ZoneText } from '@/types/registry.js';

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'TEMPLATE']);

export function extractZones(
  html: string,
  frameSelectors: readonly string[],
  excludedSelectors: readonly string[],
): readonly ZoneText[] {
  if (html.length === 0 || frameSelectors.length === 0) return [];

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return [];
  }
  const body = doc.body;
  if (body === null || body === undefined) return [];

  const seen = new Set<Element>();
  const zones: ZoneText[] = [];

  for (const selector of frameSelectors) {
    const matches = safeQueryAll(body, selector);
    let ordinal = 0;
    for (const el of matches) {
      if (seen.has(el)) continue;
      if (matchesAny(el, excludedSelectors)) continue;
      seen.add(el);

      const clone = pruneExcluded(el, excludedSelectors);
      zones.push({
        zoneId: `${selector}#${ordinal}`,
        htmlSnippet: clone.outerHTML,
        normalisedText: extractNormalisedText(clone),
        structureSkeleton: buildStructureSkeleton(clone),
      });
      ordinal += 1;
    }
  }

  return zones;
}

function safeQueryAll(root: Element, selector: string): readonly Element[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

function matchesAny(el: Element, selectors: readonly string[]): boolean {
  for (const selector of selectors) {
    try {
      if (el.matches(selector)) return true;
    } catch {
      continue;
    }
  }
  return false;
}

function pruneExcluded(el: Element, excludedSelectors: readonly string[]): Element {
  const clone = el.cloneNode(true) as Element;
  if (excludedSelectors.length === 0) return clone;
  const joined = excludedSelectors.join(',');
  let removed: readonly Element[] = [];
  try {
    removed = Array.from(clone.querySelectorAll(joined));
  } catch {
    removed = excludedSelectors.flatMap((s) => safeQueryAll(clone, s));
  }
  for (const node of removed) {
    node.parentNode?.removeChild(node);
  }
  return clone;
}

function extractNormalisedText(el: Element): string {
  const doc = el.ownerDocument;
  if (doc === null) return '';
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (parent === null) return NodeFilter.FILTER_REJECT;
      if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      const text = node.textContent;
      if (text === null || text.trim().length === 0) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const parts: string[] = [];
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent ?? '';
    parts.push(text.replace(/\s+/g, ' ').trim());
  }
  return parts.filter((p) => p.length > 0).join(' ');
}

function buildStructureSkeleton(el: Element): string {
  const parts: string[] = [];
  walkSkeleton(el, parts);
  return parts.join('');
}

function walkSkeleton(el: Element, parts: string[]): void {
  if (SKIP_TAGS.has(el.tagName)) return;
  parts.push('<', el.tagName.toLowerCase(), '>');
  for (const child of Array.from(el.children)) {
    walkSkeleton(child, parts);
  }
  parts.push('</', el.tagName.toLowerCase(), '>');
}
