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

// The theme field existed here before but nothing ever applied it — no
// component read useUIStore.theme, so switching it had zero visible effect.
// Setting data-theme on <html> is what dashboard.css's light-mode variable
// overrides key off; doing it here (not in a component effect) means it
// takes effect the instant setTheme is called and right after persisted
// state rehydrates, with no extra wiring needed in main.tsx.
function applyTheme(theme: Theme) {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
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
      setTheme: (theme) => { applyTheme(theme); set({ theme }); },
    }),
    {
      name: 'sonalit-ui',
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
