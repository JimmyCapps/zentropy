import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  STORAGE_KEY_LOGGING_STATE,
  type LoggingState,
  getLoggingState,
  setLoggingState,
  effectiveHeartbeat,
  anyHeartbeatActive,
  broadcastLoggingState,
  sendLoggingStateToTab,
  dropTabFromLoggingState,
  refreshHeartbeatBadge,
} from './logging-broadcast.js';

interface ChromeStub {
  storage: {
    local: {
      get: (key: string) => Promise<Record<string, unknown>>;
      set: (entries: Record<string, unknown>) => Promise<void>;
    };
  };
  tabs: {
    query: (info: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>;
    sendMessage: (tabId: number, msg: unknown) => Promise<unknown>;
  };
  action: {
    setBadgeText: (details: { text: string }) => Promise<void>;
    setTitle: (details: { title: string }) => Promise<void>;
  };
}

interface SentMessage {
  readonly tabId: number;
  readonly msg: unknown;
}

interface BadgeCalls {
  readonly text: string[];
  readonly title: string[];
}

function stubChrome(initial: Partial<LoggingState> | undefined, tabs: { id: number | undefined }[]): {
  sent: SentMessage[];
  badge: BadgeCalls;
  storage: Record<string, unknown>;
} {
  const sent: SentMessage[] = [];
  const badge: BadgeCalls = { text: [], title: [] };
  const storage: Record<string, unknown> = {};
  if (initial !== undefined) {
    storage[STORAGE_KEY_LOGGING_STATE] = initial;
  }
  const stub: ChromeStub = {
    storage: {
      local: {
        get: async (key: string) => (key in storage ? { [key]: storage[key] } : {}),
        set: async (entries: Record<string, unknown>) => {
          Object.assign(storage, entries);
        },
      },
    },
    tabs: {
      query: async () => tabs as chrome.tabs.Tab[],
      sendMessage: async (tabId: number, msg: unknown) => {
        sent.push({ tabId, msg });
      },
    },
    action: {
      setBadgeText: async ({ text }) => {
        badge.text.push(text);
      },
      setTitle: async ({ title }) => {
        badge.title.push(title);
      },
    },
  };
  vi.stubGlobal('chrome', stub);
  return { sent, badge, storage };
}

const FULL_STATE = (overrides: Partial<LoggingState> = {}): LoggingState => ({
  connected: false,
  heartbeat: { global: false, perTab: {} },
  ...overrides,
});

describe('effectiveHeartbeat', () => {
  it('returns perTab[id] when defined (true)', () => {
    expect(effectiveHeartbeat(FULL_STATE({ heartbeat: { global: false, perTab: { 7: true } } }), 7)).toBe(true);
  });

  it('returns perTab[id] when defined (false) — overrides global=true', () => {
    expect(effectiveHeartbeat(FULL_STATE({ heartbeat: { global: true, perTab: { 7: false } } }), 7)).toBe(false);
  });

  it('falls back to global when perTab[id] is undefined', () => {
    expect(effectiveHeartbeat(FULL_STATE({ heartbeat: { global: true, perTab: {} } }), 7)).toBe(true);
    expect(effectiveHeartbeat(FULL_STATE({ heartbeat: { global: false, perTab: {} } }), 7)).toBe(false);
  });
});

describe('anyHeartbeatActive', () => {
  it('false when global=false and no perTab entries', () => {
    expect(anyHeartbeatActive(FULL_STATE())).toBe(false);
  });

  it('true when global=true', () => {
    expect(anyHeartbeatActive(FULL_STATE({ heartbeat: { global: true, perTab: {} } }))).toBe(true);
  });

  it('true when any perTab entry is true (even if global=false)', () => {
    expect(anyHeartbeatActive(FULL_STATE({ heartbeat: { global: false, perTab: { 1: true } } }))).toBe(true);
  });

  it('false when all perTab entries are false and global=false', () => {
    expect(anyHeartbeatActive(FULL_STATE({ heartbeat: { global: false, perTab: { 1: false, 2: false } } }))).toBe(false);
  });
});

describe('getLoggingState', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('returns the default state when storage is empty', async () => {
    stubChrome(undefined, []);
    const s = await getLoggingState();
    expect(s.connected).toBe(false);
    expect(s.heartbeat.global).toBe(false);
    expect(Object.keys(s.heartbeat.perTab)).toHaveLength(0);
  });

  it('returns the persisted state', async () => {
    stubChrome({ connected: true, heartbeat: { global: true, perTab: { 5: false } } }, []);
    const s = await getLoggingState();
    expect(s.connected).toBe(true);
    expect(s.heartbeat.global).toBe(true);
    expect(s.heartbeat.perTab[5]).toBe(false);
  });
});

describe('setLoggingState', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('partial patch merges with existing state', async () => {
    const { storage } = stubChrome({ connected: false, heartbeat: { global: true, perTab: { 1: true } } }, []);
    await setLoggingState({ connected: true });
    const persisted = storage[STORAGE_KEY_LOGGING_STATE] as LoggingState;
    expect(persisted.connected).toBe(true);
    expect(persisted.heartbeat.global).toBe(true);
    expect(persisted.heartbeat.perTab[1]).toBe(true);
  });
});

describe('broadcastLoggingState', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('sends per-tab resolved state to each active tab', async () => {
    const { sent } = stubChrome(
      { connected: true, heartbeat: { global: false, perTab: { 2: true } } },
      [{ id: 1 }, { id: 2 }],
    );
    await broadcastLoggingState();
    expect(sent).toHaveLength(2);
    const tab1 = sent.find((s) => s.tabId === 1);
    const tab2 = sent.find((s) => s.tabId === 2);
    expect((tab1!.msg as { type: string; connected: boolean; heartbeat: boolean })).toEqual({
      type: 'SET_LOGGING_STATE',
      connected: true,
      heartbeat: false, // global=false, no perTab[1]
    });
    expect((tab2!.msg as { type: string; connected: boolean; heartbeat: boolean })).toEqual({
      type: 'SET_LOGGING_STATE',
      connected: true,
      heartbeat: true, // perTab[2]=true
    });
  });

  it('skips tabs without an id', async () => {
    const { sent } = stubChrome({ connected: false, heartbeat: { global: true, perTab: {} } }, [
      { id: undefined },
      { id: 5 },
    ]);
    await broadcastLoggingState();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.tabId).toBe(5);
  });
});

describe('sendLoggingStateToTab', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('sends the resolved state for the given tab id', async () => {
    const { sent } = stubChrome({ connected: true, heartbeat: { global: false, perTab: { 9: true } } }, []);
    await sendLoggingStateToTab(9);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.tabId).toBe(9);
    expect((sent[0]!.msg as { heartbeat: boolean }).heartbeat).toBe(true);
  });
});

describe('dropTabFromLoggingState', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('strips the per-tab override', async () => {
    const { storage } = stubChrome(
      { connected: false, heartbeat: { global: false, perTab: { 1: true, 2: false } } },
      [],
    );
    await dropTabFromLoggingState(1);
    const persisted = storage[STORAGE_KEY_LOGGING_STATE] as LoggingState;
    expect(persisted.heartbeat.perTab[1]).toBeUndefined();
    expect(persisted.heartbeat.perTab[2]).toBe(false);
  });

  it('is a no-op when the tab has no override', async () => {
    const { storage } = stubChrome({ connected: false, heartbeat: { global: false, perTab: {} } }, []);
    const before = JSON.stringify(storage);
    await dropTabFromLoggingState(99);
    expect(JSON.stringify(storage)).toBe(before);
  });
});

describe('refreshHeartbeatBadge', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('sets badge when heartbeat is active globally', async () => {
    const { badge } = stubChrome({ connected: false, heartbeat: { global: true, perTab: {} } }, []);
    await refreshHeartbeatBadge();
    expect(badge.text[0]).toBe('\u{1F7E1}');
    expect(badge.title[0]).toContain('Heartbeat active');
  });

  it('sets badge when heartbeat is active for any tab', async () => {
    const { badge } = stubChrome({ connected: false, heartbeat: { global: false, perTab: { 3: true } } }, []);
    await refreshHeartbeatBadge();
    expect(badge.text[0]).toBe('\u{1F7E1}');
  });

  it('clears badge when no heartbeat is active', async () => {
    const { badge } = stubChrome({ connected: false, heartbeat: { global: false, perTab: { 1: false } } }, []);
    await refreshHeartbeatBadge();
    expect(badge.text[0]).toBe('');
    expect(badge.title[0]).toBe('HoneyLLM');
  });
});
