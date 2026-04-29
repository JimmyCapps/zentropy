import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { STORAGE_KEY_TESTING_MODE } from './constants.js';
import { isTestingModeEnabled, setTestingMode } from './testing-mode.js';

interface ChromeStub {
  storage: {
    local: {
      get: (key: string) => Promise<Record<string, unknown>>;
      set: (items: Record<string, unknown>) => Promise<void>;
    };
  };
}

function stubChrome(initial: Record<string, unknown> = {}): {
  readStore: () => Record<string, unknown>;
  setSpy: ReturnType<typeof vi.fn>;
  getSpy: ReturnType<typeof vi.fn>;
} {
  const store: Record<string, unknown> = { ...initial };
  const setSpy = vi.fn(async (items: Record<string, unknown>) => {
    Object.assign(store, items);
  });
  const getSpy = vi.fn(async (key: string) =>
    key in store ? { [key]: store[key] } : {},
  );
  const chromeStub: ChromeStub = {
    storage: { local: { get: getSpy, set: setSpy } },
  };
  vi.stubGlobal('chrome', chromeStub);
  return { readStore: () => store, setSpy, getSpy };
}

describe('isTestingModeEnabled', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('returns false when key is absent', async () => {
    stubChrome();
    expect(await isTestingModeEnabled()).toBe(false);
  });

  it('returns false when stored value is non-boolean (number 1)', async () => {
    stubChrome({ [STORAGE_KEY_TESTING_MODE]: 1 });
    expect(await isTestingModeEnabled()).toBe(false);
  });

  it('returns false when stored value is the string "true"', async () => {
    stubChrome({ [STORAGE_KEY_TESTING_MODE]: 'true' });
    expect(await isTestingModeEnabled()).toBe(false);
  });

  it('returns false when stored value is null', async () => {
    stubChrome({ [STORAGE_KEY_TESTING_MODE]: null });
    expect(await isTestingModeEnabled()).toBe(false);
  });

  it('returns false when stored value is boolean false', async () => {
    stubChrome({ [STORAGE_KEY_TESTING_MODE]: false });
    expect(await isTestingModeEnabled()).toBe(false);
  });

  it('returns true only when stored value is strictly boolean true', async () => {
    stubChrome({ [STORAGE_KEY_TESTING_MODE]: true });
    expect(await isTestingModeEnabled()).toBe(true);
  });
});

describe('setTestingMode', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('writes { honeyllm:testing-mode: true } to chrome.storage.local', async () => {
    const { setSpy, readStore } = stubChrome();
    await setTestingMode(true);
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith({ [STORAGE_KEY_TESTING_MODE]: true });
    expect(readStore()[STORAGE_KEY_TESTING_MODE]).toBe(true);
  });

  it('writes { honeyllm:testing-mode: false } to chrome.storage.local', async () => {
    const { setSpy, readStore } = stubChrome({ [STORAGE_KEY_TESTING_MODE]: true });
    await setTestingMode(false);
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith({ [STORAGE_KEY_TESTING_MODE]: false });
    expect(readStore()[STORAGE_KEY_TESTING_MODE]).toBe(false);
  });

  it('round-trips via isTestingModeEnabled', async () => {
    stubChrome();
    expect(await isTestingModeEnabled()).toBe(false);
    await setTestingMode(true);
    expect(await isTestingModeEnabled()).toBe(true);
    await setTestingMode(false);
    expect(await isTestingModeEnabled()).toBe(false);
  });
});
