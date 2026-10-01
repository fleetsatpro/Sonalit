import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getTheme, normalizeTheme, type SonalitTheme } from '../styles/themes.js';

export type Theme = SonalitTheme;

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  const definition = getTheme(theme);
  root.setAttribute('data-theme', definition.id);
  root.style.colorScheme = definition.mode;

  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeColor) themeColor.content = definition.chrome;
}

type UIState = {
  sidebarOpen: boolean;
  theme: Theme;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setTheme: (theme: Theme) => void;
};

const defaultSidebarOpen = typeof window !== 'undefined'
  ? window.matchMedia('(min-width: 768px)').matches
  : false;

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: defaultSidebarOpen,
      theme: 'obsidian',
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
    }),
    {
      name: 'sonalit-ui',
      partialize: (s) => ({ theme: s.theme }),
      version: 2,
      migrate: (persistedState) => ({
        ...(persistedState as Partial<UIState>),
        theme: normalizeTheme((persistedState as Partial<UIState>)?.theme),
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const theme = normalizeTheme(state.theme);
        if (theme !== state.theme) state.setTheme(theme);
        else applyTheme(theme);
      },
    },
  ),
);
