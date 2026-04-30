// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as ed from '@noble/ed25519';

import { signRegistry, signRegistryFromDir } from '../sign-registry.js';
import { bytesToHex } from '@/registry/canonical-bundle.js';
import { verifyRegistry } from '@/registry/verify.js';
import type { RegistryEntry } from '@/types/registry.js';

const FP_ZERO = '0'.repeat(64);

const makeEntry = (origin: string, capturedAt = 1_700_000_000_000): RegistryEntry => ({
  origin,
  capturedAt,
  schemaVersion: 1,
  zones: [
    {
      zoneId: 'header#0',
      selector: 'header',
      fingerprint: { structural: FP_ZERO, tokens: FP_ZERO },
    },
  ],
  excludedSelectors: [],
});

let privHex: string;
let pubHex: string;

beforeAll(async () => {
  const priv = ed.utils.randomPrivateKey();
  privHex = bytesToHex(priv);
  pubHex = bytesToHex(await ed.getPublicKeyAsync(priv));
});

describe('signRegistry', () => {
  it('produces a v1 bundle whose round-trip verifies under the matching public key', async () => {
    const entries = [makeEntry('foo.test'), makeEntry('bar.test')];

    const bundle = await signRegistry({
      entries,
      privateKeyHex: privHex,
      now: () => 1_700_000_000_999,
    });

    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.publicKeyHex).toBe(pubHex);
    expect(bundle.signedAt).toBe(1_700_000_000_999);
    expect(bundle.signature).toMatch(/^[0-9a-f]{128}$/);

    const ok = await verifyRegistry(bundle, { publicKeyHex: pubHex });
    expect(ok).toBe(true);
  });

  it('sorts entries by origin before signing (independent of input order)', async () => {
    const inOrder = [makeEntry('zzz.test'), makeEntry('aaa.test'), makeEntry('mmm.test')];

    const bundle = await signRegistry({
      entries: inOrder,
      privateKeyHex: privHex,
      now: () => 1_700_000_000_999,
    });

    expect(bundle.entries.map((e) => e.origin)).toEqual([
      'aaa.test',
      'mmm.test',
      'zzz.test',
    ]);

    const ok = await verifyRegistry(bundle, { publicKeyHex: pubHex });
    expect(ok).toBe(true);
  });

  it('is deterministic — identical inputs produce byte-identical bundles', async () => {
    const entries = [makeEntry('foo.test')];

    const a = await signRegistry({
      entries,
      privateKeyHex: privHex,
      now: () => 1_700_000_000_999,
    });
    const b = await signRegistry({
      entries,
      privateKeyHex: privHex,
      now: () => 1_700_000_000_999,
    });

    expect(b.signature).toBe(a.signature);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('rejects an empty entries array (refuses to sign nothing)', async () => {
    await expect(
      signRegistry({
        entries: [],
        privateKeyHex: privHex,
        now: () => 1_700_000_000_999,
      }),
    ).rejects.toThrow(/empty/i);
  });

  it('throws on malformed private-key hex', async () => {
    await expect(
      signRegistry({
        entries: [makeEntry('foo.test')],
        privateKeyHex: 'not-hex',
        now: () => 1_700_000_000_999,
      }),
    ).rejects.toThrow();
  });
});

describe('signRegistryFromDir', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'sign-registry-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('reads RegistryEntry JSONs from a dir, signs them, and writes a verifying bundle to outputPath', async () => {
    const e1 = makeEntry('alpha.test');
    const e2 = makeEntry('beta.test');
    await writeFile(join(tmp, 'alpha.test.json'), JSON.stringify(e1, null, 2), 'utf8');
    await writeFile(join(tmp, 'beta.test.json'), JSON.stringify(e2, null, 2), 'utf8');
    await writeFile(
      join(tmp, 'manifest.json'),
      JSON.stringify([{ origin: 'alpha.test', url: 'x', frameSelectors: [], excludedSelectors: [] }]),
      'utf8',
    );

    const outPath = join(tmp, 'signed-registry.json');
    const bundle = await signRegistryFromDir({
      inputDir: tmp,
      outputPath: outPath,
      privateKeyHex: privHex,
      now: () => 1_700_000_000_999,
    });

    const written = await readFile(outPath, 'utf8');
    const parsed = JSON.parse(written);
    expect(parsed.signature).toBe(bundle.signature);
    expect(parsed.entries.map((e: { origin: string }) => e.origin)).toEqual([
      'alpha.test',
      'beta.test',
    ]);

    const ok = await verifyRegistry(parsed, { publicKeyHex: pubHex });
    expect(ok).toBe(true);
  });

  it('skips manifest.json and non-JSON files', async () => {
    await writeFile(join(tmp, 'alpha.test.json'), JSON.stringify(makeEntry('alpha.test')), 'utf8');
    await writeFile(join(tmp, 'manifest.json'), '[]', 'utf8');
    await writeFile(join(tmp, 'README.md'), 'not a registry entry', 'utf8');

    const outPath = join(tmp, 'signed-registry.json');
    const bundle = await signRegistryFromDir({
      inputDir: tmp,
      outputPath: outPath,
      privateKeyHex: privHex,
      now: () => 1_700_000_000_999,
    });

    expect(bundle.entries).toHaveLength(1);
    expect(bundle.entries[0].origin).toBe('alpha.test');
  });
});
