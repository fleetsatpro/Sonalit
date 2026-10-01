import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { DEFAULT_SONALIT_THEME, isSonalitTheme, type SonalitTheme } from '../theme/themes.js';

type Theme = SonalitTheme | 'dark' | 'light';

function normalizeTheme(theme: Theme | unknown): SonalitTheme {
  if (theme === 'dark') return 'obsidian';
  if (theme === 'light') return 'ivory';
  return isSonalitTheme(theme) ? theme : DEFAULT_SONALIT_THEME;
}

// The theme field existed here before but nothing ever applied it — no
// component read useUIStore.theme, so switching it had zero visible effect.
// Setting data-theme on <html> is what dashboard.css's light-mode variable
// overrides key off; doing it here (not in a component effect) means it
// takes effect the instant setTheme is called and right after persisted
// state rehydrates, with no extra wiring needed in main.tsx.
function applyTheme(theme: Theme | unknown) {
  if (typeof document !== 'undefined') {
    const normalized = normalizeTheme(theme);
    document.documentElement.setAttribute('data-theme', normalized);
    document.documentElement.style.colorScheme = normalized === 'arctic' || normalized === 'ivory' ? 'light' : 'dark';
  }
}

type UIState = {
  sidebarOpen: boolean;
  theme: Theme;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setTheme: (theme: Theme) => void;
};

// T4.6: Default sidebar open on md+ screens, closed on mobile.
const defaultSidebarOpen = typeof window !== 'undefined'
  ? window.matchMedia('(min-width: 768px)').matches
  : false;

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: defaultSidebarOpen,
      theme: DEFAULT_SONALIT_THEME,
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setTheme: (theme) => {
        const normalized = normalizeTheme(theme);
        applyTheme(normalized);
        set({ theme: normalized });
      },
    }),
    {
      name: 'sonalit-ui',
      version: 2,
      migrate: (persistedState: unknown) => {
        if (!persistedState || typeof persistedState !== 'object') return persistedState;
        const state = persistedState as { theme?: unknown };
        return { ...state, theme: normalizeTheme(state.theme) };
      },
      // Only theme is worth remembering across sessions — sidebarOpen should
      // keep re-deriving from viewport width on each load (its original
      // behavior), not get stuck on whatever it was last closed/opened to.
      partialize: (s) => ({ theme: s.theme }),
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme);
      },
    }
  )
);
