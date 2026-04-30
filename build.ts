import { build } from 'vite';
import { resolve } from 'path';
import { existsSync, rmSync } from 'fs';

import { BUILD_ASSETS, copyBuildAssets } from './scripts/build-assets.js';

// Issue #156 — @huggingface/transformers ships a prebuilt minified browser
// ESM bundle at `dist/transformers.web.min.js` (~432 KB). We mark the
// package as `external` for Vite's offscreen entry so Rollup does not
// re-bundle it into a multi-megabyte chunk; instead the prebuilt bundle is
// copied verbatim into `dist/transformers/` (see BUILD_ASSETS) and loaded
// at runtime via `chrome.runtime.getURL` (see
// src/offscreen/transformers-runtime.ts).
const TRANSFORMERS_EXTERNAL = ['@huggingface/transformers'];

const __dirname = resolve('.');

interface BuildEntry {
  readonly name: string;
  readonly input: string;
  readonly format: 'es' | 'iife';
  // Issue #156 — entries that import `@huggingface/transformers` mark the
  // package external so Rollup leaves the runtime `import()` call intact.
  // The transformers-runtime singleton rewrites the import URL to a
  // `chrome.runtime.getURL('dist/transformers/transformers.web.min.js')`
  // path at runtime.
  readonly external?: readonly string[];
}

const entries: readonly BuildEntry[] = [
  { name: 'service-worker/index', input: 'src/service-worker/index.ts', format: 'es' },
  { name: 'content/index', input: 'src/content/index.ts', format: 'iife' },
  { name: 'content/main-world-inject', input: 'src/content/main-world-inject.ts', format: 'iife' },
  // Issue #126 (N7a) — chat-portal observer content script. Loaded only on
  // chatgpt.com / chat.openai.com / claude.ai / gemini.google.com per the
  // manifest content_scripts entry; coexists with the <all_urls> page-scan
  // content script.
  { name: 'content/portals/index', input: 'src/content/portals/index.ts', format: 'iife' },
  { name: 'offscreen/index', input: 'src/offscreen/index.ts', format: 'es', external: TRANSFORMERS_EXTERNAL },
  { name: 'popup/popup', input: 'src/popup/popup.ts', format: 'iife' },
  // Phase 3 Track A Path 2 — test-only harness page for Chrome built-in
  // Prompt API (Gemini Nano). Not referenced from manifest.json; opened by
  // the Stage 5 Playwright runner via chrome.tabs.create from the SW.
  { name: 'tests/phase3/builtin-harness', input: 'src/tests/phase3/builtin-harness.ts', format: 'iife' },
];

async function main() {
  if (existsSync('dist')) rmSync('dist', { recursive: true });

  for (const entry of entries) {
    console.log(`Building ${entry.name} (${entry.format})...`);
    await build({
      configFile: false,
      build: {
        outDir: 'dist',
        emptyOutDir: false,
        target: 'esnext',
        lib: {
          entry: resolve(__dirname, entry.input),
          formats: [entry.format],
          fileName: () => `${entry.name}.js`,
          name: entry.format === 'iife' ? entry.name.replace(/[/-]/g, '_') : undefined,
        },
        rollupOptions: {
          external: entry.external !== undefined ? [...entry.external] : undefined,
          output: {
            inlineDynamicImports: true,
          },
        },
        sourcemap: false,
        minify: true,
      },
      resolve: {
        alias: {
          '@': resolve(__dirname, 'src'),
        },
      },
      logLevel: 'warn',
    });
  }

  copyBuildAssets(BUILD_ASSETS, {
    projectRoot: __dirname,
    onSkip: (src) => {
      console.warn(
        `[build] asset missing, skipping copy: ${src} (this is expected for registry/signed-registry.json before SR-E maintainer signing has produced the first bundle)`,
      );
    },
  });

  console.log('Build complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
