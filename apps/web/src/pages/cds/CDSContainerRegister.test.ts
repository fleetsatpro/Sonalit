import { describe, expect, it } from 'vitest';
import { isValidIso6346ContainerNumber, iso6346CheckDigit } from './CDSContainerRegister.js';

describe('ISO 6346 container identity', () => {
  it('calculates the check digit for valid standard container identifiers', () => {
    expect(iso6346CheckDigit('MSCU6639870')).toBe(0);
    expect(iso6346CheckDigit('CSQU3054383')).toBe(3);
  });

  it('accepts valid identifiers regardless of input case or embedded whitespace', () => {
    expect(isValidIso6346ContainerNumber('MSCU6639870')).toBe(true);
    expect(isValidIso6346ContainerNumber('mscu 6639870')).toBe(true);
  });

  it('rejects a mismatched check digit and malformed equipment category', () => {
    expect(isValidIso6346ContainerNumber('MSCU6639871')).toBe(false);
    expect(isValidIso6346ContainerNumber('MSCC6639870')).toBe(false);
    expect(iso6346CheckDigit('MSCU12345')).toBeNull();
  });
});
