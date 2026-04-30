// Pure asset-copy helpers + manifest used by build.ts. Lives in scripts/ so
// tests can import without pulling in Vite's loader chain (which would drag
// esbuild into the jsdom test environment and fail to initialise).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
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
  ['registry/signed-registry.json', 'dist/registry/signed-registry.json'],
];

export interface CopyBuildAssetsOptions {
  readonly projectRoot?: string;
  readonly onSkip?: (src: string) => void;
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
      // SR-E ramp-up: `registry/signed-registry.json` may not exist on the
      // first build after merging this PR (the maintainer signs locally or
      // the registry-crawl Action signs in CI; both produce the file as a
      // follow-up commit). Skip-with-warning instead of failing so the
      // wider build pipeline stays green during the rollout. SR-H gates
      // this hard at production-release time.
      opts.onSkip?.(src);
      continue;
    }
    const destDir = dirname(absDest);
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
    copyFileSync(absSrc, absDest);
  }
}
