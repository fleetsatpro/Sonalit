import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'dark' | 'light';

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
      theme: 'dark',
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
