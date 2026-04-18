import { describe, it, expect } from 'vitest';
import {
  resolveNanoCreateParams,
  PREFERRED_NANO_TEMPERATURE,
  PREFERRED_NANO_TOP_K,
  type NanoParamBounds,
} from './engine-params.js';

describe('resolveNanoCreateParams (issue #50 item 1)', () => {
  it('returns preferred values when bounds is null', () => {
    const result = resolveNanoCreateParams(null);
    expect(result.temperature).toBe(PREFERRED_NANO_TEMPERATURE);
    expect(result.topK).toBe(PREFERRED_NANO_TOP_K);
  });

  it('passes preferred values through when bounds are generous', () => {
    const bounds: NanoParamBounds = {
      defaultTopK: 3,
      maxTopK: 128,
      defaultTemperature: 1.0,
      maxTemperature: 2.0,
    };
    const result = resolveNanoCreateParams(bounds);
    expect(result.temperature).toBe(PREFERRED_NANO_TEMPERATURE);
    expect(result.topK).toBe(PREFERRED_NANO_TOP_K);
  });

  it('clamps topK down when maxTopK is tighter than preferred', () => {
    const bounds: NanoParamBounds = {
      defaultTopK: 1,
      maxTopK: 2,
      defaultTemperature: 0.5,
      maxTemperature: 1.0,
    };
    const result = resolveNanoCreateParams(bounds);
    expect(result.topK).toBe(2);
  });

  it('clamps temperature down when maxTemperature is tighter than preferred', () => {
    // Contrived but locks the clamp behaviour: maxTemperature below our
    // preferred 0.1 would force temperature to maxTemperature.
    const bounds: NanoParamBounds = {
      defaultTopK: 3,
      maxTopK: 8,
      defaultTemperature: 0.05,
      maxTemperature: 0.05,
    };
    const result = resolveNanoCreateParams(bounds);
    expect(result.temperature).toBe(0.05);
  });

  it('clamps both when both bounds are tighter', () => {
    const bounds: NanoParamBounds = {
      defaultTopK: 1,
      maxTopK: 1,
      defaultTemperature: 0.05,
      maxTemperature: 0.05,
    };
    const result = resolveNanoCreateParams(bounds);
    expect(result.topK).toBe(1);
    expect(result.temperature).toBe(0.05);
  });

  it('does not inflate values above preferred even if bounds allow it', () => {
    // Regression guard: Math.min with a larger upper bound should still
    // return the preferred (lower) value.
    const bounds: NanoParamBounds = {
      defaultTopK: 40,
      maxTopK: 128,
      defaultTemperature: 1.0,
      maxTemperature: 2.0,
    };
    const result = resolveNanoCreateParams(bounds);
    expect(result.topK).toBeLessThanOrEqual(PREFERRED_NANO_TOP_K);
    expect(result.temperature).toBeLessThanOrEqual(PREFERRED_NANO_TEMPERATURE);
  });
});
