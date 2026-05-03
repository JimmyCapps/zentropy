/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initHeartbeatBanner, isHeartbeatActiveForTab } from './heartbeat-banner.js';

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
    query: (info: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>;
  };
}

function stubChrome(initial: Partial<LoggingState> | undefined, currentTabId: number | undefined): {
  storage: Record<string, unknown>;
} {
  const storage: Record<string, unknown> = {};
  if (initial !== undefined) storage[STORAGE_KEY] = initial;
  const stub: ChromeStub = {
    storage: {
      local: {
        get: async (key: string) => (key in storage ? { [key]: storage[key] } : {}),
        set: async (entries: Record<string, unknown>) => {
          Object.assign(storage, entries);
        },
      },
      onChanged: { addListener: () => undefined },
    },
    tabs: {
      query: async () => (currentTabId !== undefined ? [{ id: currentTabId } as chrome.tabs.Tab] : []),
    },
  };
  vi.stubGlobal('chrome', stub);
  return { storage };
}

describe('isHeartbeatActiveForTab (#236)', () => {
  const STATE = (overrides: Partial<LoggingState> = {}): LoggingState => ({
    connected: false,
    heartbeat: { global: false, perTab: {} },
    ...overrides,
  });

  it('false when global=false and no perTab override', () => {
    expect(isHeartbeatActiveForTab(STATE(), 1)).toBe(false);
  });

  it('true when global=true (regardless of tabId)', () => {
    expect(isHeartbeatActiveForTab(STATE({ heartbeat: { global: true, perTab: {} } }), 1)).toBe(true);
    expect(isHeartbeatActiveForTab(STATE({ heartbeat: { global: true, perTab: {} } }), undefined)).toBe(true);
  });

  it('true when perTab[currentTab]=true (even if global=false)', () => {
    expect(isHeartbeatActiveForTab(STATE({ heartbeat: { global: false, perTab: { 5: true } } }), 5)).toBe(true);
  });

  it('false when perTab[currentTab]=false (override defeats global=false)', () => {
    expect(isHeartbeatActiveForTab(STATE({ heartbeat: { global: false, perTab: { 5: false } } }), 5)).toBe(false);
  });

  it('false when perTab override is for a DIFFERENT tab', () => {
    expect(isHeartbeatActiveForTab(STATE({ heartbeat: { global: false, perTab: { 7: true } } }), 5)).toBe(false);
  });
});

describe('initHeartbeatBanner — banner rendering (#236)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    while (document.body.firstChild !== null) document.body.removeChild(document.body.firstChild);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('does NOT render a visible banner when no heartbeat is active', async () => {
    stubChrome({ connected: false, heartbeat: { global: false, perTab: {} } }, 1);
    await initHeartbeatBanner();
    const banner = document.getElementById('heartbeat-banner') as HTMLDivElement;
    expect(banner).not.toBeNull();
    expect(banner.style.display).toBe('none');
  });

  it('renders the banner when heartbeat.global=true', async () => {
    stubChrome({ connected: false, heartbeat: { global: true, perTab: {} } }, 1);
    await initHeartbeatBanner();
    const banner = document.getElementById('heartbeat-banner') as HTMLDivElement;
    expect(banner.style.display).toBe('flex');
    expect(banner.textContent).toContain('Heartbeat active');
  });

  it('renders the banner when heartbeat.perTab[currentTab]=true (even if global=false)', async () => {
    stubChrome({ connected: false, heartbeat: { global: false, perTab: { 42: true } } }, 42);
    await initHeartbeatBanner();
    const banner = document.getElementById('heartbeat-banner') as HTMLDivElement;
    expect(banner.style.display).toBe('flex');
  });

  it('does NOT render when global=false and only OTHER tabs have overrides', async () => {
    stubChrome({ connected: false, heartbeat: { global: false, perTab: { 99: true } } }, 1);
    await initHeartbeatBanner();
    const banner = document.getElementById('heartbeat-banner') as HTMLDivElement;
    expect(banner.style.display).toBe('none');
  });

  it('clicking the banner writes global=false AND perTab[currentTab]=false', async () => {
    const { storage } = stubChrome(
      { connected: false, heartbeat: { global: true, perTab: {} } },
      77,
    );
    await initHeartbeatBanner();
    const banner = document.getElementById('heartbeat-banner') as HTMLDivElement;
    banner.click();
    // Allow the write to settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const persisted = storage[STORAGE_KEY] as LoggingState;
    expect(persisted.heartbeat.global).toBe(false);
    expect(persisted.heartbeat.perTab[77]).toBe(false);
  });

  it('inserts the banner as the first child of the host', async () => {
    stubChrome({ connected: false, heartbeat: { global: true, perTab: {} } }, 1);
    const sibling = document.createElement('p');
    sibling.id = 'sibling';
    document.body.appendChild(sibling);
    await initHeartbeatBanner();
    expect(document.body.firstChild?.nodeType).toBe(Node.ELEMENT_NODE);
    expect((document.body.firstChild as HTMLElement).id).toBe('heartbeat-banner');
  });
});
