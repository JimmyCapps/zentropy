import { describe, it, expect } from 'vitest';

import { extractCreditCards } from './credit-card.js';

describe('extractCreditCards', () => {
  it.each([
    ['Visa', '4111111111111111', 'visa'],
    ['Mastercard', '5555555555554444', 'mastercard'],
    ['Amex', '378282246310005', 'amex'],
    ['Discover', '6011111111111117', 'discover'],
  ] as const)('extracts a Luhn-valid %s test number with network metadata', (_name, num, network) => {
    const e = extractCreditCards(`payment ${num} done`);
    expect(e).toHaveLength(1);
    expect(e[0]!.value).toBe(num);
    expect(e[0]!.metadata?.luhn_valid).toBe(true);
    expect(e[0]!.metadata?.network).toBe(network);
    expect(e[0]!.confidence).toBe(0.95);
  });

  it('rejects a 16-digit number that fails Luhn', () => {
    expect(extractCreditCards('4111111111111112')).toEqual([]);
  });

  it('extracts dashes-and-spaces variants', () => {
    const e = extractCreditCards('use 4111-1111-1111-1111 today');
    expect(e).toHaveLength(1);
    expect(e[0]!.value).toBe('4111-1111-1111-1111');
    expect(e[0]!.metadata?.network).toBe('visa');
  });

  it('rejects long digit sequences (e.g. 20+ digits) without word boundary', () => {
    expect(extractCreditCards('012345678901234567890')).toEqual([]);
  });

  it('honors offset', () => {
    const e = extractCreditCards('4111111111111111', 100);
    expect(e[0]!.span).toEqual([100, 116]);
  });

  it('returns [] for empty input', () => {
    expect(extractCreditCards('')).toEqual([]);
  });
});
