import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadState, saveState, STORAGE_KEY, acquireSweepLock, isSweepLocked, SWEEP_LOCK_PREFIX } from './harness-state.js';

interface MockStorage {
  store: Map<string, string>;
  setShouldThrow: boolean;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
}

function makeMockStorage(): MockStorage {
  const store = new Map<string, string>();
  return {
    store,
    setShouldThrow: false,
    getItem(key: string): string | null {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string): void {
      if (this.setShouldThrow) {
        const err = new Error('Quota exceeded') as Error & { name: string };
        err.name = 'QuotaExceededError';
        throw err;
      }
      store.set(key, value);
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    clear(): void {
      store.clear();
    },
  };
}

let mockStorage: MockStorage;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

interface LockRequestOptions {
  readonly ifAvailable?: boolean;
}
type LockCallback = (lock: { readonly name: string } | null) => Promise<unknown> | unknown;
interface MockLockManager {
  readonly held: Set<string>;
  request(name: string, options: LockRequestOptions, callback: LockCallback): Promise<unknown>;
  query(): Promise<{ held: ReadonlyArray<{ name: string }>; pending: ReadonlyArray<unknown> }>;
}

function makeMockLockManager(): MockLockManager {
  const held = new Set<string>();
  return {
    held,
    async request(name, options, callback): Promise<unknown> {
      if (held.has(name)) {
        if (options.ifAvailable === true) {
          return await callback(null);
        }
        // Without ifAvailable, real Web Locks API would queue. Tests don't
        // exercise that path; surface it loudly so we don't accidentally
        // depend on queueing semantics.
        throw new Error('mock: lock contention without ifAvailable not supported in tests');
      }
      held.add(name);
      try {
        return await callback({ name });
      } finally {
        held.delete(name);
      }
    },
    async query() {
      return {
        held: [...held].map((name) => ({ name })),
        pending: [],
      };
    },
  };
}

let mockLocks: MockLockManager;

beforeEach(() => {
  mockStorage = makeMockStorage();
  vi.stubGlobal('localStorage', mockStorage);
  mockLocks = makeMockLockManager();
  vi.stubGlobal('navigator', { locks: mockLocks });
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  consoleErrorSpy.mockRestore();
});

describe('loadState', () => {
  it('returns empty bag when storage is empty', () => {
    expect(loadState()).toEqual({});
  });

  it('returns empty bag when raw value is invalid JSON', () => {
    mockStorage.store.set(STORAGE_KEY, '{not json');
    expect(loadState()).toEqual({});
  });

  it('returns empty bag when stored value is null literal', () => {
    mockStorage.store.set(STORAGE_KEY, 'null');
    expect(loadState()).toEqual({});
  });

  it('returns empty bag when stored value is a primitive (number/string)', () => {
    mockStorage.store.set(STORAGE_KEY, '42');
    expect(loadState()).toEqual({});
    mockStorage.store.set(STORAGE_KEY, '"some string"');
    expect(loadState()).toEqual({});
  });

  it('PRS-1: rejects an array even though typeof [] === "object"', () => {
    mockStorage.store.set(STORAGE_KEY, '[1,2,3]');
    const result = loadState();
    expect(Array.isArray(result)).toBe(false);
    expect(result).toEqual({});
  });

  it('returns the parsed object on a valid round-trip', () => {
    mockStorage.store.set(STORAGE_KEY, JSON.stringify({ alpha: 1, beta: 'two' }));
    expect(loadState()).toEqual({ alpha: 1, beta: 'two' });
  });
});

describe('saveState — happy path', () => {
  it('writes serialized state to storage and returns true', () => {
    const ok = saveState({ key: 'value', n: 7 });
    expect(ok).toBe(true);
    expect(mockStorage.store.get(STORAGE_KEY)).toBe(JSON.stringify({ key: 'value', n: 7 }));
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('round-trips through loadState cleanly', () => {
    expect(saveState({ a: 1, b: [2, 3], c: { nested: true } })).toBe(true);
    expect(loadState()).toEqual({ a: 1, b: [2, 3], c: { nested: true } });
  });
});

describe('saveState — PRS-2: validator rejects unsupported types', () => {
  it('returns false and logs on top-level BigInt', () => {
    const ok = saveState({ count: 123n });
    expect(ok).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('BigInt is not JSON-serializable'),
    );
    expect(mockStorage.store.has(STORAGE_KEY)).toBe(false);
  });

  it('returns false on nested BigInt with the path in the log', () => {
    const ok = saveState({ outer: { inner: 1n } });
    expect(ok).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('$.outer.inner'),
    );
  });

  it('returns false on a circular reference', () => {
    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic.self = cyclic;
    const ok = saveState(cyclic);
    expect(ok).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('circular reference'),
    );
  });

  it('returns false on Date (silently coerced to string by JSON.stringify)', () => {
    const ok = saveState({ when: new Date('2026-04-25') });
    expect(ok).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Date'),
    );
  });

  it('returns false on Map (silently becomes {})', () => {
    const ok = saveState({ table: new Map([['k', 'v']]) });
    expect(ok).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Map'),
    );
  });

  it('returns false on Set', () => {
    const ok = saveState({ s: new Set([1, 2, 3]) });
    expect(ok).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Set'),
    );
  });

  it('returns false on RegExp', () => {
    const ok = saveState({ pattern: /abc/ });
    expect(ok).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('RegExp'),
    );
  });

  it('returns false on a function', () => {
    const ok = saveState({ fn: () => 1 });
    expect(ok).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('function'),
    );
  });

  it('returns false on a symbol', () => {
    const ok = saveState({ sym: Symbol('x') });
    expect(ok).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('symbol'),
    );
  });

  it('rejects a bad value inside an array', () => {
    const ok = saveState({ list: [1, 2, 99n] });
    expect(ok).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('$.list[2]'),
    );
  });
});

describe('saveState — PRS-3: localStorage write failures', () => {
  it('returns false and logs on QuotaExceededError', () => {
    mockStorage.setShouldThrow = true;
    const ok = saveState({ ok: true });
    expect(ok).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('QuotaExceededError'),
      expect.any(Error),
    );
    expect(mockStorage.store.has(STORAGE_KEY)).toBe(false);
  });
});

describe('acquireSweepLock', () => {
  it('returns a release function when the lock is free', async () => {
    const release = await acquireSweepLock('nano');
    expect(release).not.toBeNull();
    expect(typeof release).toBe('function');
    expect(mockLocks.held.has(`${SWEEP_LOCK_PREFIX}nano`)).toBe(true);
    release!();
    // Web Locks API resolves the held promise asynchronously; give the
    // microtask queue a tick so the release propagates before assertion.
    await Promise.resolve();
    expect(mockLocks.held.has(`${SWEEP_LOCK_PREFIX}nano`)).toBe(false);
  });

  it('returns null when the lock is already held', async () => {
    mockLocks.held.add(`${SWEEP_LOCK_PREFIX}nano`);
    const release = await acquireSweepLock('nano');
    expect(release).toBeNull();
  });

  it('isolates nano vs summarizer locks', async () => {
    const nanoRelease = await acquireSweepLock('nano');
    expect(nanoRelease).not.toBeNull();
    const sumRelease = await acquireSweepLock('summarizer');
    expect(sumRelease).not.toBeNull();
    nanoRelease!();
    sumRelease!();
    await Promise.resolve();
    expect(mockLocks.held.size).toBe(0);
  });

  it('release is idempotent in the sense that double-call does not blow up', async () => {
    const release = await acquireSweepLock('nano');
    expect(release).not.toBeNull();
    release!();
    // Calling the release twice is a no-op for the second call (the
    // underlying promise has already resolved). The test asserts no throw.
    expect(() => release!()).not.toThrow();
  });
});

describe('isSweepLocked', () => {
  it('returns false when no locks are held', async () => {
    expect(await isSweepLocked('nano')).toBe(false);
    expect(await isSweepLocked('summarizer')).toBe(false);
  });

  it('returns true for the kind that is held', async () => {
    mockLocks.held.add(`${SWEEP_LOCK_PREFIX}nano`);
    expect(await isSweepLocked('nano')).toBe(true);
    expect(await isSweepLocked('summarizer')).toBe(false);
  });

  it('reflects state changes after acquire and release', async () => {
    expect(await isSweepLocked('nano')).toBe(false);
    const release = await acquireSweepLock('nano');
    expect(await isSweepLocked('nano')).toBe(true);
    release!();
    await Promise.resolve();
    expect(await isSweepLocked('nano')).toBe(false);
  });
});
