import { describe, expect, it } from 'vitest';
import { containerMovementProgress, equipmentTypeLabel, isValidIso6346ContainerNumber, iso6346CheckDigit } from './CDSContainerRegister.js';

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
    expect(isValidIso6346ContainerNumber('MSCJ6639870')).toBe(false);
    expect(isValidIso6346ContainerNumber('MSCZ6639870')).toBe(false);
    expect(iso6346CheckDigit('MSCU12345')).toBeNull();
  });
});

describe('container equipment shorthand labels', () => {
  it.each([
    ['20GP', '20 ft · General-purpose dry'],
    ['40HC', '40 ft · High-cube dry'],
    ['40RF', '40 ft · Refrigerated'],
    ['20OT', '20 ft · Open-top'],
    ['40FR', '40 ft · Flat rack'],
    ['20TK', '20 ft · Tank'],
  ])('explains %s as %s', (code, expected) => {
    expect(equipmentTypeLabel(code)).toBe(expected);
  });

  it('uses the stored human-readable fallback for an unfamiliar grouping code', () => {
    expect(equipmentTypeLabel('45XX', "45' Special equipment")).toBe('45 ft · Special equipment');
  });
});

describe('container journey milestone progress', () => {
  it('maps active movement statuses to persisted lifecycle milestones', () => {
    expect(containerMovementProgress('booked')).toMatchObject({ step: 1, total: 5, percent: 20, active: true });
    expect(containerMovementProgress('awaiting_pickup')).toMatchObject({ step: 2, percent: 40, active: true });
    expect(containerMovementProgress('in_transit')).toMatchObject({ label: 'In transit', step: 3, percent: 60, active: true });
    expect(containerMovementProgress('at_port')).toMatchObject({ step: 4, percent: 80, active: true });
    expect(containerMovementProgress('delivered')).toMatchObject({ step: 5, percent: 100, active: true });
  });

  it('does not show unallocated or maintenance equipment as an active journey', () => {
    expect(containerMovementProgress('available')).toMatchObject({ step: 0, percent: 0, active: false });
    expect(containerMovementProgress('maintenance')).toMatchObject({ step: 0, percent: 0, active: false });
  });

  it('does not invent progress for an unknown status', () => {
    expect(containerMovementProgress('unrecognised')).toMatchObject({ step: 0, percent: 0, active: false });
  });
});
