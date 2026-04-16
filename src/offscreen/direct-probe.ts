import type {
  RunProbeDirectMessage,
  ProbeDirectResultMessage,
} from '@/types/messages.js';

/**
 * Phase 3 Track A Path 1 handler — runs a single probe directly against the
 * offscreen WebGPU engine and returns raw completion + timing, bypassing the
 * production orchestrator, chunking, and analyzers so Track A rows are
 * directly comparable to Phase 2's `mlc_llm serve` rows.
 *
 * Gated on `chrome.storage.local['honeyllm:test-mode'] === true`. Inert in
 * production.
 */

export interface DirectProbeDeps {
  readonly isTestModeEnabled: () => Promise<boolean>;
  readonly getGpuAdapterArchitecture: () => Promise<string | null>;
  readonly callEngine: (systemPrompt: string, userMessage: string) => Promise<string>;
  readonly getLoadedModelId: () => string | null;
  readonly now: () => number;
}

// Module-level state, scoped to the offscreen document lifecycle.
// Both are wiped when the offscreen document is torn down (which the Stage 5
// runner does between models), so there is no leakage across sweeps.
let firstLoadEmitted = false;
let cachedArchitecture: { value: string | null } | null = null;

/**
 * Test-only: reset module-level state between unit-test cases.
 *
 * Production safety: `src/offscreen/index.ts` does not import this function
 * (only `runDirectProbe` and the `DirectProbeDeps` type), so Vite / Rollup
 * tree-shaking drops it and the module-level `firstLoadEmitted` /
 * `cachedArchitecture` bindings from the offscreen bundle. Verified by
 * `grep -c 'resetDirectProbeStateForTests' dist/offscreen/index.js` => 0.
 */
export function resetDirectProbeStateForTests(): void {
  firstLoadEmitted = false;
  cachedArchitecture = null;
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

async function resolveArchitecture(
  fetcher: () => Promise<string | null>,
): Promise<string | null> {
  // Cache ONLY on success. A thrown error may be transient (e.g. device lost
  // during Chrome startup, WebGPU adapter momentarily unavailable) — the next
  // probe should get a fresh attempt instead of a sticky-null poisoned cache
  // for the rest of the offscreen lifecycle. A successful null is treated as
  // a real answer ("adapter present, architecture not reported") and cached.
  if (cachedArchitecture !== null) return cachedArchitecture.value;
  try {
    const value = await fetcher();
    cachedArchitecture = { value };
    return value;
  } catch {
    return null;
  }
}

function baseResult(
  request: RunProbeDirectMessage,
  modelId: string,
  arch: string | null,
): Omit<ProbeDirectResultMessage, 'skipped' | 'skippedReason' | 'errorMessage' | 'rawOutput' | 'inferenceMs' | 'firstLoadMs'> {
  return {
    type: 'PROBE_DIRECT_RESULT',
    requestId: request.requestId,
    probeName: request.probeName,
    engineRuntime: 'mlc-webllm-webgpu',
    engineModel: modelId,
    webgpuBackendDetected: arch,
  };
}

export async function runDirectProbe(
  request: RunProbeDirectMessage,
  deps: DirectProbeDeps,
): Promise<ProbeDirectResultMessage> {
  // Gate is checked first so a gate-off call is genuinely inert — no GPU
  // query, no engine touch, no storage read beyond the gate itself.
  const gateOpen = await deps.isTestModeEnabled();
  if (!gateOpen) {
    const modelId = deps.getLoadedModelId() ?? 'unknown';
    return {
      ...baseResult(request, modelId, null),
      skipped: true,
      skippedReason: 'test-mode-disabled',
      errorMessage: null,
      rawOutput: '',
      inferenceMs: 0,
      firstLoadMs: null,
    };
  }

  const modelId = deps.getLoadedModelId() ?? 'unknown';
  const architecture = await resolveArchitecture(deps.getGpuAdapterArchitecture);

  const startedAt = deps.now();
  try {
    const rawOutput = await deps.callEngine(request.systemPrompt, request.userMessage);
    const inferenceMs = deps.now() - startedAt;
    const firstLoadMs = firstLoadEmitted ? null : inferenceMs;
    firstLoadEmitted = true;

    // Re-read model id AFTER the call: initEngine() may have flipped it to
    // the fallback model if the primary failed mid-load.
    const finalModelId = deps.getLoadedModelId() ?? modelId;

    return {
      ...baseResult(request, finalModelId, architecture),
      skipped: false,
      skippedReason: null,
      errorMessage: null,
      rawOutput,
      inferenceMs,
      firstLoadMs,
    };
  } catch (err: unknown) {
    return {
      ...baseResult(request, modelId, architecture),
      skipped: false,
      skippedReason: null,
      errorMessage: errorToMessage(err),
      rawOutput: '',
      inferenceMs: deps.now() - startedAt,
      firstLoadMs: null,
    };
  }
}
