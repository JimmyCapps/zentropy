import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PageSnapshot } from '@/types/snapshot.js';
import { rescanWithForcedMitigation } from './rescan.js';

interface ChromeStub {
  runtime: { sendMessage: (msg: unknown) => Promise<unknown> };
}

function stubChrome(): { sendSpy: ReturnType<typeof vi.fn> } {
  const sendSpy = vi.fn(async (_msg: unknown) => undefined);
  const chromeStub: ChromeStub = { runtime: { sendMessage: sendSpy } };
  vi.stubGlobal('chrome', chromeStub);
  return { sendSpy };
}

function makeSnapshot(): PageSnapshot {
  return {
    visibleText: 'hello',
    hiddenText: '',
    scriptFingerprints: [],
    metadata: {
      url: 'https://example.com/',
      origin: 'https://example.com',
      title: '',
      description: '',
      ogTags: new Map(),
      cspMeta: null,
      lang: 'en',
    },
    extractedAt: 1_700_000_000_000,
    charCount: 5,
  };
}

describe('rescanWithForcedMitigation', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('re-runs the extractor each call (no caching)', async () => {
    stubChrome();
    const extractor = vi.fn(async () => makeSnapshot());
    await rescanWithForcedMitigation(true, extractor);
    await rescanWithForcedMitigation(true, extractor);
    expect(extractor).toHaveBeenCalledTimes(2);
  });

  it('sends PAGE_SNAPSHOT with forceMitigation=true via chrome.runtime', async () => {
    const { sendSpy } = stubChrome();
    const extractor = vi.fn(async () => makeSnapshot());
    await rescanWithForcedMitigation(true, extractor);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const msg = sendSpy.mock.calls[0]![0] as { type: string; forceMitigation: boolean; snapshot: PageSnapshot };
    expect(msg.type).toBe('PAGE_SNAPSHOT');
    expect(msg.forceMitigation).toBe(true);
    expect(msg.snapshot.visibleText).toBe('hello');
  });

  it('propagates forceMitigation=false verbatim', async () => {
    const { sendSpy } = stubChrome();
    await rescanWithForcedMitigation(false, async () => makeSnapshot());
    const msg = sendSpy.mock.calls[0]![0] as { forceMitigation: boolean };
    expect(msg.forceMitigation).toBe(false);
  });

  it('uses tabId=0 placeholder; SW overwrites from sender.tab.id', async () => {
    const { sendSpy } = stubChrome();
    await rescanWithForcedMitigation(true, async () => makeSnapshot());
    const msg = sendSpy.mock.calls[0]![0] as { tabId: number };
    expect(msg.tabId).toBe(0);
  });

  it('returns the extracted snapshot', async () => {
    stubChrome();
    const snapshot = makeSnapshot();
    const result = await rescanWithForcedMitigation(true, async () => snapshot);
    expect(result).toBe(snapshot);
  });
});
