import * as ed from '@noble/ed25519';

import {
  bytesToHex,
  hexToBytes,
  payloadBytes,
  type SignedRegistryBundle,
} from './canonical-bundle.js';
import type { RegistryEntry } from '@/types/registry.js';

export interface SignRegistryOptions {
  readonly entries: readonly RegistryEntry[];
  readonly privateKeyHex: string;
  readonly now?: () => number;
}

export async function signRegistry(opts: SignRegistryOptions): Promise<SignedRegistryBundle> {
  if (opts.entries.length === 0) {
    throw new Error('signRegistry: refuse to sign an empty entries array');
  }

  const priv = hexToBytes(opts.privateKeyHex);
  const pub = await ed.getPublicKeyAsync(priv);
  const publicKeyHex = bytesToHex(pub);

  const sortedEntries = [...opts.entries].sort((a, b) => {
    if (a.origin < b.origin) return -1;
    if (a.origin > b.origin) return 1;
    return 0;
  });

  const signedAt = (opts.now ?? Date.now)();

  const msg = payloadBytes({
    schemaVersion: 1,
    publicKeyHex,
    signedAt,
    entries: sortedEntries,
  });
  const sig = await ed.signAsync(msg, priv);

  return {
    schemaVersion: 1,
    publicKeyHex,
    signedAt,
    entries: sortedEntries,
    signature: bytesToHex(sig),
  };
}
