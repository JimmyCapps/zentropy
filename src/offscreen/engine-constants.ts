/**
 * Engine constants split out so tests can import them without pulling the
 * full `engine.ts` module (which transitively imports `@mlc-ai/web-llm` and
 * can't load in a Node test environment).
 */

/**
 * Shared shape for options passed to both `LanguageModel.availability()`
 * and `LanguageModel.create()`. Declaring them once and spreading into
 * both call sites is the contract that prevents the availability-vs-create
 * NotSupportedError drift described in Chrome's
 * `inform-users-of-model-download` guide.
 */
export interface NanoCapabilityOptions {
  readonly expectedInputs?: ReadonlyArray<{ type: 'text'; languages?: readonly string[] }>;
  readonly expectedOutputs?: ReadonlyArray<{ type: 'text'; languages?: readonly string[] }>;
}

/**
 * Single source of truth passed to both `availability()` and `create()`.
 * English-only as of issue #46; #48 will widen to detected page language.
 */
export const NANO_CAPABILITY_OPTIONS: NanoCapabilityOptions = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
};
