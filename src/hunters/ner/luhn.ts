export type CardNetwork = 'visa' | 'mastercard' | 'amex' | 'discover';

function digitsOnly(input: string): string {
  return input.replace(/[\s-]/g, '');
}

export function luhnValid(input: string): boolean {
  const digits = digitsOnly(input);
  if (!/^\d+$/.test(digits)) return false;
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function iinNetwork(input: string): CardNetwork | null {
  const digits = digitsOnly(input);
  if (!/^\d+$/.test(digits)) return null;

  if (/^4/.test(digits)) return 'visa';

  if (/^3[47]/.test(digits)) return 'amex';

  if (/^5[1-5]/.test(digits)) return 'mastercard';
  if (digits.length >= 4) {
    const four = Number.parseInt(digits.slice(0, 4), 10);
    if (four >= 2221 && four <= 2720) return 'mastercard';
  }

  if (/^6011/.test(digits)) return 'discover';
  if (/^65/.test(digits)) return 'discover';
  if (/^64[4-9]/.test(digits)) return 'discover';

  return null;
}
