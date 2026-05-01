// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { extractImages } from './images.js';

interface ImgSpec {
  readonly src: string;
  readonly width?: number;
  readonly height?: number;
  readonly alt?: string;
}

function appendImg(parent: Element, spec: ImgSpec): HTMLImageElement {
  const img = parent.ownerDocument.createElement('img');
  img.setAttribute('src', spec.src);
  if (spec.width !== undefined) img.setAttribute('width', String(spec.width));
  if (spec.height !== undefined) img.setAttribute('height', String(spec.height));
  if (spec.alt !== undefined) img.setAttribute('alt', spec.alt);
  parent.appendChild(img);
  return img;
}

interface RectOverrides {
  readonly [src: string]: { width: number; height: number; left?: number; top?: number };
}

function makeRectGetter(overrides: RectOverrides) {
  function makeRect(width: number, height: number, left: number, top: number): DOMRect {
    return {
      width,
      height,
      left,
      top,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON() {
        return {};
      },
    };
  }

  return (el: Element): DOMRect => {
    const src = (el as HTMLImageElement).src;
    const o = overrides[src];
    if (o === undefined) {
      const img = el as HTMLImageElement;
      const w = img.width || 0;
      const h = img.height || 0;
      return makeRect(w, h, 0, 0);
    }
    return makeRect(o.width, o.height, o.left ?? 0, o.top ?? 0);
  };
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('extractImages', () => {
  it('returns an empty array when the page has no <img>', () => {
    const p = document.createElement('p');
    p.textContent = 'no images here';
    document.body.appendChild(p);
    expect(extractImages({ getRect: makeRectGetter({}) })).toEqual([]);
  });

  it('includes images at or above the 50×50 throttle', () => {
    appendImg(document.body, {
      src: 'https://example.com/a.png',
      width: 200,
      height: 200,
      alt: 'hello',
    });
    const images = extractImages({ getRect: makeRectGetter({}) });
    expect(images).toHaveLength(1);
    expect(images[0]!.src).toBe('https://example.com/a.png');
    expect(images[0]!.altText).toBe('hello');
    expect(images[0]!.width).toBe(200);
    expect(images[0]!.height).toBe(200);
  });

  it('skips images below the 50×50 throttle (either dimension)', () => {
    appendImg(document.body, { src: 'https://example.com/tiny-w.png', width: 40, height: 60 });
    appendImg(document.body, { src: 'https://example.com/tiny-h.png', width: 60, height: 40 });
    appendImg(document.body, { src: 'https://example.com/exactly-50.png', width: 50, height: 50 });
    const images = extractImages({ getRect: makeRectGetter({}) });
    expect(images.map((i) => i.src)).toEqual(['https://example.com/exactly-50.png']);
  });

  it('skips known tracking beacons even when sized above the throttle', () => {
    appendImg(document.body, {
      src: 'https://www.google-analytics.com/collect?v=1',
      width: 100,
      height: 100,
    });
    appendImg(document.body, {
      src: 'https://stats.g.doubleclick.net/r/pixel?id=42',
      width: 100,
      height: 100,
    });
    appendImg(document.body, {
      src: 'https://www.facebook.com/tr?id=999',
      width: 100,
      height: 100,
    });
    appendImg(document.body, { src: 'https://example.com/photo.jpg', width: 100, height: 100 });
    const images = extractImages({ getRect: makeRectGetter({}) });
    expect(images.map((i) => i.src)).toEqual(['https://example.com/photo.jpg']);
  });

  it('caps the result at 5 images per page', () => {
    for (let i = 0; i < 8; i++) {
      appendImg(document.body, {
        src: `https://example.com/img-${i}.png`,
        width: 100 + i,
        height: 100 + i,
      });
    }
    const images = extractImages({ getRect: makeRectGetter({}) });
    expect(images).toHaveLength(5);
  });

  it('ranks the top-N by size × visibility (visible large beats invisible large beats visible small)', () => {
    appendImg(document.body, {
      src: 'https://example.com/visible-large.png',
      width: 600,
      height: 600,
    });
    appendImg(document.body, {
      src: 'https://example.com/invisible-large.png',
      width: 600,
      height: 600,
    });
    appendImg(document.body, {
      src: 'https://example.com/visible-small.png',
      width: 80,
      height: 80,
    });
    appendImg(document.body, {
      src: 'https://example.com/visible-medium.png',
      width: 300,
      height: 300,
    });
    const getRect = makeRectGetter({
      'https://example.com/visible-large.png': { width: 600, height: 600, left: 0, top: 0 },
      'https://example.com/invisible-large.png': { width: 600, height: 600, left: 0, top: 5000 },
      'https://example.com/visible-small.png': { width: 80, height: 80, left: 0, top: 100 },
      'https://example.com/visible-medium.png': { width: 300, height: 300, left: 0, top: 200 },
    });
    const images = extractImages({ getRect, viewportWidth: 1024, viewportHeight: 768 });
    expect(images.map((i) => i.src)).toEqual([
      'https://example.com/visible-large.png',
      'https://example.com/visible-medium.png',
      'https://example.com/invisible-large.png',
      'https://example.com/visible-small.png',
    ]);
  });

  it('captures empty string when alt is missing (never undefined / null)', () => {
    appendImg(document.body, { src: 'https://example.com/noalt.png', width: 200, height: 200 });
    const images = extractImages({ getRect: makeRectGetter({}) });
    expect(images[0]!.altText).toBe('');
  });

  it('resolves relative src to an absolute URL via HTMLImageElement.src', () => {
    appendImg(document.body, { src: '/photo.png', width: 200, height: 200 });
    const images = extractImages({ getRect: makeRectGetter({}) });
    expect(images[0]!.src.startsWith('http')).toBe(true);
    expect(images[0]!.src.endsWith('/photo.png')).toBe(true);
  });

  it('marks visibleInViewport=true when the rect intersects the viewport', () => {
    appendImg(document.body, { src: 'https://example.com/in.png', width: 200, height: 200 });
    const getRect = makeRectGetter({
      'https://example.com/in.png': { width: 200, height: 200, left: 100, top: 100 },
    });
    const images = extractImages({ getRect, viewportWidth: 1024, viewportHeight: 768 });
    expect(images[0]!.visibleInViewport).toBe(true);
  });

  it('marks visibleInViewport=false when the rect is fully offscreen below', () => {
    appendImg(document.body, { src: 'https://example.com/out.png', width: 200, height: 200 });
    const getRect = makeRectGetter({
      'https://example.com/out.png': { width: 200, height: 200, left: 0, top: 5000 },
    });
    const images = extractImages({ getRect, viewportWidth: 1024, viewportHeight: 768 });
    expect(images[0]!.visibleInViewport).toBe(false);
  });

  it('buckets sizeClass: small <200, medium <500, large ≥500 (max dimension)', () => {
    appendImg(document.body, { src: 'https://example.com/small.png', width: 150, height: 150 });
    appendImg(document.body, { src: 'https://example.com/medium.png', width: 300, height: 300 });
    appendImg(document.body, { src: 'https://example.com/large.png', width: 800, height: 800 });
    const images = extractImages({ getRect: makeRectGetter({}) });
    const byId = Object.fromEntries(images.map((i) => [i.src.split('/').pop(), i.sizeClass]));
    expect(byId['small.png']).toBe('small');
    expect(byId['medium.png']).toBe('medium');
    expect(byId['large.png']).toBe('large');
  });

  it('skips images with display:none ancestors', () => {
    const hiddenWrap = document.createElement('div');
    hiddenWrap.setAttribute('style', 'display:none');
    appendImg(hiddenWrap, { src: 'https://example.com/hidden.png', width: 200, height: 200 });
    document.body.appendChild(hiddenWrap);
    appendImg(document.body, { src: 'https://example.com/shown.png', width: 200, height: 200 });
    const images = extractImages({ getRect: makeRectGetter({}) });
    expect(images.map((i) => i.src)).toEqual(['https://example.com/shown.png']);
  });
});
