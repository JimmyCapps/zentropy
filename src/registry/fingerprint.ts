import { sha256Hex } from '@/shared/hash.js';
import type { ZoneFingerprint, ZoneText } from '@/types/registry.js';

export async function fingerprintZone(zone: ZoneText): Promise<ZoneFingerprint> {
  const [structural, tokens] = await Promise.all([
    sha256Hex(zone.structureSkeleton),
    sha256Hex(zone.normalisedText),
  ]);
  return { structural, tokens };
}
