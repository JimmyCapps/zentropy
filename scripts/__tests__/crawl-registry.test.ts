// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { crawlRegistry } from '../crawl-registry.js';
import type { SiteManifestEntry } from '../crawl-registry.js';
import type { RegistryEntry } from '@/types/registry.js';

const HEX64 = /^[0-9a-f]{64}$/;

const baseHtml = (greeting: string): string => `<!doctype html>
<html lang="en">
  <head><title>Acme</title></head>
  <body>
    <header>
      <a href="/" class="logo">Acme</a>
      <span class="user-greeting">${greeting}</span>
    </header>
    <nav><ul><li><a href="/">Home</a></li></ul></nav>
    <article><p>variable content</p></article>
    <footer><p>(c) Acme</p></footer>
  </body>
</html>`;

const okResponse = (html: string): Response =>
  new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });

type FetchHandler = Response | Error | (() => Response | Promise<Response>);

const makeFetch = (responses: Readonly<Record<string, FetchHandler>>) =>
  async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const handler = responses[url];
    if (handler === undefined) throw new Error(`unmocked URL ${url}`);
    if (handler instanceof Error) throw handler;
    return typeof handler === 'function' ? handler() : handler;
  };

const silentLogger = { info: (): void => {}, warn: (): void => {} };

let outputDir: string;

beforeEach(async () => {
  outputDir = await mkdtemp(join(tmpdir(), 'crawl-registry-'));
});

afterEach(async () => {
  await rm(outputDir, { recursive: true, force: true });
});

describe('crawlRegistry', () => {
  it('writes a schema-valid RegistryEntry per site in the manifest', async () => {
    const manifest: readonly SiteManifestEntry[] = [
      {
        origin: 'acme.test',
        url: 'https://acme.test/',
        frameSelectors: ['nav', 'header', 'footer'],
        excludedSelectors: ['.user-greeting'],
      },
    ];
    const fetchFn = makeFetch({
      'https://acme.test/': okResponse(baseHtml('Welcome guest')),
    });

    const result = await crawlRegistry({
      manifest,
      outputDir,
      fetchFn,
      now: () => 1735689600000,
      logger: silentLogger,
    });

    expect(result.written).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);

    const path = join(outputDir, 'acme.test.json');
    const entry = JSON.parse(await readFile(path, 'utf8')) as RegistryEntry;

    expect(entry.origin).toBe('acme.test');
    expect(entry.schemaVersion).toBe(1);
    expect(entry.capturedAt).toBe(1735689600000);
    expect(entry.excludedSelectors).toEqual(['.user-greeting']);
    expect(entry.zones.length).toBe(3);
  });

  it('produces 64-char hex fingerprints (structural + tokens) per zone', async () => {
    const manifest: readonly SiteManifestEntry[] = [
      {
        origin: 'acme.test',
        url: 'https://acme.test/',
        frameSelectors: ['header', 'nav', 'footer'],
        excludedSelectors: [],
      },
    ];
    const fetchFn = makeFetch({
      'https://acme.test/': okResponse(baseHtml('Hi')),
    });

    const result = await crawlRegistry({
      manifest,
      outputDir,
      fetchFn,
      logger: silentLogger,
    });

    const entry = JSON.parse(await readFile(result.written[0], 'utf8')) as RegistryEntry;
    expect(entry.zones.length).toBeGreaterThan(0);
    for (const zone of entry.zones) {
      expect(typeof zone.zoneId).toBe('string');
      expect(typeof zone.selector).toBe('string');
      expect(zone.zoneId.startsWith(`${zone.selector}#`)).toBe(true);
      expect(zone.fingerprint.structural).toMatch(HEX64);
      expect(zone.fingerprint.tokens).toMatch(HEX64);
    }
  });

  it('skips a site when fetch throws and continues with the rest', async () => {
    const manifest: readonly SiteManifestEntry[] = [
      {
        origin: 'broken.test',
        url: 'https://broken.test/',
        frameSelectors: ['nav', 'header', 'footer'],
        excludedSelectors: [],
      },
      {
        origin: 'ok.test',
        url: 'https://ok.test/',
        frameSelectors: ['nav', 'header', 'footer'],
        excludedSelectors: [],
      },
    ];
    const fetchFn = makeFetch({
      'https://broken.test/': new Error('connection refused'),
      'https://ok.test/': okResponse(baseHtml('Hi')),
    });

    const result = await crawlRegistry({
      manifest,
      outputDir,
      fetchFn,
      logger: silentLogger,
    });

    expect(result.skipped.map((s) => s.origin)).toEqual(['broken.test']);
    expect(result.skipped[0].reason).toBe('fetch-failed');
    expect(result.written).toHaveLength(1);
    expect(result.written[0]).toContain('ok.test.json');

    const files = await readdir(outputDir);
    expect(files.sort()).toEqual(['ok.test.json']);
  });

  it('skips a site when fetch returns a non-ok status', async () => {
    const manifest: readonly SiteManifestEntry[] = [
      {
        origin: 'forbidden.test',
        url: 'https://forbidden.test/',
        frameSelectors: ['nav'],
        excludedSelectors: [],
      },
    ];
    const fetchFn = makeFetch({
      'https://forbidden.test/': new Response('forbidden', { status: 403 }),
    });

    const result = await crawlRegistry({
      manifest,
      outputDir,
      fetchFn,
      logger: silentLogger,
    });

    expect(result.written).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe('fetch-failed');
    expect(result.skipped[0].detail).toContain('403');
  });

  it('skips a site when extractZones returns no zones', async () => {
    const manifest: readonly SiteManifestEntry[] = [
      {
        origin: 'empty.test',
        url: 'https://empty.test/',
        frameSelectors: ['nav', 'header', 'footer'],
        excludedSelectors: [],
      },
    ];
    const fetchFn = makeFetch({
      'https://empty.test/': okResponse(
        '<!doctype html><html><body><main>only main</main></body></html>',
      ),
    });

    const result = await crawlRegistry({
      manifest,
      outputDir,
      fetchFn,
      logger: silentLogger,
    });

    expect(result.written).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe('no-zones');

    const files = await readdir(outputDir);
    expect(files).toEqual([]);
  });

  it('persists excludedSelectors verbatim from the manifest entry', async () => {
    const excluded = ['.user-greeting', '[data-user-name]'];
    const manifest: readonly SiteManifestEntry[] = [
      {
        origin: 'acme.test',
        url: 'https://acme.test/',
        frameSelectors: ['header'],
        excludedSelectors: excluded,
      },
    ];
    const fetchFn = makeFetch({
      'https://acme.test/': okResponse(baseHtml('Hi')),
    });

    const result = await crawlRegistry({
      manifest,
      outputDir,
      fetchFn,
      logger: silentLogger,
    });

    const entry = JSON.parse(await readFile(result.written[0], 'utf8')) as RegistryEntry;
    expect(entry.excludedSelectors).toEqual(excluded);
  });
});
