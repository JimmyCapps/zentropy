// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import * as ed from '@noble/ed25519';

import {
  BUILD_ASSETS,
  RELEASE_REQUIRED_SOURCES,
  copyBuildAssets,
  patchTransformersBundle,
} from '../build-assets.js';
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

describe('SR-H committed bundle ↔ embedded trust root', () => {
  // Strong regression-safety assertion: the v1.0-pre signed bundle MUST
  // verify against `REGISTRY_PUBLIC_KEY_HEX` in `src/registry/keys.ts`. If
  // a maintainer rotates keys.ts but forgets to re-sign (or vice versa),
  // the SW would silently MISS the registry on every page load. This test
  // fires before the silence ever reaches production.
  it('registry/signed-registry.json verifies under the embedded REGISTRY_PUBLIC_KEY_HEX', async () => {
    const bundlePath = resolve(REPO_ROOT, 'registry/signed-registry.json');
    const raw = await readFile(bundlePath, 'utf8');
    const bundle = JSON.parse(raw);
    expect(await verifyRegistry(bundle)).toBe(true);
  });

  it('the committed bundle covers every JSON in registry/sites/ (fail-loud if a site was added without re-signing)', async () => {
    const bundlePath = resolve(REPO_ROOT, 'registry/signed-registry.json');
    const sitesDir = resolve(REPO_ROOT, 'registry/sites');
    const bundle = JSON.parse(await readFile(bundlePath, 'utf8'));
    const committedJsons = (await readdir(sitesDir)).filter(
      (n) => n.endsWith('.json') && n !== 'manifest.json',
    );
    expect(bundle.entries.length).toBe(committedJsons.length);
  });
});

describe('SR-H release-mode hard-gate', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'sr-h-release-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('declares `registry/signed-registry.json` as a release-required source', () => {
    expect(RELEASE_REQUIRED_SOURCES).toContain('registry/signed-registry.json');
  });

  it('release mode + missing registry source → throws (production builds must ship the signed bundle)', () => {
    const onSkip = vi.fn();
    expect(() =>
      copyBuildAssets(
        [['registry/signed-registry.json', 'dist/registry/signed-registry.json']],
        { projectRoot: tmp, releaseMode: true, onSkip },
      ),
    ).toThrow(/release mode.*registry\/signed-registry\.json/i);
    expect(onSkip).not.toHaveBeenCalled();
  });

  it('release mode + present registry source → copies and does not throw', async () => {
    await mkdir(join(tmp, 'registry'), { recursive: true });
    await writeFile(join(tmp, 'registry/signed-registry.json'), '{"schemaVersion":1}', 'utf8');

    expect(() =>
      copyBuildAssets(
        [['registry/signed-registry.json', 'dist/registry/signed-registry.json']],
        { projectRoot: tmp, releaseMode: true },
      ),
    ).not.toThrow();
    const written = await readFile(join(tmp, 'dist/registry/signed-registry.json'), 'utf8');
    expect(written).toBe('{"schemaVersion":1}');
  });

  it('release mode + missing non-required source → still skips (only release-required sources are gated)', () => {
    const onSkip = vi.fn();
    expect(() =>
      copyBuildAssets(
        [['some/other/asset.txt', 'dist/some/other/asset.txt']],
        { projectRoot: tmp, releaseMode: true, onSkip },
      ),
    ).not.toThrow();
    expect(onSkip).toHaveBeenCalledWith('some/other/asset.txt');
  });

  it('default (releaseMode=false) + missing registry source → still skips (preserves SR-E ramp-up behaviour)', () => {
    const onSkip = vi.fn();
    expect(() =>
      copyBuildAssets(
        [['registry/signed-registry.json', 'dist/registry/signed-registry.json']],
        { projectRoot: tmp, onSkip },
      ),
    ).not.toThrow();
    expect(onSkip).toHaveBeenCalledWith('registry/signed-registry.json');
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

// Issue #209 — verify the bundle-patch helper rewrites the bare specifier
// exactly once and refuses to silently mutate a bundle whose shape changed.
describe('patchTransformersBundle', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'issue-209-bundle-patch-'));
    await mkdir(join(tmp, 'dist', 'transformers'), { recursive: true });
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  const BUNDLE_REL = 'dist/transformers/transformers.web.min.js';

  it('rewrites the webgpu bare specifier to a relative URL', async () => {
    const before = `prefix;import*as cA from"onnxruntime-web/webgpu";async function B(){}`;
    await writeFile(join(tmp, BUNDLE_REL), before);

    const patched = patchTransformersBundle(tmp);

    expect(patched).toBe(true);
    const after = await readFile(join(tmp, BUNDLE_REL), 'utf-8');
    expect(after).toContain('"./onnxruntime-web/webgpu.mjs"');
    expect(after).not.toContain('"onnxruntime-web/webgpu"');
  });

  it('also rewrites the onnxruntime-common bare specifier to the same webgpu bundle (Tensor re-export)', async () => {
    const before = `prefix;import{Tensor as Q0}from"onnxruntime-common";suffix`;
    await writeFile(join(tmp, BUNDLE_REL), before);

    const patched = patchTransformersBundle(tmp);

    expect(patched).toBe(true);
    const after = await readFile(join(tmp, BUNDLE_REL), 'utf-8');
    expect(after).toContain('"./onnxruntime-web/webgpu.mjs"');
    expect(after).not.toContain('"onnxruntime-common"');
  });

  it('rewrites both bare specifiers in a single pass when both are present', async () => {
    const before = `prefix;import*as cA from"onnxruntime-web/webgpu";middle;import{Tensor as Q0}from"onnxruntime-common";suffix`;
    await writeFile(join(tmp, BUNDLE_REL), before);

    const patched = patchTransformersBundle(tmp);

    expect(patched).toBe(true);
    const after = await readFile(join(tmp, BUNDLE_REL), 'utf-8');
    expect(after).not.toContain('"onnxruntime-web/webgpu"');
    expect(after).not.toContain('"onnxruntime-common"');
    // Both imports now point at the webgpu bundle (browsers dedupe module loads).
    expect(after.split('"./onnxruntime-web/webgpu.mjs"').length - 1).toBe(2);
  });

  it('returns false (no-op) when the bundle is missing', () => {
    expect(patchTransformersBundle(tmp)).toBe(false);
  });

  it('returns false (no-op) when the bare specifier is absent (already-patched bundle)', async () => {
    const alreadyPatched = `prefix;import*as cA from"./onnxruntime-web/webgpu.mjs";async function B(){}`;
    await writeFile(join(tmp, BUNDLE_REL), alreadyPatched);

    const patched = patchTransformersBundle(tmp);

    expect(patched).toBe(false);
    const after = await readFile(join(tmp, BUNDLE_REL), 'utf-8');
    expect(after).toBe(alreadyPatched);
  });

  it('throws when the bare specifier appears more than once (bundle shape changed)', async () => {
    const ambiguous = `import"onnxruntime-web/webgpu";import"onnxruntime-web/webgpu";`;
    await writeFile(join(tmp, BUNDLE_REL), ambiguous);

    expect(() => patchTransformersBundle(tmp)).toThrow(
      /expected at most 1 occurrence/,
    );
  });

  it('preserves the rest of the bundle byte-for-byte', async () => {
    const lhs = 'a'.repeat(1000);
    const rhs = 'b'.repeat(1000);
    const before = `${lhs}"onnxruntime-web/webgpu"${rhs}`;
    await writeFile(join(tmp, BUNDLE_REL), before);

    patchTransformersBundle(tmp);

    const after = await readFile(join(tmp, BUNDLE_REL), 'utf-8');
    expect(after.startsWith(lhs)).toBe(true);
    expect(after.endsWith(rhs)).toBe(true);
    expect(after.length).toBe(before.length + ('"./onnxruntime-web/webgpu.mjs"'.length - '"onnxruntime-web/webgpu"'.length));
  });
});
