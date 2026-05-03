// Issue #236 — popup heartbeat-active banner. Surfaces when heartbeat
// is on (globally or for the current tab) so the user notices on every
// popup open after Chrome restart. One-click disable writes both
// global=false AND clears the per-tab override; SW broadcast (PR1)
// then propagates SET_LOGGING_STATE to every content script.

const STORAGE_KEY_LOGGING_STATE = 'honeyllm:logging-state';

interface LoggingState {
  connected: boolean;
  heartbeat: { global: boolean; perTab: Record<number, boolean> };
}

async function readLoggingState(): Promise<LoggingState> {
  const res = await chrome.storage.local.get(STORAGE_KEY_LOGGING_STATE);
  const stored = res[STORAGE_KEY_LOGGING_STATE] as Partial<LoggingState> | undefined;
  return {
    connected: stored?.connected ?? false,
    heartbeat: {
      global: stored?.heartbeat?.global ?? false,
      perTab: stored?.heartbeat?.perTab ?? {},
    },
  };
}

async function writeLoggingState(next: LoggingState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY_LOGGING_STATE]: next });
}

export function isHeartbeatActiveForTab(state: LoggingState, tabId: number | undefined): boolean {
  if (state.heartbeat.global) return true;
  if (tabId !== undefined && state.heartbeat.perTab[tabId] === true) return true;
  return false;
}

async function disableHeartbeatForCurrentTab(tabId: number | undefined): Promise<void> {
  const current = await readLoggingState();
  const nextPerTab: Record<number, boolean> = { ...current.heartbeat.perTab };
  if (tabId !== undefined) {
    nextPerTab[tabId] = false;
  }
  await writeLoggingState({
    connected: current.connected,
    heartbeat: { global: false, perTab: nextPerTab },
  });
}

function ensureBanner(host: HTMLElement): HTMLDivElement {
  let banner = document.getElementById('heartbeat-banner') as HTMLDivElement | null;
  if (banner !== null) return banner;
  banner = document.createElement('div');
  banner.id = 'heartbeat-banner';
  banner.style.background = '#3a2f15';
  banner.style.border = '1px solid #7a5d20';
  banner.style.color = '#facc15';
  banner.style.padding = '8px 12px';
  banner.style.borderRadius = '6px';
  banner.style.fontSize = '12px';
  banner.style.marginBottom = '12px';
  banner.style.cursor = 'pointer';
  banner.style.display = 'flex';
  banner.style.gap = '8px';
  banner.style.alignItems = 'center';
  banner.title = 'Click to disable heartbeat for the current tab and globally';
  host.insertBefore(banner, host.firstChild);
  return banner;
}

function renderBanner(banner: HTMLDivElement, active: boolean): void {
  if (!active) {
    banner.style.display = 'none';
    while (banner.firstChild !== null) banner.removeChild(banner.firstChild);
    return;
  }
  banner.style.display = 'flex';
  while (banner.firstChild !== null) banner.removeChild(banner.firstChild);
  const dot = document.createElement('span');
  dot.textContent = '\u{1F7E1}';
  banner.appendChild(dot);
  const text = document.createElement('span');
  text.textContent = 'Heartbeat active — click to disable';
  text.style.flex = '1';
  banner.appendChild(text);
}

export async function initHeartbeatBanner(host: HTMLElement = document.body): Promise<void> {
  const banner = ensureBanner(host);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tab?.id;

  async function refresh(): Promise<void> {
    const state = await readLoggingState();
    renderBanner(banner, isHeartbeatActiveForTab(state, tabId));
  }

  banner.addEventListener('click', () => {
    void disableHeartbeatForCurrentTab(tabId).then(refresh);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[STORAGE_KEY_LOGGING_STATE] === undefined) return;
    void refresh();
  });

  await refresh();
}
