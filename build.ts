import { build } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync, rmSync } from 'fs';

// Issue #156 — @huggingface/transformers ships a prebuilt minified browser
// ESM bundle at `dist/transformers.web.min.js` (~432 KB). We mark the
// package as `external` for Vite's offscreen entry so Rollup does not
// re-bundle it into a multi-megabyte chunk; instead the prebuilt bundle is
// copied verbatim into `dist/transformers/` and loaded at runtime via
// `chrome.runtime.getURL` (see src/offscreen/transformers-runtime.ts).
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
  // path at runtime, where the prebuilt minified browser bundle is served
  // from. Keeps the offscreen entry small (~6 MB) and the bundle delta
  // bounded (~432 KB for the prebuilt bundle, copied below).
  readonly external?: readonly string[];
}

const entries: readonly BuildEntry[] = [
  { name: 'service-worker/index', input: 'src/service-worker/index.ts', format: 'es' },
  { name: 'content/index', input: 'src/content/index.ts', format: 'iife' },
  { name: 'content/main-world-inject', input: 'src/content/main-world-inject.ts', format: 'iife' },
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

  const assets: [string, string][] = [
    ['src/offscreen/offscreen.html', 'dist/offscreen/offscreen.html'],
    ['src/popup/popup.html', 'dist/popup/popup.html'],
    ['src/tests/phase3/builtin-harness.html', 'dist/tests/phase3/builtin-harness.html'],
    // Issue #156 — prebuilt minified browser bundle of @huggingface/transformers
    // (~432 KB). Loaded via `chrome.runtime.getURL` from the offscreen doc; the
    // adjacent `.mjs` file is the JSEP loader companion that ONNX Runtime
    // imports lazily. WASM kernels and the actual NER model are NOT shipped —
    // they lazy-fetch from the HF/jsdelivr CDN at first use and cache via
    // the Cache API.
    [
      'node_modules/@huggingface/transformers/dist/transformers.web.min.js',
      'dist/transformers/transformers.web.min.js',
    ],
    [
      'node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs',
      'dist/transformers/ort-wasm-simd-threaded.jsep.mjs',
    ],
  ];
  for (const [src, dest] of assets) {
    const destDir = resolve(__dirname, dest, '..');
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
    copyFileSync(resolve(__dirname, src), resolve(__dirname, dest));
  }

  console.log('Build complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
