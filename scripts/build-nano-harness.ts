#!/usr/bin/env tsx
/**
 * Build script for the manual Nano harness page.
 *
 * Compiles `test-pages/nano-harness.ts` to `nano-harness.js` in-place
 * so the HTML page can load it as a module. Intentionally separate from the
 * extension build (`build.ts`) because this harness is a standalone local
 * browser tab, not part of the extension bundle — it runs in real Chrome
 * with EPP-gated Nano access and does not depend on the extension runtime.
 *
 * Usage:
 *   npx tsx scripts/build-nano-harness.ts
 */
import { build } from 'esbuild';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname ?? new URL('.', import.meta.url).pathname, '..');
const ENTRY = resolve(REPO_ROOT, 'test-pages/nano-harness.ts');
const OUTPUT = resolve(REPO_ROOT, 'test-pages/nano-harness.js');

async function main(): Promise<void> {
  await build({
    entryPoints: [ENTRY],
    outfile: OUTPUT,
    bundle: true,
    format: 'esm',
    target: 'es2022',
    sourcemap: false,
    logLevel: 'info',
  });
  console.log(`Built ${OUTPUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
