import { describe, expect, it } from 'vitest';
import { DEFAULT_SONALIT_THEME, SONALIT_THEMES, isSonalitTheme } from './themes.js';

describe('Sonalit operator themes', () => {
  it('defines six unique production themes with complete previews', () => {
    expect(SONALIT_THEMES).toHaveLength(6);
    expect(new Set(SONALIT_THEMES.map((theme) => theme.id)).size).toBe(6);
    for (const theme of SONALIT_THEMES) {
      expect(theme.name.length).toBeGreaterThan(0);
      expect(theme.description.length).toBeGreaterThan(0);
      expect(theme.preview).toHaveLength(4);
      expect(['dark', 'light']).toContain(theme.mode);
    }
  });

  it('uses Obsidian Command as the safe default', () => {
    expect(DEFAULT_SONALIT_THEME).toBe('obsidian');
    expect(isSonalitTheme(DEFAULT_SONALIT_THEME)).toBe(true);
  });

  it('rejects stale or arbitrary persisted identifiers', () => {
    expect(isSonalitTheme('dark')).toBe(false);
    expect(isSonalitTheme('light')).toBe(false);
    expect(isSonalitTheme('not-a-theme')).toBe(false);
  });
});
