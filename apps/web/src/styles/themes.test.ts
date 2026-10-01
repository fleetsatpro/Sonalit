import { describe, expect, it } from 'vitest';
import { getTheme, normalizeTheme, SONALIT_THEMES } from './themes.js';

describe('Sonalit theme registry', () => {
  it('contains six unique themes with complete presentation metadata', () => {
    expect(SONALIT_THEMES).toHaveLength(6);
    expect(new Set(SONALIT_THEMES.map((theme) => theme.id)).size).toBe(6);

    for (const theme of SONALIT_THEMES) {
      expect(theme.name).toBeTruthy();
      expect(theme.description).toBeTruthy();
      expect(theme.chrome).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.accent).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.swatches).toHaveLength(4);
      expect(getTheme(theme.id).id).toBe(theme.id);
    }
  });

  it('migrates legacy dark/light values and rejects invalid values', () => {
    expect(normalizeTheme('dark')).toBe('obsidian');
    expect(normalizeTheme('light')).toBe('daylight');
    expect(normalizeTheme('signal')).toBe('signal');
    expect(normalizeTheme('not-a-theme')).toBe('obsidian');
    expect(normalizeTheme(null)).toBe('obsidian');
    expect(normalizeTheme(undefined)).toBe('obsidian');
  });
});
