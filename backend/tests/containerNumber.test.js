const { validateContainerNumber, checkDigit, normalise } = require('../src/utils/containerNumber');

describe('ISO 6346 container-number validation', () => {
  test('accepts a valid freight-container identifier', () => {
    expect(validateContainerNumber('CSQU3054383')).toEqual({ ok: true });
  });

  test('normalises spaces and hyphens before validation', () => {
    expect(normalise('csqu 305438-3')).toBe('CSQU3054383');
    expect(validateContainerNumber('csqu 305438-3')).toEqual({ ok: true });
  });

  test('rejects a number whose format is not four letters plus seven digits', () => {
    expect(validateContainerNumber('CSQ3054383')).toMatchObject({ ok: false, reason: 'format' });
    expect(validateContainerNumber('CSQJ3054383')).toMatchObject({ ok: false, reason: 'format' });
    expect(validateContainerNumber('CSQU30543A3')).toMatchObject({ ok: false, reason: 'format' });
  });

  test('identifies a wrong check digit and returns the expected digit', () => {
    expect(validateContainerNumber('CSQU3054384')).toEqual({
      ok: false, reason: 'check_digit', expected: 3, found: 4,
    });
  });

  test('returns null when a check digit cannot be calculated', () => {
    expect(checkDigit('CSQU30543A')).toBeNull();
    expect(checkDigit('CSQ3054383')).toBeNull();
  });

  test('distinguishes an empty identifier from malformed input', () => {
    expect(validateContainerNumber('  ')).toEqual({ ok: false, reason: 'missing' });
  });
});
