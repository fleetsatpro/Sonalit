import { describe, expect, it } from 'vitest';
import { COUNTRIES, countryCodeFromName, countryFlagUrl, countryNameFromCode } from './countries';

describe('ISO country labels and flag artwork', () => {
  it('includes a full country catalogue rather than a regional subset', () => {
    expect(COUNTRIES.length).toBeGreaterThanOrEqual(249);
  });
  it.each([
    ['Kenya', 'KE'], ['Tanzania', 'TZ'], ['France', 'FR'], ['United Kingdom', 'GB'],
    ['Kenyan', 'KE'], ['British', 'GB'], ['KE', 'KE'], ['GB', 'GB'],
  ])('resolves %s to %s', (name, code) => {
    expect(countryCodeFromName(name)).toBe(code);
  });
  it('returns a human-readable name for ISO codes', () => {
    expect(countryNameFromCode('KE')).toBe('Kenya');
    expect(countryNameFromCode('xx')).toBe('');
  });
  it('uses country flag SVG assets only for valid ISO alpha-2 values', () => {
    expect(countryFlagUrl('KE')).toContain('/flags/4x3/ke.svg');
    expect(countryFlagUrl('invalid')).toBeNull();
    expect(countryFlagUrl(null)).toBeNull();
  });
});
