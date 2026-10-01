export const SONALIT_THEMES = [
  { id: 'obsidian', name: 'Obsidian Command', mode: 'dark', description: 'Deep-space command console with holographic cyan and violet signals.', preview: ['#030711', '#101a30', '#22e8ff', '#8b6bff'] },
  { id: 'arctic', name: 'Arctic Signal', mode: 'light', description: 'High-clarity analytical surface with cool blue intelligence accents.', preview: ['#f5f8fc', '#ffffff', '#087ea4', '#3158b8'] },
  { id: 'graphite', name: 'Graphite Pro', mode: 'dark', description: 'Refined graphite control room with restrained electric blue telemetry.', preview: ['#090b10', '#171b23', '#58b8ff', '#a78bfa'] },
  { id: 'copper', name: 'Copper Dusk', mode: 'dark', description: 'Warm field-operations aesthetic built around copper and amber signals.', preview: ['#100b08', '#211710', '#ff9b54', '#ffd166'] },
  { id: 'signal', name: 'Signal Lime', mode: 'dark', description: 'High-visibility tactical console with disciplined lime-green signaling.', preview: ['#070c09', '#101a14', '#c7ff4d', '#5eead4'] },
  { id: 'ivory', name: 'Ivory Daylight', mode: 'light', description: 'Bright executive surface designed for daylight operations and field tablets.', preview: ['#f8f7f3', '#ffffff', '#0f766e', '#b45309'] },
] as const;

export type SonalitTheme = typeof SONALIT_THEMES[number]['id'];
export type ThemeMode = typeof SONALIT_THEMES[number]['mode'];
export const DEFAULT_SONALIT_THEME: SonalitTheme = 'obsidian';
export function isSonalitTheme(value: unknown): value is SonalitTheme {
  return typeof value === 'string' && SONALIT_THEMES.some((theme) => theme.id === value);
}
