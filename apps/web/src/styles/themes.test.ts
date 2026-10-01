import { describe, expect, it } from 'vitest';
import {
  SONALIT_THEMES,
  isDarkSonalitTheme,
  isSonalitTheme,
  normalizeSonalitTheme,
} from './themes.js';

describe('Sonalit theme contract', () => {
  it('keeps six unique, fully described themes', () => {
    const ids = SONALIT_THEMES.map((theme) => theme.id);

    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(ids.length);

    for (const theme of SONALIT_THEMES) {
      expect(theme.name.length).toBeGreaterThan(0);
      expect(theme.description.length).toBeGreaterThan(0);
      expect(theme.swatches).toHaveLength(3);
      expect(['dark', 'light']).toContain(theme.colorScheme);
    }
  });

  it('recognizes only the production theme ids', () => {
    expect(isSonalitTheme('obsidian')).toBe(true);
    expect(isSonalitTheme('daylight')).toBe(true);
    expect(isSonalitTheme('dark')).toBe(false);
    expect(isSonalitTheme(undefined)).toBe(false);
    expect(isSonalitTheme({ id: 'obsidian' })).toBe(false);
  });

  it('migrates legacy values and rejects invalid persisted values safely', () => {
    expect(normalizeSonalitTheme('dark')).toBe('obsidian');
    expect(normalizeSonalitTheme('light')).toBe('daylight');
    expect(normalizeSonalitTheme('signal')).toBe('signal');
    expect(normalizeSonalitTheme('unexpected')).toBe('obsidian');
    expect(normalizeSonalitTheme(null)).toBe('obsidian');
  });

  it('classifies native browser color-scheme correctly', () => {
    expect(isDarkSonalitTheme('obsidian')).toBe(true);
    expect(isDarkSonalitTheme('graphite')).toBe(true);
    expect(isDarkSonalitTheme('copper')).toBe(true);
    expect(isDarkSonalitTheme('signal')).toBe(true);
    expect(isDarkSonalitTheme('arctic')).toBe(false);
    expect(isDarkSonalitTheme('daylight')).toBe(false);
  });
});
