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
import { getRegistryStats, resetRegistryTelemetry } from '../telemetry.js';

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
const FIXED_SIGNED_AT = 1_700_000_000_999;

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

  const store = new Map<string, unknown>();

  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('chrome', {
    runtime: {
      getURL: (path: string) => `chrome-extension://test/${path}`,
    },
    storage: {
      local: {
        get: async (keys?: string | string[] | null) => {
          if (keys === null || keys === undefined) {
            return Object.fromEntries(store);
          }
          const arr = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of arr) {
            if (store.has(k)) out[k] = store.get(k);
          }
          return out;
        },
        set: async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store.set(k, v);
        },
        remove: async (keys: string | string[]) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          for (const k of arr) store.delete(k);
        },
      },
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

describe('registry lookup → telemetry wiring (SR-G)', () => {
  beforeEach(async () => {
    if (signerPrivHex === undefined) {
      const priv = ed.utils.randomPrivateKey();
      signerPrivHex = bytesToHex(priv);
      signerPubHex = bytesToHex(await ed.getPublicKeyAsync(priv));
      sampleEntry = await buildEntryFromHtml('acme.test', SAMPLE_HTML);
      sampleBundle = await signRegistry({
        entries: [sampleEntry],
        privateKeyHex: signerPrivHex,
        now: () => FIXED_SIGNED_AT,
      });
    }
    __resetRegistryForTests();
    setupChrome();
    await resetRegistryTelemetry();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('on successful bundle load, records bundleSignedAt and bundleLoadedAt', async () => {
    const stub = setupChrome();
    stub.setBundleResponse(sampleBundle);

    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });

    const stats = await getRegistryStats();
    expect(stats.bundleSignedAt).toBe(FIXED_SIGNED_AT);
    expect(stats.bundleLoadedAt).not.toBeNull();
    expect(stats.verifyFailures).toBe(0);
  });

  it('on verify failure (wrong trust root), increments verifyFailures and skips bundle metadata write', async () => {
    const stub = setupChrome();
    stub.setBundleResponse(sampleBundle);

    const wrongPriv = ed.utils.randomPrivateKey();
    const wrongPub = bytesToHex(await ed.getPublicKeyAsync(wrongPriv));

    await loadRegistryOnce({ trustedPublicKeyHex: wrongPub });

    const stats = await getRegistryStats();
    expect(stats.verifyFailures).toBe(1);
    expect(stats.bundleSignedAt).toBeNull();
    expect(stats.bundleLoadedAt).toBeNull();
  });

  it('on fetch 404, does NOT increment verifyFailures (no bundle to verify) and leaves bundle metadata null', async () => {
    const stub = setupChrome();
    stub.setBundleResponse(null, 404);

    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });

    const stats = await getRegistryStats();
    expect(stats.verifyFailures).toBe(0);
    expect(stats.bundleSignedAt).toBeNull();
  });

  it('on full registry hit, records hit against the normalised origin', async () => {
    const stub = setupChrome();
    stub.setBundleResponse(sampleBundle);

    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });
    const result = await lookupRegistry('acme.test', SAMPLE_HTML);
    expect(result.matched).toBe(true);

    const stats = await getRegistryStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(0);
    expect(stats.perOrigin['acme.test']!.hits).toBe(1);
  });

  it('records the hit against the host-normalised origin even when called with a URL-shaped origin', async () => {
    const stub = setupChrome();
    stub.setBundleResponse(sampleBundle);

    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });
    await lookupRegistry('https://acme.test', SAMPLE_HTML);

    const stats = await getRegistryStats();
    expect(stats.perOrigin['acme.test']).toBeDefined();
    expect(stats.perOrigin['https://acme.test']).toBeUndefined();
  });

  it('on origin not in registry, records miss against the normalised origin', async () => {
    const stub = setupChrome();
    stub.setBundleResponse(sampleBundle);

    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });
    await lookupRegistry('different.test', SAMPLE_HTML);

    const stats = await getRegistryStats();
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(0);
    expect(stats.perOrigin['different.test']!.misses).toBe(1);
  });

  it('on fingerprint drift (origin in registry, content changed), records miss against the origin', async () => {
    const stub = setupChrome();
    stub.setBundleResponse(sampleBundle);

    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });

    const drifted = SAMPLE_HTML.replace(
      '<footer><p>© 2026 Acme</p></footer>',
      '<footer><p>© 2026 Acme</p><p>injected</p></footer>',
    );
    await lookupRegistry('acme.test', drifted);

    const stats = await getRegistryStats();
    expect(stats.misses).toBe(1);
    expect(stats.perOrigin['acme.test']!.misses).toBe(1);
    expect(stats.perOrigin['acme.test']!.hits).toBe(0);
  });

  it('does NOT record telemetry when the registry is unloaded (cachedBundle still null)', async () => {
    setupChrome();
    // No loadRegistryOnce call.
    await lookupRegistry('acme.test', SAMPLE_HTML);

    const stats = await getRegistryStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
  });

  it('does NOT record telemetry when snapshotHtml is empty (synthetic / pre-SR-F state)', async () => {
    const stub = setupChrome();
    stub.setBundleResponse(sampleBundle);

    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });
    await lookupRegistry('acme.test', '');

    const stats = await getRegistryStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
  });

  it('a hit followed by a miss against the same origin produces hit=1 / miss=1 / hitRate=0.5', async () => {
    const stub = setupChrome();
    stub.setBundleResponse(sampleBundle);

    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });

    await lookupRegistry('acme.test', SAMPLE_HTML);
    const drifted = SAMPLE_HTML.replace(
      '<footer><p>© 2026 Acme</p></footer>',
      '<footer><p>© 2026 Acme</p><p>injected</p></footer>',
    );
    await lookupRegistry('acme.test', drifted);

    const stats = await getRegistryStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBeCloseTo(0.5, 6);
    expect(stats.perOrigin['acme.test']!.hits).toBe(1);
    expect(stats.perOrigin['acme.test']!.misses).toBe(1);
  });
});
