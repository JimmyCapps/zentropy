import type { PageMetadata, PageSnapshot, ScriptFingerprint } from '@/types/snapshot.js';
import {
  MAX_HIDDEN_TEXT_CHARS,
  MAX_VISIBLE_TEXT_CHARS,
  SCRIPT_PREVIEW_LENGTH,
} from '@/shared/constants.js';

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'TEMPLATE']);

const HIDDEN_SELECTORS = [
  '[hidden]',
  '[aria-hidden="true"]',
  '[style*="display:none"]',
  '[style*="display: none"]',
  '[style*="visibility:hidden"]',
  '[style*="visibility: hidden"]',
  '[style*="opacity:0"]',
  '[style*="opacity: 0"]',
  '.sr-only',
  '.visually-hidden',
  '.hidden',
].join(',');

export function parseHtmlToSnapshot(html: string, url: string): PageSnapshot {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const visibleText = extractVisibleTextFromDoc(doc);
  const hiddenText = extractHiddenTextFromDoc(doc);
  const scriptFingerprints = extractScriptFingerprintsSync(doc);
  const metadata = extractMetadataFromDoc(doc, url);
  return {
    visibleText,
    hiddenText,
    scriptFingerprints,
    metadata,
    extractedAt: Date.now(),
    charCount: visibleText.length + hiddenText.length,
  };
}

function isHiddenByAttributes(el: Element): boolean {
  if (el.hasAttribute('hidden')) return true;
  if (el.getAttribute('aria-hidden') === 'true') return true;
  const style = el.getAttribute('style') ?? '';
  if (/display\s*:\s*none/i.test(style)) return true;
  if (/visibility\s*:\s*hidden/i.test(style)) return true;
  if (/opacity\s*:\s*0(?!\.)/i.test(style)) return true;
  return false;
}

function hasHiddenAncestor(node: Node): boolean {
  let current: Node | null = node.parentElement;
  while (current !== null && current.nodeType === 1) {
    const el = current as Element;
    if (isHiddenByAttributes(el)) return true;
    current = el.parentElement;
  }
  return false;
}

function extractVisibleTextFromDoc(doc: Document): string {
  const body = doc.body;
  if (body === null || body === undefined) return '';

  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (parent === null) return NodeFilter.FILTER_REJECT;
      if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (hasHiddenAncestor(node)) return NodeFilter.FILTER_REJECT;
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

function extractHiddenTextFromDoc(doc: Document): string {
  const body = doc.body;
  if (body === null || body === undefined) return '';
  const elements = body.querySelectorAll(HIDDEN_SELECTORS);
  const parts: string[] = [];
  let totalLength = 0;
  for (const el of elements) {
    const text = el.textContent?.trim() ?? '';
    if (text.length === 0) continue;
    if (totalLength + text.length > MAX_HIDDEN_TEXT_CHARS) {
      parts.push(text.slice(0, MAX_HIDDEN_TEXT_CHARS - totalLength));
      break;
    }
    parts.push(text);
    totalLength += text.length;
  }
  return parts.join('\n');
}

function extractScriptFingerprintsSync(doc: Document): readonly ScriptFingerprint[] {
  const scripts = doc.querySelectorAll('script');
  const fingerprints: ScriptFingerprint[] = [];
  for (const script of scripts) {
    const src = script.getAttribute('src');
    const content = script.textContent ?? '';
    if (content.length === 0 && (src === null || src === '')) continue;
    fingerprints.push({
      src: src && src.length > 0 ? src : null,
      preview: content.slice(0, SCRIPT_PREVIEW_LENGTH),
      hash: content.length > 0 ? hashSync(content) : '',
      length: content.length,
    });
  }
  return fingerprints;
}

// Synchronous SHA-256 via a 32-bit word implementation. The DOMParser path
// runs in offscreen which has crypto.subtle, but parseHtmlToSnapshot is
// callable from the SW too if we ever inline it for tests. Sync hashing
// keeps the API simple. Hash output matches `crypto.subtle.digest('SHA-256',…)`
// hex-encoded byte-for-byte for the same input string (UTF-8).
function hashSync(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return sha256(bytes);
}

function sha256(input: Uint8Array): string {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const bitLen = input.length * 8;
  const padLen = (input.length + 9 + 63) & ~63;
  const padded = new Uint8Array(padLen);
  padded.set(input);
  padded[input.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000));
  dv.setUint32(padLen - 4, bitLen >>> 0);

  const w = new Uint32Array(64);
  for (let i = 0; i < padLen; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }
  let out = '';
  for (let i = 0; i < 8; i++) out += H[i].toString(16).padStart(8, '0');
  return out;
}

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function extractMetadataFromDoc(doc: Document, url: string): PageMetadata {
  const ogTags = new Map<string, string>();
  doc.querySelectorAll('meta[property^="og:"]').forEach((meta) => {
    const property = meta.getAttribute('property') ?? '';
    const content = meta.getAttribute('content') ?? '';
    if (property.length > 0 && content.length > 0) ogTags.set(property, content);
  });
  const cspMeta =
    doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ??
    null;
  const description =
    doc.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
  let origin = url;
  try {
    origin = new URL(url).origin;
  } catch {
    /* fall through to raw url */
  }
  return {
    title: doc.title,
    url,
    origin,
    description,
    ogTags,
    cspMeta,
    lang: doc.documentElement?.lang || 'unknown',
  };
}
