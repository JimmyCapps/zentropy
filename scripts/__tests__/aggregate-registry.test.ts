import { describe, it, expect } from 'vitest';

import { aggregateRegistry } from '../aggregate-registry.js';
import type { RegistryEntry, RegistryZone } from '@/types/registry.js';

const HEX = '0'.repeat(64);

const fp = (structural: string, tokens: string) => ({
  structural: `${structural}${HEX}`.slice(0, 64),
  tokens: `${tokens}${HEX}`.slice(0, 64),
});

const zone = (zoneId: string, structural: string, tokens: string): RegistryZone => ({
  zoneId,
  selector: zoneId.split('#')[0] ?? zoneId,
  fingerprint: fp(structural, tokens),
});

const entry = (
  origin: string,
  zones: readonly RegistryZone[],
  capturedAt = 1_000,
  excludedSelectors: readonly string[] = [],
): RegistryEntry => ({
  origin,
  capturedAt,
  schemaVersion: 1,
  zones,
  excludedSelectors,
});

const silent = { info: (): void => {}, warn: (): void => {} };

describe('aggregateRegistry', () => {
  it('publishes a single entry per origin when all locations agree', () => {
    const a = entry('site.test', [zone('header#0', 'aaa', 'bbb')]);
    const b = entry('site.test', [zone('header#0', 'aaa', 'bbb')]);
    const c = entry('site.test', [zone('header#0', 'aaa', 'bbb')]);

    const result = aggregateRegistry({
      entries: [a, b, c],
      now: () => 9_999,
      logger: silent,
    });

    expect(result.dropped).toEqual([]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].origin).toBe('site.test');
    expect(result.entries[0].zones).toEqual(a.zones);
  });

  it('drops a site whose zone has more than K=8 distinct fingerprints', () => {
    const entries: RegistryEntry[] = [];
    for (let i = 0; i < 9; i += 1) {
      entries.push(entry('volatile.test', [zone('header#0', `s${i}`, `t${i}`)]));
    }

    const result = aggregateRegistry({
      entries,
      now: () => 9_999,
      logger: silent,
    });

    expect(result.entries).toEqual([]);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].origin).toBe('volatile.test');
    expect(result.dropped[0].reason).toBe('diversity-exceeded');
  });

  it('publishes a site whose zone has exactly K=8 distinct fingerprints (boundary)', () => {
    const entries: RegistryEntry[] = [];
    for (let i = 0; i < 8; i += 1) {
      entries.push(entry('boundary.test', [zone('header#0', `s${i}`, `t${i}`)]));
    }

    const result = aggregateRegistry({
      entries,
      now: () => 9_999,
      logger: silent,
    });

    expect(result.dropped).toEqual([]);
    expect(result.entries).toHaveLength(1);
  });

  it('preserves capturedAt when canonical fingerprints match the prior entry', () => {
    const z = zone('header#0', 'aaa', 'bbb');
    const current = entry('site.test', [z]);
    const prior = entry('site.test', [z], 12_345);

    const result = aggregateRegistry({
      entries: [current, current, current],
      priorEntries: new Map([['site.test', prior]]),
      now: () => 9_999,
      logger: silent,
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].capturedAt).toBe(12_345);
  });

  it('refreshes capturedAt when fingerprints differ from the prior entry', () => {
    const current = entry('site.test', [zone('header#0', 'new', 'new')]);
    const prior = entry('site.test', [zone('header#0', 'old', 'old')], 12_345);

    const result = aggregateRegistry({
      entries: [current, current, current],
      priorEntries: new Map([['site.test', prior]]),
      now: () => 9_999,
      logger: silent,
    });

    expect(result.entries[0].capturedAt).toBe(9_999);
  });

  it('uses now() for capturedAt when no prior entry exists', () => {
    const current = entry('new-site.test', [zone('header#0', 'aaa', 'bbb')]);

    const result = aggregateRegistry({
      entries: [current],
      now: () => 9_999,
      logger: silent,
    });

    expect(result.entries[0].capturedAt).toBe(9_999);
  });

  it('treats different zoneIds independently when counting distinct fingerprints', () => {
    // Each zone has only 2 distinct fingerprints across 4 locations -> well under K=8.
    const entries: RegistryEntry[] = [
      entry('multi.test', [zone('header#0', 's1', 't1'), zone('footer#0', 'sx', 'tx')]),
      entry('multi.test', [zone('header#0', 's2', 't2'), zone('footer#0', 'sx', 'tx')]),
      entry('multi.test', [zone('header#0', 's1', 't1'), zone('footer#0', 'sy', 'ty')]),
      entry('multi.test', [zone('header#0', 's2', 't2'), zone('footer#0', 'sy', 'ty')]),
    ];

    const result = aggregateRegistry({
      entries,
      now: () => 9_999,
      logger: silent,
    });

    expect(result.dropped).toEqual([]);
    expect(result.entries).toHaveLength(1);
  });

  it('aggregates multiple origins independently', () => {
    const result = aggregateRegistry({
      entries: [
        entry('a.test', [zone('header#0', 'aaa', 'bbb')]),
        entry('a.test', [zone('header#0', 'aaa', 'bbb')]),
        entry('b.test', [zone('main#0', 'ccc', 'ddd')]),
      ],
      now: () => 9_999,
      logger: silent,
    });

    const origins = result.entries.map((e) => e.origin).sort();
    expect(origins).toEqual(['a.test', 'b.test']);
  });

  it('emits deterministic zones (selector + zoneId equal across all canonical zones)', () => {
    const result = aggregateRegistry({
      entries: [entry('site.test', [zone('header#0', 'aaa', 'bbb')])],
      now: () => 9_999,
      logger: silent,
    });

    const out = result.entries[0];
    for (const z of out.zones) {
      expect(z.zoneId.startsWith(`${z.selector}#`)).toBe(true);
    }
  });
});
