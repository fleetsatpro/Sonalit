const THEMES = new Set(['obsidian', 'arctic', 'graphite', 'copper', 'signal', 'ivory']);
const LIGHT_THEMES = new Set(['arctic', 'ivory']);

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

document.documentElement.setAttribute('data-theme', theme);
document.documentElement.style.colorScheme = LIGHT_THEMES.has(theme) ? 'light' : 'dark';
