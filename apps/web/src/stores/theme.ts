export const SONALIT_THEMES = [
  { id: 'obsidian', name: 'Obsidian Command', description: 'Cinematic command centre with cyan telemetry and violet intelligence accents.', mode: 'dark', accent: '#22e8ff', accentSecondary: '#8b6bff', preview: ['#030711', '#101a30', '#22e8ff', '#8b6bff'] },
  { id: 'arctic', name: 'Arctic Signal', description: 'Cool, high-clarity operations console for dense analytical work.', mode: 'dark', accent: '#5ee7ff', accentSecondary: '#6ea8ff', preview: ['#07111a', '#10222d', '#5ee7ff', '#6ea8ff'] },
  { id: 'graphite', name: 'Graphite Pro', description: 'Restrained executive control-room language with neutral graphite surfaces.', mode: 'dark', accent: '#c8d2dc', accentSecondary: '#8da7bd', preview: ['#0b0e11', '#171c21', '#c8d2dc', '#8da7bd'] },
  { id: 'copper', name: 'Copper Dusk', description: 'Warm field-operations language built around copper and ember highlights.', mode: 'dark', accent: '#ff9d63', accentSecondary: '#f06d42', preview: ['#110b09', '#211613', '#ff9d63', '#f06d42'] },
  { id: 'signal', name: 'Signal Lime', description: 'High-visibility tactical console with deliberate signal-green emphasis.', mode: 'dark', accent: '#d7ff4f', accentSecondary: '#62f0b0', preview: ['#070b08', '#111b13', '#d7ff4f', '#62f0b0'] },
  { id: 'ivory', name: 'Ivory Daylight', description: 'Bright field and executive mode designed for daylight readability.', mode: 'light', accent: '#0f766e', accentSecondary: '#c2410c', preview: ['#f8faf8', '#ffffff', '#0f766e', '#c2410c'] },
] as const;

export type SonalitTheme = (typeof SONALIT_THEMES)[number]['id'];
export const DEFAULT_SONALIT_THEME: SonalitTheme = 'obsidian';

export function isSonalitTheme(value: unknown): value is SonalitTheme {
  return typeof value === 'string' && SONALIT_THEMES.some((theme) => theme.id === value);
}

export function normalizeSonalitTheme(value: unknown): SonalitTheme {
  if (value === 'dark') return 'obsidian';
  if (value === 'light') return 'ivory';
  return isSonalitTheme(value) ? value : DEFAULT_SONALIT_THEME;
}

export function getSonalitThemeMeta(theme: SonalitTheme) {
  return SONALIT_THEMES.find((item) => item.id === theme) ?? SONALIT_THEMES[0];
}
