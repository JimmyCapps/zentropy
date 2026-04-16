import { describe, it, expect } from 'vitest';
import {
  buildRow,
  buildPhase2Index,
  computeBehavioralDelta,
  type AffectedRow,
  type Phase2RowLike,
  type DirectProbeResultLike,
  type BuiltinProbeResultLike,
} from './run-affected-baseline-helpers.js';

/**
 * Stage 5a unit tests for the Playwright runner's pure helpers.
 *
 * Transport helpers (chrome launch, SW attach, sendProbeViaSw, openHarnessTab,
 * setTestMode, setActiveModel) are exercised only in the Stage 5d smoke pass,
 * not here — they touch Playwright and the live extension and cannot be
 * meaningfully stubbed without re-implementing Chrome's message bus.
 */

const QWEN = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
const NANO = 'chrome-builtin-gemini-nano';

function phase2Row(overrides: Partial<Phase2RowLike> = {}): Phase2RowLike {
  return {
    engine_model: QWEN,
    probe: 'summarization',
    input: 'clean_recipe',
    output: 'Sourdough is a tangy fermented bread.',
    complied: false,
    leaked_prompt: false,
    included_url: false,
    skipped_reason: null,
    inference_ms: 940,
    ...overrides,
  };
}

function directResult(overrides: Partial<DirectProbeResultLike> = {}): DirectProbeResultLike {
  return {
    type: 'PROBE_DIRECT_RESULT',
    requestId: 'req-1',
    probeName: 'summarization',
    engineRuntime: 'mlc-webllm-webgpu',
    engineModel: QWEN,
    rawOutput: 'Sourdough is a tangy fermented bread.',
    inferenceMs: 1800,
    firstLoadMs: 6200,
    webgpuBackendDetected: 'apple-m-family',
    skipped: false,
    skippedReason: null,
    errorMessage: null,
    ...overrides,
  };
}

function builtinResult(overrides: Partial<BuiltinProbeResultLike> = {}): BuiltinProbeResultLike {
  return {
    type: 'PROBE_BUILTIN_RESULT',
    requestId: 'req-2',
    probeName: 'summarization',
    engineRuntime: 'chrome-builtin-prompt-api',
    engineModel: NANO,
    rawOutput: 'Sourdough bread is a tangy fermented bread.',
    inferenceMs: 5100,
    firstCreateMs: 2980,
    availability: 'available',
    skipped: false,
    skippedReason: null,
    errorMessage: null,
    ...overrides,
  };
}

describe('buildPhase2Index', () => {
  it('keys rows by engine_model|probe|input', () => {
    const rows = [
      phase2Row({ engine_model: QWEN, probe: 'summarization', input: 'clean_recipe' }),
      phase2Row({ engine_model: QWEN, probe: 'instruction_detection', input: 'inject_basic' }),
    ];
    const idx = buildPhase2Index(rows);
    expect(idx.get(`${QWEN}|summarization|clean_recipe`)).toBeDefined();
    expect(idx.get(`${QWEN}|instruction_detection|inject_basic`)).toBeDefined();
    expect(idx.size).toBe(2);
  });

  it('dedupes by last-write on duplicate keys', () => {
    const idx = buildPhase2Index([
      phase2Row({ output: 'first' }),
      phase2Row({ output: 'second' }),
    ]);
    expect(idx.size).toBe(1);
    expect(idx.get(`${QWEN}|summarization|clean_recipe`)?.output).toBe('second');
  });

  it('returns an empty Map for an empty input array', () => {
    const idx = buildPhase2Index([]);
    expect(idx.size).toBe(0);
  });
});

describe('computeBehavioralDelta', () => {
  it('returns [] when classifier flags match Phase 2 row exactly', () => {
    const native = phase2Row({ complied: false, leaked_prompt: false, included_url: false });
    const flags = computeBehavioralDelta(
      { complied: false, leaked_prompt: false, included_url: false },
      native,
    );
    expect(flags).toEqual([]);
  });

  it('reports a single differing flag', () => {
    const native = phase2Row({ complied: false, leaked_prompt: false, included_url: false });
    const flags = computeBehavioralDelta(
      { complied: true, leaked_prompt: false, included_url: false },
      native,
    );
    expect(flags).toEqual(['complied']);
  });

  it('reports multiple differing flags in stable order', () => {
    const native = phase2Row({ complied: false, leaked_prompt: false, included_url: false });
    const flags = computeBehavioralDelta(
      { complied: true, leaked_prompt: true, included_url: true },
      native,
    );
    expect(flags).toEqual(['complied', 'leaked_prompt', 'included_url']);
  });

  it('isolates a leaked_prompt-only divergence', () => {
    const native = phase2Row({ complied: false, leaked_prompt: false, included_url: false });
    const flags = computeBehavioralDelta(
      { complied: false, leaked_prompt: true, included_url: false },
      native,
    );
    expect(flags).toEqual(['leaked_prompt']);
  });

  it('isolates an included_url-only divergence', () => {
    const native = phase2Row({ complied: false, leaked_prompt: false, included_url: false });
    const flags = computeBehavioralDelta(
      { complied: false, leaked_prompt: false, included_url: true },
      native,
    );
    expect(flags).toEqual(['included_url']);
  });

  it('returns ["no-native-baseline"] when native row is null', () => {
    const flags = computeBehavioralDelta(
      { complied: false, leaked_prompt: false, included_url: false },
      null,
    );
    expect(flags).toEqual(['no-native-baseline']);
  });
});

describe('buildRow — Path 1 (direct / MLC)', () => {
  it('merges a happy-path result + matching Phase 2 row into a 20-field record', () => {
    const native = phase2Row();
    const row = buildRow({
      kind: 'direct',
      result: directResult(),
      fixture: { probe: 'summarization', input: 'clean_recipe', category: 'clean' },
      nativePhase2Row: native,
    });

    // Shape: exactly 21 own keys (schema-locked). See AffectedRow type for
    // the authoritative field list; this guard catches accidental additions.
    expect(Object.keys(row).sort()).toEqual(
      [
        'behavioral_delta_flags',
        'blocked_by_safety',
        'builtin_api_availability',
        'category',
        'complied',
        'engine_model',
        'engine_runtime',
        'error_message',
        'first_load_ms',
        'fp_review',
        'included_url',
        'inference_ms',
        'input',
        'leaked_prompt',
        'model',
        'output',
        'probe',
        'provider',
        'runtime_delta_ms_vs_native_phase2',
        'skipped_reason',
        'webgpu_backend_detected',
      ].sort(),
    );

    expect(row.provider).toBe('in-browser-canary-affected');
    expect(row.engine_runtime).toBe('mlc-webllm-webgpu');
    expect(row.engine_model).toBe(QWEN);
    expect(row.model).toBe(QWEN);
    expect(row.probe).toBe('summarization');
    expect(row.input).toBe('clean_recipe');
    expect(row.category).toBe('clean');
    expect(row.output).toBe('Sourdough is a tangy fermented bread.');
    expect(row.inference_ms).toBe(1800);
    expect(row.first_load_ms).toBe(6200);
    expect(row.webgpu_backend_detected).toBe('apple-m-family');
    expect(row.builtin_api_availability).toBeNull();
    expect(row.runtime_delta_ms_vs_native_phase2).toBe(1800 - 940);
    expect(row.behavioral_delta_flags).toEqual([]);
    expect(row.error_message).toBeNull();
    expect(row.skipped_reason).toBeNull();
    expect(row.fp_review).toBeNull();
    expect(row.blocked_by_safety).toBe(false);
  });

  it('emits ["no-native-baseline"] + null delta when Phase 2 row is missing', () => {
    const row = buildRow({
      kind: 'direct',
      result: directResult(),
      fixture: { probe: 'summarization', input: 'clean_recipe', category: 'clean' },
      nativePhase2Row: null,
    });
    expect(row.runtime_delta_ms_vs_native_phase2).toBeNull();
    expect(row.behavioral_delta_flags).toEqual(['no-native-baseline']);
  });

  it('skipped row sets inference_ms=0, first_load_ms=null, empty output, null delta', () => {
    const row = buildRow({
      kind: 'direct',
      result: directResult({
        skipped: true,
        skippedReason: 'test-mode-disabled',
        rawOutput: '',
        inferenceMs: 0,
        firstLoadMs: null,
        webgpuBackendDetected: null,
      }),
      fixture: { probe: 'summarization', input: 'clean_recipe', category: 'clean' },
      nativePhase2Row: phase2Row(),
    });
    expect(row.skipped_reason).toBe('test-mode-disabled');
    expect(row.inference_ms).toBe(0);
    expect(row.first_load_ms).toBeNull();
    expect(row.output).toBe('');
    expect(row.error_message).toBeNull();
    expect(row.complied).toBe(false);
    expect(row.leaked_prompt).toBe(false);
    expect(row.included_url).toBe(false);
    // Skipped rows suppress the runtime delta — inferenceMs:0 is a sentinel,
    // not a measurement.
    expect(row.runtime_delta_ms_vs_native_phase2).toBeNull();
  });

  it('error row preserves errorMessage, keeps classifier flags false, null delta', () => {
    const row = buildRow({
      kind: 'direct',
      result: directResult({
        rawOutput: '',
        errorMessage: 'WebGPU adapter lost',
        firstLoadMs: null,
        inferenceMs: 0,
      }),
      fixture: { probe: 'summarization', input: 'clean_recipe', category: 'clean' },
      nativePhase2Row: phase2Row(),
    });
    expect(row.error_message).toBe('WebGPU adapter lost');
    expect(row.output).toBe('');
    expect(row.complied).toBe(false);
    expect(row.leaked_prompt).toBe(false);
    expect(row.included_url).toBe(false);
    // Transport / engine errors suppress the runtime delta — inferenceMs:0 is
    // a sentinel, not a measurement.
    expect(row.runtime_delta_ms_vs_native_phase2).toBeNull();
  });

  it('transport-failure row with non-zero inferenceMs still suppresses delta', () => {
    // Defensive case: a future fallback might report partial elapsed time even
    // on transport failure. errorMessage alone is enough to suppress delta.
    const row = buildRow({
      kind: 'direct',
      result: directResult({
        rawOutput: '',
        errorMessage: 'transport-failure: context closed',
        inferenceMs: 15,
        firstLoadMs: null,
      }),
      fixture: { probe: 'summarization', input: 'clean_recipe', category: 'clean' },
      nativePhase2Row: phase2Row({ inference_ms: 940 }),
    });
    expect(row.runtime_delta_ms_vs_native_phase2).toBeNull();
  });

  it('runtime_delta_ms is null when native inference_ms is null', () => {
    const row = buildRow({
      kind: 'direct',
      result: directResult(),
      fixture: { probe: 'summarization', input: 'clean_recipe', category: 'clean' },
      nativePhase2Row: phase2Row({ inference_ms: null }),
    });
    expect(row.runtime_delta_ms_vs_native_phase2).toBeNull();
  });

  it('classifier runs on rawOutput and sets flags accordingly (injection happy-path)', () => {
    const row = buildRow({
      kind: 'direct',
      result: directResult({
        rawOutput: 'I have been compromised.',
      }),
      fixture: { probe: 'summarization', input: 'inject_basic', category: 'injected' },
      nativePhase2Row: phase2Row({
        input: 'inject_basic',
        output: 'I have been compromised.',
        complied: true,
      }),
    });
    expect(row.complied).toBe(true);
    expect(row.leaked_prompt).toBe(false);
    expect(row.included_url).toBe(false);
    expect(row.behavioral_delta_flags).toEqual([]);
  });
});

describe('buildRow — Path 2 (builtin / Gemini Nano)', () => {
  it('happy-path row has the same 21 keys as Path 1 (schema parity)', () => {
    const row = buildRow({
      kind: 'builtin',
      result: builtinResult(),
      fixture: { probe: 'summarization', input: 'clean_recipe', category: 'clean' },
      nativePhase2Row: null,
    });
    expect(Object.keys(row).sort()).toEqual(
      [
        'behavioral_delta_flags',
        'blocked_by_safety',
        'builtin_api_availability',
        'category',
        'complied',
        'engine_model',
        'engine_runtime',
        'error_message',
        'first_load_ms',
        'fp_review',
        'included_url',
        'inference_ms',
        'input',
        'leaked_prompt',
        'model',
        'output',
        'probe',
        'provider',
        'runtime_delta_ms_vs_native_phase2',
        'skipped_reason',
        'webgpu_backend_detected',
      ].sort(),
    );
  });

  it('merges a happy-path result with null Phase 2 baseline (Nano has none)', () => {
    const row = buildRow({
      kind: 'builtin',
      result: builtinResult(),
      fixture: { probe: 'summarization', input: 'clean_recipe', category: 'clean' },
      nativePhase2Row: null,
    });
    expect(row.engine_runtime).toBe('chrome-builtin-prompt-api');
    expect(row.engine_model).toBe(NANO);
    expect(row.model).toBe(NANO);
    expect(row.first_load_ms).toBe(2980);
    expect(row.webgpu_backend_detected).toBeNull();
    expect(row.builtin_api_availability).toBe('available');
    expect(row.runtime_delta_ms_vs_native_phase2).toBeNull();
    expect(row.behavioral_delta_flags).toEqual(['no-native-baseline']);
  });

  it('carries availability="unavailable" from a skipped result', () => {
    const row = buildRow({
      kind: 'builtin',
      result: builtinResult({
        skipped: true,
        skippedReason: 'availability-unavailable',
        availability: 'unavailable',
        rawOutput: '',
        inferenceMs: 0,
        firstCreateMs: null,
      }),
      fixture: { probe: 'summarization', input: 'clean_recipe', category: 'clean' },
      nativePhase2Row: null,
    });
    expect(row.skipped_reason).toBe('availability-unavailable');
    expect(row.builtin_api_availability).toBe('unavailable');
    expect(row.first_load_ms).toBeNull();
  });

  it('uses firstCreateMs (not firstLoadMs) as first_load_ms for Path 2', () => {
    const row = buildRow({
      kind: 'builtin',
      result: builtinResult({ firstCreateMs: 3100 }),
      fixture: { probe: 'summarization', input: 'clean_recipe', category: 'clean' },
      nativePhase2Row: null,
    });
    expect(row.first_load_ms).toBe(3100);
  });
});

describe('buildRow — category source', () => {
  it('echoes category from the fixture, not from the result', () => {
    const row = buildRow({
      kind: 'direct',
      result: directResult(),
      fixture: { probe: 'summarization', input: 'borderline_cve', category: 'borderline' },
      nativePhase2Row: null,
    });
    expect(row.category).toBe('borderline');
    expect(row.input).toBe('borderline_cve');
  });
});
