/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Issue #236 — log-viewer heartbeat toggle. Storage I/O + render logic
// extracted into a thin testable surface; the rest of log-viewer.ts is
// integration-tested via the live verification flow.

const STORAGE_KEY = 'honeyllm:logging-state';

interface LoggingState {
  connected: boolean;
  heartbeat: { global: boolean; perTab: Record<number, boolean> };
}

interface ChromeStub {
  storage: {
    local: {
      get: (key: string) => Promise<Record<string, unknown>>;
      set: (entries: Record<string, unknown>) => Promise<void>;
    };
    onChanged: { addListener: (cb: (...args: unknown[]) => void) => void };
  };
  tabs: {
    query: () => Promise<chrome.tabs.Tab[]>;
    onCreated: { addListener: (cb: () => void) => void };
    onUpdated: { addListener: (cb: () => void) => void };
    onRemoved: { addListener: (cb: () => void) => void };
  };
}

function stubChrome(initial?: Partial<LoggingState>, tabs: chrome.tabs.Tab[] = []): {
  storage: Record<string, unknown>;
  changeListeners: Array<(...args: unknown[]) => void>;
} {
  const storage: Record<string, unknown> = {};
  const changeListeners: Array<(...args: unknown[]) => void> = [];
  if (initial !== undefined) storage[STORAGE_KEY] = initial;
  const stub: ChromeStub = {
    storage: {
      local: {
        get: async (key: string) => (key in storage ? { [key]: storage[key] } : {}),
        set: async (entries: Record<string, unknown>) => {
          Object.assign(storage, entries);
        },
      },
      onChanged: { addListener: (cb) => changeListeners.push(cb) },
    },
    tabs: {
      query: async () => tabs,
      onCreated: { addListener: () => undefined },
      onUpdated: { addListener: () => undefined },
      onRemoved: { addListener: () => undefined },
    },
  };
  vi.stubGlobal('chrome', stub);
  return { storage, changeListeners };
}

// Pure helpers extracted from log-viewer.ts for unit-test access.
async function readLoggingState(): Promise<LoggingState> {
  const res = await chrome.storage.local.get(STORAGE_KEY);
  const stored = res[STORAGE_KEY] as Partial<LoggingState> | undefined;
  return {
    connected: stored?.connected ?? false,
    heartbeat: {
      global: stored?.heartbeat?.global ?? false,
      perTab: stored?.heartbeat?.perTab ?? {},
    },
  };
}

async function writeLoggingState(next: LoggingState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
}

async function setHeartbeatGlobal(on: boolean): Promise<void> {
  const current = await readLoggingState();
  await writeLoggingState({
    connected: current.connected,
    heartbeat: { global: on, perTab: current.heartbeat.perTab },
  });
}

async function setHeartbeatPerTab(tabId: number, on: boolean | null): Promise<void> {
  const current = await readLoggingState();
  const nextPerTab: Record<number, boolean> = { ...current.heartbeat.perTab };
  if (on === null) delete nextPerTab[tabId];
  else nextPerTab[tabId] = on;
  await writeLoggingState({
    connected: current.connected,
    heartbeat: { global: current.heartbeat.global, perTab: nextPerTab },
  });
}

describe('log-viewer storage I/O (#236)', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('readLoggingState returns defaults when storage is empty', async () => {
    stubChrome();
    const s = await readLoggingState();
    expect(s.connected).toBe(false);
    expect(s.heartbeat.global).toBe(false);
    expect(Object.keys(s.heartbeat.perTab)).toHaveLength(0);
  });

  it('setHeartbeatGlobal writes the global flag without disturbing perTab', async () => {
    const { storage } = stubChrome({
      connected: true,
      heartbeat: { global: false, perTab: { 5: true } },
    });
    await setHeartbeatGlobal(true);
    const persisted = storage[STORAGE_KEY] as LoggingState;
    expect(persisted.heartbeat.global).toBe(true);
    expect(persisted.heartbeat.perTab[5]).toBe(true);
    expect(persisted.connected).toBe(true);
  });

  it('setHeartbeatPerTab(tabId, true) sets the override', async () => {
    const { storage } = stubChrome({ connected: false, heartbeat: { global: false, perTab: {} } });
    await setHeartbeatPerTab(7, true);
    const persisted = storage[STORAGE_KEY] as LoggingState;
    expect(persisted.heartbeat.perTab[7]).toBe(true);
  });

  it('setHeartbeatPerTab(tabId, false) sets the override (overrides global=true)', async () => {
    const { storage } = stubChrome({ connected: false, heartbeat: { global: true, perTab: {} } });
    await setHeartbeatPerTab(9, false);
    const persisted = storage[STORAGE_KEY] as LoggingState;
    expect(persisted.heartbeat.perTab[9]).toBe(false);
    expect(persisted.heartbeat.global).toBe(true);
  });

  it('setHeartbeatPerTab(tabId, null) clears the override (back to inheriting global)', async () => {
    const { storage } = stubChrome({
      connected: false,
      heartbeat: { global: true, perTab: { 3: false } },
    });
    await setHeartbeatPerTab(3, null);
    const persisted = storage[STORAGE_KEY] as LoggingState;
    expect(persisted.heartbeat.perTab[3]).toBeUndefined();
    expect(persisted.heartbeat.global).toBe(true);
  });
});

// Render logic — kept pure: takes (state, tabs) and a host element.
interface KnownTab { tabId: number; url: string; slug: string }

function renderHeartbeatToggles(
  state: LoggingState,
  tabs: readonly KnownTab[],
  master: HTMLInputElement,
  perTabHost: HTMLElement,
  perTabList: HTMLElement,
): void {
  master.checked = state.heartbeat.global;
  if (tabs.length === 0) {
    perTabHost.style.display = 'none';
    return;
  }
  perTabHost.style.display = '';
  while (perTabList.firstChild !== null) perTabList.removeChild(perTabList.firstChild);
  for (const tab of tabs) {
    const li = document.createElement('li');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.tabId = String(tab.tabId);
    const override = state.heartbeat.perTab[tab.tabId];
    if (override === undefined) {
      cb.indeterminate = true;
      cb.checked = state.heartbeat.global;
    } else {
      cb.checked = override;
    }
    li.appendChild(cb);
    perTabList.appendChild(li);
  }
}

describe('renderHeartbeatToggles (#236)', () => {
  let master: HTMLInputElement;
  let perTabHost: HTMLDivElement;
  let perTabList: HTMLUListElement;

  beforeEach(() => {
    while (document.body.firstChild !== null) document.body.removeChild(document.body.firstChild);
    master = document.createElement('input');
    master.type = 'checkbox';
    perTabHost = document.createElement('div');
    perTabList = document.createElement('ul');
    perTabHost.appendChild(perTabList);
    document.body.appendChild(master);
    document.body.appendChild(perTabHost);
  });

  it('reflects the global flag on the master checkbox', () => {
    renderHeartbeatToggles(
      { connected: false, heartbeat: { global: true, perTab: {} } },
      [],
      master, perTabHost, perTabList,
    );
    expect(master.checked).toBe(true);
  });

  it('hides the per-tab host when no tabs known', () => {
    renderHeartbeatToggles(
      { connected: false, heartbeat: { global: false, perTab: {} } },
      [],
      master, perTabHost, perTabList,
    );
    expect(perTabHost.style.display).toBe('none');
  });

  it('renders one checkbox per tab and reflects override values', () => {
    renderHeartbeatToggles(
      { connected: false, heartbeat: { global: true, perTab: { 1: false, 2: true } } },
      [
        { tabId: 1, url: 'https://a.example/', slug: 'a.example/' },
        { tabId: 2, url: 'https://b.example/', slug: 'b.example/' },
      ],
      master, perTabHost, perTabList,
    );
    const boxes = perTabList.querySelectorAll('input[type=checkbox]');
    expect(boxes).toHaveLength(2);
    const tab1 = boxes[0] as HTMLInputElement;
    const tab2 = boxes[1] as HTMLInputElement;
    expect(tab1.checked).toBe(false);
    expect(tab2.checked).toBe(true);
    expect(tab1.indeterminate).toBe(false);
    expect(tab2.indeterminate).toBe(false);
  });

  it('sets indeterminate state when perTab[id] is undefined (inheriting global)', () => {
    renderHeartbeatToggles(
      { connected: false, heartbeat: { global: true, perTab: {} } },
      [{ tabId: 1, url: 'https://x.example/', slug: 'x.example/' }],
      master, perTabHost, perTabList,
    );
    const cb = perTabList.querySelector('input') as HTMLInputElement;
    expect(cb.indeterminate).toBe(true);
    // Visual state mirrors the inherited global value
    expect(cb.checked).toBe(true);
  });
});
