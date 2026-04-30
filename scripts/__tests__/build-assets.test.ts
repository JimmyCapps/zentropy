// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import * as ed from '@noble/ed25519';

import { BUILD_ASSETS, copyBuildAssets } from '../build-assets.js';
import { signRegistryFromDir } from '../sign-registry.js';
import { bytesToHex } from '@/registry/canonical-bundle.js';
import { verifyRegistry } from '@/registry/verify.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

describe('BUILD_ASSETS', () => {
  it('declares the signed registry bundle as a copy target into dist/', () => {
    const pair = BUILD_ASSETS.find(([src]) => src === 'registry/signed-registry.json');
    expect(pair).toBeDefined();
    expect(pair?.[1]).toBe('dist/registry/signed-registry.json');
  });
});

describe('copyBuildAssets', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'sr-e-build-assets-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('copies present sources to their destinations under the project root', async () => {
    const srcRel = 'tmp-fixture/source.txt';
    const destRel = 'tmp-fixture/dest.txt';
    await mkdir(join(tmp, 'tmp-fixture'), { recursive: true });
    await writeFile(join(tmp, srcRel), 'hello', 'utf8');

    copyBuildAssets([[srcRel, destRel]], { projectRoot: tmp });

    const written = await readFile(join(tmp, destRel), 'utf8');
    expect(written).toBe('hello');
  });

  it('skips (does not throw) when a source asset is missing — required for SR-E ramp-up', () => {
    // signed-registry.json may not be committed yet during the SR-E rollout
    // window; the build must remain green so unrelated work is not blocked.
    expect(() =>
      copyBuildAssets([['missing/file.txt', 'dist/missing/file.txt']], { projectRoot: tmp }),
    ).not.toThrow();
    expect(existsSync(join(tmp, 'dist/missing/file.txt'))).toBe(false);
  });
});

// Real-input round-trip: signing the currently-committed registry/sites/ with
// a fresh keypair must produce a verifying SignedRegistryBundle. This is the
// SR-E "smaller scripts-side test" alternative to a full build-output assertion
// (the latter would require the v1 maintainer private key in the test env,
// which intentionally never enters the repo or test fixtures).
describe('signRegistryFromDir against committed registry/sites/', () => {
  let privHex: string;
  let pubHex: string;
  let outDir: string;

  beforeAll(async () => {
    const priv = ed.utils.randomPrivateKey();
    privHex = bytesToHex(priv);
    pubHex = bytesToHex(await ed.getPublicKeyAsync(priv));
  });
  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'sr-e-sign-real-'));
  });
  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it('signs every committed RegistryEntry JSON and the bundle verifies', async () => {
    const sitesDir = join(REPO_ROOT, 'registry/sites');
    const committedJsons = (await readdir(sitesDir)).filter(
      (n) => n.endsWith('.json') && n !== 'manifest.json',
    );
    expect(committedJsons.length).toBeGreaterThan(0);

    const outPath = join(outDir, 'signed-registry.json');
    const bundle = await signRegistryFromDir({
      inputDir: sitesDir,
      outputPath: outPath,
      privateKeyHex: privHex,
      now: () => 1_700_000_000_999,
    });

    expect(bundle.entries.length).toBe(committedJsons.length);
    expect(bundle.publicKeyHex).toBe(pubHex);

    const written = JSON.parse(await readFile(outPath, 'utf8'));
    expect(await verifyRegistry(written, { publicKeyHex: pubHex })).toBe(true);

    // Entries must be sorted by origin (deterministic — see SR-D drift
    // choice (e)). Future SR-E maintainer / CI signing reuses this contract.
    const sorted = [...bundle.entries.map((e) => e.origin)].sort();
    expect(bundle.entries.map((e) => e.origin)).toEqual(sorted);
  });
});
