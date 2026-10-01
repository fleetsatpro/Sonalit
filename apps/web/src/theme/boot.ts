import { getTheme, normalizeTheme } from '../styles/themes.js';

function readPersistedTheme(): ReturnType<typeof normalizeTheme> {
  try {
    const raw = localStorage.getItem('sonalit-ui');
    if (!raw) return 'obsidian';
    const parsed = JSON.parse(raw) as { state?: { theme?: unknown } };
    return normalizeTheme(parsed.state?.theme);
  } catch {
    return 'obsidian';
  }
}

const theme = readPersistedTheme();
const root = document.documentElement;
const definition = getTheme(theme);
root.setAttribute('data-theme', definition.id);
root.classList.toggle('dark', definition.mode === 'dark');
root.style.colorScheme = definition.mode;
document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', definition.chrome);
