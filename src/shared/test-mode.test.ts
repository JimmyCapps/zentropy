import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isTestModeEnabled } from './test-mode.js';
import { STORAGE_KEY_TEST_MODE } from './constants.js';

interface ChromeStub {
  storage: {
    local: {
      get: (key: string) => Promise<Record<string, unknown>>;
    };
  };
}

function stubChrome(getImpl: (key: string) => Promise<Record<string, unknown>>): void {
  const chromeStub: ChromeStub = { storage: { local: { get: getImpl } } };
  vi.stubGlobal('chrome', chromeStub);
}

describe('isTestModeEnabled (Phase 3 Track A gate)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns false when the key is absent from storage', async () => {
    stubChrome(async () => ({}));
    expect(await isTestModeEnabled()).toBe(false);
  });

  it('returns false when the key is explicitly false', async () => {
    stubChrome(async () => ({ [STORAGE_KEY_TEST_MODE]: false }));
    expect(await isTestModeEnabled()).toBe(false);
  });

  it('returns false for truthy-but-not-true values (string, number, object)', async () => {
    for (const sneaky of ['true', 1, 'yes', {}, []]) {
      stubChrome(async () => ({ [STORAGE_KEY_TEST_MODE]: sneaky }));
      expect(await isTestModeEnabled()).toBe(false);
    }
  });

  it('returns true ONLY when the key is strictly boolean true', async () => {
    stubChrome(async () => ({ [STORAGE_KEY_TEST_MODE]: true }));
    expect(await isTestModeEnabled()).toBe(true);
  });

  it('returns false when chrome.storage.local.get throws', async () => {
    stubChrome(async () => {
      throw new Error('storage unavailable');
    });
    expect(await isTestModeEnabled()).toBe(false);
  });

  it('queries the expected storage key', async () => {
    const getSpy = vi.fn(async (_key: string) => ({ [STORAGE_KEY_TEST_MODE]: true }));
    stubChrome(getSpy);
    await isTestModeEnabled();
    expect(getSpy).toHaveBeenCalledWith(STORAGE_KEY_TEST_MODE);
  });
});
