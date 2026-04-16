import { describe, it, expect, vi } from 'vitest';
import {
  runBuiltinProbe,
  resetBuiltinProbeStateForTests,
  defaultCreateOptions,
  type BuiltinProbeDeps,
  type LanguageModelFacade,
  type LanguageModelSessionFacade,
} from './builtin-probe.js';
import type { RunProbeBuiltinMessage } from '@/types/messages.js';

function baseRequest(overrides: Partial<RunProbeBuiltinMessage> = {}): RunProbeBuiltinMessage {
  return {
    type: 'RUN_PROBE_BUILTIN',
    requestId: 'req-1',
    probeName: 'summarization',
    systemPrompt: 'You are a factual text summarizer.',
    userMessage: 'Summarize the following content:\n\nSourdough bread…',
    ...overrides,
  };
}

interface FakeSessionOptions {
  readonly output?: string;
  readonly promptThrows?: unknown;
}

function fakeSession({ output = 'ok', promptThrows }: FakeSessionOptions = {}): LanguageModelSessionFacade & { destroyed: boolean } {
  const session = {
    destroyed: false,
    async prompt(_userMessage: string): Promise<string> {
      if (promptThrows !== undefined) throw promptThrows;
      return output;
    },
    destroy(): void {
      this.destroyed = true;
    },
  };
  return session;
}

interface FakeLanguageModelOptions {
  readonly availability?:
    | 'available'
    | 'readily-available'
    | 'after-download'
    | 'downloading'
    | 'unavailable';
  readonly availabilityThrows?: unknown;
  readonly createThrows?: unknown;
  readonly sessionFactory?: () => LanguageModelSessionFacade;
}

function fakeLanguageModel(opts: FakeLanguageModelOptions = {}): LanguageModelFacade & {
  availabilityCalls: number;
  createCalls: Array<unknown>;
} {
  const fake = {
    availabilityCalls: 0,
    createCalls: [] as Array<unknown>,
    async availability() {
      this.availabilityCalls++;
      if (opts.availabilityThrows !== undefined) throw opts.availabilityThrows;
      return opts.availability ?? ('available' as const);
    },
    async create(options: unknown): Promise<LanguageModelSessionFacade> {
      this.createCalls.push(options);
      if (opts.createThrows !== undefined) throw opts.createThrows;
      return opts.sessionFactory ? opts.sessionFactory() : fakeSession();
    },
  };
  return fake;
}

describe('runBuiltinProbe (Phase 3 Track A Path 2 handler)', () => {
  describe('gate', () => {
    it('returns skipped=true with test-mode-disabled when gate is off', async () => {
      resetBuiltinProbeStateForTests();
      const lm = fakeLanguageModel();
      const deps: BuiltinProbeDeps = {
        isTestModeEnabled: async () => false,
        getLanguageModel: () => lm,
        now: () => 0,
        createOptions: defaultCreateOptions,
      };
      const result = await runBuiltinProbe(baseRequest(), deps);

      expect(result.type).toBe('PROBE_BUILTIN_RESULT');
      expect(result.skipped).toBe(true);
      expect(result.skippedReason).toBe('test-mode-disabled');
      expect(result.errorMessage).toBeNull();
      expect(result.availability).toBeNull();
      expect(result.rawOutput).toBe('');
      expect(result.inferenceMs).toBe(0);
      expect(result.firstCreateMs).toBeNull();
      expect(result.engineRuntime).toBe('chrome-builtin-prompt-api');
      expect(result.engineModel).toBe('chrome-builtin-gemini-nano');
      // Gate-off must be genuinely inert — no API calls.
      expect(lm.availabilityCalls).toBe(0);
      expect(lm.createCalls).toHaveLength(0);
    });
  });

  describe('API presence', () => {
    it('returns skipped=true with language-model-api-absent when LanguageModel is null', async () => {
      resetBuiltinProbeStateForTests();
      const result = await runBuiltinProbe(baseRequest(), {
        isTestModeEnabled: async () => true,
        getLanguageModel: () => null,
        now: () => 0,
        createOptions: defaultCreateOptions,
      });

      expect(result.skipped).toBe(true);
      expect(result.skippedReason).toBe('language-model-api-absent');
      expect(result.availability).toBeNull();
      expect(result.errorMessage).toBeNull();
    });
  });

  describe('availability', () => {
    it('returns skipped when availability() resolves to "unavailable"', async () => {
      resetBuiltinProbeStateForTests();
      const lm = fakeLanguageModel({ availability: 'unavailable' });
      const result = await runBuiltinProbe(baseRequest(), {
        isTestModeEnabled: async () => true,
        getLanguageModel: () => lm,
        now: () => 0,
        createOptions: defaultCreateOptions,
      });

      expect(result.skipped).toBe(true);
      expect(result.skippedReason).toBe('availability-unavailable');
      expect(result.availability).toBe('unavailable');
      expect(result.errorMessage).toBeNull();
      expect(lm.createCalls).toHaveLength(0);
    });

    it('populates errorMessage and null availability when availability() throws', async () => {
      resetBuiltinProbeStateForTests();
      const lm = fakeLanguageModel({ availabilityThrows: new Error('availability failed') });
      const result = await runBuiltinProbe(baseRequest(), {
        isTestModeEnabled: async () => true,
        getLanguageModel: () => lm,
        now: () => 0,
        createOptions: defaultCreateOptions,
      });

      expect(result.skipped).toBe(false);
      expect(result.errorMessage).toBe('availability failed');
      expect(result.availability).toBeNull();
      expect(lm.createCalls).toHaveLength(0);
    });
  });

  describe('create / prompt lifecycle', () => {
    it('returns rawOutput + timing on the happy path', async () => {
      resetBuiltinProbeStateForTests();
      let t = 1000;
      const lm = fakeLanguageModel({
        availability: 'available',
        sessionFactory: () => fakeSession({ output: 'summary text' }),
      });
      const result = await runBuiltinProbe(baseRequest(), {
        isTestModeEnabled: async () => true,
        getLanguageModel: () => lm,
        now: () => {
          t += 100;
          return t;
        },
        createOptions: defaultCreateOptions,
      });

      expect(result.skipped).toBe(false);
      expect(result.errorMessage).toBeNull();
      expect(result.rawOutput).toBe('summary text');
      expect(result.availability).toBe('available');
      expect(result.inferenceMs).toBeGreaterThan(0);
      expect(result.firstCreateMs).toBeGreaterThan(0);
    });

    it('populates errorMessage when create() throws, availability is preserved', async () => {
      resetBuiltinProbeStateForTests();
      const lm = fakeLanguageModel({ createThrows: new Error('create failed') });
      const result = await runBuiltinProbe(baseRequest(), {
        isTestModeEnabled: async () => true,
        getLanguageModel: () => lm,
        now: () => 0,
        createOptions: defaultCreateOptions,
      });

      expect(result.skipped).toBe(false);
      expect(result.errorMessage).toBe('create failed');
      expect(result.availability).toBe('available');
      expect(result.rawOutput).toBe('');
      expect(result.firstCreateMs).toBeNull();
    });

    it('populates errorMessage when prompt() throws and destroys the session', async () => {
      resetBuiltinProbeStateForTests();
      const session = fakeSession({ promptThrows: new Error('prompt failed') });
      const lm = fakeLanguageModel({
        availability: 'available',
        sessionFactory: () => session,
      });
      const result = await runBuiltinProbe(baseRequest(), {
        isTestModeEnabled: async () => true,
        getLanguageModel: () => lm,
        now: () => 0,
        createOptions: defaultCreateOptions,
      });

      expect(result.skipped).toBe(false);
      expect(result.errorMessage).toBe('prompt failed');
      expect(result.rawOutput).toBe('');
      expect(session.destroyed).toBe(true);
    });

    it('calls session.destroy() after a successful prompt', async () => {
      resetBuiltinProbeStateForTests();
      const session = fakeSession({ output: 'ok' });
      const lm = fakeLanguageModel({
        availability: 'available',
        sessionFactory: () => session,
      });
      await runBuiltinProbe(baseRequest(), {
        isTestModeEnabled: async () => true,
        getLanguageModel: () => lm,
        now: () => 0,
        createOptions: defaultCreateOptions,
      });
      expect(session.destroyed).toBe(true);
    });
  });

  describe('firstCreateMs semantics (single-shot, success-gated)', () => {
    it('populates firstCreateMs only on the first successful create per lifecycle', async () => {
      resetBuiltinProbeStateForTests();
      const lm = fakeLanguageModel({ availability: 'available' });
      let t = 0;
      const deps: BuiltinProbeDeps = {
        isTestModeEnabled: async () => true,
        getLanguageModel: () => lm,
        now: () => {
          t += 10;
          return t;
        },
        createOptions: defaultCreateOptions,
      };

      const first = await runBuiltinProbe(baseRequest({ requestId: 'r1' }), deps);
      const second = await runBuiltinProbe(baseRequest({ requestId: 'r2' }), deps);
      const third = await runBuiltinProbe(baseRequest({ requestId: 'r3' }), deps);

      expect(first.firstCreateMs).not.toBeNull();
      expect(second.firstCreateMs).toBeNull();
      expect(third.firstCreateMs).toBeNull();
    });

    it('does not set firstCreateMs when the first create() throws', async () => {
      resetBuiltinProbeStateForTests();
      let calls = 0;
      const failingThenOk: LanguageModelFacade = {
        async availability() {
          return 'available';
        },
        async create(options) {
          calls++;
          if (calls === 1) throw new Error('first create failed');
          return fakeSession({ output: 'ok' });
        },
      };
      const deps: BuiltinProbeDeps = {
        isTestModeEnabled: async () => true,
        getLanguageModel: () => failingThenOk,
        now: () => 0,
        createOptions: defaultCreateOptions,
      };

      const firstAttempt = await runBuiltinProbe(baseRequest({ requestId: 'r1' }), deps);
      const secondAttempt = await runBuiltinProbe(baseRequest({ requestId: 'r2' }), deps);

      expect(firstAttempt.errorMessage).toBe('first create failed');
      expect(firstAttempt.firstCreateMs).toBeNull();
      expect(secondAttempt.errorMessage).toBeNull();
      expect(secondAttempt.firstCreateMs).not.toBeNull();
    });

    it('keeps firstCreateMs populated when prompt() throws AFTER a successful create()', async () => {
      resetBuiltinProbeStateForTests();
      const lm = fakeLanguageModel({
        availability: 'available',
        sessionFactory: () => fakeSession({ promptThrows: new Error('prompt failed') }),
      });
      const result = await runBuiltinProbe(baseRequest(), {
        isTestModeEnabled: async () => true,
        getLanguageModel: () => lm,
        now: () => 0,
        createOptions: defaultCreateOptions,
      });

      expect(result.errorMessage).toBe('prompt failed');
      // Cold-start cost was genuinely incurred; a subsequent call would
      // get null, but this row records the create time.
      expect(result.firstCreateMs).not.toBeNull();
    });

    it('measures firstCreateMs exclusively from create() — prompt() latency does not contaminate it', async () => {
      resetBuiltinProbeStateForTests();
      // Distinguishing clock: pre-create = 1000, post-create = 1100 (100ms),
      // prompt start = 1100, prompt end = 1500 (400ms). firstCreateMs must
      // be exactly 100, never 500. If `firstCreateEmitted = true` were
      // placed AFTER prompt() (a regression), a reader couldn't detect it
      // from the previous happy-path test because that one uses now:()=>0.
      const times = [1000, 1100, 1100, 1500];
      let i = 0;
      const lm = fakeLanguageModel({
        availability: 'available',
        sessionFactory: () => fakeSession({ output: 'summary' }),
      });
      const result = await runBuiltinProbe(baseRequest(), {
        isTestModeEnabled: async () => true,
        getLanguageModel: () => lm,
        now: () => {
          const t = times[i] ?? times[times.length - 1]!;
          i++;
          return t;
        },
        createOptions: defaultCreateOptions,
      });

      expect(result.firstCreateMs).toBe(100);
      expect(result.inferenceMs).toBe(400);
      expect(result.rawOutput).toBe('summary');
    });

    it('on a second call, firstCreateMs is null even if the first call only partially succeeded (create ok, prompt threw)', async () => {
      resetBuiltinProbeStateForTests();
      const lm = fakeLanguageModel({
        availability: 'available',
        sessionFactory: () => fakeSession({ promptThrows: new Error('boom') }),
      });
      const deps: BuiltinProbeDeps = {
        isTestModeEnabled: async () => true,
        getLanguageModel: () => lm,
        now: () => 0,
        createOptions: defaultCreateOptions,
      };

      const first = await runBuiltinProbe(baseRequest({ requestId: 'r1' }), deps);
      expect(first.firstCreateMs).not.toBeNull(); // create() succeeded
      expect(first.errorMessage).toBe('boom');

      // Replace session factory to return a working session on retry.
      const lm2 = fakeLanguageModel({
        availability: 'available',
        sessionFactory: () => fakeSession({ output: 'retry-ok' }),
      });
      const second = await runBuiltinProbe(baseRequest({ requestId: 'r2' }), {
        ...deps,
        getLanguageModel: () => lm2,
      });
      // firstCreateEmitted was set on the first call (because create()
      // succeeded), so the second call must get null.
      expect(second.firstCreateMs).toBeNull();
      expect(second.rawOutput).toBe('retry-ok');
    });
  });

  describe('availability cache', () => {
    it('caches availability after a successful resolve', async () => {
      resetBuiltinProbeStateForTests();
      const lm = fakeLanguageModel({ availability: 'available' });
      const deps: BuiltinProbeDeps = {
        isTestModeEnabled: async () => true,
        getLanguageModel: () => lm,
        now: () => 0,
        createOptions: defaultCreateOptions,
      };

      await runBuiltinProbe(baseRequest({ requestId: 'r1' }), deps);
      await runBuiltinProbe(baseRequest({ requestId: 'r2' }), deps);
      await runBuiltinProbe(baseRequest({ requestId: 'r3' }), deps);

      expect(lm.availabilityCalls).toBe(1);
    });

    it('retries availability after a transient throw', async () => {
      resetBuiltinProbeStateForTests();
      let calls = 0;
      const lm: LanguageModelFacade = {
        async availability() {
          calls++;
          if (calls === 1) throw new Error('transient');
          return 'available';
        },
        async create() {
          return fakeSession({ output: 'ok' });
        },
      };
      const deps: BuiltinProbeDeps = {
        isTestModeEnabled: async () => true,
        getLanguageModel: () => lm,
        now: () => 0,
        createOptions: defaultCreateOptions,
      };

      const first = await runBuiltinProbe(baseRequest({ requestId: 'r1' }), deps);
      expect(first.errorMessage).toBe('transient');

      const second = await runBuiltinProbe(baseRequest({ requestId: 'r2' }), deps);
      expect(calls).toBe(2);
      expect(second.availability).toBe('available');
      expect(second.errorMessage).toBeNull();

      const third = await runBuiltinProbe(baseRequest({ requestId: 'r3' }), deps);
      expect(calls).toBe(2); // success cached
      expect(third.availability).toBe('available');
    });
  });

  describe('createOptions contract', () => {
    it('calls create() with the exact spec-required options', async () => {
      resetBuiltinProbeStateForTests();
      const lm = fakeLanguageModel({ availability: 'available' });
      await runBuiltinProbe(baseRequest(), {
        isTestModeEnabled: async () => true,
        getLanguageModel: () => lm,
        now: () => 0,
        createOptions: defaultCreateOptions,
      });

      expect(lm.createCalls).toHaveLength(1);
      expect(lm.createCalls[0]).toEqual({
        initialPrompts: [{ role: 'system', content: 'You are a factual text summarizer.' }],
        temperature: 0.1,
        topK: 3,
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      });
    });

    it('allows caller to override createOptions', async () => {
      resetBuiltinProbeStateForTests();
      const lm = fakeLanguageModel({ availability: 'available' });
      const customOptions = vi.fn((sys: string) => ({ custom: true, sys }));
      await runBuiltinProbe(baseRequest(), {
        isTestModeEnabled: async () => true,
        getLanguageModel: () => lm,
        now: () => 0,
        createOptions: customOptions,
      });

      expect(customOptions).toHaveBeenCalledWith('You are a factual text summarizer.');
      expect(lm.createCalls[0]).toEqual({ custom: true, sys: 'You are a factual text summarizer.' });
    });
  });

  describe('echo invariants', () => {
    it('echoes requestId and probeName verbatim', async () => {
      resetBuiltinProbeStateForTests();
      const lm = fakeLanguageModel({ availability: 'available' });
      const result = await runBuiltinProbe(
        baseRequest({ requestId: 'custom-id-42', probeName: 'adversarial_compliance' }),
        {
          isTestModeEnabled: async () => true,
          getLanguageModel: () => lm,
          now: () => 0,
          createOptions: defaultCreateOptions,
        },
      );
      expect(result.requestId).toBe('custom-id-42');
      expect(result.probeName).toBe('adversarial_compliance');
    });
  });

  describe('error coercion', () => {
    it('formats a non-Error throw value via errorToMessage', async () => {
      resetBuiltinProbeStateForTests();
      const lm = fakeLanguageModel({
        availability: 'available',
        createThrows: 'string error',
      });
      const result = await runBuiltinProbe(baseRequest(), {
        isTestModeEnabled: async () => true,
        getLanguageModel: () => lm,
        now: () => 0,
        createOptions: defaultCreateOptions,
      });
      expect(result.errorMessage).toBe('string error');
    });
  });
});
