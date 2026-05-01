import type { ImageRef } from '@/types/snapshot.js';

const MIN_DIMENSION_PX = 50;
const MAX_IMAGES_PER_PAGE = 5;
const SIZE_BUCKET_MEDIUM_PX = 200;
const SIZE_BUCKET_LARGE_PX = 500;
const INVISIBLE_SCORE_FACTOR = 0.2;

// Tracking-beacon hostnames + path patterns. Hostname match is suffix-based
// so subdomains (`stats.g.doubleclick.net`) match. Path patterns catch the
// generic `/tr`, `/pixel`, `/beacon`, `/p.gif`-style endpoints that show up
// on long-tail tracking servers we don't enumerate by hostname.
const TRACKING_HOSTNAMES: readonly string[] = [
  'google-analytics.com',
  'googletagmanager.com',
  'doubleclick.net',
  'facebook.com',
  'scorecardresearch.com',
  'quantserve.com',
  'adsystem.amazon.com',
  'adservice.google.com',
];

const TRACKING_PATH_RE = /\/(?:tr|pixel|beacon|track|collect)(?:[/?]|\.gif$|\.png$|$)/i;

interface RectLike {
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface ExtractImagesOptions {
  readonly doc?: Document;
  readonly getRect?: (el: Element) => RectLike;
  readonly viewportWidth?: number;
  readonly viewportHeight?: number;
}

export function extractImages(opts: ExtractImagesOptions = {}): readonly ImageRef[] {
  const doc = opts.doc ?? (typeof document !== 'undefined' ? document : null);
  if (doc === null) return [];

  const getRect = opts.getRect ?? ((el: Element) => el.getBoundingClientRect());
  const viewportW =
    opts.viewportWidth ?? (typeof window !== 'undefined' ? window.innerWidth : 1024);
  const viewportH =
    opts.viewportHeight ?? (typeof window !== 'undefined' ? window.innerHeight : 768);

  const ranked: { ref: ImageRef; score: number }[] = [];

  for (const el of Array.from(doc.querySelectorAll('img'))) {
    const img = el as HTMLImageElement;
    if (hasHiddenAncestor(img)) continue;

    const rect = getRect(img);
    const width = Math.round(rect.width || img.width || img.naturalWidth || 0);
    const height = Math.round(rect.height || img.height || img.naturalHeight || 0);
    if (width < MIN_DIMENSION_PX || height < MIN_DIMENSION_PX) continue;

    const src = img.src;
    if (src.length === 0) continue;
    if (isTrackingBeacon(src)) continue;

    const visibleInViewport = intersectsViewport(rect, viewportW, viewportH);
    const sizeClass = bucketSize(Math.max(width, height));
    const altText = img.getAttribute('alt')?.trim() ?? '';

    const score = width * height * (visibleInViewport ? 1 : INVISIBLE_SCORE_FACTOR);
    ranked.push({
      ref: { src, altText, width, height, visibleInViewport, sizeClass },
      score,
    });
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, MAX_IMAGES_PER_PAGE).map((r) => r.ref);
}

function bucketSize(maxDim: number): ImageRef['sizeClass'] {
  if (maxDim < SIZE_BUCKET_MEDIUM_PX) return 'small';
  if (maxDim < SIZE_BUCKET_LARGE_PX) return 'medium';
  return 'large';
}

function intersectsViewport(rect: RectLike, viewportW: number, viewportH: number): boolean {
  if (rect.width === 0 || rect.height === 0) return false;
  return rect.bottom > 0 && rect.top < viewportH && rect.right > 0 && rect.left < viewportW;
}

function isTrackingBeacon(src: string): boolean {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  for (const tracker of TRACKING_HOSTNAMES) {
    if (host === tracker || host.endsWith(`.${tracker}`)) return true;
  }
  if (TRACKING_PATH_RE.test(url.pathname)) return true;
  return false;
}

function hasHiddenAncestor(el: Element): boolean {
  let cur: Element | null = el;
  while (cur !== null) {
    const style = cur.getAttribute('style') ?? '';
    if (/display\s*:\s*none/i.test(style)) return true;
    if (/visibility\s*:\s*hidden/i.test(style)) return true;
    if (cur.hasAttribute('hidden')) return true;
    cur = cur.parentElement;
  }
  return false;
}
