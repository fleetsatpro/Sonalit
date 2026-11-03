export const SONALIT_THEMES = [
  {
    id: 'obsidian',
    name: 'Obsidian Command',
    description: 'Signature operations console with deep-space surfaces and cyan telemetry.',
    mode: 'dark',
    chrome: '#030711',
    accent: '#22e8ff',
    swatches: ['#030711', '#101a30', '#22e8ff', '#8b6bff'],
  },
  {
    id: 'arctic',
    name: 'Arctic Signal',
    description: 'Bright analytical workspace with cool surfaces and precise blue signal accents.',
    mode: 'light',
    chrome: '#f4f8fc',
    accent: '#0b7898',
    swatches: ['#f4f8fc', '#dce7ef', '#0b7898', '#3156a8'],
  },
  {
    id: 'graphite',
    name: 'Graphite Pro',
    description: 'Neutral executive control-room finish for dense operational sessions.',
    mode: 'dark',
    chrome: '#0e1012',
    accent: '#7dd3fc',
    swatches: ['#0e1012', '#202428', '#7dd3fc', '#d1d5db'],
  },
  {
    id: 'copper',
    name: 'Copper Dusk',
    description: 'Warm field-operations palette with restrained copper and teal instrumentation.',
    mode: 'dark',
    chrome: '#130f0d',
    accent: '#ff9f68',
    swatches: ['#130f0d', '#2a201b', '#ff9f68', '#67e8c5'],
  },
  {
    id: 'signal',
    name: 'Signal Lime',
    description: 'High-visibility tactical display tuned for rapid state recognition.',
    mode: 'dark',
    chrome: '#090d09',
    accent: '#d8ff5f',
    swatches: ['#090d09', '#171e16', '#d8ff5f', '#65e6a8'],
  },
  {
    id: 'daylight',
    name: 'Ivory Daylight',
    description: 'Low-glare daylight workspace for field and tablet operations.',
    mode: 'light',
    chrome: '#f8f7f2',
    accent: '#0f766e',
    swatches: ['#f8f7f2', '#deded5', '#0f766e', '#c2410c'],
  },
] as const;

export type SonalitTheme = typeof SONALIT_THEMES[number]['id'];

export function normalizeTheme(value: unknown): SonalitTheme {
  // Legacy aliases are normalized here so every consumer (bootstrap, store,
  // Settings and tests) converges on one persisted production identity.
  if (value === 'dark') return 'obsidian';
  if (value === 'light' || value === 'ivory') return 'daylight';
  return SONALIT_THEMES.some((theme) => theme.id === value)
    ? value as SonalitTheme
    : 'obsidian';
}

export function getTheme(theme: unknown) {
  const id = normalizeTheme(theme);
  return SONALIT_THEMES.find((item) => item.id === id) ?? SONALIT_THEMES[0];
}
