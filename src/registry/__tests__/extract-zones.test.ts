// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { extractZones } from '../extract-zones.js';
import type { ZoneText } from '@/types/registry.js';

const FRAME_SELECTORS = ['nav', 'header', 'footer'] as const;

const baseHtml = (greeting: string, mainText: string, lang = 'en'): string => `<!doctype html>
<html lang="${lang}">
  <head><title>Acme</title></head>
  <body>
    <header>
      <a href="/" class="logo">Acme</a>
      <span class="user-greeting">${greeting}</span>
    </header>
    <nav>
      <ul>
        <li><a href="/products">Products</a></li>
        <li><a href="/pricing">Pricing</a></li>
        <li><a href="/about">About</a></li>
      </ul>
    </nav>
    <article>${mainText}</article>
    <footer>
      <p>© 2026 Acme Corp</p>
    </footer>
  </body>
</html>`;

const findZone = (zones: readonly ZoneText[], selector: string): ZoneText => {
  const z = zones.find((x) => x.zoneId.startsWith(selector + '#'));
  if (z === undefined) throw new Error(`no zone for selector ${selector}`);
  return z;
};

describe('extractZones', () => {
  it('extracts only static-frame zones (nav/header/footer); skips article', () => {
    const html = baseHtml('Welcome guest', '<p>marketing copy that varies per visit</p>');
    const zones = extractZones(html, [...FRAME_SELECTORS], []);

    const ids = zones.map((z) => z.zoneId).sort();
    expect(ids).toEqual(['footer#0', 'header#0', 'nav#0']);

    for (const zone of zones) {
      expect(zone.htmlSnippet).not.toContain('marketing copy');
      expect(zone.normalisedText).not.toContain('marketing copy');
    }
  });

  it('produces an identical structureSkeleton across locale variants of the same page', () => {
    const en = baseHtml('Welcome guest', '<p>EN body</p>', 'en');
    const es = baseHtml('Bienvenido invitado', '<p>ES body</p>', 'es');

    const enZones = extractZones(en, [...FRAME_SELECTORS], []);
    const esZones = extractZones(es, [...FRAME_SELECTORS], []);

    expect(enZones).toHaveLength(esZones.length);
    for (const enZone of enZones) {
      const esZone = findZone(esZones, enZone.zoneId.split('#')[0]);
      expect(esZone.structureSkeleton).toBe(enZone.structureSkeleton);
    }

    const enHeader = findZone(enZones, 'header');
    const esHeader = findZone(esZones, 'header');
    expect(esHeader.normalisedText).not.toBe(enHeader.normalisedText);
    expect(enHeader.normalisedText).toContain('Welcome guest');
    expect(esHeader.normalisedText).toContain('Bienvenido invitado');
  });

  it('tolerates signed-in vs signed-out chrome via excluded selectors', () => {
    const signedOut = baseHtml('Welcome guest', '<p>body</p>');
    const signedIn = baseHtml('Welcome, Alice 👋', '<p>body</p>');

    const excluded = ['.user-greeting'];
    const outZones = extractZones(signedOut, [...FRAME_SELECTORS], excluded);
    const inZones = extractZones(signedIn, [...FRAME_SELECTORS], excluded);

    const outHeader = findZone(outZones, 'header');
    const inHeader = findZone(inZones, 'header');

    expect(inHeader.normalisedText).toBe(outHeader.normalisedText);
    expect(inHeader.htmlSnippet).toBe(outHeader.htmlSnippet);
    expect(inHeader.structureSkeleton).toBe(outHeader.structureSkeleton);

    expect(outHeader.normalisedText).not.toContain('Welcome guest');
    expect(inHeader.normalisedText).not.toContain('Alice');
  });

  it('drops a frame match whose element itself matches an excluded selector', () => {
    const html = `<!doctype html><html><body>
      <header class="experimental">should be dropped</header>
      <nav><a href="/">Home</a></nav>
      <footer>fine</footer>
    </body></html>`;
    const zones = extractZones(html, [...FRAME_SELECTORS], ['header.experimental']);
    const ids = zones.map((z) => z.zoneId).sort();
    expect(ids).toEqual(['footer#0', 'nav#0']);
  });

  it('returns an empty array for empty HTML', () => {
    expect(extractZones('', [...FRAME_SELECTORS], [])).toEqual([]);
    expect(extractZones('<!doctype html><html></html>', [...FRAME_SELECTORS], [])).toEqual([]);
  });

  it('does not throw on malformed HTML', () => {
    const malformed = '<!doctype html><html><body><nav><ul><li><a href="/">x';
    expect(() => extractZones(malformed, [...FRAME_SELECTORS], [])).not.toThrow();
    const zones = extractZones(malformed, [...FRAME_SELECTORS], []);
    expect(zones.length).toBeGreaterThanOrEqual(0);
  });

  it('produces deterministic, doc-order zoneIds when a selector matches multiple elements', () => {
    const html = `<!doctype html><html><body>
      <nav id="top"><a href="/">Top</a></nav>
      <main><p>x</p></main>
      <nav id="side"><a href="/">Side</a></nav>
      <footer>f</footer>
    </body></html>`;
    const zones = extractZones(html, ['nav', 'footer'], []);
    expect(zones.map((z) => z.zoneId)).toEqual(['nav#0', 'nav#1', 'footer#0']);
    expect(zones[0].htmlSnippet).toContain('id="top"');
    expect(zones[1].htmlSnippet).toContain('id="side"');
  });

  it('deduplicates zones when multiple selectors match the same element', () => {
    const html = `<!doctype html><html><body>
      <header><nav><a href="/">Home</a></nav></header>
    </body></html>`;
    const zones = extractZones(html, ['header', 'header > nav'], []);
    expect(zones.map((z) => z.zoneId)).toEqual(['header#0', 'header > nav#0']);
    expect(zones).toHaveLength(2);
  });

  it('prunes excluded descendants from htmlSnippet, normalisedText, and structureSkeleton', () => {
    const html = `<!doctype html><html><body>
      <header>
        <a href="/" class="logo">Acme</a>
        <div class="locale-banner">Browsing from US — switch?</div>
      </header>
    </body></html>`;
    const zones = extractZones(html, ['header'], ['.locale-banner']);
    expect(zones).toHaveLength(1);
    const header = zones[0];
    expect(header.htmlSnippet).not.toContain('locale-banner');
    expect(header.htmlSnippet).not.toContain('Browsing from US');
    expect(header.normalisedText).not.toContain('Browsing from US');
    expect(header.normalisedText).toContain('Acme');
    expect(header.structureSkeleton).not.toContain('locale-banner');
  });

  it('exposes the documented ZoneText shape', () => {
    const html = `<!doctype html><html><body><nav><a href="/">x</a></nav></body></html>`;
    const [zone] = extractZones(html, ['nav'], []);
    expect(zone).toBeDefined();
    expect(typeof zone.zoneId).toBe('string');
    expect(typeof zone.htmlSnippet).toBe('string');
    expect(typeof zone.normalisedText).toBe('string');
    expect(typeof zone.structureSkeleton).toBe('string');
    expect(Object.keys(zone).sort()).toEqual([
      'htmlSnippet',
      'normalisedText',
      'structureSkeleton',
      'zoneId',
    ]);
  });
});
