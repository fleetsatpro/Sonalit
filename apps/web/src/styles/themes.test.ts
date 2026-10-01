import { describe, expect, it } from 'vitest';
import { SONALIT_THEMES, getTheme, normalizeTheme } from './themes.js';

describe('Sonalit theme contract', () => {
  it('keeps the six production themes unique and complete', () => {
    expect(SONALIT_THEMES).toHaveLength(6);
    expect(new Set(SONALIT_THEMES.map((theme) => theme.id)).size).toBe(6);
    for (const theme of SONALIT_THEMES) {
      expect(theme.name).toBeTruthy();
      expect(theme.description).toBeTruthy();
      expect(theme.chrome).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.accent).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.swatches).toHaveLength(4);
      expect(['dark', 'light']).toContain(theme.mode);
    }
  });

  it('migrates legacy dark/light values without accepting arbitrary persisted values', () => {
    expect(normalizeTheme('dark')).toBe('obsidian');
    expect(normalizeTheme('light')).toBe('daylight');
    expect(normalizeTheme('signal')).toBe('signal');
    expect(normalizeTheme('not-a-theme')).toBe('obsidian');
    expect(normalizeTheme(null)).toBe('obsidian');
    expect(getTheme('daylight').mode).toBe('light');
  });
});
