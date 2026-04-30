// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as ed from '@noble/ed25519';

import { signRegistry } from '../sign.js';
import { extractZones } from '../extract-zones.js';
import { fingerprintZone } from '../fingerprint.js';
import { bytesToHex, type SignedRegistryBundle } from '../canonical-bundle.js';
import type { RegistryEntry, RegistryZone } from '@/types/registry.js';

import {
  loadRegistryOnce,
  lookupRegistry,
  __resetRegistryForTests,
} from '../lookup.js';

const SAMPLE_HTML = `<!doctype html>
<html lang="en">
  <body>
    <header><a href="/">Acme</a></header>
    <nav><ul><li><a href="/x">X</a></li></ul></nav>
    <article><p>varies</p></article>
    <footer><p>© 2026 Acme</p></footer>
  </body>
</html>`;

const FRAME_SELECTORS = ['header', 'nav', 'footer'] as const;

async function buildEntryFromHtml(origin: string, html: string): Promise<RegistryEntry> {
  const zones = extractZones(html, [...FRAME_SELECTORS], []);
  const registryZones: RegistryZone[] = await Promise.all(
    zones.map(async (z) => ({
      zoneId: z.zoneId,
      selector: z.zoneId.split('#')[0]!,
      fingerprint: await fingerprintZone(z),
    })),
  );
  return {
    origin,
    capturedAt: 1_700_000_000_000,
    schemaVersion: 1,
    zones: registryZones,
    excludedSelectors: [],
  };
}

interface ChromeStub {
  fetchMock: ReturnType<typeof vi.fn>;
  setBundleResponse(bundle: unknown | null, status?: number): void;
}

function setupChrome(): ChromeStub {
  let nextResponse: { ok: boolean; status: number; body: unknown | null } = {
    ok: false,
    status: 404,
    body: null,
  };

  const fetchMock = vi.fn(async (_url: string) => ({
    ok: nextResponse.ok,
    status: nextResponse.status,
    json: async () => nextResponse.body,
  }));

  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('chrome', {
    runtime: {
      getURL: (path: string) => `chrome-extension://test/${path}`,
    },
  });

  return {
    fetchMock,
    setBundleResponse(bundle: unknown | null, status: number = 200) {
      nextResponse = bundle === null
        ? { ok: false, status, body: null }
        : { ok: true, status: 200, body: bundle };
    },
  };
}

let signerPrivHex: string;
let signerPubHex: string;
let sampleBundle: SignedRegistryBundle;
let sampleEntry: RegistryEntry;

describe('registry lookup module', () => {
  beforeEach(async () => {
    if (signerPrivHex === undefined) {
      const priv = ed.utils.randomPrivateKey();
      signerPrivHex = bytesToHex(priv);
      signerPubHex = bytesToHex(await ed.getPublicKeyAsync(priv));
      sampleEntry = await buildEntryFromHtml('acme.test', SAMPLE_HTML);
      sampleBundle = await signRegistry({
        entries: [sampleEntry],
        privateKeyHex: signerPrivHex,
        now: () => 1_700_000_000_999,
      });
    }
    __resetRegistryForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loadRegistryOnce — fetches the bundle, verifies, caches; second call is a no-op fetch', async () => {
    const stub = setupChrome();
    stub.setBundleResponse(sampleBundle);

    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });
    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });

    expect(stub.fetchMock).toHaveBeenCalledTimes(1);
    expect(stub.fetchMock.mock.calls[0]![0]).toBe(
      'chrome-extension://test/dist/registry/signed-registry.json',
    );
  });

  it('loadRegistryOnce — when fetch returns 404, lookup misses for the rest of the SW lifetime (fail-safe)', async () => {
    const stub = setupChrome();
    stub.setBundleResponse(null, 404);

    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });

    const result = await lookupRegistry('acme.test', SAMPLE_HTML);
    expect(result.matched).toBe(false);
    expect(result.zoneIds).toEqual([]);
  });

  it('loadRegistryOnce — when verify fails (wrong trust root), lookup misses for the rest of the SW lifetime', async () => {
    const stub = setupChrome();
    stub.setBundleResponse(sampleBundle);

    const wrongPriv = ed.utils.randomPrivateKey();
    const wrongPub = bytesToHex(await ed.getPublicKeyAsync(wrongPriv));

    await loadRegistryOnce({ trustedPublicKeyHex: wrongPub });

    const result = await lookupRegistry('acme.test', SAMPLE_HTML);
    expect(result.matched).toBe(false);
  });

  it('lookupRegistry — returns matched=true with all zoneIds when origin + every fingerprint matches', async () => {
    const stub = setupChrome();
    stub.setBundleResponse(sampleBundle);

    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });

    const result = await lookupRegistry('acme.test', SAMPLE_HTML);

    expect(result.matched).toBe(true);
    expect([...result.zoneIds].sort()).toEqual(
      [...sampleEntry.zones.map((z) => z.zoneId)].sort(),
    );
  });

  it('lookupRegistry — returns matched=false when origin has no entry in the registry', async () => {
    const stub = setupChrome();
    stub.setBundleResponse(sampleBundle);

    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });

    const result = await lookupRegistry('different.test', SAMPLE_HTML);
    expect(result.matched).toBe(false);
    expect(result.zoneIds).toEqual([]);
  });

  it('lookupRegistry — returns matched=false when one zone fingerprint drifts (content injected into footer)', async () => {
    const stub = setupChrome();
    stub.setBundleResponse(sampleBundle);

    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });

    const drifted = SAMPLE_HTML.replace(
      '<footer><p>© 2026 Acme</p></footer>',
      '<footer><p>© 2026 Acme</p><p>injected</p></footer>',
    );

    const result = await lookupRegistry('acme.test', drifted);
    expect(result.matched).toBe(false);
  });

  it('lookupRegistry — partial-zone match returns matched=false (registry only short-circuits on full agreement)', async () => {
    const stub = setupChrome();
    stub.setBundleResponse(sampleBundle);

    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });

    // Drop the <nav> entirely — the registry expects all 3 zones; only 2 will be extracted.
    const partialHtml = SAMPLE_HTML.replace(
      /<nav>[\s\S]*?<\/nav>/,
      '',
    );

    const result = await lookupRegistry('acme.test', partialHtml);
    expect(result.matched).toBe(false);
  });

  it('lookupRegistry — returns matched=false when called before loadRegistryOnce (registry not loaded sentinel)', async () => {
    setupChrome();
    // No loadRegistryOnce call.
    const result = await lookupRegistry('acme.test', SAMPLE_HTML);
    expect(result.matched).toBe(false);
    expect(result.zoneIds).toEqual([]);
  });

  it('lookupRegistry — returns matched=false when snapshotHtml is empty (fail-safe path)', async () => {
    const stub = setupChrome();
    stub.setBundleResponse(sampleBundle);

    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });

    const result = await lookupRegistry('acme.test', '');
    expect(result.matched).toBe(false);
  });

  it('lookupRegistry — normalises a URL-shaped origin (https://acme.test) to host-only for match', async () => {
    const stub = setupChrome();
    stub.setBundleResponse(sampleBundle);

    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });

    const result = await lookupRegistry('https://acme.test', SAMPLE_HTML);
    expect(result.matched).toBe(true);
  });
});
