// Pure asset-copy helpers + manifest used by build.ts. Lives in scripts/ so
// tests can import without pulling in Vite's loader chain (which would drag
// esbuild into the jsdom test environment and fail to initialise).
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type AssetPair = readonly [src: string, dest: string];

// SR-D / SR-E (registry-#51) — `registry/signed-registry.json` is the
// SignedRegistryBundle produced by `scripts/sign-registry.ts` (locally by
// the maintainer, or by the registry-crawl GH Action with the
// HONEYLLM_REGISTRY_SIGNING_KEY secret). It is copied verbatim into
// `dist/registry/signed-registry.json` so the SW can `chrome.runtime.getURL`
// + fetch + verifyRegistry on startup. Copying (not Vite-importing) keeps
// the bundle outside the SW JS chunk so future SR-F/SR-G changes don't need
// a rebuild to swap registries.
//
// Issue #156 — `@huggingface/transformers` ships a prebuilt minified browser
// ESM bundle copied verbatim and loaded via `chrome.runtime.getURL` from
// `src/offscreen/transformers-runtime.ts`.
export const BUILD_ASSETS: readonly AssetPair[] = [
  ['src/offscreen/offscreen.html', 'dist/offscreen/offscreen.html'],
  ['src/popup/popup.html', 'dist/popup/popup.html'],
  ['src/tests/phase3/builtin-harness.html', 'dist/tests/phase3/builtin-harness.html'],
  [
    'node_modules/@huggingface/transformers/dist/transformers.web.min.js',
    'dist/transformers/transformers.web.min.js',
  ],
  [
    'node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs',
    'dist/transformers/ort-wasm-simd-threaded.jsep.mjs',
  ],
  // Issue #209 — `transformers.web.min.js` contains an unconditional static
  // `import * as cA from "onnxruntime-web/webgpu"` that fires at module
  // evaluation time regardless of `device: 'wasm'`. Browsers can only
  // resolve bare specifiers via an import map; `offscreen.html` declares
  // one mapping `onnxruntime-web/webgpu` to the asset copied here.
  [
    'node_modules/onnxruntime-web/dist/ort.webgpu.bundle.min.mjs',
    'dist/transformers/onnxruntime-web/webgpu.mjs',
  ],
  // Issue #209 — Chrome (non-Safari) ORT wasm path defaults to the asyncify
  // variant; ship both the JS factory and the WASM binary same-origin so
  // `env.backends.onnx.wasm.wasmPaths` (set in transformers-runtime.ts) can
  // resolve them under MV3 `script-src 'self'` without a CDN fetch.
  [
    'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs',
    'dist/transformers/onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs',
  ],
  [
    'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm',
    'dist/transformers/onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm',
  ],
  ['registry/signed-registry.json', 'dist/registry/signed-registry.json'],
  // Issue #129 Stage 3 — multilingual injection corpus with 384-dim
  // L2-normalised embeddings (schema v2). Copied verbatim into the dist
  // bundle so Stage 4's SW startup can `chrome.runtime.getURL` + fetch it
  // on demand. Loader (`src/hunters/embeddings/corpus-loader.ts`) is
  // fail-safe: a missing or malformed bundle reduces to an empty index +
  // no-op hunter, preserving the Phase 2 byte-locked baseline.
  ['data/injection-corpus.json', 'dist/data/injection-corpus.json'],
];

// SR-H — sources whose absence aborts the build under `releaseMode: true`.
// The signed registry bundle is the trust root that production users rely
// on; shipping a release without it would silently disable the §Q5
// fail-safe in the field. Other assets (HTML shells, prebuilt vendor
// bundles) keep skip-with-warning semantics because their absence is loud
// at runtime — only the registry pair is silently security-relevant.
export const RELEASE_REQUIRED_SOURCES: readonly string[] = [
  'registry/signed-registry.json',
];

export interface CopyBuildAssetsOptions {
  readonly projectRoot?: string;
  readonly onSkip?: (src: string) => void;
  readonly releaseMode?: boolean;
}

// Issue #209 — `transformers.web.min.js` contains TWO unconditional static
// imports with bare specifiers: `import * as cA from "onnxruntime-web/webgpu"`
// (the webgpu backend module) and `import { Tensor as Q0 } from
// "onnxruntime-common"` (the Tensor class). Bare specifiers cannot be
// resolved by browser ES module loaders without an import map, and Chrome
// MV3's `script-src 'self' 'wasm-unsafe-eval'` rejects inline import maps
// while external import maps are not yet implemented in any browser
// (WICG/import-maps#235, archived 2025-02-26). Patch the bundle in place
// after copy: rewrite each bare specifier to a relative URL pointing at the
// onnxruntime-web webgpu bundle we already copy alongside it. The webgpu
// bundle re-exports `Tensor`, so both imports can resolve to the same file
// (browsers dedupe module loads — no second asset required). This is the
// standard MV3 + transformers.js workaround used by other extensions that
// don't go through a webpack/Vite bundle re-pass.
const TRANSFORMERS_BUNDLE_DEST = 'dist/transformers/transformers.web.min.js';
const ONNX_BARE_SPECIFIER_REWRITES: ReadonlyArray<readonly [from: string, to: string]> = [
  ['"onnxruntime-web/webgpu"', '"./onnxruntime-web/webgpu.mjs"'],
  ['"onnxruntime-common"', '"./onnxruntime-web/webgpu.mjs"'],
];

export function patchTransformersBundle(projectRoot: string): boolean {
  const path = resolve(projectRoot, TRANSFORMERS_BUNDLE_DEST);
  if (!existsSync(path)) return false;
  const before = readFileSync(path, 'utf-8');
  let after = before;
  let didReplace = false;
  for (const [fromSpec, toSpec] of ONNX_BARE_SPECIFIER_REWRITES) {
    const occurrences = after.split(fromSpec).length - 1;
    if (occurrences === 0) continue;
    if (occurrences > 1) {
      throw new Error(
        `patchTransformersBundle: expected at most 1 occurrence of ${fromSpec} in ${TRANSFORMERS_BUNDLE_DEST}, found ${occurrences} — bundle shape changed; review the patch before continuing`,
      );
    }
    after = after.replace(fromSpec, toSpec);
    didReplace = true;
  }
  if (!didReplace) return false;
  writeFileSync(path, after);
  return true;
}

export function copyBuildAssets(
  assets: readonly AssetPair[],
  opts: CopyBuildAssetsOptions = {},
): void {
  const root = opts.projectRoot ?? resolve('.');
  for (const [src, dest] of assets) {
    const absSrc = resolve(root, src);
    const absDest = resolve(root, dest);
    if (!existsSync(absSrc)) {
      if (opts.releaseMode === true && RELEASE_REQUIRED_SOURCES.includes(src)) {
        // SR-H production-release gate: a missing release-required source
        // is a hard error. Closes the SR-E ramp-up window for production
        // builds — the registry must be signed before tagging a release.
        throw new Error(
          `copyBuildAssets: required asset missing in release mode: ${src} (run \`npm run sign:registry\` with the maintainer private key, or trigger the registry-crawl workflow with HONEYLLM_REGISTRY_SIGNING_KEY set)`,
        );
      }
      // SR-E ramp-up: `registry/signed-registry.json` may not exist on the
      // first build after merging this PR (the maintainer signs locally or
      // the registry-crawl Action signs in CI; both produce the file as a
      // follow-up commit). Skip-with-warning instead of failing so the
      // wider build pipeline stays green during the rollout. SR-H gates
      // this hard at production-release time via `releaseMode: true`.
      opts.onSkip?.(src);
      continue;
    }
    const destDir = dirname(absDest);
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
    copyFileSync(absSrc, absDest);
  }
}
