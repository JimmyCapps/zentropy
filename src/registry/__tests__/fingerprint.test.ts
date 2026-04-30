// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { extractZones } from '../extract-zones.js';
import { fingerprintZone } from '../fingerprint.js';
import type { ZoneText } from '@/types/registry.js';

const FRAME_SELECTORS = ['nav', 'header', 'footer'] as const;

const SHA256_OF_EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

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

describe('fingerprintZone', () => {
  it('produces an identical structural hash across locale variants of the same DOM', async () => {
    const en = baseHtml('Welcome guest', '<p>EN body</p>', 'en');
    const es = baseHtml('Bienvenido invitado', '<p>ES body</p>', 'es');

    const enZones = extractZones(en, [...FRAME_SELECTORS], []);
    const esZones = extractZones(es, [...FRAME_SELECTORS], []);

    for (const enZone of enZones) {
      const esZone = findZone(esZones, enZone.zoneId.split('#')[0]);
      const enFp = await fingerprintZone(enZone);
      const esFp = await fingerprintZone(esZone);
      expect(esFp.structural).toBe(enFp.structural);
    }

    const enHeader = await fingerprintZone(findZone(enZones, 'header'));
    const esHeader = await fingerprintZone(findZone(esZones, 'header'));
    expect(esHeader.tokens).not.toBe(enHeader.tokens);
  });

  it('produces an identical tokens hash across DOM-shape variants that preserve visible text', async () => {
    const wrappedInP = `<!doctype html><html><body><nav><p>Same Visible Text</p></nav></body></html>`;
    const wrappedInSpan = `<!doctype html><html><body><nav><span>Same Visible Text</span></nav></body></html>`;

    const [pZone] = extractZones(wrappedInP, ['nav'], []);
    const [spanZone] = extractZones(wrappedInSpan, ['nav'], []);

    expect(pZone.normalisedText).toBe(spanZone.normalisedText);
    expect(pZone.structureSkeleton).not.toBe(spanZone.structureSkeleton);

    const pFp = await fingerprintZone(pZone);
    const spanFp = await fingerprintZone(spanZone);

    expect(spanFp.tokens).toBe(pFp.tokens);
    expect(spanFp.structural).not.toBe(pFp.structural);
  });

  it('flips both structural and tokens hashes when content is injected', async () => {
    const original = `<!doctype html><html><body><nav><a href="/">Home</a></nav></body></html>`;
    const injected = `<!doctype html><html><body><nav><a href="/">Home</a><p>injected paragraph</p></nav></body></html>`;

    const [origZone] = extractZones(original, ['nav'], []);
    const [injZone] = extractZones(injected, ['nav'], []);

    const origFp = await fingerprintZone(origZone);
    const injFp = await fingerprintZone(injZone);

    expect(injFp.structural).not.toBe(origFp.structural);
    expect(injFp.tokens).not.toBe(origFp.tokens);
  });

  it('returns SHA-256 of empty string for both factors when given an empty ZoneText', async () => {
    const empty: ZoneText = {
      zoneId: 'header#0',
      htmlSnippet: '',
      normalisedText: '',
      structureSkeleton: '',
    };

    const fp = await fingerprintZone(empty);

    expect(fp.structural).toBe(SHA256_OF_EMPTY);
    expect(fp.tokens).toBe(SHA256_OF_EMPTY);
    expect(fp.version).toBeUndefined();
  });

  it('returns version undefined in v1 (signing arrives in SR-D)', async () => {
    const html = `<!doctype html><html><body><nav><a href="/">x</a></nav></body></html>`;
    const [zone] = extractZones(html, ['nav'], []);
    const fp = await fingerprintZone(zone);

    expect(fp.version).toBeUndefined();
  });

  it('returns 64-character lowercase hex SHA-256 strings for both factors', async () => {
    const html = `<!doctype html><html><body><nav><a href="/">x</a></nav></body></html>`;
    const [zone] = extractZones(html, ['nav'], []);
    const fp = await fingerprintZone(zone);

    expect(fp.structural).toMatch(/^[0-9a-f]{64}$/);
    expect(fp.tokens).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic — repeated calls on the same ZoneText yield identical hashes', async () => {
    const html = `<!doctype html><html><body><header><h1>Title</h1></header></body></html>`;
    const [zone] = extractZones(html, ['header'], []);

    const a = await fingerprintZone(zone);
    const b = await fingerprintZone(zone);

    expect(b.structural).toBe(a.structural);
    expect(b.tokens).toBe(a.tokens);
  });
});
