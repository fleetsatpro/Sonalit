import { describe, expect, it } from 'vitest';
import { safeExternalUrl } from './intelligenceText';

describe('safe external intelligence source links', () => {
  it.each([
    ['https://example.org/story?id=42', 'https://example.org/story?id=42'],
    ['http://publisher.example/report', 'http://publisher.example/report'],
    ['  https://example.org/path  ', 'https://example.org/path'],
  ])('allows web URL %s', (value, expected) => {
    expect(safeExternalUrl(value)).toBe(expected);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'ftp://example.org/story',
    '//example.org/story',
    'https://user:password@example.org/story',
    'https://example.org/with\ncontrol',
    'not a URL',
    '',
  ])('rejects unsafe or non-absolute URL %s', value => {
    expect(safeExternalUrl(value)).toBeNull();
  });

  it('rejects non-string values and overlong input', () => {
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl({ href: 'https://example.org' })).toBeNull();
    expect(safeExternalUrl('https://example.org/' + 'a'.repeat(2050))).toBeNull();
  });
});
