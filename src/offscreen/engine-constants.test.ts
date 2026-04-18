import { describe, it, expect } from 'vitest';
import { NANO_CAPABILITY_OPTIONS } from './engine-constants.js';

/**
 * Regression guard for issue #46. The capability-options constant is the
 * single source of truth passed to BOTH `LanguageModel.availability()` and
 * `LanguageModel.create()`. Chrome rejects create() with NotSupportedError
 * if the two calls diverge on modality/language, so these tests lock the
 * contract shape.
 *
 * We don't exercise the adapter end-to-end here — `createNanoEngineAdapter`
 * is module-private (can't mock `window.LanguageModel` without an export
 * seam). The sibling PR for #41 made the same call. These tests pin the
 * observable surface instead.
 */
describe('NANO_CAPABILITY_OPTIONS (issue #46)', () => {
  it('declares both expectedInputs and expectedOutputs', () => {
    expect(NANO_CAPABILITY_OPTIONS.expectedInputs).toBeDefined();
    expect(NANO_CAPABILITY_OPTIONS.expectedOutputs).toBeDefined();
  });

  it('uses matching language arrays on both sides (avoids create() NotSupportedError)', () => {
    const inputs = NANO_CAPABILITY_OPTIONS.expectedInputs ?? [];
    const outputs = NANO_CAPABILITY_OPTIONS.expectedOutputs ?? [];
    expect(inputs).toHaveLength(1);
    expect(outputs).toHaveLength(1);
    expect(inputs[0]!.languages).toEqual(outputs[0]!.languages);
  });

  it('declares text modality on both sides', () => {
    const inputs = NANO_CAPABILITY_OPTIONS.expectedInputs ?? [];
    const outputs = NANO_CAPABILITY_OPTIONS.expectedOutputs ?? [];
    expect(inputs[0]!.type).toBe('text');
    expect(outputs[0]!.type).toBe('text');
  });

  it('currently ships English-only (expand via #48 Language Detector)', () => {
    const inputs = NANO_CAPABILITY_OPTIONS.expectedInputs ?? [];
    expect(inputs[0]!.languages).toEqual(['en']);
  });
});
