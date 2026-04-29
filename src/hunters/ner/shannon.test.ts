import { describe, it, expect } from 'vitest';

import { shannon } from './shannon.js';

describe('shannon entropy', () => {
  it('returns 0 for an empty string', () => {
    expect(shannon('')).toBe(0);
  });

  it('returns 0 for a constant string', () => {
    expect(shannon('aaaaaaaa')).toBe(0);
  });

  it('returns 1.0 for a balanced two-symbol alphabet', () => {
    expect(shannon('abababab')).toBeCloseTo(1.0, 5);
  });

  it('returns ~2.585 for unique-letter abcdef', () => {
    expect(shannon('abcdef')).toBeCloseTo(2.585, 2);
  });

  it('exceeds 3.5 for a 32-char hex-like string with diverse symbols', () => {
    expect(shannon('a1b2c3d4e5f6789012345678901234ab')).toBeGreaterThan(3.5);
  });
});
