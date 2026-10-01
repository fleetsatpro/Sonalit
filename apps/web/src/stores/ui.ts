import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import {
  isDarkSonalitTheme,
  normalizeSonalitTheme,
  type SonalitTheme,
} from '../styles/themes.js';

export type Theme = SonalitTheme;

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;

  const normalized = normalizeSonalitTheme(theme);
  const root = document.documentElement;
  const dark = isDarkSonalitTheme(normalized);

  root.setAttribute('data-theme', normalized);
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';

  // Keep browser/PWA chrome synchronized with the selected surface when the
  // meta tag is present. This is presentation-only and never affects data.
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const themeColors: Record<Theme, string> = {
    obsidian: '#030711',
    arctic: '#f4f8fc',
    graphite: '#0e1012',
    copper: '#130f0d',
    signal: '#090d09',
    daylight: '#f8f7f2',
  };
  if (themeColor) themeColor.content = themeColors[normalized];
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
        const normalized = normalizeSonalitTheme(theme);
        applyTheme(normalized);
        set({ theme: normalized });
      },
    }),
    {
      name: 'sonalit-ui',
      version: 2,
      partialize: (s) => ({ theme: s.theme }),
      migrate: (persistedState) => {
        const state = persistedState as Partial<UIState> | undefined;
        return {
          theme: normalizeSonalitTheme(state?.theme),
        };
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const normalized = normalizeSonalitTheme(state.theme);
        if (state.theme !== normalized) state.setTheme(normalized);
        else applyTheme(normalized);
      },
    },
  ),
);
