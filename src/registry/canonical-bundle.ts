import type { RegistryEntry } from '@/types/registry.js';

export interface SignedRegistryBundle {
  readonly schemaVersion: 1;
  readonly publicKeyHex: string;
  readonly signedAt: number;
  readonly entries: readonly RegistryEntry[];
  readonly signature: string;
}

export interface SignedPayload {
  readonly schemaVersion: 1;
  readonly publicKeyHex: string;
  readonly signedAt: number;
  readonly entries: readonly RegistryEntry[];
}

export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'null';
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',')}}`;
  }
  throw new Error(`canonicalize: unsupported value type ${typeof value}`);
}

export function payloadBytes(payload: SignedPayload): Uint8Array {
  return new TextEncoder().encode(canonicalize(payload));
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 1) {
    s += bytes[i].toString(16).padStart(2, '0');
  }
  return s;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('hexToBytes: odd-length input');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error(`hexToBytes: invalid hex at offset ${i * 2}`);
    out[i] = byte;
  }
  return out;
}
