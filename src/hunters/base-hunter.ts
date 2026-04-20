/**
 * Hunter — a content-analysis detector that runs alongside (not instead of)
 * the LLM Probe pipeline. Hunters score raw content without invoking the
 * canary LLM, so they're cheap enough to run on every chunk and can inform
 * whether the downstream probes even need to fire.
 *
 * Mirrors the Probe interface (src/probes/base-probe.ts) where possible:
 * - Readonly types throughout
 * - errorMessage pattern for Phase 4 Stage 4A-compatible error propagation
 * - Flags are freeform strings suitable for the policy engine
 *
 * Differences from Probe:
 * - No systemPrompt / no LLM round-trip
 * - Async scan() because some hunters may load models or run WASM inference
 * - Emits a calibrated confidence (0-1 probability) alongside the score
 * - Carries feature-level explainability for Stage 5D flag-source mapping
 */

export interface HunterFeature {
  /** Short identifier, e.g. 'meta_markers', 'directive_density' */
  readonly name: string;
  /** Contribution of this feature to the final score, in [0, 1]. */
  readonly weight: number;
  /**
   * Excerpts from the scanned content that triggered this feature. Kept
   * short (first N chars per activation). Used by Stage 5D to map a flag
   * back to the DOM node that produced it.
   */
  readonly activations: readonly string[];
}

export interface HunterResult {
  readonly hunterName: string;
  /** True when any feature activated or any deterministic rule matched. */
  readonly matched: boolean;
  /** Freeform flags fed into the policy engine, e.g. 'hawk:directive_density'. */
  readonly flags: readonly string[];
  /**
   * Score on the same scale used by ProbeResult.score (see
   * SCORE_* constants in shared/constants.ts). Callers sum across hunters
   * and probes to derive the final SecurityVerdict.
   */
  readonly score: number;
  /**
   * Calibrated probability in [0, 1] representing the hunter's belief that
   * the content is an injection attempt. Deterministic hunters (Spider)
   * emit 0.0 or 1.0 only; probabilistic hunters (Hawk) emit anywhere in
   * the range.
   */
  readonly confidence: number;
  /** Feature-level breakdown for explainability. Empty on no-match. */
  readonly features: readonly HunterFeature[];
  /**
   * Populated when the hunter invocation threw (classifier load failure,
   * tokenizer error, etc.). Null on success. Mirrors ProbeResult.errorMessage
   * so the Phase 4 Stage 4A error-aware branching applies uniformly.
   */
  readonly errorMessage: string | null;
}

export interface Hunter {
  readonly name: string;
  /**
   * Score a text chunk. Must not throw — errors should be packaged into
   * the returned HunterResult.errorMessage so the hunt runner can continue
   * with the remaining hunters.
   */
  scan(chunk: string): Promise<HunterResult>;
}

/** Convenience constant for no-match results. */
export function cleanResult(hunterName: string): HunterResult {
  return {
    hunterName,
    matched: false,
    flags: [],
    score: 0,
    confidence: 0,
    features: [],
    errorMessage: null,
  };
}

/** Convenience constant for hunter-errored results. */
export function errorResult(hunterName: string, errorMessage: string): HunterResult {
  return {
    hunterName,
    matched: false,
    flags: [],
    score: 0,
    confidence: 0,
    features: [],
    errorMessage,
  };
}
