import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { STORAGE_KEY_INSTALL_SECRET } from './constants.js';
import { ensureInstallSecret, _resetForTesting } from './install-secret.js';

interface ChromeStub {
  storage: {
    local: {
      get: (key: string) => Promise<Record<string, unknown>>;
      set: (items: Record<string, unknown>) => Promise<void>;
    };
  };
}

function stubChrome(
  initial: Record<string, unknown> = {},
  opts: { setRejects?: Error } = {},
): {
  readStore: () => Record<string, unknown>;
  setSpy: ReturnType<typeof vi.fn>;
  getSpy: ReturnType<typeof vi.fn>;
} {
  const store: Record<string, unknown> = { ...initial };
  const setSpy = vi.fn(async (items: Record<string, unknown>) => {
    if (opts.setRejects !== undefined) throw opts.setRejects;
    Object.assign(store, items);
  });
  const getSpy = vi.fn(async (key: string) =>
    key in store ? { [key]: store[key] } : {},
  );
  const chromeStub: ChromeStub = {
    storage: {
      local: {
        get: getSpy,
        set: setSpy,
      },
    },
  };
  vi.stubGlobal('chrome', chromeStub);
  return { readStore: () => store, setSpy, getSpy };
}

describe('ensureInstallSecret', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    _resetForTesting();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    _resetForTesting();
  });

  it('returns existing secret without calling set', async () => {
    const { setSpy } = stubChrome({
      [STORAGE_KEY_INSTALL_SECRET]: 'existing-secret-1234567890ABCDEF',
    });
    expect(await ensureInstallSecret()).toBe('existing-secret-1234567890ABCDEF');
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('lazily generates and persists when storage is empty', async () => {
    const { readStore, setSpy } = stubChrome();
    const secret = await ensureInstallSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(secret.length).toBe(43); // 32 bytes -> 43 chars base64url unpadded
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith({ [STORAGE_KEY_INSTALL_SECRET]: secret });
    expect(readStore()[STORAGE_KEY_INSTALL_SECRET]).toBe(secret);
  });

  it('produces base64url alphabet only (no +, /, =)', async () => {
    stubChrome();
    const secret = await ensureInstallSecret();
    expect(secret).not.toContain('+');
    expect(secret).not.toContain('/');
    expect(secret).not.toContain('=');
  });

  it('is single-flight under concurrent calls (set invoked exactly once)', async () => {
    const { setSpy } = stubChrome();
    const [a, b, c] = await Promise.all([
      ensureInstallSecret(),
      ensureInstallSecret(),
      ensureInstallSecret(),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(setSpy).toHaveBeenCalledTimes(1);
  });

  it('is idempotent on sequential calls (no extra set after first resolved)', async () => {
    const { setSpy } = stubChrome();
    const a = await ensureInstallSecret();
    const b = await ensureInstallSecret();
    const c = await ensureInstallSecret();
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(setSpy).toHaveBeenCalledTimes(1);
  });

  it('surfaces storage.set rejection rather than returning an unpersisted secret', async () => {
    stubChrome({}, { setRejects: new Error('QUOTA_BYTES quota exceeded') });
    await expect(ensureInstallSecret()).rejects.toThrow('QUOTA_BYTES quota exceeded');
  });
});
