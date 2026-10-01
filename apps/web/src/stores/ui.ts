import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme =
  | 'obsidian'
  | 'arctic'
  | 'graphite'
  | 'copper'
  | 'signal'
  | 'ivory';

export const THEMES = [
  { id: 'obsidian', name: 'Obsidian Command', description: 'Holographic dark operations', mode: 'Dark' },
  { id: 'arctic', name: 'Arctic Signal', description: 'Cool analytical command', mode: 'Dark' },
  { id: 'graphite', name: 'Graphite Pro', description: 'Neutral executive control', mode: 'Dark' },
  { id: 'copper', name: 'Copper Dusk', description: 'Warm field operations', mode: 'Dark' },
  { id: 'signal', name: 'Signal Lime', description: 'High-visibility tactical', mode: 'Dark' },
  { id: 'ivory', name: 'Ivory Daylight', description: 'Daylight field operations', mode: 'Light' },
] as const;

export type ThemeDefinition = (typeof THEMES)[number];

const LEGACY_THEME_MAP: Record<string, Theme> = {
  dark: 'obsidian',
  light: 'ivory',
};

function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && THEMES.some((theme) => theme.id === value);
}

function normalizeTheme(value: unknown): Theme {
  if (isTheme(value)) return value;
  if (typeof value === 'string' && LEGACY_THEME_MAP[value]) return LEGACY_THEME_MAP[value];
  return 'obsidian';
}

function applyTheme(theme: Theme) {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

// Prevent a first-paint flash before persisted Zustand state finishes hydrating.
applyTheme('obsidian');

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
      version: 2,
      partialize: (s) => ({ theme: s.theme }),
      migrate: (persistedState) => {
        const state = persistedState as { theme?: unknown } | null;
        return { theme: normalizeTheme(state?.theme) };
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          const normalized = normalizeTheme(state.theme);
          if (normalized !== state.theme) {
            state.setTheme(normalized);
          } else {
            applyTheme(normalized);
          }
        }
      },
    },
  ),
);
