// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import * as ed from '@noble/ed25519';

import { verifyRegistry } from '../verify.js';
import { signRegistry } from '../sign.js';
import {
  bytesToHex,
  type SignedRegistryBundle,
} from '../canonical-bundle.js';
import { REGISTRY_PUBLIC_KEY_HEX } from '../keys.js';
import type { RegistryEntry } from '@/types/registry.js';

const FP_ZERO = '0'.repeat(64);

const sampleEntries: readonly RegistryEntry[] = [
  {
    origin: 'foo.test',
    capturedAt: 1_700_000_000_000,
    schemaVersion: 1,
    zones: [
      {
        zoneId: 'header#0',
        selector: 'header',
        fingerprint: { structural: FP_ZERO, tokens: FP_ZERO },
      },
    ],
    excludedSelectors: [],
  },
  {
    origin: 'bar.test',
    capturedAt: 1_700_000_000_000,
    schemaVersion: 1,
    zones: [
      {
        zoneId: 'footer#0',
        selector: 'footer',
        fingerprint: { structural: FP_ZERO, tokens: FP_ZERO },
      },
    ],
    excludedSelectors: [],
  },
];

let pubAHex: string;
let privAHex: string;
let pubBHex: string;

beforeAll(async () => {
  const privA = ed.utils.randomPrivateKey();
  privAHex = bytesToHex(privA);
  pubAHex = bytesToHex(await ed.getPublicKeyAsync(privA));

  const privB = ed.utils.randomPrivateKey();
  pubBHex = bytesToHex(await ed.getPublicKeyAsync(privB));
});

describe('verifyRegistry', () => {
  it('returns true for a freshly-signed bundle when given the matching public key', async () => {
    const bundle = await signRegistry({
      entries: sampleEntries,
      privateKeyHex: privAHex,
      now: () => 1_700_000_000_999,
    });

    const ok = await verifyRegistry(bundle, { publicKeyHex: pubAHex });

    expect(ok).toBe(true);
    expect(bundle.publicKeyHex).toBe(pubAHex);
    expect(bundle.signature).toMatch(/^[0-9a-f]{128}$/);
  });

  it('returns false when one byte of the signature is mutated', async () => {
    const bundle = await signRegistry({
      entries: sampleEntries,
      privateKeyHex: privAHex,
      now: () => 1_700_000_000_999,
    });

    const flippedNibble = bundle.signature[0] === '0' ? '1' : '0';
    const tampered: SignedRegistryBundle = {
      ...bundle,
      signature: flippedNibble + bundle.signature.slice(1),
    };

    const ok = await verifyRegistry(tampered, { publicKeyHex: pubAHex });

    expect(ok).toBe(false);
  });

  it('returns false when one byte of the payload is mutated (matching origin / different content)', async () => {
    const bundle = await signRegistry({
      entries: sampleEntries,
      privateKeyHex: privAHex,
      now: () => 1_700_000_000_999,
    });

    const tampered: SignedRegistryBundle = {
      ...bundle,
      entries: bundle.entries.map((e, i) =>
        i === 0 ? { ...e, origin: 'foo.evil' } : e,
      ),
    };

    const ok = await verifyRegistry(tampered, { publicKeyHex: pubAHex });

    expect(ok).toBe(false);
  });

  it('returns false when the bundle was signed by a different key (wrong public key in trust root)', async () => {
    const bundle = await signRegistry({
      entries: sampleEntries,
      privateKeyHex: privAHex,
      now: () => 1_700_000_000_999,
    });

    const ok = await verifyRegistry(bundle, { publicKeyHex: pubBHex });

    expect(ok).toBe(false);
  });

  it('returns false when bundle.publicKeyHex is rewritten away from the trust root', async () => {
    const bundle = await signRegistry({
      entries: sampleEntries,
      privateKeyHex: privAHex,
      now: () => 1_700_000_000_999,
    });

    const tampered: SignedRegistryBundle = { ...bundle, publicKeyHex: pubBHex };

    const ok = await verifyRegistry(tampered, { publicKeyHex: pubAHex });

    expect(ok).toBe(false);
  });

  it('uses REGISTRY_PUBLIC_KEY_HEX as the default trust root and rejects bundles signed by other keys', async () => {
    const bundle = await signRegistry({
      entries: sampleEntries,
      privateKeyHex: privAHex,
      now: () => 1_700_000_000_999,
    });

    const ok = await verifyRegistry(bundle);

    expect(REGISTRY_PUBLIC_KEY_HEX).toMatch(/^[0-9a-f]{64}$/);
    expect(REGISTRY_PUBLIC_KEY_HEX).not.toBe(pubAHex);
    expect(ok).toBe(false);
  });

  it('returns false (not throws) for malformed bundles', async () => {
    await expect(verifyRegistry(null, { publicKeyHex: pubAHex })).resolves.toBe(false);
    await expect(verifyRegistry(undefined, { publicKeyHex: pubAHex })).resolves.toBe(false);
    await expect(verifyRegistry({}, { publicKeyHex: pubAHex })).resolves.toBe(false);
    await expect(
      verifyRegistry(
        {
          schemaVersion: 1,
          publicKeyHex: pubAHex,
          signedAt: 0,
          entries: [],
          signature: 'not-hex',
        },
        { publicKeyHex: pubAHex },
      ),
    ).resolves.toBe(false);
    await expect(
      verifyRegistry(
        {
          schemaVersion: 1,
          publicKeyHex: pubAHex,
          signedAt: 0,
          entries: [],
          signature: '00',
        },
        { publicKeyHex: pubAHex },
      ),
    ).resolves.toBe(false);
  });
});
