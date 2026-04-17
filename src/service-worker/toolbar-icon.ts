import type { SecurityStatus } from '@/types/verdict.js';
import { createLogger } from '@/shared/logger.js';

// Phase 4 Stage 4D.4 — per-tab toolbar icon state.
//
// The SW maintains a small map of tabId → verdict status so that when the
// user switches tabs we can re-apply the correct canary icon. Verdicts live
// in chrome.storage.local keyed by origin, but tabs switch faster than a
// storage read, so an in-memory mirror is kept. Storage remains the source
// of truth; this map is rebuilt lazily from storage on a cache miss.

const log = createLogger('ToolbarIcon');

type IconState = SecurityStatus | 'neutral';

const tabStatus = new Map<number, SecurityStatus>();

function iconBase(size: number, state: IconState): string {
  if (state === 'neutral') return `public/icons/icon-${size}.png`;
  return `public/icons/icon-${state.toLowerCase()}-${size}.png`;
}

function badgeColorForStatus(state: IconState): string {
  switch (state) {
    case 'CLEAN':       return '#4ade80';
    case 'SUSPICIOUS':  return '#facc15';
    case 'COMPROMISED': return '#f87171';
    case 'UNKNOWN':     return '#9ca3af';
    case 'neutral':     return '#00000000';
  }
}

export function setTabVerdict(tabId: number, status: SecurityStatus): void {
  tabStatus.set(tabId, status);
  void applyIconForTab(tabId, status);
}

export function clearTabVerdict(tabId: number): void {
  tabStatus.delete(tabId);
}

export async function applyIconForTab(tabId: number, state: IconState): Promise<void> {
  try {
    await chrome.action.setIcon({
      tabId,
      path: {
        16: iconBase(16, state),
        32: iconBase(32, state),
        48: iconBase(48, state),
        128: iconBase(128, state),
      },
    });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: badgeColorForStatus(state) });
  } catch (err) {
    // setIcon rejects if the tab closed mid-analysis. Harmless.
    log.debug(`setIcon failed for tab ${tabId}: ${String(err)}`);
  }
}

export function handleTabActivated(activeInfo: chrome.tabs.TabActiveInfo): void {
  const status = tabStatus.get(activeInfo.tabId);
  if (status !== undefined) {
    void applyIconForTab(activeInfo.tabId, status);
  } else {
    void applyIconForTab(activeInfo.tabId, 'neutral');
  }
}

export function handleTabRemoved(tabId: number): void {
  clearTabVerdict(tabId);
}
