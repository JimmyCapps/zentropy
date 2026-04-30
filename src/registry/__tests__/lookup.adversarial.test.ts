// @vitest-environment jsdom
//
// SR-H adversarial regression suite — RFC §Q9 properties exercised
// end-to-end through `loadRegistryOnce` + `lookupRegistry` against
// deliberately mutated `SignedRegistryBundle` payloads. Sibling to
// `lookup.test.ts` (functional) and `lookup.telemetry.test.ts` (counter
// wiring); this file is the "an attacker mutated the bundle on disk"
// surface area.
//
// Each case follows the same shape:
//   1. sign a clean bundle with a fresh keypair
//   2. mutate ONE field (signature byte / entries / signedAt / pubKey)
//   3. confirm `verifyRegistry` rejects via `loadRegistryOnce`
//   4. confirm `verifyFailures` increments (or stays at 0 for fetch-404
//      paths where no bundle was presented for verification)
//   5. confirm every subsequent `lookupRegistry` is MISS for the SW
//      lifetime (the §Q5 fail-safe)
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
  setStorageBehaviour(opts: { getThrows?: boolean; setThrows?: boolean }): void;
}

function setupChrome(): ChromeStub {
  let nextResponse: { ok: boolean; status: number; body: unknown | null } = {
    ok: false,
    status: 404,
    body: null,
  };
  let getThrows = false;
  let setThrows = false;

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
          if (getThrows) throw new Error('storage.local.get explosion');
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
          if (setThrows) throw new Error('storage.local.set explosion');
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
    setStorageBehaviour({ getThrows: g, setThrows: s }) {
      if (g !== undefined) getThrows = g;
      if (s !== undefined) setThrows = s;
    },
  };
}

let signerPrivHex: string;
let signerPubHex: string;
let attackerPrivHex: string;
let attackerPubHex: string;
let cleanBundle: SignedRegistryBundle;
let sampleEntry: RegistryEntry;

describe('SR-H — adversarial bundle tamper surface', () => {
  beforeEach(async () => {
    if (signerPrivHex === undefined) {
      const priv = ed.utils.randomPrivateKey();
      signerPrivHex = bytesToHex(priv);
      signerPubHex = bytesToHex(await ed.getPublicKeyAsync(priv));

      const evilPriv = ed.utils.randomPrivateKey();
      attackerPrivHex = bytesToHex(evilPriv);
      attackerPubHex = bytesToHex(await ed.getPublicKeyAsync(evilPriv));

      sampleEntry = await buildEntryFromHtml('acme.test', SAMPLE_HTML);
      cleanBundle = await signRegistry({
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

  it('signature tamper: flipping one byte in `signature` → verify fails, verifyFailures=1, lookup MISS for SW lifetime', async () => {
    const stub = setupChrome();
    const tampered: SignedRegistryBundle = {
      ...cleanBundle,
      signature: flipFirstHexByte(cleanBundle.signature),
    };
    stub.setBundleResponse(tampered);

    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });

    const stats = await getRegistryStats();
    expect(stats.verifyFailures).toBe(1);
    expect(stats.bundleSignedAt).toBeNull();
    expect(stats.bundleLoadedAt).toBeNull();

    const result = await lookupRegistry('acme.test', SAMPLE_HTML);
    expect(result.matched).toBe(false);
  });

  it('entry tamper: mutating a zone fingerprint after signing → verify fails, verifyFailures=1', async () => {
    const stub = setupChrome();
    const tamperedEntries: RegistryEntry[] = cleanBundle.entries.map((e) => ({
      ...e,
      zones: e.zones.map((z, i) =>
        i === 0
          ? {
              ...z,
              fingerprint: {
                ...z.fingerprint,
                structural: '0'.repeat(64),
              },
            }
          : z,
      ),
    }));
    const tampered: SignedRegistryBundle = {
      ...cleanBundle,
      entries: tamperedEntries,
    };
    stub.setBundleResponse(tampered);

    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });

    const stats = await getRegistryStats();
    expect(stats.verifyFailures).toBe(1);

    const result = await lookupRegistry('acme.test', SAMPLE_HTML);
    expect(result.matched).toBe(false);
  });

  it('signedAt tamper: rewriting `signedAt` → verify fails, verifyFailures=1', async () => {
    const stub = setupChrome();
    const tampered: SignedRegistryBundle = {
      ...cleanBundle,
      signedAt: cleanBundle.signedAt + 86_400_000,
    };
    stub.setBundleResponse(tampered);

    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });

    const stats = await getRegistryStats();
    expect(stats.verifyFailures).toBe(1);
    expect(stats.bundleSignedAt).toBeNull();
  });

  it('public-key swap: `publicKeyHex` field replaced with attacker key → verify fails, verifyFailures=1', async () => {
    const stub = setupChrome();
    const tampered: SignedRegistryBundle = {
      ...cleanBundle,
      publicKeyHex: attackerPubHex,
    };
    stub.setBundleResponse(tampered);

    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });

    const stats = await getRegistryStats();
    expect(stats.verifyFailures).toBe(1);
  });

  it('truncated entries: dropping every entry from a signed bundle → verify fails, verifyFailures=1', async () => {
    const stub = setupChrome();
    const tampered: SignedRegistryBundle = {
      ...cleanBundle,
      entries: [],
    };
    stub.setBundleResponse(tampered);

    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });

    const stats = await getRegistryStats();
    expect(stats.verifyFailures).toBe(1);
  });

  it('attacker-signed bundle masquerading under trusted publicKeyHex → verify fails, verifyFailures=1', async () => {
    // Adversary signed a bundle with their own private key, then tried to
    // claim it was signed by the trusted key by setting `publicKeyHex` to
    // the trusted key's hex. verifyRegistry catches this because the
    // signature was generated against the attacker's public-key bytes.
    const stub = setupChrome();
    const attackerSigned = await signRegistry({
      entries: [sampleEntry],
      privateKeyHex: attackerPrivHex,
      now: () => FIXED_SIGNED_AT,
    });
    const masquerade: SignedRegistryBundle = {
      ...attackerSigned,
      publicKeyHex: signerPubHex,
    };
    stub.setBundleResponse(masquerade);

    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });

    const stats = await getRegistryStats();
    expect(stats.verifyFailures).toBe(1);

    const result = await lookupRegistry('acme.test', SAMPLE_HTML);
    expect(result.matched).toBe(false);
  });

  it('attacker-signed bundle with attacker publicKeyHex → verify fails (publicKeyHex !== trusted)', async () => {
    const stub = setupChrome();
    const attackerSigned = await signRegistry({
      entries: [sampleEntry],
      privateKeyHex: attackerPrivHex,
      now: () => FIXED_SIGNED_AT,
    });
    stub.setBundleResponse(attackerSigned);

    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });

    const stats = await getRegistryStats();
    expect(stats.verifyFailures).toBe(1);
  });

  it('garbage-shaped bundle (missing signature field) → verify fails, verifyFailures=1', async () => {
    const stub = setupChrome();
    const malformed = {
      schemaVersion: 1,
      publicKeyHex: signerPubHex,
      signedAt: FIXED_SIGNED_AT,
      entries: [],
      // signature deliberately omitted
    };
    stub.setBundleResponse(malformed);

    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });

    const stats = await getRegistryStats();
    expect(stats.verifyFailures).toBe(1);
  });

  it('verify failure poisons SW lifetime: a second loadRegistryOnce call is a no-op (loadPromise reused)', async () => {
    // After an initial verify failure, loadRegistryOnce returns the cached
    // (rejected) load promise. The second call MUST NOT re-fetch, so even
    // if a clean bundle becomes available later, registry stays MISS for
    // the SW lifetime. This is the fail-safe contract from RFC §Q5.
    const stub = setupChrome();
    const tampered: SignedRegistryBundle = {
      ...cleanBundle,
      signature: flipFirstHexByte(cleanBundle.signature),
    };
    stub.setBundleResponse(tampered);

    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });
    // Now swap to a clean bundle response — but the second loadRegistryOnce
    // must NOT re-fetch, per the cached-promise contract in lookup.ts:31.
    stub.setBundleResponse(cleanBundle);
    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });

    expect(stub.fetchMock).toHaveBeenCalledTimes(1);

    const result = await lookupRegistry('acme.test', SAMPLE_HTML);
    expect(result.matched).toBe(false);
  });

  it('storage.local.set throws during telemetry write → SW hot path stays safe (lookup still resolves)', async () => {
    // SR-G drift carry-forward (f): all telemetry calls in lookup.ts wrap
    // .catch(() => {}). Belt-and-suspenders alongside writeTelemetry's
    // internal swallow. SR-H asserts the contract: an injected throw on
    // chrome.storage.local.set must NOT propagate out of lookupRegistry.
    const stub = setupChrome();
    stub.setBundleResponse(cleanBundle);
    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });
    stub.setStorageBehaviour({ setThrows: true });

    const result = await lookupRegistry('acme.test', SAMPLE_HTML);
    expect(result.matched).toBe(true);
    expect([...result.zoneIds].sort()).toEqual(
      [...sampleEntry.zones.map((z) => z.zoneId)].sort(),
    );
  });

  it('storage.local.get throws during telemetry read → SW hot path stays safe (lookup still resolves)', async () => {
    const stub = setupChrome();
    stub.setBundleResponse(cleanBundle);
    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });
    stub.setStorageBehaviour({ getThrows: true });

    const result = await lookupRegistry('acme.test', SAMPLE_HTML);
    expect(result.matched).toBe(true);
  });

  it('storage failure on miss path also stays safe (lookup returns matched=false without throwing)', async () => {
    const stub = setupChrome();
    stub.setBundleResponse(cleanBundle);
    await loadRegistryOnce({ trustedPublicKeyHex: signerPubHex });
    stub.setStorageBehaviour({ setThrows: true });

    const result = await lookupRegistry('different.test', SAMPLE_HTML);
    expect(result.matched).toBe(false);
  });
});

function flipFirstHexByte(hex: string): string {
  const head = hex.slice(0, 2);
  const flipped = (parseInt(head, 16) ^ 0xff).toString(16).padStart(2, '0');
  return flipped + hex.slice(2);
}
