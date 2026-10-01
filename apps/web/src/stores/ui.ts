import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const SONALIT_THEMES = ['obsidian','arctic','graphite','copper','signal','ivory'] as const;
export type Theme = typeof SONALIT_THEMES[number];

export const THEME_META: Record<Theme, { label: string; description: string; preview: string; density: 'dark' | 'light' }> = {
  obsidian: { label: 'Obsidian Command', description: 'Deep-space command console with cyan/violet instrumentation.', preview: 'linear-gradient(135deg,#030711,#22e8ff,#8b6bff)', density: 'dark' },
  arctic: { label: 'Arctic Signal', description: 'Bright analytical control room with cool blue telemetry accents.', preview: 'linear-gradient(135deg,#f7fbff,#1677ff,#11a6c7)', density: 'light' },
  graphite: { label: 'Graphite Pro', description: 'Neutral executive console with restrained blue signal accents.', preview: 'linear-gradient(135deg,#101216,#657080,#dbe5f0)', density: 'dark' },
  copper: { label: 'Copper Dusk', description: 'Warm field-operations palette with copper and ember instrumentation.', preview: 'linear-gradient(135deg,#120d0a,#d97735,#f0b36b)', density: 'dark' },
  signal: { label: 'Signal Lime', description: 'High-visibility tactical console for fast operational scanning.', preview: 'linear-gradient(135deg,#07100b,#a7e83b,#22c55e)', density: 'dark' },
  ivory: { label: 'Ivory Daylight', description: 'Daylight field console tuned for bright environments and tablets.', preview: 'linear-gradient(135deg,#fffdf8,#245bff,#0e8f72)', density: 'light' },
};

const DEFAULT_THEME: Theme = 'obsidian';
const isTheme = (value: unknown): value is Theme => typeof value === 'string' && (SONALIT_THEMES as readonly string[]).includes(value);

// The theme field existed here before but nothing ever applied it — no
// Setting data-theme on <html> is the single bridge between persisted UI state
// and the dashboard token system. This keeps theme changes immediate and
// prevents individual screens from owning appearance state.
function normalizeTheme(theme: unknown): Theme {
  if (theme === 'light') return 'ivory-daylight';
  if (theme === 'dark' || typeof theme !== 'string' || !THEME_OPTIONS.some((item) => item.id === theme)) {
    return 'obsidian-command';
  }
  return theme as Theme;
}

function applyTheme(theme: Theme) {
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    const option = THEME_OPTIONS.find((item) => item.id === theme);
    root.style.colorScheme = option?.mode ?? 'dark';
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
      theme: DEFAULT_THEME,
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setTheme: (theme) => { const next = normalizeTheme(theme); applyTheme(next); set({ theme: next }); },
    }),
    {
      name: 'sonalit-ui',
      version: 2,
      migrate: (persisted: unknown) => {
        const state = persisted as { theme?: unknown } | null;
        return { theme: isTheme(state?.theme) ? state?.theme : DEFAULT_THEME };
      },
      // Only theme is worth remembering across sessions — sidebarOpen should
      // keep re-deriving from viewport width on each load (its original
      // behavior), not get stuck on whatever it was last closed/opened to.
      partialize: (s) => ({ theme: s.theme }),
      onRehydrateStorage: () => (state) => {
        if (state) { const next = normalizeTheme(state.theme); applyTheme(next); if (next !== state.theme) state.setTheme(next); }
      },
    }
  )
);
