import { describe, it, expect } from 'vitest';

import { luhnValid, iinNetwork } from './luhn.js';

describe('luhnValid', () => {
  it('accepts the canonical Visa test number', () => {
    expect(luhnValid('4111111111111111')).toBe(true);
  });

  it('rejects the same Visa with the last digit flipped', () => {
    expect(luhnValid('4111111111111112')).toBe(false);
  });

  it('strips dashes before validation', () => {
    expect(luhnValid('4111-1111-1111-1111')).toBe(true);
  });

  it('strips spaces before validation', () => {
    expect(luhnValid('4111 1111 1111 1111')).toBe(true);
  });

  it('rejects strings shorter than 13 digits', () => {
    expect(luhnValid('411111111111')).toBe(false);
  });

  it('rejects strings longer than 19 digits', () => {
    expect(luhnValid('41111111111111111111')).toBe(false);
  });

  it('returns true for canonical Mastercard, Amex, Discover test numbers', () => {
    expect(luhnValid('5555555555554444')).toBe(true);
    expect(luhnValid('378282246310005')).toBe(true);
    expect(luhnValid('6011111111111117')).toBe(true);
  });
});

describe('iinNetwork', () => {
  it.each([
    ['4111111111111111', 'visa'],
    ['5555555555554444', 'mastercard'],
    ['2221000000000009', 'mastercard'],
    ['378282246310005', 'amex'],
    ['371449635398431', 'amex'],
    ['6011111111111117', 'discover'],
    ['6500000000000000', 'discover'],
  ] as const)('classifies %s as %s', (number, network) => {
    expect(iinNetwork(number)).toBe(network);
  });

  it('returns null for unknown IIN', () => {
    expect(iinNetwork('1234567890123452')).toBeNull();
  });

  it('strips dashes/spaces before classification', () => {
    expect(iinNetwork('4111-1111-1111-1111')).toBe('visa');
  });
});
