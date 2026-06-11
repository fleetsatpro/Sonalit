import { create } from 'zustand';
// T4.6: Default sidebar open on md+ screens, closed on mobile.
const defaultSidebarOpen = typeof window !== 'undefined'
    ? window.matchMedia('(min-width: 768px)').matches
    : false;
export const useUIStore = create((set) => ({
    sidebarOpen: defaultSidebarOpen,
    theme: 'dark',
    toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
    setSidebarOpen: (open) => set({ sidebarOpen: open }),
    setTheme: (theme) => set({ theme }),
}));
