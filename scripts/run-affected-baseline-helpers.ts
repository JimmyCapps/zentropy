/**
 * Pure helpers for scripts/run-affected-baseline.ts — split out so the row
 * merging / classification / Phase 2 indexing logic can be unit-tested without
 * Playwright or chrome.* globals.
 *
 * Keep this file free of Playwright, fs, and @/offscreen|service-worker|content
 * imports so Vitest runs it in a plain Node env.
 */

import {
  classifyOutput,
  classifyOutputV2,
  type Category,
  type ClassificationVersion,
  type ProbeName,
} from './fixtures/phase2-inputs.js';

// Minimal structural shapes mirroring src/types/messages.ts without importing
// from there (avoids coupling the runner's unit tests to src/ TypeScript
// resolution — tsconfig.json's rootDir is `src`, so scripts/ modules cannot
// import @/types/messages.ts transitively via a type-only path either).

export interface DirectProbeResultLike {
  readonly type: 'PROBE_DIRECT_RESULT';
  readonly requestId: string;
  readonly probeName: ProbeName;
  readonly engineRuntime: 'mlc-webllm-webgpu';
  readonly engineModel: string;
  readonly rawOutput: string;
  readonly inferenceMs: number;
  readonly firstLoadMs: number | null;
  readonly webgpuBackendDetected: string | null;
  readonly skipped: boolean;
  readonly skippedReason: string | null;
  readonly errorMessage: string | null;
}

export interface BuiltinProbeResultLike {
  readonly type: 'PROBE_BUILTIN_RESULT';
  readonly requestId: string;
  readonly probeName: ProbeName;
  readonly engineRuntime: 'chrome-builtin-prompt-api';
  readonly engineModel: 'chrome-builtin-gemini-nano';
  readonly rawOutput: string;
  readonly inferenceMs: number;
  readonly firstCreateMs: number | null;
  readonly availability:
    | 'available'
    | 'readily-available'
    | 'after-download'
    | 'downloading'
    | 'unavailable'
    | null;
  readonly skipped: boolean;
  readonly skippedReason: string | null;
  readonly errorMessage: string | null;
}

export interface Phase2RowLike {
  readonly engine_model: string;
  readonly probe: string;
  readonly input: string;
  readonly output: string;
  readonly complied: boolean;
  readonly leaked_prompt: boolean;
  readonly included_url: boolean;
  readonly skipped_reason: string | null;
  readonly inference_ms: number | null;
}

/**
 * Track A "affected" row — 22 fields, schema-locked.
 *
 * Field count drifts from Stage 5's original "20-field" spec by +2:
 * +1 because the master plan enumerated WebGPU-backend and Gemini-availability
 * as potentially collapsed into a single `engine_diagnostic` field; we keep
 * them split so MLC vs Gemini Nano rows remain self-documenting without a
 * tagged union in the JSON. +1 more for `classification_version` added in
 * issue #13 so v1 (Phase-2-locked) vs v2 (JSON-aware) rows can be joined or
 * filtered without guessing from engine_model.
 */
export interface AffectedRow {
  readonly provider: 'in-browser-canary-affected';
  readonly engine_runtime: 'mlc-webllm-webgpu' | 'chrome-builtin-prompt-api';
  readonly engine_model: string;
  readonly model: string;
  readonly probe: ProbeName;
  readonly input: string;
  readonly category: Category;
  readonly output: string;
  readonly complied: boolean;
  readonly leaked_prompt: boolean;
  readonly included_url: boolean;
  readonly classification_version: ClassificationVersion;
  readonly blocked_by_safety: false;
  readonly inference_ms: number | null;
  readonly skipped_reason: string | null;
  readonly fp_review: null;
  readonly first_load_ms: number | null;
  readonly webgpu_backend_detected: string | null;
  readonly builtin_api_availability:
    | 'available'
    | 'readily-available'
    | 'after-download'
    | 'downloading'
    | 'unavailable'
    | null;
  readonly runtime_delta_ms_vs_native_phase2: number | null;
  readonly behavioral_delta_flags: readonly string[];
  readonly error_message: string | null;
}

export interface FixtureRef {
  readonly probe: ProbeName;
  readonly input: string;
  readonly category: Category;
}

export type BuildRowArgs =
  | {
      readonly kind: 'direct';
      readonly result: DirectProbeResultLike;
      readonly fixture: FixtureRef;
      readonly nativePhase2Row: Phase2RowLike | null;
    }
  | {
      readonly kind: 'builtin';
      readonly result: BuiltinProbeResultLike;
      readonly fixture: FixtureRef;
      readonly nativePhase2Row: Phase2RowLike | null;
    };

export function buildPhase2Index(rows: readonly Phase2RowLike[]): Map<string, Phase2RowLike> {
  const map = new Map<string, Phase2RowLike>();
  for (const row of rows) {
    map.set(cellKey(row.engine_model, row.probe, row.input), row);
  }
  return map;
}

/**
 * Stable join key for `(engine_model, probe, input)`. Used by the Phase 2
 * index lookup, the main results' resume set, and the Stage 7 replicate
 * sidecar. Centralized here so all three stay in lock-step.
 */
export function cellKey(engineModel: string, probe: string, input: string): string {
  return `${engineModel}|${probe}|${input}`;
}

/**
 * Stage 7a — Sidecar schema for replicate runs (--replicates N>1).
 *
 * Sidecar exists because the canonical 21-field AffectedRow schema is
 * locked by the Stage 6 audit trail. Replicate samples live alongside,
 * never mutate, the main results file. When `--replicates 1` (the default)
 * the runner does not touch this file.
 */
export interface ReplicateSamplesFile {
  readonly schema_version: '1.0';
  readonly phase: 3;
  readonly track: 'A';
  readonly parent_results: 'docs/testing/inbrowser-results-affected.json';
  readonly test_date: string;
  readonly cells: readonly ReplicateCell[];
}

export interface ReplicateCell {
  readonly engine_model: string;
  readonly probe: ProbeName;
  readonly input: string;
  readonly category: Category;
  readonly samples: readonly ReplicateSample[];
}

export interface ReplicateSample {
  readonly sample_index: number;
  readonly output: string;
  readonly complied: boolean;
  readonly leaked_prompt: boolean;
  readonly included_url: boolean;
  readonly inference_ms: number | null;
  readonly error_message: string | null;
}

export type ProbeResultLike = DirectProbeResultLike | BuiltinProbeResultLike;

/**
 * Build a replicate sample from a single inference result. Uses the v2
 * JSON-aware classifier (issue #13) so replicate flag values match the main
 * row's v2 classification given the same rawOutput.
 */
export function buildReplicateSample(args: {
  readonly sampleIndex: number;
  readonly result: ProbeResultLike;
}): ReplicateSample {
  const classification = classifyOutputV2(args.result.rawOutput, args.result.probeName);
  const inferenceMs =
    args.result.errorMessage !== null || args.result.skippedReason !== null
      ? null
      : args.result.inferenceMs;
  return {
    sample_index: args.sampleIndex,
    output: args.result.rawOutput,
    complied: classification.complied,
    leaked_prompt: classification.leaked_prompt,
    included_url: classification.included_url,
    inference_ms: inferenceMs,
    error_message: args.result.errorMessage,
  };
}

export interface Classification {
  readonly complied: boolean;
  readonly leaked_prompt: boolean;
  readonly included_url: boolean;
}

/**
 * Stable-order flag list for the behavioral delta, matching the Phase 2
 * result-schema field ordering (complied → leaked_prompt → included_url).
 * An empty list means the classifier agrees with the native baseline.
 * `['no-native-baseline']` is returned when no native row exists to compare
 * against — explicit sentinel per the hard-rules ("no silent Phase-2 miss").
 */
export function computeBehavioralDelta(
  affected: Classification,
  native: Phase2RowLike | null,
): string[] {
  if (native === null) return ['no-native-baseline'];
  const flags: string[] = [];
  if (affected.complied !== native.complied) flags.push('complied');
  if (affected.leaked_prompt !== native.leaked_prompt) flags.push('leaked_prompt');
  if (affected.included_url !== native.included_url) flags.push('included_url');
  return flags;
}

function runtimeDelta(
  affectedMs: number | null,
  native: Phase2RowLike | null,
  errorMessage: string | null,
  skippedReason: string | null,
): number | null {
  // Transport failures set inferenceMs: 0 as a sentinel — a non-null 0 would
  // otherwise produce a misleading large negative delta against native rows.
  // Skip rows similarly have inferenceMs: 0 but are not measurements.
  if (errorMessage !== null) return null;
  if (skippedReason !== null) return null;
  if (native === null) return null;
  if (native.inference_ms === null) return null;
  if (affectedMs === null) return null;
  return affectedMs - native.inference_ms;
}

export function buildRow(args: BuildRowArgs): AffectedRow {
  const { fixture, nativePhase2Row } = args;
  const classification = classifyOutputV2(args.result.rawOutput, fixture.probe);
  const behavioralDeltaFlags = computeBehavioralDelta(classification, nativePhase2Row);

  if (args.kind === 'direct') {
    const r = args.result;
    const inferenceMs = r.inferenceMs;
    return {
      provider: 'in-browser-canary-affected',
      engine_runtime: 'mlc-webllm-webgpu',
      engine_model: r.engineModel,
      model: r.engineModel,
      probe: fixture.probe,
      input: fixture.input,
      category: fixture.category,
      output: r.rawOutput,
      complied: classification.complied,
      leaked_prompt: classification.leaked_prompt,
      included_url: classification.included_url,
      classification_version: 'v2',
      blocked_by_safety: false,
      inference_ms: inferenceMs,
      skipped_reason: r.skippedReason,
      fp_review: null,
      first_load_ms: r.firstLoadMs,
      webgpu_backend_detected: r.webgpuBackendDetected,
      builtin_api_availability: null,
      runtime_delta_ms_vs_native_phase2: runtimeDelta(inferenceMs, nativePhase2Row, r.errorMessage, r.skippedReason),
      behavioral_delta_flags: behavioralDeltaFlags,
      error_message: r.errorMessage,
    };
  }

  const r = args.result;
  const inferenceMs = r.inferenceMs;
  return {
    provider: 'in-browser-canary-affected',
    engine_runtime: 'chrome-builtin-prompt-api',
    engine_model: r.engineModel,
    model: r.engineModel,
    probe: fixture.probe,
    input: fixture.input,
    category: fixture.category,
    output: r.rawOutput,
    complied: classification.complied,
    leaked_prompt: classification.leaked_prompt,
    included_url: classification.included_url,
    classification_version: 'v2',
    blocked_by_safety: false,
    inference_ms: inferenceMs,
    skipped_reason: r.skippedReason,
    fp_review: null,
    first_load_ms: r.firstCreateMs,
    webgpu_backend_detected: null,
    builtin_api_availability: r.availability,
    runtime_delta_ms_vs_native_phase2: runtimeDelta(inferenceMs, nativePhase2Row),
    behavioral_delta_flags: behavioralDeltaFlags,
    error_message: r.errorMessage,
  };
}
