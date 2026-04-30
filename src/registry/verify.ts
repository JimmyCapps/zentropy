import * as ed from '@noble/ed25519';

import {
  hexToBytes,
  payloadBytes,
  type SignedRegistryBundle,
} from './canonical-bundle.js';
import { REGISTRY_PUBLIC_KEY_HEX } from './keys.js';
import type { RegistryEntry, RegistryZone, ZoneFingerprint } from '@/types/registry.js';

export interface VerifyRegistryOptions {
  readonly publicKeyHex?: string;
}

const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;

export async function verifyRegistry(
  bundle: unknown,
  opts: VerifyRegistryOptions = {},
): Promise<boolean> {
  const trusted = opts.publicKeyHex ?? REGISTRY_PUBLIC_KEY_HEX;
  if (!HEX64.test(trusted)) return false;

  const validated = validateBundleShape(bundle);
  if (validated === null) return false;
  if (validated.publicKeyHex !== trusted) return false;

  try {
    const sig = hexToBytes(validated.signature);
    const pub = hexToBytes(validated.publicKeyHex);
    const msg = payloadBytes({
      schemaVersion: validated.schemaVersion,
      publicKeyHex: validated.publicKeyHex,
      signedAt: validated.signedAt,
      entries: validated.entries,
    });
    return await ed.verifyAsync(sig, msg, pub);
  } catch {
    return false;
  }
}

function validateBundleShape(value: unknown): SignedRegistryBundle | null {
  if (value === null || typeof value !== 'object') return null;
  const b = value as Record<string, unknown>;

  if (b.schemaVersion !== 1) return null;
  if (typeof b.publicKeyHex !== 'string' || !HEX64.test(b.publicKeyHex)) return null;
  if (typeof b.signedAt !== 'number' || !Number.isFinite(b.signedAt)) return null;
  if (typeof b.signature !== 'string' || !HEX128.test(b.signature)) return null;
  if (!Array.isArray(b.entries)) return null;
  for (const e of b.entries) {
    if (!isRegistryEntry(e)) return null;
  }

  return {
    schemaVersion: 1,
    publicKeyHex: b.publicKeyHex,
    signedAt: b.signedAt,
    signature: b.signature,
    entries: b.entries as readonly RegistryEntry[],
  };
}

function isRegistryEntry(value: unknown): value is RegistryEntry {
  if (value === null || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  if (typeof e.origin !== 'string') return false;
  if (typeof e.capturedAt !== 'number' || !Number.isFinite(e.capturedAt)) return false;
  if (e.schemaVersion !== 1) return false;
  if (!Array.isArray(e.zones)) return false;
  for (const z of e.zones) {
    if (!isRegistryZone(z)) return false;
  }
  if (!Array.isArray(e.excludedSelectors)) return false;
  for (const s of e.excludedSelectors) {
    if (typeof s !== 'string') return false;
  }
  return true;
}

function isRegistryZone(value: unknown): value is RegistryZone {
  if (value === null || typeof value !== 'object') return false;
  const z = value as Record<string, unknown>;
  if (typeof z.zoneId !== 'string') return false;
  if (typeof z.selector !== 'string') return false;
  return isFingerprint(z.fingerprint);
}

function isFingerprint(value: unknown): value is ZoneFingerprint {
  if (value === null || typeof value !== 'object') return false;
  const f = value as Record<string, unknown>;
  if (typeof f.structural !== 'string') return false;
  if (typeof f.tokens !== 'string') return false;
  if (f.version !== undefined && typeof f.version !== 'string') return false;
  return true;
}
