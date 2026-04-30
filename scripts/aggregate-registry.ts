import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { RegistryEntry, RegistryZone } from '../src/types/registry.js';

export const DEFAULT_DIVERSITY_BOUND = 8;

export interface AggregateLogger {
  readonly info: (message: string) => void;
  readonly warn: (message: string) => void;
}

export type AggregateDropReason = 'diversity-exceeded';

export interface AggregateDropped {
  readonly origin: string;
  readonly reason: AggregateDropReason;
  readonly detail: string;
}

export interface AggregateOptions {
  readonly entries: readonly RegistryEntry[];
  readonly priorEntries?: ReadonlyMap<string, RegistryEntry>;
  readonly diversityBound?: number;
  readonly now?: () => number;
  readonly logger?: AggregateLogger;
}

export interface AggregateResult {
  readonly entries: readonly RegistryEntry[];
  readonly dropped: readonly AggregateDropped[];
}

export function aggregateRegistry(options: AggregateOptions): AggregateResult {
  const K = options.diversityBound ?? DEFAULT_DIVERSITY_BOUND;
  const now = options.now ?? Date.now;
  const logger = options.logger ?? defaultLogger;

  const grouped = new Map<string, RegistryEntry[]>();
  for (const entry of options.entries) {
    const arr = grouped.get(entry.origin) ?? [];
    arr.push(entry);
    grouped.set(entry.origin, arr);
  }

  const out: RegistryEntry[] = [];
  const dropped: AggregateDropped[] = [];

  const origins = [...grouped.keys()].sort();
  for (const origin of origins) {
    const entries = grouped.get(origin) ?? [];
    if (entries.length === 0) continue;

    const distinctByZone = new Map<string, Set<string>>();
    for (const entry of entries) {
      for (const zone of entry.zones) {
        const key = fingerprintKey(zone);
        const set = distinctByZone.get(zone.zoneId) ?? new Set<string>();
        set.add(key);
        distinctByZone.set(zone.zoneId, set);
      }
    }

    let exceededZone: string | null = null;
    let exceededCount = 0;
    for (const [zoneId, set] of distinctByZone) {
      if (set.size > K) {
        exceededZone = zoneId;
        exceededCount = set.size;
        break;
      }
    }

    if (exceededZone !== null) {
      const detail = `zone ${exceededZone} has ${exceededCount} distinct fingerprints (>K=${K})`;
      dropped.push({ origin, reason: 'diversity-exceeded', detail });
      logger.warn(`${origin}: dropped — ${detail}`);
      continue;
    }

    const canonical = entries[0];
    const prior = options.priorEntries?.get(origin);
    const capturedAt =
      prior !== undefined && zonesFingerprintMatch(canonical.zones, prior.zones)
        ? prior.capturedAt
        : now();

    out.push({
      origin,
      capturedAt,
      schemaVersion: 1,
      zones: canonical.zones,
      excludedSelectors: canonical.excludedSelectors,
    });
  }

  return { entries: out, dropped };
}

function fingerprintKey(zone: RegistryZone): string {
  const v = zone.fingerprint.version ?? '';
  return `${zone.fingerprint.structural}|${zone.fingerprint.tokens}|${v}`;
}

function zonesFingerprintMatch(
  a: readonly RegistryZone[],
  b: readonly RegistryZone[],
): boolean {
  if (a.length !== b.length) return false;
  const byZoneA = new Map(a.map((z) => [z.zoneId, fingerprintKey(z)]));
  const byZoneB = new Map(b.map((z) => [z.zoneId, fingerprintKey(z)]));
  if (byZoneA.size !== byZoneB.size) return false;
  for (const [zoneId, keyA] of byZoneA) {
    if (byZoneB.get(zoneId) !== keyA) return false;
  }
  return true;
}

const defaultLogger: AggregateLogger = {
  info: (message) => process.stdout.write(`${message}\n`),
  warn: (message) => process.stderr.write(`${message}\n`),
};

export async function readEntriesFromDir(dir: string): Promise<readonly RegistryEntry[]> {
  if (!existsSync(dir)) return [];
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
  readonly inputDirs: readonly string[];
  readonly priorDir: string | null;
  readonly outputDir: string;
}

function parseArgs(argv: readonly string[]): CliConfig {
  const inputDirs: string[] = [];
  let priorDir: string | null = null;
  let outputDir = 'registry/sites';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input') {
      const v = argv[++i];
      if (v !== undefined) inputDirs.push(v);
    } else if (arg === '--prior') {
      priorDir = argv[++i] ?? null;
    } else if (arg === '--output') {
      outputDir = argv[++i] ?? outputDir;
    }
  }

  return { inputDirs, priorDir, outputDir };
}

async function runCli(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));

  if (config.inputDirs.length === 0) {
    process.stderr.write('aggregate-registry: at least one --input <dir> is required\n');
    process.exit(2);
  }

  const allEntries: RegistryEntry[] = [];
  for (const dir of config.inputDirs) {
    const entries = await readEntriesFromDir(dir);
    for (const e of entries) allEntries.push(e);
  }

  const priorMap = new Map<string, RegistryEntry>();
  if (config.priorDir !== null) {
    const prior = await readEntriesFromDir(config.priorDir);
    for (const e of prior) priorMap.set(e.origin, e);
  }

  const result = aggregateRegistry({
    entries: allEntries,
    priorEntries: priorMap,
  });

  await mkdir(config.outputDir, { recursive: true });
  for (const entry of result.entries) {
    const path = join(config.outputDir, `${entry.origin}.json`);
    await writeFile(path, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
  }

  process.stdout.write(
    `aggregate-registry: wrote ${result.entries.length}, dropped ${result.dropped.length}\n`,
  );
  for (const d of result.dropped) {
    process.stdout.write(`  dropped ${d.origin}: ${d.reason} (${d.detail})\n`);
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runCli().catch((err: unknown) => {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    process.stderr.write(`aggregate-registry failed: ${msg}\n`);
    process.exit(1);
  });
}
