import type {
  RunProbeBuiltinMessage,
  ProbeBuiltinResultMessage,
} from '@/types/messages.js';

/**
 * Phase 3 Track A Path 2 handler — runs a single probe directly against
 * Chrome's built-in Prompt API (`window.LanguageModel`, Gemini Nano) from
 * an extension window context, returning raw completion + timing so rows
 * are directly comparable to Phase 2's `mlc_llm serve` rows.
 *
 * Gated on `chrome.storage.sync['honeyllm:test-mode'] === true`. Inert in
 * production. The helper is TOTAL — every error path resolves with a
 * well-formed `ProbeBuiltinResultMessage`.
 */

type AvailabilityValue =
  | 'available'
  | 'readily-available'
  | 'after-download'
  | 'downloading'
  | 'unavailable';

export interface LanguageModelSessionFacade {
  prompt(userMessage: string): Promise<string>;
  destroy(): void;
}

export interface LanguageModelFacade {
  availability(): Promise<AvailabilityValue>;
  create(options: unknown): Promise<LanguageModelSessionFacade>;
}

export interface BuiltinProbeDeps {
  readonly isTestModeEnabled: () => Promise<boolean>;
  readonly getLanguageModel: () => LanguageModelFacade | null;
  readonly now: () => number;
  readonly createOptions: (systemPrompt: string) => unknown;
}

/**
 * Spec-required create() params (Chrome Extensions Prompt API).
 *   - `temperature: 0.1` matches Phase 2's `mlc_llm serve` determinism knob.
 *   - `topK: 3` is Extensions-only; default without it is larger.
 *   - `expectedOutputs: [{type:'text', languages:['en']}]` suppresses the
 *      "No output language was specified" warning observed in Stage 0.
 */
export const defaultCreateOptions = (systemPrompt: string): unknown => ({
  initialPrompts: [{ role: 'system', content: systemPrompt }],
  temperature: 0.1,
  topK: 3,
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
});

// Module-level state, scoped to the harness page lifecycle. Both reset on
// page reload (Stage 5 runner can reopen the page between models if needed).
let firstCreateEmitted = false;
let cachedAvailability: { value: AvailabilityValue } | null = null;

/**
 * Test-only: reset module-level state between unit-test cases.
 *
 * Production safety: `src/tests/phase3/builtin-harness.ts` does not import
 * this function (only `runBuiltinProbe` and `defaultCreateOptions`), so
 * Vite/Rollup tree-shaking drops it and the module-level `firstCreateEmitted`
 * / `cachedAvailability` bindings from the harness bundle.
 */
export function resetBuiltinProbeStateForTests(): void {
  firstCreateEmitted = false;
  cachedAvailability = null;
}

function errorToMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'Unknown error';
  }
}

/**
 * Cache-only-on-success (mirrors `direct-probe.ts#resolveArchitecture`).
 * Returns `{ ok: true, value }` on success (serving cached value on
 * subsequent calls), `{ ok: false, error }` on throw — the next call will
 * retry rather than be poisoned by a transient failure.
 */
async function resolveAvailability(
  api: LanguageModelFacade,
): Promise<
  | { readonly ok: true; readonly value: AvailabilityValue }
  | { readonly ok: false; readonly error: unknown }
> {
  if (cachedAvailability !== null) return { ok: true, value: cachedAvailability.value };
  try {
    const value = await api.availability();
    cachedAvailability = { value };
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error };
  }
}

function baseResult(
  request: RunProbeBuiltinMessage,
): Omit<
  ProbeBuiltinResultMessage,
  | 'skipped'
  | 'skippedReason'
  | 'errorMessage'
  | 'rawOutput'
  | 'inferenceMs'
  | 'firstCreateMs'
  | 'availability'
> {
  return {
    type: 'PROBE_BUILTIN_RESULT',
    requestId: request.requestId,
    probeName: request.probeName,
    engineRuntime: 'chrome-builtin-prompt-api',
    engineModel: 'chrome-builtin-gemini-nano',
  };
}

export async function runBuiltinProbe(
  request: RunProbeBuiltinMessage,
  deps: BuiltinProbeDeps,
): Promise<ProbeBuiltinResultMessage> {
  // Gate first — a gate-off call is genuinely inert (no API touch, no
  // storage read beyond the gate itself).
  const gateOpen = await deps.isTestModeEnabled();
  if (!gateOpen) {
    return {
      ...baseResult(request),
      skipped: true,
      skippedReason: 'test-mode-disabled',
      errorMessage: null,
      availability: null,
      rawOutput: '',
      inferenceMs: 0,
      firstCreateMs: null,
    };
  }

  const api = deps.getLanguageModel();
  if (api === null) {
    return {
      ...baseResult(request),
      skipped: true,
      skippedReason: 'language-model-api-absent',
      errorMessage: null,
      availability: null,
      rawOutput: '',
      inferenceMs: 0,
      firstCreateMs: null,
    };
  }

  const availabilityResult = await resolveAvailability(api);
  if (!availabilityResult.ok) {
    return {
      ...baseResult(request),
      skipped: false,
      skippedReason: null,
      errorMessage: errorToMessage(availabilityResult.error),
      availability: null,
      rawOutput: '',
      inferenceMs: 0,
      firstCreateMs: null,
    };
  }

  const availability = availabilityResult.value;
  if (availability === 'unavailable') {
    return {
      ...baseResult(request),
      skipped: true,
      skippedReason: 'availability-unavailable',
      errorMessage: null,
      availability,
      rawOutput: '',
      inferenceMs: 0,
      firstCreateMs: null,
    };
  }

  // create() timing — only counts toward firstCreateMs on success.
  const createStart = deps.now();
  let session: LanguageModelSessionFacade;
  try {
    session = await api.create(deps.createOptions(request.systemPrompt));
  } catch (err) {
    return {
      ...baseResult(request),
      skipped: false,
      skippedReason: null,
      errorMessage: errorToMessage(err),
      availability,
      rawOutput: '',
      inferenceMs: 0,
      firstCreateMs: null,
    };
  }

  const createElapsed = deps.now() - createStart;
  const firstCreateMs = firstCreateEmitted ? null : createElapsed;
  firstCreateEmitted = true;

  const promptStart = deps.now();
  try {
    const rawOutput = await session.prompt(request.userMessage);
    const inferenceMs = deps.now() - promptStart;
    return {
      ...baseResult(request),
      skipped: false,
      skippedReason: null,
      errorMessage: null,
      availability,
      rawOutput,
      inferenceMs,
      firstCreateMs,
    };
  } catch (err) {
    return {
      ...baseResult(request),
      skipped: false,
      skippedReason: null,
      errorMessage: errorToMessage(err),
      availability,
      rawOutput: '',
      inferenceMs: deps.now() - promptStart,
      // Cold-start cost was genuinely incurred even though prompt failed.
      firstCreateMs,
    };
  } finally {
    // Per-probe session lifecycle: always destroy, even on throw. Matches
    // Stage 0 diagnostic pattern and avoids accidental context carryover.
    try {
      session.destroy();
    } catch {
      // destroy() failures are non-fatal for the probe row.
    }
  }
}
