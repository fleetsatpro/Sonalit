import { describe, expect, it } from 'vitest';
import { SONALIT_THEMES, THEME_META, normalizeTheme } from './ui.js';

describe('Sonalit theme contract', () => {
  it('defines six unique production themes with matching metadata', () => {
    expect(SONALIT_THEMES).toHaveLength(6);
    expect(new Set(SONALIT_THEMES).size).toBe(SONALIT_THEMES.length);

    for (const theme of SONALIT_THEMES) {
      expect(THEME_META[theme].label).toBeTruthy();
      expect(THEME_META[theme].description).toBeTruthy();
      expect(THEME_META[theme].preview).toContain('gradient');
      expect(['dark', 'light']).toContain(THEME_META[theme].density);
    }
  });

  it('migrates legacy values and rejects invalid persisted values', () => {
    expect(normalizeTheme('dark')).toBe('obsidian');
    expect(normalizeTheme('light')).toBe('ivory');
    expect(normalizeTheme('signal')).toBe('signal');
    expect(normalizeTheme('not-a-theme')).toBe('obsidian');
    expect(normalizeTheme(null)).toBe('obsidian');
  });
});
