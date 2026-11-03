import { describe, expect, it } from 'vitest';
import { isValidPhone, normalizePhone } from './phone';

describe('phone normalization', () => {
  it.each([
    ['0712345678', '+254712345678'],
    ['+254712345678', '+254712345678'],
    ['+254 712 345 678', '+254712345678'],
    ['254712345678', '+254712345678'],
    ['01 1234 5678', '+254112345678'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizePhone(input, 'Kenya')).toBe(expected);
    expect(isValidPhone(input, 'Kenya')).toBe(true);
  });

  it.each(['071234567', '07123456789', '+254612345678', '2548123456789', 'not-a-phone'])('rejects invalid Kenya phone %s', input => {
    expect(isValidPhone(input, 'Kenya')).toBe(false);
  });
});
