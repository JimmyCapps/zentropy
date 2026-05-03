import type { SetLoggingStateMessage } from '@/types/messages.js';
import { createLogger } from '@/shared/logger.js';

const log = createLogger('LoggingBroadcast');

/**
 * Issue #236 — single source of truth for content→SW logging state. The
 * `connected` flag flips on log-viewer Port open/close. Heartbeat
 * preference persists across SW + Chrome restarts (per-tab overrides
 * are wiped on `chrome.tabs.onRemoved`).
 */
export const STORAGE_KEY_LOGGING_STATE = 'honeyllm:logging-state';

export interface LoggingState {
  readonly connected: boolean;
  readonly heartbeat: {
    readonly global: boolean;
    readonly perTab: Readonly<Record<number, boolean>>;
  };
}

const DEFAULT_STATE: LoggingState = {
  connected: false,
  heartbeat: { global: false, perTab: {} },
};

export async function getLoggingState(): Promise<LoggingState> {
  const res = await chrome.storage.local.get(STORAGE_KEY_LOGGING_STATE);
  const stored = res[STORAGE_KEY_LOGGING_STATE] as Partial<LoggingState> | undefined;
  if (stored === undefined || stored === null) return DEFAULT_STATE;
  return {
    connected: stored.connected ?? false,
    heartbeat: {
      global: stored.heartbeat?.global ?? false,
      perTab: stored.heartbeat?.perTab ?? {},
    },
  };
}

export async function setLoggingState(patch: Partial<LoggingState>): Promise<void> {
  const current = await getLoggingState();
  const next: LoggingState = {
    connected: patch.connected ?? current.connected,
    heartbeat: {
      global: patch.heartbeat?.global ?? current.heartbeat.global,
      perTab: patch.heartbeat?.perTab ?? current.heartbeat.perTab,
    },
  };
  await chrome.storage.local.set({ [STORAGE_KEY_LOGGING_STATE]: next });
}

export function effectiveHeartbeat(state: LoggingState, tabId: number): boolean {
  const override = state.heartbeat.perTab[tabId];
  return override !== undefined ? override : state.heartbeat.global;
}

export function anyHeartbeatActive(state: LoggingState): boolean {
  if (state.heartbeat.global) return true;
  for (const tabId of Object.keys(state.heartbeat.perTab)) {
    if (state.heartbeat.perTab[Number(tabId)]) return true;
  }
  return false;
}

/**
 * Send the resolved per-tab logging state to every active tab. Failures
 * (no content script in tab, tab closed mid-flight) are swallowed —
 * dispatch is best-effort observability.
 */
export async function broadcastLoggingState(): Promise<void> {
  const state = await getLoggingState();
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    const msg: SetLoggingStateMessage = {
      type: 'SET_LOGGING_STATE',
      connected: state.connected,
      heartbeat: effectiveHeartbeat(state, tab.id),
    };
    chrome.tabs.sendMessage(tab.id, msg).catch(() => {
      // Tab may have no content script (chrome:// pages, file:// excluded
      // by manifest, etc.) or may have closed mid-flight.
    });
  }
}

/**
 * Send the resolved state to a single tab — used on `chrome.tabs.onUpdated`
 * status='complete' so a freshly-mounted content script gets the current
 * state without waiting for the next state change.
 */
export async function sendLoggingStateToTab(tabId: number): Promise<void> {
  const state = await getLoggingState();
  const msg: SetLoggingStateMessage = {
    type: 'SET_LOGGING_STATE',
    connected: state.connected,
    heartbeat: effectiveHeartbeat(state, tabId),
  };
  chrome.tabs.sendMessage(tabId, msg).catch(() => undefined);
}

/**
 * Strip a per-tab heartbeat override from storage. Called from
 * `chrome.tabs.onRemoved` so a recycled tab id starts fresh from the
 * global default. Mirrors the dedup-cleanup pattern from #234.
 */
export async function dropTabFromLoggingState(tabId: number): Promise<void> {
  const current = await getLoggingState();
  if (current.heartbeat.perTab[tabId] === undefined) return;
  const nextPerTab: Record<number, boolean> = { ...current.heartbeat.perTab };
  delete nextPerTab[tabId];
  await setLoggingState({
    heartbeat: { global: current.heartbeat.global, perTab: nextPerTab },
  });
}

/**
 * Reflect heartbeat-active state on the toolbar badge. Amber dot when
 * any heartbeat (global or per-tab) is on, cleared otherwise. Lets a
 * user who closed the log viewer with heartbeat still on notice on the
 * next Chrome session.
 */
export async function refreshHeartbeatBadge(): Promise<void> {
  const state = await getLoggingState();
  if (anyHeartbeatActive(state)) {
    await chrome.action.setBadgeText({ text: '\u{1F7E1}' });
    await chrome.action.setTitle({ title: 'HoneyLLM — Heartbeat active (click to disable)' });
  } else {
    await chrome.action.setBadgeText({ text: '' });
    await chrome.action.setTitle({ title: 'HoneyLLM' });
  }
}

/** Internal: called on log-viewer Port connect. */
export async function markViewerConnected(): Promise<void> {
  await setLoggingState({ connected: true });
  log.info('viewer connected');
}

/** Internal: called on log-viewer Port disconnect. */
export async function markViewerDisconnected(): Promise<void> {
  await setLoggingState({ connected: false });
  log.info('viewer disconnected');
}
