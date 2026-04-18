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

// Cache of decoded ImageData per state+size. MV3 service workers can't reliably
// resolve `setIcon({ path })` strings (Chrome returns "Failed to fetch" even
// when chrome.runtime.getURL + fetch succeeds), so we decode once via fetch +
// createImageBitmap + OffscreenCanvas and pass ImageData to setIcon.
const imageDataCache = new Map<string, ImageData>();

function iconBase(size: number, state: IconState): string {
  if (state === 'neutral') return `public/icons/icon-${size}.png`;
  return `public/icons/icon-${state.toLowerCase()}-${size}.png`;
}

async function loadImageData(size: number, state: IconState): Promise<ImageData> {
  const key = `${state}-${size}`;
  const cached = imageDataCache.get(key);
  if (cached) return cached;

  const url = chrome.runtime.getURL(iconBase(size, state));
  const resp = await fetch(url);
  const blob = await resp.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
  ctx.drawImage(bitmap, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size);
  imageDataCache.set(key, data);
  return data;
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
    const [d16, d32, d48, d128] = await Promise.all([
      loadImageData(16, state),
      loadImageData(32, state),
      loadImageData(48, state),
      loadImageData(128, state),
    ]);
    await chrome.action.setIcon({
      tabId,
      imageData: { 16: d16, 32: d32, 48: d48, 128: d128 },
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
