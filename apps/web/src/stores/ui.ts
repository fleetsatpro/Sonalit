import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_SONALIT_THEME, getSonalitTheme, getSonalitThemeMeta, type SonalitTheme } from './theme.js';

function applyTheme(theme: SonalitTheme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  const themeMeta = getSonalitThemeMeta(theme);

  root.setAttribute('data-sonalit-theme', theme);
  root.setAttribute('data-theme', theme === 'ivory' ? 'light' : theme);
  root.style.colorScheme = themeMeta.mode;
  metaThemeColor?.setAttribute('content', themeMeta.preview[0]);
}

function bootstrapTheme(): SonalitTheme {
  if (typeof window === 'undefined') return DEFAULT_SONALIT_THEME;
  try {
    const raw = window.localStorage.getItem('sonalit-ui');
    if (!raw) return DEFAULT_SONALIT_THEME;
    const parsed = JSON.parse(raw) as { state?: { theme?: unknown } };
    return getSonalitTheme(parsed?.state?.theme);
  } catch {
    return DEFAULT_SONALIT_THEME;
  }
}

const bootTheme = bootstrapTheme();
applyTheme(bootTheme);

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
      theme: bootTheme,
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setTheme: (theme) => {
        const safeTheme = getSonalitTheme(theme);
        applyTheme(safeTheme);
        set({ theme: safeTheme });
      },
    }),
    {
      name: 'sonalit-ui',
      partialize: (state) => ({ theme: state.theme }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          const safeTheme = getSonalitTheme(state.theme);
          if (safeTheme !== state.theme) state.theme = safeTheme;
          applyTheme(safeTheme);
        }
      },
    },
  ),
);
