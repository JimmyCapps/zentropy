import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getVerdict, mergeWithStoredVerdict, persistVerdict } from './storage.js';
import { STORAGE_KEY_PREFIX } from '@/shared/constants.js';
import type { SecurityVerdict } from '@/types/verdict.js';
import type { ResponseVerdict } from '@/types/portal-response.js';

interface ChromeStorageStub {
  storage: {
    local: {
      get: (key?: string | string[] | null) => Promise<Record<string, unknown>>;
      set: (items: Record<string, unknown>) => Promise<void>;
      remove: (keys: string | readonly string[]) => Promise<void>;
    };
  };
}

function stubChrome(initial: Record<string, unknown> = {}): {
  readonly readStore: () => Record<string, unknown>;
} {
  const store: Record<string, unknown> = { ...initial };
  const chromeStub: ChromeStorageStub = {
    storage: {
      local: {
        get: async (key) => {
          if (key === undefined || key === null) return { ...store };
          if (Array.isArray(key)) {
            const out: Record<string, unknown> = {};
            for (const k of key) if (k in store) out[k] = store[k];
            return out;
          }
          return key in store ? { [key]: store[key] } : {};
        },
        set: async (items) => {
          Object.assign(store, items);
        },
        remove: async (keys) => {
          const ks = Array.isArray(keys) ? keys : [keys as string];
          for (const k of ks) delete store[k];
        },
      },
    },
  };
  vi.stubGlobal('chrome', chromeStub);
  return { readStore: () => store };
}

const URL = 'https://example.com/foo';
const ORIGIN_KEY = STORAGE_KEY_PREFIX + 'https://example.com';

const RESPONSE_VERDICT: ResponseVerdict = {
  portalId: 'chatgpt',
  status: 'CLEAN',
  confidence: 0.9,
  totalScore: 5,
  probeResults: [],
  behavioralFlags: {
    roleDrift: false,
    exfiltrationIntent: false,
    instructionFollowing: false,
    hiddenContentAwareness: false,
  },
  timestamp: 1714400000000,
  responseTextHash: 'a'.repeat(64),
  responseTextLength: 1240,
  conversationId: 'abc-123',
  messageId: 'msg-1',
  analysisError: null,
  canaryId: 'gemma-2-2b-mlc',
};

function buildVerdict(overrides: Partial<SecurityVerdict> = {}): SecurityVerdict {
  return {
    status: 'CLEAN',
    confidence: 0.95,
    totalScore: 10,
    probeResults: [],
    behavioralFlags: {
      roleDrift: false,
      exfiltrationIntent: false,
      instructionFollowing: false,
      hiddenContentAwareness: false,
    },
    mitigationsApplied: [],
    timestamp: 1714400000000,
    url: URL,
    analysisError: null,
    canaryId: 'gemma-2-2b-mlc',
    webgpuAdapterMode: 'core',
    stamp: null,
    perChunkAnalysis: null,
    entitySummary: null,
    responseVerdict: null,
    ...overrides,
  };
}

describe('storage — responseVerdict migration', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  describe('getVerdict', () => {
    it('returns null when no record exists', async () => {
      stubChrome();
      expect(await getVerdict(URL)).toBeNull();
    });

    it('round-trips a verdict with responseVerdict populated', async () => {
      stubChrome();
      const v = buildVerdict({ responseVerdict: RESPONSE_VERDICT });
      await persistVerdict(v);
      const restored = await getVerdict(URL);
      expect(restored?.responseVerdict).toEqual(RESPONSE_VERDICT);
    });

    it('coalesces undefined responseVerdict on legacy records to null', async () => {
      // Legacy record: stamp/perChunkAnalysis/responseVerdict all absent.
      stubChrome({
        [ORIGIN_KEY]: {
          status: 'CLEAN',
          confidence: 0.9,
          totalScore: 5,
          timestamp: 1700000000000,
          url: URL,
          flags: [],
          behavioralFlags: {
            roleDrift: false,
            exfiltrationIntent: false,
            instructionFollowing: false,
            hiddenContentAwareness: false,
          },
          analysisError: null,
          canaryId: null,
        },
      });
      const restored = await getVerdict(URL);
      expect(restored).not.toBeNull();
      expect(restored?.stamp).toBeNull();
      expect(restored?.perChunkAnalysis).toBeNull();
      expect(restored?.responseVerdict).toBeNull();
    });

    it('does not coalesce when responseVerdict is already stored as null', async () => {
      // Seed directly with a record where responseVerdict, stamp, and
      // perChunkAnalysis are all stored as `null` (already migrated).
      // The coalesce condition is `=== undefined`, never `=== null`, so
      // these fields must round-trip unchanged.
      stubChrome({
        [ORIGIN_KEY]: {
          status: 'CLEAN',
          confidence: 0.9,
          totalScore: 5,
          timestamp: 1700000000000,
          url: URL,
          flags: [],
          behavioralFlags: {
            roleDrift: false,
            exfiltrationIntent: false,
            instructionFollowing: false,
            hiddenContentAwareness: false,
          },
          analysisError: null,
          canaryId: null,
          stamp: null,
          hunterSummary: null,
          entitySummary: null,
          responseVerdict: null,
          // Pre-#112 records lacked perChunkAnalysis — but this scenario
          // simulates a fully-migrated record where every additive field
          // is explicitly null.
          perChunkAnalysis: null,
        },
      });
      const restored = await getVerdict(URL);
      expect(restored?.stamp).toBeNull();
      expect(restored?.perChunkAnalysis).toBeNull();
      expect(restored?.responseVerdict).toBeNull();
    });
  });

  describe('persistVerdict', () => {
    it('persists responseVerdict verbatim', async () => {
      const { readStore } = stubChrome();
      await persistVerdict(buildVerdict({ responseVerdict: RESPONSE_VERDICT }));
      const stored = readStore()[ORIGIN_KEY] as { responseVerdict: ResponseVerdict };
      expect(stored.responseVerdict).toEqual(RESPONSE_VERDICT);
    });

    it('persists null when responseVerdict is null', async () => {
      const { readStore } = stubChrome();
      await persistVerdict(buildVerdict({ responseVerdict: null }));
      const stored = readStore()[ORIGIN_KEY] as { responseVerdict: ResponseVerdict | null };
      expect(stored.responseVerdict).toBeNull();
    });
  });

  describe('mergeWithStoredVerdict', () => {
    it('preserves prior responseVerdict on a fresh page-scan write', async () => {
      stubChrome();
      // Seed: prior verdict carries a responseVerdict.
      await persistVerdict(buildVerdict({ responseVerdict: RESPONSE_VERDICT }));
      // Fresh page-scan: status changes, no responseVerdict provided.
      const fresh = buildVerdict({
        status: 'SUSPICIOUS',
        responseVerdict: null,
      });
      const merged = await mergeWithStoredVerdict(fresh);
      expect(merged.status).toBe('SUSPICIOUS');
      expect(merged.responseVerdict).toEqual(RESPONSE_VERDICT);
    });

    it('returns input unchanged when no prior record exists', async () => {
      stubChrome();
      const fresh = buildVerdict({ status: 'CLEAN', responseVerdict: null });
      const merged = await mergeWithStoredVerdict(fresh);
      expect(merged).toEqual(fresh);
    });

    it('passes a non-null responseVerdict on the input through (response-analyzer write path)', async () => {
      stubChrome();
      // Seed with no prior responseVerdict.
      await persistVerdict(buildVerdict({ responseVerdict: null }));
      // Write a new responseVerdict from the analyzer path.
      const next = buildVerdict({ responseVerdict: RESPONSE_VERDICT });
      const merged = await mergeWithStoredVerdict(next);
      expect(merged.responseVerdict).toEqual(RESPONSE_VERDICT);
    });
  });
});
