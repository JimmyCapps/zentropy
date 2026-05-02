import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SecurityVerdict, SecurityStatus } from '@/types/verdict.js';
import { STORAGE_KEY_TESTING_MODE } from '@/shared/constants.js';
import {
  dispatchVerdictMessages,
  handleRescanWithMitigation,
  handleRescanPage,
  handleTabRemovedForDispatch,
  __resetDispatchState,
} from './dispatch.js';

interface ChromeStub {
  storage: {
    local: {
      get: (key: string) => Promise<Record<string, unknown>>;
    };
  };
  tabs: {
    sendMessage: (tabId: number, msg: unknown) => Promise<unknown>;
  };
}

interface SentMessage {
  readonly tabId: number;
  readonly msg: unknown;
}

function stubChrome(testingMode: boolean | undefined): {
  sent: SentMessage[];
  sendSpy: ReturnType<typeof vi.fn>;
  getSpy: ReturnType<typeof vi.fn>;
} {
  const sent: SentMessage[] = [];
  const sendSpy = vi.fn(async (tabId: number, msg: unknown) => {
    sent.push({ tabId, msg });
  });
  const getSpy = vi.fn(async (key: string) => {
    if (key === STORAGE_KEY_TESTING_MODE && testingMode !== undefined) {
      return { [key]: testingMode };
    }
    return {};
  });
  const chromeStub: ChromeStub = {
    storage: { local: { get: getSpy } },
    tabs: { sendMessage: sendSpy },
  };
  vi.stubGlobal('chrome', chromeStub);
  return { sent, sendSpy, getSpy };
}

function makeVerdict(status: SecurityStatus, analysisError: string | null = null): SecurityVerdict {
  return {
    status,
    confidence: status === 'CLEAN' ? 0.95 : 0.7,
    totalScore: status === 'CLEAN' ? 0 : 50,
    probeResults: [],
    behavioralFlags: {
      roleDrift: false,
      exfiltrationIntent: false,
      instructionFollowing: false,
      hiddenContentAwareness: false,
    },
    mitigationsApplied: [],
    timestamp: 1_700_000_000_000,
    url: 'https://example.com/',
    analysisError,
    canaryId: 'gemma-2-2b-mlc',
    webgpuAdapterMode: 'core',
    stamp: null,
    perChunkAnalysis: null,
    entitySummary: null,
    responseVerdict: null,
    thinkingVerdict: null,
    embeddingsFindings: null,
  };
}

function findMessage(sent: SentMessage[], type: string): SentMessage | undefined {
  return sent.find((s) => {
    const m = s.msg as { type?: unknown };
    return m.type === type;
  });
}

describe('dispatchVerdictMessages — testing-mode gate', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    __resetDispatchState();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('always dispatches VERDICT regardless of testing-mode (CLEAN, mode off)', async () => {
    const { sent } = stubChrome(false);
    await dispatchVerdictMessages(1, makeVerdict('CLEAN'), false);
    expect(findMessage(sent, 'VERDICT')).toBeDefined();
  });

  it('always dispatches VERDICT regardless of testing-mode (CLEAN, mode on)', async () => {
    const { sent } = stubChrome(true);
    await dispatchVerdictMessages(1, makeVerdict('CLEAN'), false);
    expect(findMessage(sent, 'VERDICT')).toBeDefined();
  });

  it('always dispatches VERDICT (SUSPICIOUS, mode on)', async () => {
    const { sent } = stubChrome(true);
    await dispatchVerdictMessages(1, makeVerdict('SUSPICIOUS'), false);
    expect(findMessage(sent, 'VERDICT')).toBeDefined();
  });

  it('always dispatches VERDICT (COMPROMISED, mode off)', async () => {
    const { sent } = stubChrome(false);
    await dispatchVerdictMessages(1, makeVerdict('COMPROMISED'), false);
    expect(findMessage(sent, 'VERDICT')).toBeDefined();
  });

  it('does NOT dispatch APPLY_MITIGATION when testing-mode is on (COMPROMISED)', async () => {
    const { sent } = stubChrome(true);
    await dispatchVerdictMessages(1, makeVerdict('COMPROMISED'), false);
    expect(findMessage(sent, 'APPLY_MITIGATION')).toBeUndefined();
  });

  it('does NOT dispatch APPLY_MITIGATION when testing-mode is on (SUSPICIOUS)', async () => {
    const { sent } = stubChrome(true);
    await dispatchVerdictMessages(1, makeVerdict('SUSPICIOUS'), false);
    expect(findMessage(sent, 'APPLY_MITIGATION')).toBeUndefined();
  });

  it('dispatches APPLY_MITIGATION when testing-mode is off (COMPROMISED)', async () => {
    const { sent } = stubChrome(false);
    await dispatchVerdictMessages(1, makeVerdict('COMPROMISED'), false);
    const mitigation = findMessage(sent, 'APPLY_MITIGATION');
    expect(mitigation).toBeDefined();
    expect((mitigation!.msg as { verdict: SecurityVerdict }).verdict.status).toBe('COMPROMISED');
  });

  it('dispatches APPLY_MITIGATION when testing-mode is off (SUSPICIOUS)', async () => {
    const { sent } = stubChrome(false);
    await dispatchVerdictMessages(1, makeVerdict('SUSPICIOUS'), false);
    expect(findMessage(sent, 'APPLY_MITIGATION')).toBeDefined();
  });

  it('does NOT dispatch APPLY_MITIGATION when verdict is CLEAN, regardless of testing-mode', async () => {
    const { sent: sentOff } = stubChrome(false);
    await dispatchVerdictMessages(1, makeVerdict('CLEAN'), false);
    expect(findMessage(sentOff, 'APPLY_MITIGATION')).toBeUndefined();

    vi.unstubAllGlobals();
    const { sent: sentOn } = stubChrome(true);
    await dispatchVerdictMessages(1, makeVerdict('CLEAN'), false);
    expect(findMessage(sentOn, 'APPLY_MITIGATION')).toBeUndefined();
  });

  it('does NOT dispatch APPLY_MITIGATION for origin-skipped verdict (UNKNOWN + origin_denied:)', async () => {
    const { sent } = stubChrome(false);
    await dispatchVerdictMessages(1, makeVerdict('UNKNOWN', 'origin_denied: deny-list match'), false);
    expect(findMessage(sent, 'APPLY_MITIGATION')).toBeUndefined();
  });

  it('forceMitigation=true overrides testing-mode=true (COMPROMISED)', async () => {
    const { sent } = stubChrome(true);
    await dispatchVerdictMessages(1, makeVerdict('COMPROMISED'), true);
    expect(findMessage(sent, 'APPLY_MITIGATION')).toBeDefined();
  });

  it('forceMitigation=true overrides testing-mode=true (SUSPICIOUS)', async () => {
    const { sent } = stubChrome(true);
    await dispatchVerdictMessages(1, makeVerdict('SUSPICIOUS'), true);
    expect(findMessage(sent, 'APPLY_MITIGATION')).toBeDefined();
  });

  it('forceMitigation=true does NOT cause APPLY_MITIGATION on a CLEAN verdict', async () => {
    const { sent } = stubChrome(true);
    await dispatchVerdictMessages(1, makeVerdict('CLEAN'), true);
    expect(findMessage(sent, 'APPLY_MITIGATION')).toBeUndefined();
  });

  it('forceMitigation=false respects testing-mode=true (no APPLY_MITIGATION)', async () => {
    const { sent } = stubChrome(true);
    await dispatchVerdictMessages(1, makeVerdict('SUSPICIOUS'), false);
    expect(findMessage(sent, 'APPLY_MITIGATION')).toBeUndefined();
  });

  it('does not call chrome.storage.local.get when forceMitigation=true (skips the gate read)', async () => {
    const { getSpy } = stubChrome(true);
    await dispatchVerdictMessages(1, makeVerdict('SUSPICIOUS'), true);
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('VERDICT message carries the correct tabId', async () => {
    const { sent } = stubChrome(false);
    await dispatchVerdictMessages(42, makeVerdict('CLEAN'), false);
    const verdictMsg = findMessage(sent, 'VERDICT');
    expect(verdictMsg!.tabId).toBe(42);
  });
});

describe('dispatchVerdictMessages — duplicate-VERDICT idempotency (#230)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    __resetDispatchState();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('emits exactly one VERDICT per call (CLEAN — no APPLY_MITIGATION path)', async () => {
    const { sent } = stubChrome(false);
    await dispatchVerdictMessages(1, makeVerdict('CLEAN'), false);
    const verdictCount = sent.filter((s) => (s.msg as { type?: string }).type === 'VERDICT').length;
    expect(verdictCount).toBe(1);
  });

  it('emits exactly one VERDICT per call (COMPROMISED — APPLY_MITIGATION also dispatched)', async () => {
    const { sent } = stubChrome(false);
    await dispatchVerdictMessages(1, makeVerdict('COMPROMISED'), false);
    const verdictCount = sent.filter((s) => (s.msg as { type?: string }).type === 'VERDICT').length;
    const mitigateCount = sent.filter((s) => (s.msg as { type?: string }).type === 'APPLY_MITIGATION').length;
    expect(verdictCount).toBe(1);
    expect(mitigateCount).toBe(1);
  });

  it('suppresses a duplicate dispatch for same tab + same verdict.timestamp', async () => {
    const { sent } = stubChrome(false);
    const verdict = makeVerdict('COMPROMISED');
    await dispatchVerdictMessages(1, verdict, false);
    await dispatchVerdictMessages(1, verdict, false); // duplicate — should be skipped
    const verdictCount = sent.filter((s) => (s.msg as { type?: string }).type === 'VERDICT').length;
    const mitigateCount = sent.filter((s) => (s.msg as { type?: string }).type === 'APPLY_MITIGATION').length;
    expect(verdictCount).toBe(1);
    expect(mitigateCount).toBe(1);
  });

  it('allows re-dispatch when verdict.timestamp differs (newer analysis)', async () => {
    const { sent } = stubChrome(false);
    const first = makeVerdict('CLEAN');
    const second: SecurityVerdict = { ...first, timestamp: first.timestamp + 1 };
    await dispatchVerdictMessages(1, first, false);
    await dispatchVerdictMessages(1, second, false);
    const verdictCount = sent.filter((s) => (s.msg as { type?: string }).type === 'VERDICT').length;
    expect(verdictCount).toBe(2);
  });

  it('dedup is per-tab — same timestamp on a different tab is dispatched', async () => {
    const { sent } = stubChrome(false);
    const verdict = makeVerdict('CLEAN');
    await dispatchVerdictMessages(1, verdict, false);
    await dispatchVerdictMessages(2, verdict, false);
    const verdictCount = sent.filter((s) => (s.msg as { type?: string }).type === 'VERDICT').length;
    expect(verdictCount).toBe(2);
  });

  it('handleTabRemovedForDispatch clears state so a recycled tab id starts fresh', async () => {
    const { sent } = stubChrome(false);
    const verdict = makeVerdict('CLEAN');
    await dispatchVerdictMessages(1, verdict, false);
    handleTabRemovedForDispatch(1);
    await dispatchVerdictMessages(1, verdict, false);
    const verdictCount = sent.filter((s) => (s.msg as { type?: string }).type === 'VERDICT').length;
    expect(verdictCount).toBe(2);
  });
});

describe('dispatchVerdictMessages — DEACTIVATE_MITIGATIONS path (#233A)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    __resetDispatchState();
  });
  afterEach(() => vi.unstubAllGlobals());

  function makeVerdictAt(status: SecurityStatus, ts: number): SecurityVerdict {
    return { ...makeVerdict(status), timestamp: ts };
  }

  it('emits DEACTIVATE_MITIGATIONS when CLEAN supersedes a prior COMPROMISED', async () => {
    const { sent } = stubChrome(false);
    await dispatchVerdictMessages(1, makeVerdictAt('COMPROMISED', 100), false);
    await dispatchVerdictMessages(1, makeVerdictAt('CLEAN', 101), false);
    expect(findMessage(sent, 'DEACTIVATE_MITIGATIONS')).toBeDefined();
  });

  it('emits DEACTIVATE_MITIGATIONS when UNKNOWN supersedes a prior SUSPICIOUS', async () => {
    const { sent } = stubChrome(false);
    await dispatchVerdictMessages(1, makeVerdictAt('SUSPICIOUS', 200), false);
    await dispatchVerdictMessages(1, makeVerdictAt('UNKNOWN', 201), false);
    expect(findMessage(sent, 'DEACTIVATE_MITIGATIONS')).toBeDefined();
  });

  it('does not emit DEACTIVATE_MITIGATIONS on the first verdict (no prior state)', async () => {
    const { sent } = stubChrome(false);
    await dispatchVerdictMessages(1, makeVerdictAt('CLEAN', 100), false);
    expect(findMessage(sent, 'DEACTIVATE_MITIGATIONS')).toBeUndefined();
  });

  it('does not emit DEACTIVATE_MITIGATIONS on CLEAN → CLEAN', async () => {
    const { sent } = stubChrome(false);
    await dispatchVerdictMessages(1, makeVerdictAt('CLEAN', 100), false);
    await dispatchVerdictMessages(1, makeVerdictAt('CLEAN', 101), false);
    expect(findMessage(sent, 'DEACTIVATE_MITIGATIONS')).toBeUndefined();
  });

  it('does not emit DEACTIVATE_MITIGATIONS on COMPROMISED → COMPROMISED', async () => {
    const { sent } = stubChrome(false);
    await dispatchVerdictMessages(1, makeVerdictAt('COMPROMISED', 100), false);
    await dispatchVerdictMessages(1, makeVerdictAt('COMPROMISED', 101), false);
    expect(findMessage(sent, 'DEACTIVATE_MITIGATIONS')).toBeUndefined();
  });

  it('does not emit DEACTIVATE_MITIGATIONS on COMPROMISED → SUSPICIOUS (still mitigated)', async () => {
    const { sent } = stubChrome(false);
    await dispatchVerdictMessages(1, makeVerdictAt('COMPROMISED', 100), false);
    await dispatchVerdictMessages(1, makeVerdictAt('SUSPICIOUS', 101), false);
    expect(findMessage(sent, 'DEACTIVATE_MITIGATIONS')).toBeUndefined();
  });

  it('emits DEACTIVATE_MITIGATIONS even when testing-mode would block APPLY_MITIGATION', async () => {
    const { sent } = stubChrome(true); // testing-mode on
    await dispatchVerdictMessages(1, makeVerdictAt('COMPROMISED', 100), true); // forceMitigation
    await dispatchVerdictMessages(1, makeVerdictAt('CLEAN', 101), false);
    expect(findMessage(sent, 'DEACTIVATE_MITIGATIONS')).toBeDefined();
  });

  it('handleTabRemovedForDispatch clears the status so a recycled tab id does not deactivate spuriously', async () => {
    const { sent } = stubChrome(false);
    await dispatchVerdictMessages(1, makeVerdictAt('COMPROMISED', 100), false);
    handleTabRemovedForDispatch(1);
    await dispatchVerdictMessages(1, makeVerdictAt('CLEAN', 101), false);
    expect(findMessage(sent, 'DEACTIVATE_MITIGATIONS')).toBeUndefined();
  });
});

describe('handleRescanWithMitigation', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('dispatches TRIGGER_RESCAN { forceMitigation: true } to the specified tabId', () => {
    const { sent } = stubChrome(undefined);
    handleRescanWithMitigation(99);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.tabId).toBe(99);
    expect(sent[0]!.msg).toEqual({ type: 'TRIGGER_RESCAN', forceMitigation: true });
  });

  it('does not read the testing-mode flag (handler is unconditional)', () => {
    const { getSpy } = stubChrome(true);
    handleRescanWithMitigation(1);
    expect(getSpy).not.toHaveBeenCalled();
  });
});

describe('handleRescanPage', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('dispatches TRIGGER_RESCAN { forceMitigation: false } to the specified tabId', () => {
    const { sent } = stubChrome(undefined);
    handleRescanPage(42);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.tabId).toBe(42);
    expect(sent[0]!.msg).toEqual({ type: 'TRIGGER_RESCAN', forceMitigation: false });
  });

  it('does not read the testing-mode flag (gate lives in dispatchVerdictMessages, not here)', () => {
    const { getSpy } = stubChrome(true);
    handleRescanPage(7);
    expect(getSpy).not.toHaveBeenCalled();
  });
});
