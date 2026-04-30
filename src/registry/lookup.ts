import { createLogger } from '@/shared/logger.js';
import { extractZones } from './extract-zones.js';
import { fingerprintZone } from './fingerprint.js';
import { verifyRegistry } from './verify.js';
import type { SignedRegistryBundle } from './canonical-bundle.js';
import type { RegistryEntry } from '@/types/registry.js';

const log = createLogger('RegistryLookup');

const REGISTRY_BUNDLE_PATH = 'dist/registry/signed-registry.json';

export interface LookupResult {
  readonly matched: boolean;
  readonly zoneIds: readonly string[];
}

export interface LoadRegistryOptions {
  readonly trustedPublicKeyHex?: string;
}

let cachedBundle: SignedRegistryBundle | null = null;
let loadPromise: Promise<void> | null = null;

export async function loadRegistryOnce(opts: LoadRegistryOptions = {}): Promise<void> {
  if (loadPromise !== null) return loadPromise;
  loadPromise = doLoad(opts);
  return loadPromise;
}

async function doLoad(opts: LoadRegistryOptions): Promise<void> {
  try {
    const url = chrome.runtime.getURL(REGISTRY_BUNDLE_PATH);
    const resp = await fetch(url);
    if (!resp.ok) {
      log.warn(`Registry bundle fetch failed: HTTP ${resp.status} (registry MISS for SW lifetime)`);
      return;
    }
    const parsed: unknown = await resp.json();
    const verifyOpts =
      opts.trustedPublicKeyHex === undefined
        ? undefined
        : { publicKeyHex: opts.trustedPublicKeyHex };
    const ok = await verifyRegistry(parsed, verifyOpts);
    if (!ok) {
      log.warn('Registry bundle verification failed (registry MISS for SW lifetime)');
      return;
    }
    cachedBundle = parsed as SignedRegistryBundle;
    log.info(`Registry loaded with ${cachedBundle.entries.length} entries`);
  } catch (err) {
    log.warn('Registry load threw; treating as MISS for SW lifetime', err);
  }
}

export async function lookupRegistry(
  origin: string,
  snapshotHtml: string,
): Promise<LookupResult> {
  if (cachedBundle === null) return EMPTY_RESULT;
  if (snapshotHtml.length === 0) return EMPTY_RESULT;

  const normalised = normaliseOrigin(origin);
  const entry = findEntry(cachedBundle.entries, normalised);
  if (entry === null) return EMPTY_RESULT;

  const frameSelectors = uniqueSelectors(entry.zones);
  const extracted = extractZones(snapshotHtml, frameSelectors, entry.excludedSelectors);

  const matchedIds: string[] = [];
  for (const entryZone of entry.zones) {
    const ext = extracted.find((z) => z.zoneId === entryZone.zoneId);
    if (ext === undefined) return EMPTY_RESULT;
    const fp = await fingerprintZone(ext);
    if (
      fp.structural !== entryZone.fingerprint.structural ||
      fp.tokens !== entryZone.fingerprint.tokens
    ) {
      return EMPTY_RESULT;
    }
    matchedIds.push(entryZone.zoneId);
  }

  return { matched: true, zoneIds: matchedIds };
}

const EMPTY_RESULT: LookupResult = { matched: false, zoneIds: [] };

function normaliseOrigin(origin: string): string {
  const trimmed = origin.trim().toLowerCase();
  if (trimmed.includes('://')) {
    try {
      return new URL(trimmed).host;
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function findEntry(
  entries: readonly RegistryEntry[],
  normalisedHost: string,
): RegistryEntry | null {
  for (const e of entries) {
    if (normaliseOrigin(e.origin) === normalisedHost) return e;
  }
  return null;
}

function uniqueSelectors(zones: readonly RegistryEntry['zones'][number][]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const z of zones) {
    if (!seen.has(z.selector)) {
      seen.add(z.selector);
      out.push(z.selector);
    }
  }
  return out;
}

export function __resetRegistryForTests(): void {
  cachedBundle = null;
  loadPromise = null;
}
