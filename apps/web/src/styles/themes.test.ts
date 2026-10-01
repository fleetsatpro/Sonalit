import { describe, expect, it } from 'vitest';
import { SONALIT_THEMES, getTheme, normalizeTheme } from './themes.js';

describe('Sonalit theme contract', () => {
  it('defines six unique production themes with complete presentation metadata', () => {
    expect(SONALIT_THEMES).toHaveLength(6);
    expect(new Set(SONALIT_THEMES.map((theme) => theme.id)).size).toBe(6);

    for (const theme of SONALIT_THEMES) {
      expect(theme.name).toBeTruthy();
      expect(theme.description).toBeTruthy();
      expect(['dark', 'light']).toContain(theme.mode);
      expect(theme.chrome).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.accent).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.swatches).toHaveLength(4);
    }
  });

  it('migrates legacy preferences and rejects invalid values', () => {
    expect(normalizeTheme('dark')).toBe('obsidian');
    expect(normalizeTheme('light')).toBe('daylight');
    expect(normalizeTheme('arctic')).toBe('arctic');
    expect(normalizeTheme('not-a-theme')).toBe('obsidian');
    expect(normalizeTheme(null)).toBe('obsidian');
  });

  it('returns a complete definition for every normalized theme', () => {
    for (const theme of SONALIT_THEMES) {
      expect(getTheme(theme.id).id).toBe(theme.id);
    }
  });
});
