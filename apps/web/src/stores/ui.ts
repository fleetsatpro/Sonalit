import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme =
  | 'obsidian'
  | 'arctic'
  | 'graphite'
  | 'copper'
  | 'signal'
  | 'ivory';

export const THEMES: ReadonlyArray<{
  id: Theme;
  name: string;
  descriptor: string;
  mode: 'dark' | 'light';
  accent: string;
}> = [
  { id: 'obsidian', name: 'Obsidian Command', descriptor: 'Deep command-room contrast', mode: 'dark', accent: '#b8a6ff' },
  { id: 'arctic', name: 'Arctic Signal', descriptor: 'Cool analytical operations', mode: 'dark', accent: '#67e8f9' },
  { id: 'graphite', name: 'Graphite Pro', descriptor: 'Neutral executive control', mode: 'dark', accent: '#aeb9c8' },
  { id: 'copper', name: 'Copper Dusk', descriptor: 'Warm field operations', mode: 'dark', accent: '#f6a46a' },
  { id: 'signal', name: 'Signal Lime', descriptor: 'High-visibility tactical', mode: 'dark', accent: '#d9ff69' },
  { id: 'ivory', name: 'Ivory Daylight', descriptor: 'Bright field / daylight', mode: 'light', accent: '#0b8f72' },
];

const DEFAULT_THEME: Theme = 'obsidian';

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  const meta = THEMES.find((item) => item.id === theme) ?? THEMES[0];
  document.documentElement.setAttribute('data-theme', meta.id);
  document.documentElement.style.colorScheme = meta.mode;
}

function normalizeTheme(value: unknown): Theme {
  return THEMES.some((theme) => theme.id === value) ? value as Theme : DEFAULT_THEME;
}

applyTheme(DEFAULT_THEME);

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
      theme: DEFAULT_THEME,
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
      partialize: (s) => ({ theme: s.theme }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          const normalized = normalizeTheme(state.theme);
          if (normalized !== state.theme) state.setTheme(normalized);
          else applyTheme(normalized);
        }
      },
    },
  ),
);
