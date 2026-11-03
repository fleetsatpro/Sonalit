import { getTheme } from '../styles/themes.js';

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
const theme = getTheme(persisted);

const root = document.documentElement;
root.setAttribute('data-theme', theme.id);
root.classList.toggle('dark', theme.mode === 'dark');
root.style.colorScheme = theme.mode;

document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute(
  'content',
  theme.chrome,
);
