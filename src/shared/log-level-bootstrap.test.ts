import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bootstrapLogLevel } from './log-level-bootstrap.js';
import {
  createLogger,
  resetLoggerForTests,
  setLogSink,
  setLogLevel,
  type LogEntry,
} from './logger.js';
import { STORAGE_KEY_LOG_LEVEL } from './constants.js';

type StorageChangeListener = (
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  areaName: string,
) => void;

interface ChromeStub {
  storage: {
    local: {
      get: (key: string) => Promise<Record<string, unknown>>;
    };
    onChanged: {
      addListener: (fn: StorageChangeListener) => void;
      removeListener: (fn: StorageChangeListener) => void;
    };
  };
}

interface StubControls {
  setStored(value: unknown): void;
  fireChange(changes: Record<string, { newValue?: unknown }>, area?: string): void;
  listenerCount(): number;
}

function stubChrome(initial?: unknown): StubControls {
  let stored: unknown = initial;
  const listeners: StorageChangeListener[] = [];
  const chromeStub: ChromeStub = {
    storage: {
      local: {
        get: async (_key: string) =>
          stored === undefined ? {} : { [STORAGE_KEY_LOG_LEVEL]: stored },
      },
      onChanged: {
        addListener: (fn) => {
          listeners.push(fn);
        },
        removeListener: (fn) => {
          const idx = listeners.indexOf(fn);
          if (idx >= 0) listeners.splice(idx, 1);
        },
      },
    },
  };
  vi.stubGlobal('chrome', chromeStub);
  return {
    setStored(value: unknown) {
      stored = value;
    },
    fireChange(changes, area = 'local') {
      for (const listener of listeners) listener(changes, area);
    },
    listenerCount() {
      return listeners.length;
    },
  };
}

describe('bootstrapLogLevel', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetLoggerForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetLoggerForTests();
  });

  it('leaves the logger at default info when the storage key is absent', async () => {
    stubChrome();
    const sink = vi.fn<(entry: LogEntry) => void>();
    setLogSink(sink);

    await bootstrapLogLevel();
    const log = createLogger('Test');
    log.debug('not delivered');
    log.info('delivered');

    const calls = sink.mock.calls.map((c) => c[0]);
    expect(calls.some((e) => e.level === 'debug')).toBe(false);
    expect(calls.some((e) => e.level === 'info')).toBe(true);
  });

  it('applies a stored debug level so debug events reach the sink', async () => {
    stubChrome('debug');
    const sink = vi.fn<(entry: LogEntry) => void>();
    setLogSink(sink);

    await bootstrapLogLevel();
    const log = createLogger('Test');
    log.debug('delivered');

    const calls = sink.mock.calls.map((c) => c[0]);
    expect(calls.some((e) => e.level === 'debug' && e.message === 'delivered')).toBe(true);
  });

  it('ignores invalid stored values and leaves the logger at info', async () => {
    stubChrome('verbose');
    const sink = vi.fn<(entry: LogEntry) => void>();
    setLogSink(sink);

    await bootstrapLogLevel();
    const log = createLogger('Test');
    log.debug('not delivered');

    const calls = sink.mock.calls.map((c) => c[0]);
    expect(calls.some((e) => e.level === 'debug')).toBe(false);
  });

  it('registers a storage change listener that re-applies on key updates', async () => {
    const ctrl = stubChrome();
    const sink = vi.fn<(entry: LogEntry) => void>();
    setLogSink(sink);

    await bootstrapLogLevel();
    expect(ctrl.listenerCount()).toBe(1);

    ctrl.fireChange({ [STORAGE_KEY_LOG_LEVEL]: { newValue: 'debug' } });
    const log = createLogger('Test');
    log.debug('after-toggle');
    const calls = sink.mock.calls.map((c) => c[0]);
    expect(calls.some((e) => e.level === 'debug' && e.message === 'after-toggle')).toBe(true);
  });

  it('falls back to info when the storage key is removed at runtime', async () => {
    const ctrl = stubChrome('debug');
    const sink = vi.fn<(entry: LogEntry) => void>();
    setLogSink(sink);

    await bootstrapLogLevel();
    const log = createLogger('Test');
    log.debug('delivered-before');
    ctrl.fireChange({ [STORAGE_KEY_LOG_LEVEL]: { newValue: undefined } });
    log.debug('not-delivered-after');

    const calls = sink.mock.calls.map((c) => c[0]);
    expect(calls.some((e) => e.message === 'delivered-before')).toBe(true);
    expect(calls.some((e) => e.message === 'not-delivered-after')).toBe(false);
  });

  it('ignores changes in non-local storage areas', async () => {
    const ctrl = stubChrome();
    const sink = vi.fn<(entry: LogEntry) => void>();
    setLogSink(sink);

    await bootstrapLogLevel();
    ctrl.fireChange({ [STORAGE_KEY_LOG_LEVEL]: { newValue: 'debug' } }, 'sync');

    const log = createLogger('Test');
    log.debug('not-delivered');
    const calls = sink.mock.calls.map((c) => c[0]);
    expect(calls.some((e) => e.level === 'debug')).toBe(false);
  });

  it('swallows errors when chrome.storage is unavailable', async () => {
    vi.stubGlobal('chrome', undefined);
    setLogLevel('info');
    await expect(bootstrapLogLevel()).resolves.toBeUndefined();
  });

  it('swallows errors when chrome.storage.local.get throws', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: async () => {
            throw new Error('storage unavailable');
          },
        },
        onChanged: {
          addListener: () => {},
          removeListener: () => {},
        },
      },
    });
    setLogLevel('info');
    await expect(bootstrapLogLevel()).resolves.toBeUndefined();
  });
});
