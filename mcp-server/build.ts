import { build as esbuild } from 'esbuild';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

export interface RunBuildOptions {
  readonly outdir?: string;
  readonly minify?: boolean;
}

export interface BuildResult {
  readonly outfile: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));

export async function runBuild(opts: RunBuildOptions = {}): Promise<BuildResult> {
  const outdir = opts.outdir ?? path.join(here, 'dist');
  const outfile = path.join(outdir, 'index.js');
  await esbuild({
    entryPoints: [path.join(here, 'src/index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    outfile,
    external: ['playwright'],
    banner: { js: '#!/usr/bin/env node' },
    minify: opts.minify ?? false,
    sourcemap: false,
    logLevel: 'silent',
    legalComments: 'none',
  });
  return { outfile };
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedAsScript) {
  const result = await runBuild();
  process.stdout.write(`[mcp-server] built ${path.relative(process.cwd(), result.outfile)}\n`);
}
