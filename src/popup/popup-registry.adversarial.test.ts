// @vitest-environment jsdom
//
// SR-H adversarial popup-render assertions — drives `renderRegistryStats`
// directly (per SR-G drift carry-forward (e)+(g): it's a pure function;
// reuse it for adversarial UI cases instead of driving the full popup
// lifecycle). Sibling to `popup-registry.test.ts` (functional render);
// this file covers the union states a tampered or stale registry would
// surface to the user — what the popup looks like when verifyFailures is
// non-zero, when the bundle is past the staleness threshold, and when
// both signals fire at once.
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

describe('SR-H — adversarial popup render states', () => {
  it('high verifyFailures (signature-tamper run) renders the literal count, not a clamped or rounded value', () => {
    renderRegistryStats(container, freshStats({ verifyFailures: 99 }));
    const verifyLine = Array.from(container.querySelectorAll('div')).find((d) =>
      (d.textContent ?? '').toLowerCase().includes('verify failure'),
    );
    expect(verifyLine).toBeDefined();
    expect(verifyLine!.textContent).toContain('99');
    // Adversary should not be able to "hide" via a high count: the renderer
    // must surface the unclamped integer.
    expect(verifyLine!.textContent).not.toMatch(/\b9\+\b/);
  });

  it('stale bundle + non-zero verifyFailures: both warnings render simultaneously', () => {
    renderRegistryStats(
      container,
      freshStats({
        verifyFailures: 3,
        bundleSignedAt: 1_000,
        bundleLoadedAt: 1_000 + REGISTRY_STALE_BUNDLE_THRESHOLD_MS + 1,
        bundleAgeMs: REGISTRY_STALE_BUNDLE_THRESHOLD_MS + 1,
        staleBundle: true,
      }),
    );
    expect(container.querySelector('.registry-stale-warning')).not.toBeNull();
    const text = (container.textContent ?? '').toLowerCase();
    expect(text).toContain('verify failure');
    expect(text).toContain('stale');
  });

  it('stale bundle with successful lookups: stale warning AND hit-rate render (no contradiction)', () => {
    renderRegistryStats(
      container,
      freshStats({
        hits: 10,
        misses: 0,
        hitRate: 1,
        verifyFailures: 0,
        bundleSignedAt: 1_000,
        bundleLoadedAt: 1_000 + REGISTRY_STALE_BUNDLE_THRESHOLD_MS + 1,
        bundleAgeMs: REGISTRY_STALE_BUNDLE_THRESHOLD_MS + 1,
        staleBundle: true,
      }),
    );
    const text = container.textContent ?? '';
    expect(text).toContain('100.0%');
    expect(container.querySelector('.registry-stale-warning')).not.toBeNull();
    // verifyFailures === 0 → that warning line is omitted
    expect(text.toLowerCase()).not.toContain('verify failure');
  });

  it('verifyFailures with zero lookups: shows the failure count without lying about hit-rate', () => {
    // Adversarial state: bundle was rejected at startup, so no hits or
    // misses ever recorded; the popup must not invent a hit-rate.
    renderRegistryStats(container, freshStats({ verifyFailures: 1 }));
    const text = container.textContent ?? '';
    expect(text.toLowerCase()).toContain('verify failure');
    expect(text.toLowerCase()).toContain('no lookups yet');
  });

  it('per-origin section truncates to top-3 even in adversarial multi-origin loads', () => {
    // Defensive: an adversary cannot push perOrigin past the LRU cap (the
    // module enforces REGISTRY_MAX_ORIGINS_TRACKED), but the render layer
    // must independently cap to top 3 by hits regardless of input size.
    const perOrigin: Record<string, { hits: number; misses: number; lastSeenAt: number }> = {};
    for (let i = 0; i < 20; i += 1) {
      perOrigin[`site${i}.test`] = { hits: 20 - i, misses: 0, lastSeenAt: i };
    }
    renderRegistryStats(
      container,
      freshStats({ hits: 210, misses: 0, hitRate: 1, perOrigin }),
    );
    const rows = container.querySelectorAll('.registry-origin-row');
    expect(rows.length).toBe(3);
    expect(rows[0]!.textContent).toContain('site0.test');
    expect(rows[1]!.textContent).toContain('site1.test');
    expect(rows[2]!.textContent).toContain('site2.test');
  });
});
