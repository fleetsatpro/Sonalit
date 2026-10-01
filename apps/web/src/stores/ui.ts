import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const THEMES = ['obsidian', 'arctic', 'graphite', 'copper', 'signal', 'ivory'] as const;
export type Theme = typeof THEMES[number];

const LEGACY_THEME_MAP: Record<string, Theme> = { dark: 'obsidian', light: 'ivory' };

function normalizeTheme(theme: string | null | undefined): Theme {
  if (theme && (THEMES as readonly string[]).includes(theme)) return theme as Theme;
  return LEGACY_THEME_MAP[theme ?? ''] ?? 'obsidian';
}

function applyTheme(theme: string) {
  if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', normalizeTheme(theme));
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
      setTheme: (theme) => { applyTheme(theme); set({ theme }); },
    }),
    {
      name: 'sonalit-ui',
      partialize: (s) => ({ theme: s.theme }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          const theme = normalizeTheme(state.theme);
          applyTheme(theme);
          if (state.theme !== theme) useUIStore.setState({ theme });
        } else applyTheme('obsidian');
      },
    }
  )
);
