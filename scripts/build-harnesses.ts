#!/usr/bin/env tsx
/**
 * Build script for HoneyLLM harness pages.
 *
 * Compiles `harnesses/*.ts` entry points to sibling `.js` files so the
 * HTML pages can load them as modules. Separate from the extension build
 * (`build.ts`) — the harnesses are standalone local browser tabs, not part
 * of the extension bundle.
 *
 * Usage:
 *   npx tsx scripts/build-harnesses.ts
 */
import { build } from 'esbuild';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname ?? new URL('.', import.meta.url).pathname, '..');

interface Entry {
  readonly name: string;
  readonly entry: string;
  readonly output: string;
}

const ENTRIES: ReadonlyArray<Entry> = [
  {
    name: 'index',
    entry: resolve(REPO_ROOT, 'harnesses/index.ts'),
    output: resolve(REPO_ROOT, 'harnesses/index.js'),
  },
  {
    name: 'nano-harness',
    entry: resolve(REPO_ROOT, 'harnesses/nano-harness.ts'),
    output: resolve(REPO_ROOT, 'harnesses/nano-harness.js'),
  },
];

async function main(): Promise<void> {
  for (const e of ENTRIES) {
    await build({
      entryPoints: [e.entry],
      outfile: e.output,
      bundle: true,
      format: 'esm',
      target: 'es2022',
      sourcemap: false,
      logLevel: 'info',
    });
    console.log(`Built ${e.output}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
