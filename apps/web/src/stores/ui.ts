import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme =
  | 'obsidian-command'
  | 'arctic-signal'
  | 'graphite-pro'
  | 'copper-dusk'
  | 'signal-lime'
  | 'ivory-daylight';

export const THEMES: ReadonlyArray<{
  id: Theme;
  name: string;
  descriptor: string;
  mode: 'dark' | 'light';
  accent: string;
}> = [
  { id: 'obsidian-command', name: 'Obsidian Command', descriptor: 'Signature operations console', mode: 'dark', accent: '#22e8ff' },
  { id: 'arctic-signal', name: 'Arctic Signal', descriptor: 'Crisp analytical control', mode: 'light', accent: '#0f7ea8' },
  { id: 'graphite-pro', name: 'Graphite Pro', descriptor: 'Neutral executive command', mode: 'dark', accent: '#d7a84a' },
  { id: 'copper-dusk', name: 'Copper Dusk', descriptor: 'Warm field operations', mode: 'dark', accent: '#f28a52' },
  { id: 'signal-lime', name: 'Signal Lime', descriptor: 'High-visibility NOC', mode: 'dark', accent: '#c7f36b' },
  { id: 'ivory-daylight', name: 'Ivory Daylight', descriptor: 'Bright field workspace', mode: 'light', accent: '#d96a35' },
];

// The theme field existed here before but nothing ever applied it — no
// component read useUIStore.theme, so switching it had zero visible effect.
// Setting data-theme on <html> is what dashboard.css's light-mode variable
// overrides key off; doing it here (not in a component effect) means it
// takes effect the instant setTheme is called and right after persisted
// state rehydrates, with no extra wiring needed in main.tsx.
function applyTheme(theme: Theme) {
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = THEMES.find((item) => item.id === theme)?.mode ?? 'dark';
    root.style.setProperty('theme-color', THEMES.find((item) => item.id === theme)?.accent ?? '#22e8ff');
  }
}

function migrateTheme(theme: unknown): Theme {
  if (theme === 'dark') return 'obsidian-command';
  if (theme === 'light') return 'ivory-daylight';
  return THEMES.some((item) => item.id === theme) ? theme as Theme : 'obsidian-command';
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
      theme: 'obsidian-command',
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
      version: 2,
      migrate: (persisted) => ({ ...persisted as UIState, theme: migrateTheme((persisted as Partial<UIState>)?.theme) }),
      onRehydrateStorage: () => (state) => {
        if (state) { const theme = migrateTheme(state.theme); applyTheme(theme); state.theme = theme; }
      },
    }
  )
);
