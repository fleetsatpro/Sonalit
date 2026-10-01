import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SONALIT_THEME,
  SONALIT_THEMES,
  getSonalitThemeMeta,
  isSonalitTheme,
  normalizeSonalitTheme,
} from './theme.js';

describe('Sonalit theme contract', () => {
  it('defines six unique themes with complete presentation metadata', () => {
    expect(SONALIT_THEMES).toHaveLength(6);
    expect(new Set(SONALIT_THEMES.map((theme) => theme.id)).size).toBe(6);

    for (const theme of SONALIT_THEMES) {
      expect(isSonalitTheme(theme.id)).toBe(true);
      expect(theme.name).toBeTruthy();
      expect(theme.description).toBeTruthy();
      expect(theme.preview).toHaveLength(4);
      expect(theme.mode === 'dark' || theme.mode === 'light').toBe(true);
      expect(getSonalitThemeMeta(theme.id).id).toBe(theme.id);
    }
  });

  it('migrates legacy values and rejects unknown persisted values', () => {
    expect(normalizeSonalitTheme('dark')).toBe('obsidian');
    expect(normalizeSonalitTheme('light')).toBe('ivory');
    expect(normalizeSonalitTheme('signal')).toBe('signal');
    expect(normalizeSonalitTheme('not-a-theme')).toBe(DEFAULT_SONALIT_THEME);
    expect(normalizeSonalitTheme(null)).toBe(DEFAULT_SONALIT_THEME);
    expect(normalizeSonalitTheme(undefined)).toBe(DEFAULT_SONALIT_THEME);
  });
});
