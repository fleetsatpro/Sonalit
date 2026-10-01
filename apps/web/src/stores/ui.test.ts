import { describe, expect, it } from 'vitest';
import { normalizeTheme, THEMES } from './ui.js';

describe('Sonalit theme contract', () => {
  it('exposes six unique production themes', () => {
    expect(THEMES).toHaveLength(6);
    expect(new Set(THEMES.map((theme) => theme.id)).size).toBe(6);
    expect(THEMES.map((theme) => theme.name)).toEqual([
      'Obsidian Command',
      'Arctic Signal',
      'Graphite Pro',
      'Copper Dusk',
      'Signal Lime',
      'Ivory Daylight',
    ]);
  });

  it('migrates legacy preferences and rejects invalid persisted values', () => {
    expect(normalizeTheme('dark')).toBe('obsidian');
    expect(normalizeTheme('light')).toBe('ivory');
    expect(normalizeTheme('signal')).toBe('signal');
    expect(normalizeTheme('invalid')).toBe('obsidian');
    expect(normalizeTheme(null)).toBe('obsidian');
  });
});
