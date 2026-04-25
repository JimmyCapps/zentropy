import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadState, saveState, STORAGE_KEY } from './harness-state.js';

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

beforeEach(() => {
  mockStorage = makeMockStorage();
  vi.stubGlobal('localStorage', mockStorage);
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
