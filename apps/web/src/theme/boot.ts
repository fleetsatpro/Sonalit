const THEMES = new Set(['obsidian', 'arctic', 'graphite', 'copper', 'signal', 'ivory']);
const LIGHT_THEMES = new Set(['ivory']);

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
    ? 'ivory'
    : persisted && THEMES.has(persisted)
      ? persisted
      : 'obsidian';

const root = document.documentElement;
root.setAttribute('data-sonalit-theme', theme);
root.setAttribute('data-theme', theme === 'ivory' ? 'light' : theme);
root.style.colorScheme = LIGHT_THEMES.has(theme) ? 'light' : 'dark';

const chrome = {
  obsidian: '#030711',
  arctic: '#07111a',
  graphite: '#0b0e11',
  copper: '#110b09',
  signal: '#070b08',
  ivory: '#f3f6f4',
} as Record<string, string>;

document.querySelector('meta[name="theme-color"]')?.setAttribute('content', chrome[theme] ?? chrome.obsidian);
