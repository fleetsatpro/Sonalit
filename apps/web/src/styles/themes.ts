export const SONALIT_THEMES = [
  { id: 'obsidian', name: 'Obsidian Command', description: 'Deep command-room contrast with cyan telemetry and violet control accents.', swatches: ['#030711','#22e8ff','#8b6bff'] },
  { id: 'arctic', name: 'Arctic Signal', description: 'Bright analytical workspace with cool blue surfaces and precise signal accents.', swatches: ['#f4f8fc','#0b6e8f','#3156a8'] },
  { id: 'graphite', name: 'Graphite Pro', description: 'Neutral executive control-room finish for long operational sessions.', swatches: ['#111315','#7dd3fc','#d1d5db'] },
  { id: 'copper', name: 'Copper Dusk', description: 'Warm field-operations palette with restrained copper instrumentation.', swatches: ['#130f0d','#ff9f68','#67e8c5'] },
  { id: 'signal', name: 'Signal Lime', description: 'High-visibility tactical display tuned for rapid state recognition.', swatches: ['#090d09','#d8ff5f','#65e6a8'] },
  { id: 'daylight', name: 'Ivory Daylight', description: 'Low-glare daylight workspace for field and tablet use.', swatches: ['#f8f7f2','#0f766e','#c2410c'] },
] as const;

export type SonalitTheme = typeof SONALIT_THEMES[number]['id'];
