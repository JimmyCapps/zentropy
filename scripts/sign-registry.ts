import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { signRegistry } from '../src/registry/sign.js';
import type { SignedRegistryBundle } from '../src/registry/canonical-bundle.js';
import type { RegistryEntry } from '../src/types/registry.js';

export { signRegistry };

export interface SignRegistryFromDirOptions {
  readonly inputDir: string;
  readonly outputPath: string;
  readonly privateKeyHex: string;
  readonly now?: () => number;
}

export async function signRegistryFromDir(
  opts: SignRegistryFromDirOptions,
): Promise<SignedRegistryBundle> {
  const entries = await readEntriesFromDir(opts.inputDir);

  const bundle = await signRegistry({
    entries,
    privateKeyHex: opts.privateKeyHex,
    now: opts.now,
  });

  await mkdir(dirname(opts.outputPath), { recursive: true });
  await writeFile(opts.outputPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
  return bundle;
}

async function readEntriesFromDir(dir: string): Promise<readonly RegistryEntry[]> {
  if (!existsSync(dir)) {
    throw new Error(`signRegistry: input dir does not exist: ${dir}`);
  }
  const names = await readdir(dir);
  const out: RegistryEntry[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    if (name === 'manifest.json') continue;
    const raw = await readFile(join(dir, name), 'utf8');
    out.push(JSON.parse(raw) as RegistryEntry);
  }
  return out;
}

interface CliConfig {
  readonly inputDir: string;
  readonly outputPath: string;
}

function parseCliArgs(argv: readonly string[], cwd: string): CliConfig {
  let inputDir = join(cwd, 'registry/sites');
  let outputPath = join(cwd, 'registry/signed-registry.json');
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input') {
      inputDir = argv[++i] ?? inputDir;
    } else if (arg === '--output') {
      outputPath = argv[++i] ?? outputPath;
    }
  }
  return { inputDir, outputPath };
}

async function runCli(): Promise<void> {
  const cwd = process.cwd();
  const { inputDir, outputPath } = parseCliArgs(process.argv.slice(2), cwd);

  const privateKeyHex = process.env.HONEYLLM_REGISTRY_SIGNING_KEY;
  if (privateKeyHex === undefined || privateKeyHex.length === 0) {
    process.stderr.write(
      'sign-registry: HONEYLLM_REGISTRY_SIGNING_KEY env var is required (32-byte private key, hex).\n',
    );
    process.exit(2);
  }

  const bundle = await signRegistryFromDir({
    inputDir,
    outputPath,
    privateKeyHex,
  });

  process.stdout.write(
    `sign-registry: wrote ${outputPath} (${bundle.entries.length} entries, key ${bundle.publicKeyHex.slice(0, 12)}...)\n`,
  );
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runCli().catch((err: unknown) => {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    process.stderr.write(`sign-registry failed: ${msg}\n`);
    process.exit(1);
  });
}
