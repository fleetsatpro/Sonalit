import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_SONALIT_THEME, getSonalitThemeMeta, normalizeSonalitTheme, type SonalitTheme } from './theme.js';

function applyTheme(theme: SonalitTheme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  const meta = getSonalitThemeMeta(theme);
  root.setAttribute('data-sonalit-theme', theme);
  // Keep the existing light-token path coherent for Ivory while the new layer
  // remains independent for every other theme.
  root.setAttribute('data-theme', theme === 'ivory' ? 'light' : theme);
  root.style.colorScheme = meta.mode;
  metaThemeColor?.setAttribute('content', meta.preview[0]);
}

function readPersistedTheme(): SonalitTheme {
  if (typeof window === 'undefined') return DEFAULT_SONALIT_THEME;
  try {
    const raw = window.localStorage.getItem('sonalit-ui');
    const parsed = raw ? JSON.parse(raw) as { state?: { theme?: unknown } } : null;
    return normalizeSonalitTheme(parsed?.state?.theme);
  } catch {
    return DEFAULT_SONALIT_THEME;
  }
}

// Apply before React mounts so a persisted choice does not flash Obsidian first.
const initialTheme = readPersistedTheme();
applyTheme(initialTheme);

type UIState = {
  sidebarOpen: boolean;
  theme: SonalitTheme;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setTheme: (theme: SonalitTheme) => void;
};

const defaultSidebarOpen = typeof window !== 'undefined'
  ? window.matchMedia('(min-width: 768px)').matches
  : false;

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: defaultSidebarOpen,
      theme: initialTheme,
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setTheme: (theme) => {
        const normalized = normalizeSonalitTheme(theme);
        applyTheme(normalized);
        set({ theme: normalized });
      },
    }),
    {
      name: 'sonalit-ui',
      version: 4,
      partialize: (state) => ({ theme: state.theme }),
      migrate: (persistedState) => ({
        theme: normalizeSonalitTheme((persistedState as { theme?: unknown } | null)?.theme),
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const normalized = normalizeSonalitTheme(state.theme);
        if (normalized !== state.theme) state.theme = normalized;
        applyTheme(normalized);
      },
    },
  ),
);
