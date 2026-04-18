import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getOverrides, setOverride, clearOverride } from './origin-storage.js';
import { STORAGE_KEY_ORIGIN_OVERRIDES } from '@/shared/constants.js';

interface ChromeStub {
  storage: {
    sync: {
      get: (key: string) => Promise<Record<string, unknown>>;
      set: (items: Record<string, unknown>) => Promise<void>;
    };
  };
}

function stubChrome(initial: Record<string, unknown> = {}): {
  readStore: () => Record<string, unknown>;
} {
  const store: Record<string, unknown> = { ...initial };
  const chromeStub: ChromeStub = {
    storage: {
      sync: {
        get: async (key) => (key in store ? { [key]: store[key] } : {}),
        set: async (items) => {
          Object.assign(store, items);
        },
      },
    },
  };
  vi.stubGlobal('chrome', chromeStub);
  return { readStore: () => store };
}

describe('origin-storage', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getOverrides', () => {
    it('returns empty object when key is absent', async () => {
      stubChrome();
      expect(await getOverrides()).toEqual({});
    });

    it('returns stored overrides', async () => {
      stubChrome({
        [STORAGE_KEY_ORIGIN_OVERRIDES]: {
          'example.com': 'skip',
          'mail.google.com': 'scan',
        },
      });
      expect(await getOverrides()).toEqual({
        'example.com': 'skip',
        'mail.google.com': 'scan',
      });
    });

    it('filters garbage values (only "scan" and "skip" are accepted)', async () => {
      stubChrome({
        [STORAGE_KEY_ORIGIN_OVERRIDES]: {
          'valid.com': 'skip',
          'nonsense.com': 'maybe',
          'numeric.com': 1,
          'nested.com': { obj: true },
        },
      });
      expect(await getOverrides()).toEqual({ 'valid.com': 'skip' });
    });

    it('normalises keys to lowercase', async () => {
      stubChrome({
        [STORAGE_KEY_ORIGIN_OVERRIDES]: { 'Example.COM': 'skip' },
      });
      expect(await getOverrides()).toEqual({ 'example.com': 'skip' });
    });

    it('returns empty when stored value is not an object', async () => {
      stubChrome({ [STORAGE_KEY_ORIGIN_OVERRIDES]: 'not-an-object' });
      expect(await getOverrides()).toEqual({});
    });

    it('returns empty when stored value is null', async () => {
      stubChrome({ [STORAGE_KEY_ORIGIN_OVERRIDES]: null });
      expect(await getOverrides()).toEqual({});
    });
  });

  describe('setOverride', () => {
    it('writes a new override under the lowercased host', async () => {
      const { readStore } = stubChrome();
      await setOverride('Example.COM', 'skip');
      expect(readStore()[STORAGE_KEY_ORIGIN_OVERRIDES]).toEqual({
        'example.com': 'skip',
      });
    });

    it('preserves existing overrides when adding a new one', async () => {
      const { readStore } = stubChrome({
        [STORAGE_KEY_ORIGIN_OVERRIDES]: { 'a.com': 'skip' },
      });
      await setOverride('b.com', 'scan');
      expect(readStore()[STORAGE_KEY_ORIGIN_OVERRIDES]).toEqual({
        'a.com': 'skip',
        'b.com': 'scan',
      });
    });

    it('overwrites an existing override for the same host', async () => {
      const { readStore } = stubChrome({
        [STORAGE_KEY_ORIGIN_OVERRIDES]: { 'example.com': 'skip' },
      });
      await setOverride('example.com', 'scan');
      expect(readStore()[STORAGE_KEY_ORIGIN_OVERRIDES]).toEqual({
        'example.com': 'scan',
      });
    });

    it('extracts hostname from a full URL', async () => {
      const { readStore } = stubChrome();
      await setOverride('https://mail.google.com/mail/u/0/#inbox', 'scan');
      expect(readStore()[STORAGE_KEY_ORIGIN_OVERRIDES]).toEqual({
        'mail.google.com': 'scan',
      });
    });

    it('silently ignores unparseable origins', async () => {
      const { readStore } = stubChrome();
      await setOverride('', 'skip');
      expect(readStore()[STORAGE_KEY_ORIGIN_OVERRIDES]).toBeUndefined();
    });
  });

  describe('clearOverride', () => {
    it('removes a stored override', async () => {
      const { readStore } = stubChrome({
        [STORAGE_KEY_ORIGIN_OVERRIDES]: {
          'a.com': 'skip',
          'b.com': 'scan',
        },
      });
      await clearOverride('a.com');
      expect(readStore()[STORAGE_KEY_ORIGIN_OVERRIDES]).toEqual({ 'b.com': 'scan' });
    });

    it('is a no-op when the origin has no override', async () => {
      const { readStore } = stubChrome({
        [STORAGE_KEY_ORIGIN_OVERRIDES]: { 'a.com': 'skip' },
      });
      await clearOverride('nonexistent.com');
      expect(readStore()[STORAGE_KEY_ORIGIN_OVERRIDES]).toEqual({ 'a.com': 'skip' });
    });

    it('accepts a full URL', async () => {
      const { readStore } = stubChrome({
        [STORAGE_KEY_ORIGIN_OVERRIDES]: { 'mail.google.com': 'scan' },
      });
      await clearOverride('https://mail.google.com/foo');
      expect(readStore()[STORAGE_KEY_ORIGIN_OVERRIDES]).toEqual({});
    });

    it('silently ignores unparseable origins', async () => {
      const { readStore } = stubChrome({
        [STORAGE_KEY_ORIGIN_OVERRIDES]: { 'a.com': 'skip' },
      });
      await clearOverride('');
      expect(readStore()[STORAGE_KEY_ORIGIN_OVERRIDES]).toEqual({ 'a.com': 'skip' });
    });
  });
});
