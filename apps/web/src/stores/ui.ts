import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const SONALIT_THEMES = ['obsidian', 'arctic', 'graphite', 'copper', 'signal', 'ivory'] as const;
export type Theme = typeof SONALIT_THEMES[number];

export const THEME_META: Record<Theme, {
  label: string;
  description: string;
  density: 'dark' | 'light';
  accent: string;
}> = {
  obsidian: { label: 'Obsidian Command', description: 'Deep-space command console with cyan/violet instrumentation.', density: 'dark', accent: '#22e8ff' },
  arctic: { label: 'Arctic Signal', description: 'Bright analytical control room with cool blue telemetry accents.', density: 'light', accent: '#0b7cff' },
  graphite: { label: 'Graphite Pro', description: 'Neutral executive console with restrained blue signal accents.', density: 'dark', accent: '#9ca8ff' },
  copper: { label: 'Copper Dusk', description: 'Warm field-operations palette with copper and ember instrumentation.', density: 'dark', accent: '#ff9b54' },
  signal: { label: 'Signal Lime', description: 'High-visibility tactical console for fast operational scanning.', density: 'dark', accent: '#c8ff4a' },
  ivory: { label: 'Ivory Daylight', description: 'Daylight field console tuned for bright environments and tablets.', density: 'light', accent: '#0f766e' },
};

const DEFAULT_THEME: Theme = 'obsidian';
const isTheme = (value: unknown): value is Theme =>
  typeof value === 'string' && (SONALIT_THEMES as readonly string[]).includes(value);

function normalizeTheme(value: unknown): Theme {
  if (isTheme(value)) return value;
  if (value === 'light') return 'ivory';
  return DEFAULT_THEME;
}

export function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.style.colorScheme = THEME_META[theme].density;
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
      theme: DEFAULT_THEME,
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
      migrate: (persisted: unknown) => {
        const state = persisted as { theme?: unknown } | null;
        return { theme: normalizeTheme(state?.theme) };
      },
      partialize: (state) => ({ theme: state.theme }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          const theme = normalizeTheme(state.theme);
          if (theme !== state.theme) state.setTheme(theme);
          else applyTheme(theme);
        }
      },
    },
  ),
);
