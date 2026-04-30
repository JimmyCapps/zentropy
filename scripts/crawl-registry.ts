import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

import { extractZones } from '../src/registry/extract-zones.js';
import { fingerprintZone } from '../src/registry/fingerprint.js';
import type {
  RegistryEntry,
  RegistryZone,
  ZoneFingerprint,
  ZoneText,
} from '../src/types/registry.js';

export interface SiteManifestEntry {
  readonly origin: string;
  readonly url: string;
  readonly frameSelectors: readonly string[];
  readonly excludedSelectors: readonly string[];
}

export interface CrawlLogger {
  readonly info: (message: string) => void;
  readonly warn: (message: string) => void;
}

export interface CrawlOptions {
  readonly manifest: readonly SiteManifestEntry[];
  readonly outputDir: string;
  readonly fetchFn?: typeof fetch;
  readonly now?: () => number;
  readonly logger?: CrawlLogger;
}

export type CrawlSkipReason = 'fetch-failed' | 'no-zones';

export interface CrawlSkipped {
  readonly origin: string;
  readonly reason: CrawlSkipReason;
  readonly detail: string;
}

export interface CrawlResult {
  readonly written: readonly string[];
  readonly skipped: readonly CrawlSkipped[];
}

export async function crawlRegistry(options: CrawlOptions): Promise<CrawlResult> {
  ensureBrowserGlobals();

  const fetchFn = options.fetchFn ?? fetch;
  const now = options.now ?? Date.now;
  const logger = options.logger ?? defaultLogger;

  await mkdir(options.outputDir, { recursive: true });

  const written: string[] = [];
  const skipped: CrawlSkipped[] = [];

  for (const site of options.manifest) {
    const outcome = await crawlOne(site, fetchFn, now, logger);
    if (outcome.kind === 'skipped') {
      skipped.push({
        origin: outcome.origin,
        reason: outcome.reason,
        detail: outcome.detail,
      });
      continue;
    }
    const path = join(options.outputDir, `${site.origin}.json`);
    await writeFile(path, `${JSON.stringify(outcome.entry, null, 2)}\n`, 'utf8');
    written.push(path);
    logger.info(`wrote ${path} (${outcome.entry.zones.length} zones)`);
  }

  return { written, skipped };
}

interface CrawlOk {
  readonly kind: 'ok';
  readonly entry: RegistryEntry;
}

interface CrawlSkippedInternal {
  readonly kind: 'skipped';
  readonly origin: string;
  readonly reason: CrawlSkipReason;
  readonly detail: string;
}

async function crawlOne(
  site: SiteManifestEntry,
  fetchFn: typeof fetch,
  now: () => number,
  logger: CrawlLogger,
): Promise<CrawlOk | CrawlSkippedInternal> {
  let html: string;
  try {
    const res = await fetchFn(site.url, { redirect: 'follow' });
    if (!res.ok) {
      const detail = `status ${res.status}`;
      logger.warn(`${site.origin}: fetch failed (${detail})`);
      return { kind: 'skipped', origin: site.origin, reason: 'fetch-failed', detail };
    }
    html = await res.text();
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.warn(`${site.origin}: fetch error: ${detail}`);
    return { kind: 'skipped', origin: site.origin, reason: 'fetch-failed', detail };
  }

  const zones: readonly ZoneText[] = extractZones(
    html,
    site.frameSelectors,
    site.excludedSelectors,
  );
  if (zones.length === 0) {
    const detail = 'extractZones returned 0 zones';
    logger.warn(`${site.origin}: ${detail}`);
    return { kind: 'skipped', origin: site.origin, reason: 'no-zones', detail };
  }

  const fingerprints: readonly ZoneFingerprint[] = await Promise.all(
    zones.map((zone) => fingerprintZone(zone)),
  );
  const registryZones: readonly RegistryZone[] = zones.map((zone, idx) => ({
    zoneId: zone.zoneId,
    selector: zone.zoneId.split('#')[0] ?? zone.zoneId,
    fingerprint: fingerprints[idx],
  }));

  const entry: RegistryEntry = {
    origin: site.origin,
    capturedAt: now(),
    schemaVersion: 1,
    zones: registryZones,
    excludedSelectors: site.excludedSelectors,
  };
  return { kind: 'ok', entry };
}

function ensureBrowserGlobals(): void {
  const g = globalThis as {
    DOMParser?: typeof DOMParser;
    NodeFilter?: typeof NodeFilter;
    Node?: typeof Node;
  };
  if (typeof g.DOMParser !== 'undefined' && typeof g.NodeFilter !== 'undefined') return;
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  g.DOMParser ??= dom.window.DOMParser;
  g.NodeFilter ??= dom.window.NodeFilter;
  g.Node ??= dom.window.Node;
}

const defaultLogger: CrawlLogger = {
  info: (message) => process.stdout.write(`${message}\n`),
  warn: (message) => process.stderr.write(`${message}\n`),
};

interface CliConfig {
  readonly manifestPath: string;
  readonly outputDir: string;
}

function parseCliArgs(argv: readonly string[], cwd: string): CliConfig {
  let manifestPath = join(cwd, 'registry/sites/manifest.json');
  let outputDir = join(cwd, 'registry/sites');
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--manifest') {
      manifestPath = argv[++i] ?? manifestPath;
    } else if (arg === '--output') {
      outputDir = argv[++i] ?? outputDir;
    }
  }
  return { manifestPath, outputDir };
}

async function runCli(): Promise<void> {
  const cwd = process.cwd();
  const { manifestPath, outputDir } = parseCliArgs(process.argv.slice(2), cwd);

  const raw = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw) as readonly SiteManifestEntry[];

  const result = await crawlRegistry({ manifest, outputDir });
  process.stdout.write(
    `crawl complete: wrote ${result.written.length}, skipped ${result.skipped.length}\n`,
  );
  if (result.skipped.length > 0) {
    for (const s of result.skipped) {
      process.stdout.write(`  skipped ${s.origin}: ${s.reason} (${s.detail})\n`);
    }
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runCli().catch((err: unknown) => {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    process.stderr.write(`crawl-registry failed: ${msg}\n`);
    process.exit(1);
  });
}
