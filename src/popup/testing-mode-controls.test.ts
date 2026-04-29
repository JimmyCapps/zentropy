// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { STORAGE_KEY_TESTING_MODE } from '@/shared/constants.js';
import {
  initTestingModeToggle,
  initRescanButton,
  initRescanPageButton,
} from './testing-mode-controls.js';

interface ChromeStub {
  storage: {
    local: {
      get: (key: string) => Promise<Record<string, unknown>>;
      set: (items: Record<string, unknown>) => Promise<void>;
    };
  };
  runtime: { sendMessage: (msg: unknown) => Promise<unknown> };
  tabs: { query: (q: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]> };
}

function stubChrome(opts: {
  testingMode?: boolean;
  setRejects?: Error;
  activeTabId?: number | undefined;
  activeTabUrl?: string;
  sendRejects?: Error;
} = {}): {
  store: Record<string, unknown>;
  setSpy: ReturnType<typeof vi.fn>;
  sendSpy: ReturnType<typeof vi.fn>;
  querySpy: ReturnType<typeof vi.fn>;
} {
  const store: Record<string, unknown> = {};
  if (opts.testingMode !== undefined) store[STORAGE_KEY_TESTING_MODE] = opts.testingMode;
  const setSpy = vi.fn(async (items: Record<string, unknown>) => {
    if (opts.setRejects !== undefined) throw opts.setRejects;
    Object.assign(store, items);
  });
  const getSpy = vi.fn(async (key: string) =>
    key in store ? { [key]: store[key] } : {},
  );
  const sendSpy = vi.fn(async (_msg: unknown) => {
    if (opts.sendRejects !== undefined) throw opts.sendRejects;
    return undefined;
  });
  const querySpy = vi.fn(async (_q: chrome.tabs.QueryInfo) => {
    const tab: Partial<chrome.tabs.Tab> = {};
    if (opts.activeTabId !== undefined) tab.id = opts.activeTabId;
    if (opts.activeTabUrl !== undefined) tab.url = opts.activeTabUrl;
    return [tab as chrome.tabs.Tab];
  });
  const chromeStub: ChromeStub = {
    storage: { local: { get: getSpy, set: setSpy } },
    runtime: { sendMessage: sendSpy },
    tabs: { query: querySpy },
  };
  vi.stubGlobal('chrome', chromeStub);
  return { store, setSpy, sendSpy, querySpy };
}

function makeCheckbox(): HTMLInputElement {
  const el = document.createElement('input');
  el.type = 'checkbox';
  return el;
}

function makeButton(): HTMLButtonElement {
  return document.createElement('button');
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('initTestingModeToggle', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('initial checkbox state reflects stored testing-mode=false', async () => {
    stubChrome({ testingMode: false });
    const checkbox = makeCheckbox();
    await initTestingModeToggle(checkbox, () => {});
    expect(checkbox.checked).toBe(false);
  });

  it('initial checkbox state reflects stored testing-mode=true', async () => {
    stubChrome({ testingMode: true });
    const checkbox = makeCheckbox();
    await initTestingModeToggle(checkbox, () => {});
    expect(checkbox.checked).toBe(true);
  });

  it('initial checkbox state defaults to false when key absent', async () => {
    stubChrome({});
    const checkbox = makeCheckbox();
    await initTestingModeToggle(checkbox, () => {});
    expect(checkbox.checked).toBe(false);
  });

  it('toggling checkbox to true calls setTestingMode(true) and shows ON toast', async () => {
    const { setSpy } = stubChrome({ testingMode: false });
    const checkbox = makeCheckbox();
    const toasts: string[] = [];
    await initTestingModeToggle(checkbox, (m) => toasts.push(m));

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    await flushMicrotasks();

    expect(setSpy).toHaveBeenCalledWith({ [STORAGE_KEY_TESTING_MODE]: true });
    expect(toasts[0]).toContain('Testing mode ON');
  });

  it('toggling checkbox to false calls setTestingMode(false) and shows OFF toast', async () => {
    const { setSpy } = stubChrome({ testingMode: true });
    const checkbox = makeCheckbox();
    const toasts: string[] = [];
    await initTestingModeToggle(checkbox, (m) => toasts.push(m));

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    await flushMicrotasks();

    expect(setSpy).toHaveBeenCalledWith({ [STORAGE_KEY_TESTING_MODE]: false });
    expect(toasts[0]).toContain('Testing mode OFF');
  });

  it('rolls back checkbox state and toasts on persist failure', async () => {
    stubChrome({ testingMode: false, setRejects: new Error('quota exceeded') });
    const checkbox = makeCheckbox();
    const toasts: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await initTestingModeToggle(checkbox, (m) => toasts.push(m));

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    await flushMicrotasks();

    expect(checkbox.checked).toBe(false); // rolled back
    expect(toasts[0]).toContain('Failed');
    errorSpy.mockRestore();
  });
});

describe('initRescanButton', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('button is disabled when verdictStatus is undefined', () => {
    stubChrome();
    const btn = makeButton();
    initRescanButton(btn, undefined, () => {});
    expect(btn.disabled).toBe(true);
  });

  it('button is disabled when verdictStatus is CLEAN', () => {
    stubChrome();
    const btn = makeButton();
    initRescanButton(btn, 'CLEAN', () => {});
    expect(btn.disabled).toBe(true);
  });

  it('button is disabled when verdictStatus is UNKNOWN', () => {
    stubChrome();
    const btn = makeButton();
    initRescanButton(btn, 'UNKNOWN', () => {});
    expect(btn.disabled).toBe(true);
  });

  it('button is enabled when verdictStatus is SUSPICIOUS', () => {
    stubChrome();
    const btn = makeButton();
    initRescanButton(btn, 'SUSPICIOUS', () => {});
    expect(btn.disabled).toBe(false);
  });

  it('button is enabled when verdictStatus is COMPROMISED', () => {
    stubChrome();
    const btn = makeButton();
    initRescanButton(btn, 'COMPROMISED', () => {});
    expect(btn.disabled).toBe(false);
  });

  it('clicking enabled button sends RESCAN_WITH_MITIGATION with active tabId', async () => {
    const { sendSpy } = stubChrome({ activeTabId: 77 });
    const btn = makeButton();
    const toasts: string[] = [];
    initRescanButton(btn, 'SUSPICIOUS', (m) => toasts.push(m));

    btn.click();
    await flushMicrotasks();

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0]![0]).toEqual({ type: 'RESCAN_WITH_MITIGATION', tabId: 77 });
    expect(toasts[0]).toContain('Rescan triggered');
  });

  it('clicking disabled button does NOT send any message (listener never attached)', async () => {
    const { sendSpy } = stubChrome({ activeTabId: 1 });
    const btn = makeButton();
    initRescanButton(btn, 'CLEAN', () => {});

    btn.click();
    await flushMicrotasks();

    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('toasts when no active tab is found', async () => {
    const { sendSpy } = stubChrome({ activeTabId: undefined });
    const btn = makeButton();
    const toasts: string[] = [];
    initRescanButton(btn, 'COMPROMISED', (m) => toasts.push(m));

    btn.click();
    await flushMicrotasks();

    expect(sendSpy).not.toHaveBeenCalled();
    expect(toasts[0]).toContain('No active tab');
  });

  it('toasts on chrome.runtime.sendMessage rejection', async () => {
    stubChrome({ activeTabId: 1, sendRejects: new Error('SW disconnected') });
    const btn = makeButton();
    const toasts: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    initRescanButton(btn, 'COMPROMISED', (m) => toasts.push(m));

    btn.click();
    await flushMicrotasks();

    expect(toasts[0]).toContain('Rescan failed');
    errorSpy.mockRestore();
  });
});

describe('initRescanPageButton', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('disables the button on chrome:// tab', async () => {
    stubChrome({ activeTabId: 5, activeTabUrl: 'chrome://extensions/' });
    const btn = makeButton();
    await initRescanPageButton(btn, () => {});
    expect(btn.disabled).toBe(true);
  });

  it('disables the button on chrome-extension:// tab', async () => {
    stubChrome({ activeTabId: 5, activeTabUrl: 'chrome-extension://abc/popup.html' });
    const btn = makeButton();
    await initRescanPageButton(btn, () => {});
    expect(btn.disabled).toBe(true);
  });

  it('disables the button on about: tab', async () => {
    stubChrome({ activeTabId: 5, activeTabUrl: 'about:blank' });
    const btn = makeButton();
    await initRescanPageButton(btn, () => {});
    expect(btn.disabled).toBe(true);
  });

  it('disables the button when tab has no URL', async () => {
    stubChrome({ activeTabId: 5 });
    const btn = makeButton();
    await initRescanPageButton(btn, () => {});
    expect(btn.disabled).toBe(true);
  });

  it('disables the button when tab has no id', async () => {
    stubChrome({ activeTabUrl: 'https://example.com/' });
    const btn = makeButton();
    await initRescanPageButton(btn, () => {});
    expect(btn.disabled).toBe(true);
  });

  it('enables the button on https:// tab', async () => {
    stubChrome({ activeTabId: 33, activeTabUrl: 'https://example.com/' });
    const btn = makeButton();
    await initRescanPageButton(btn, () => {});
    expect(btn.disabled).toBe(false);
  });

  it('enables the button on http:// tab', async () => {
    stubChrome({ activeTabId: 33, activeTabUrl: 'http://localhost:3000/' });
    const btn = makeButton();
    await initRescanPageButton(btn, () => {});
    expect(btn.disabled).toBe(false);
  });

  it('clicking the enabled button sends RESCAN_PAGE with the tab id', async () => {
    const { sendSpy } = stubChrome({ activeTabId: 33, activeTabUrl: 'https://example.com/' });
    const btn = makeButton();
    const toasts: string[] = [];
    await initRescanPageButton(btn, (m) => toasts.push(m));

    btn.click();
    await flushMicrotasks();

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0]![0]).toEqual({ type: 'RESCAN_PAGE', tabId: 33 });
    expect(toasts[0]).toContain('Rescan triggered');
  });

  it('clicking a disabled button does NOT send any message (listener never attached)', async () => {
    const { sendSpy } = stubChrome({ activeTabId: 5, activeTabUrl: 'chrome://extensions/' });
    const btn = makeButton();
    await initRescanPageButton(btn, () => {});

    btn.click();
    await flushMicrotasks();

    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('toasts on chrome.runtime.sendMessage rejection', async () => {
    stubChrome({
      activeTabId: 33,
      activeTabUrl: 'https://example.com/',
      sendRejects: new Error('SW disconnected'),
    });
    const btn = makeButton();
    const toasts: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await initRescanPageButton(btn, (m) => toasts.push(m));

    btn.click();
    await flushMicrotasks();

    expect(toasts[0]).toContain('Rescan failed');
    errorSpy.mockRestore();
  });
});
