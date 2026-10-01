const THEMES = new Set(['obsidian', 'arctic', 'graphite', 'copper', 'signal', 'daylight']);
const LIGHT_THEMES = new Set(['arctic', 'daylight']);

function readPersistedTheme(): string | null {
  try {
    const raw = localStorage.getItem('sonalit-ui');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { theme?: unknown } };
    return typeof parsed.state?.theme === 'string' ? parsed.state.theme : null;
  } catch {
    return null;
  }
}

const persisted = readPersistedTheme();
const theme = persisted === 'dark'
  ? 'obsidian'
  : persisted === 'light'
    ? 'daylight'
    : persisted && THEMES.has(persisted)
      ? persisted
      : 'obsidian';

document.documentElement.setAttribute('data-theme', theme);
document.documentElement.style.colorScheme = LIGHT_THEMES.has(theme) ? 'light' : 'dark';


const THEME_CHROME: Record<string, string> = {
  obsidian: '#030711',
  arctic: '#f7fbff',
  graphite: '#0d0f12',
  copper: '#100b08',
  signal: '#050b07',
  daylight: '#fbfaf6',
};

document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute(
  'content',
  THEME_CHROME[theme] ?? THEME_CHROME.obsidian,
);
