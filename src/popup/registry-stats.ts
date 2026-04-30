import type { RegistryStats } from '@/registry/telemetry.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const TOP_ORIGINS_LIMIT = 3;

function formatBundleAge(ageMs: number): string {
  const days = Math.round(ageMs / ONE_DAY_MS);
  if (days <= 0) return 'less than a day';
  if (days === 1) return '1 day';
  return `${days} days`;
}

function pickTopOrigins(
  perOrigin: RegistryStats['perOrigin'],
  limit: number,
): ReadonlyArray<readonly [string, RegistryStats['perOrigin'][string]]> {
  return Object.entries(perOrigin)
    .sort(([aOrigin, a], [bOrigin, b]) => {
      if (b.hits !== a.hits) return b.hits - a.hits;
      // Deterministic tiebreak: newer lastSeenAt first, then origin lexicographic
      if (b.lastSeenAt !== a.lastSeenAt) return b.lastSeenAt - a.lastSeenAt;
      return aOrigin.localeCompare(bOrigin);
    })
    .slice(0, limit);
}

/**
 * SR-G — render the SR-F registry's hit / miss / stale counters into the
 * given container. Pure DOM construction; idempotent re-render via
 * `replaceChildren`. Renders nothing network-bound — counters and
 * bundle metadata are read from chrome.storage.local by the caller and
 * passed in as a `RegistryStats` value.
 */
export function renderRegistryStats(container: HTMLElement, stats: RegistryStats): void {
  const wrapper = document.createElement('div');
  wrapper.className = 'meta';
  wrapper.style.lineHeight = '1.6';

  const hitRateLine = document.createElement('div');
  if (stats.hitRate === null) {
    hitRateLine.textContent = 'Hit rate: — (no lookups yet)';
  } else {
    const pct = (stats.hitRate * 100).toFixed(1);
    hitRateLine.textContent = `Hit rate: ${pct}% (${stats.hits} hit / ${stats.misses} miss)`;
  }
  wrapper.appendChild(hitRateLine);

  const bundleLine = document.createElement('div');
  if (stats.bundleSignedAt === null || stats.bundleAgeMs === null) {
    bundleLine.textContent = 'Bundle: not loaded';
  } else {
    bundleLine.textContent = `Bundle age: ${formatBundleAge(stats.bundleAgeMs)}`;
  }
  wrapper.appendChild(bundleLine);

  if (stats.staleBundle) {
    const warning = document.createElement('div');
    warning.className = 'registry-stale-warning';
    warning.style.color = '#facc15';
    warning.style.marginTop = '4px';
    warning.textContent = 'Bundle is stale (older than the freshness threshold) — site coverage may have drifted.';
    wrapper.appendChild(warning);
  }

  if (stats.verifyFailures > 0) {
    const verifyLine = document.createElement('div');
    verifyLine.style.color = '#f87171';
    verifyLine.style.marginTop = '4px';
    verifyLine.textContent = `Verify failures: ${stats.verifyFailures}`;
    wrapper.appendChild(verifyLine);
  }

  const top = pickTopOrigins(stats.perOrigin, TOP_ORIGINS_LIMIT);
  if (top.length > 0) {
    const heading = document.createElement('div');
    heading.style.marginTop = '8px';
    heading.style.color = '#888';
    heading.textContent = 'Top origins by hits';
    wrapper.appendChild(heading);

    for (const [origin, counts] of top) {
      const row = document.createElement('div');
      row.className = 'registry-origin-row';
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.fontSize = '11px';
      const left = document.createElement('span');
      left.textContent = origin;
      const right = document.createElement('span');
      right.style.fontVariantNumeric = 'tabular-nums';
      right.textContent = `${counts.hits} hit / ${counts.misses} miss`;
      row.appendChild(left);
      row.appendChild(right);
      wrapper.appendChild(row);
    }
  }

  container.replaceChildren(wrapper);
}
