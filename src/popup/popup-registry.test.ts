// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderRegistryStats } from './registry-stats.js';
import type { RegistryStats } from '@/registry/telemetry.js';
import { REGISTRY_STALE_BUNDLE_THRESHOLD_MS } from '@/shared/constants.js';

function freshStats(overrides: Partial<RegistryStats> = {}): RegistryStats {
  return {
    hits: 0,
    misses: 0,
    verifyFailures: 0,
    hitRate: null,
    bundleSignedAt: null,
    bundleLoadedAt: null,
    bundleAgeMs: null,
    staleBundle: false,
    perOrigin: {},
    lastResetAt: 0,
    ...overrides,
  };
}

let container: HTMLElement;

beforeEach(() => {
  document.body.replaceChildren();
  container = document.createElement('div');
  container.id = 'root';
  document.body.appendChild(container);
});

describe('popup registry-stats render', () => {
  it('empty state: shows "no lookups yet" and "bundle not loaded"', () => {
    renderRegistryStats(container, freshStats());
    const text = container.textContent ?? '';
    expect(text).toContain('no lookups yet');
    expect(text).toContain('not loaded');
  });

  it('with hits and misses: shows hit rate as percent and absolute counts', () => {
    renderRegistryStats(
      container,
      freshStats({ hits: 7, misses: 3, hitRate: 0.7 }),
    );
    const text = container.textContent ?? '';
    expect(text).toContain('70.0%');
    expect(text).toContain('7 hit');
    expect(text).toContain('3 miss');
  });

  it('with verifyFailures > 0: surfaces a verify-failures line', () => {
    renderRegistryStats(container, freshStats({ verifyFailures: 4 }));
    const text = container.textContent ?? '';
    expect(text.toLowerCase()).toContain('verify failure');
    expect(text).toContain('4');
  });

  it('with verifyFailures === 0: does NOT render a verify-failures line', () => {
    renderRegistryStats(container, freshStats({ hits: 1, misses: 1, hitRate: 0.5 }));
    const text = container.textContent ?? '';
    expect(text.toLowerCase()).not.toContain('verify failure');
  });

  it('fresh bundle: renders age in days, no stale warning', () => {
    const oneDay = 24 * 60 * 60 * 1000;
    renderRegistryStats(
      container,
      freshStats({
        bundleSignedAt: 1_700_000_000_000,
        bundleLoadedAt: 1_700_000_000_000 + oneDay,
        bundleAgeMs: 5 * oneDay,
        staleBundle: false,
      }),
    );
    const text = container.textContent ?? '';
    expect(text).toContain('5');
    expect(text.toLowerCase()).toContain('day');
    const warning = container.querySelector('.registry-stale-warning');
    expect(warning).toBeNull();
  });

  it('stale bundle: renders amber warning element with the staleness threshold context', () => {
    renderRegistryStats(
      container,
      freshStats({
        bundleSignedAt: 1_700_000_000_000,
        bundleLoadedAt: 1_700_000_000_000 + REGISTRY_STALE_BUNDLE_THRESHOLD_MS + 1,
        bundleAgeMs: REGISTRY_STALE_BUNDLE_THRESHOLD_MS + 1,
        staleBundle: true,
      }),
    );
    const warning = container.querySelector('.registry-stale-warning');
    expect(warning).not.toBeNull();
    expect((warning!.textContent ?? '').toLowerCase()).toContain('stale');
  });

  it('per-origin section: lists the top 3 origins by hit count, descending', () => {
    renderRegistryStats(
      container,
      freshStats({
        hits: 12,
        misses: 0,
        hitRate: 1,
        perOrigin: {
          'gmail.com': { hits: 5, misses: 0, lastSeenAt: 100 },
          'github.com': { hits: 4, misses: 1, lastSeenAt: 200 },
          'slack.com': { hits: 2, misses: 0, lastSeenAt: 300 },
          'notion.com': { hits: 1, misses: 0, lastSeenAt: 400 },
        },
      }),
    );
    const rows = container.querySelectorAll('.registry-origin-row');
    expect(rows.length).toBe(3);
    expect(rows[0]!.textContent).toContain('gmail.com');
    expect(rows[1]!.textContent).toContain('github.com');
    expect(rows[2]!.textContent).toContain('slack.com');
  });

  it('per-origin section: omitted entirely when no origins recorded', () => {
    renderRegistryStats(container, freshStats());
    const rows = container.querySelectorAll('.registry-origin-row');
    expect(rows.length).toBe(0);
  });

  it('replaces existing children rather than appending (idempotent re-render)', () => {
    container.appendChild(document.createElement('span'));
    renderRegistryStats(container, freshStats({ hits: 1, misses: 1, hitRate: 0.5 }));
    const childCountFirst = container.children.length;

    renderRegistryStats(container, freshStats({ hits: 1, misses: 1, hitRate: 0.5 }));
    const childCountSecond = container.children.length;
    expect(childCountSecond).toBe(childCountFirst);
  });
});
