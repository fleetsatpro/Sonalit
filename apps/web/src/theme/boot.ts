const THEMES = new Set(['obsidian', 'arctic', 'graphite', 'copper', 'signal', 'ivory', 'daylight']);
const LIGHT_THEMES = new Set(['arctic', 'ivory', 'daylight']);

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

const root = document.documentElement;
root.setAttribute('data-theme', theme);
root.classList.toggle('dark', !LIGHT_THEMES.has(theme));
root.style.colorScheme = LIGHT_THEMES.has(theme) ? 'light' : 'dark';

const themeChrome: Record<string, string> = {
  obsidian: '#030711',
  arctic: '#f4f8fc',
  graphite: '#0e1012',
  copper: '#130f0d',
  signal: '#090d09',
  ivory: '#f8f7f2',
  daylight: '#f8f7f2',
};

const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
if (themeColor) themeColor.content = themeChrome[theme] ?? themeChrome.obsidian;
