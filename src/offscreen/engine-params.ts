/**
 * Nano param bounds + preferred-values resolver (issue #50 item 1).
 *
 * Split into its own module so tests can import it without pulling the
 * full `engine.ts` (which transitively imports `@mlc-ai/web-llm` and
 * explodes in Node).
 *
 * Chrome's Prompt API for Chrome Extensions exposes `LanguageModel.params()`
 * which returns current-build bounds for `topK` and `temperature`. Without
 * querying these and clamping our preferred values, a future Chrome release
 * tightening `maxTopK` below our hardcoded 3 would make every `create()`
 * call throw silently.
 */

export const PREFERRED_NANO_TEMPERATURE = 0.1;
export const PREFERRED_NANO_TOP_K = 3;

export interface NanoParamBounds {
  readonly defaultTopK: number;
  readonly maxTopK: number;
  readonly defaultTemperature: number;
  readonly maxTemperature: number;
}

export interface ResolvedNanoCreateParams {
  readonly temperature: number;
  readonly topK: number;
}

/**
 * Clamp our preferred values against runtime bounds. When `bounds === null`
 * (older Chrome or non-Extensions surface where `params()` is absent),
 * pass preferred values through unmodified — nothing to clamp against.
 */
export function resolveNanoCreateParams(bounds: NanoParamBounds | null): ResolvedNanoCreateParams {
  if (bounds === null) {
    return { temperature: PREFERRED_NANO_TEMPERATURE, topK: PREFERRED_NANO_TOP_K };
  }
  return {
    temperature: Math.min(PREFERRED_NANO_TEMPERATURE, bounds.maxTemperature),
    topK: Math.min(PREFERRED_NANO_TOP_K, bounds.maxTopK),
  };
}
