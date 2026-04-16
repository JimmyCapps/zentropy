import { build } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync, rmSync } from 'fs';

const __dirname = resolve('.');

const entries = [
  { name: 'service-worker/index', input: 'src/service-worker/index.ts', format: 'es' as const },
  { name: 'content/index', input: 'src/content/index.ts', format: 'iife' as const },
  { name: 'content/main-world-inject', input: 'src/content/main-world-inject.ts', format: 'iife' as const },
  { name: 'offscreen/index', input: 'src/offscreen/index.ts', format: 'es' as const },
  { name: 'popup/popup', input: 'src/popup/popup.ts', format: 'iife' as const },
  // Phase 3 Track A Path 2 — test-only harness page for Chrome built-in
  // Prompt API (Gemini Nano). Not referenced from manifest.json; opened by
  // the Stage 5 Playwright runner via chrome.tabs.create from the SW.
  { name: 'tests/phase3/builtin-harness', input: 'src/tests/phase3/builtin-harness.ts', format: 'iife' as const },
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
