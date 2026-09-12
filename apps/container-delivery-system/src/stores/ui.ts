import { create } from 'zustand';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
}

interface UIState {
  sidebarCollapsed: boolean;
  drawerOpen: boolean;
  drawerTitle: string;
  drawerContent: React.ReactNode | null;
  toasts: Toast[];
  commandPaletteOpen: boolean;
  toggleSidebar: () => void;
  openDrawer: (title: string, content: React.ReactNode) => void;
  closeDrawer: () => void;
  addToast: (message: string, type?: Toast['type']) => void;
  removeToast: (id: string) => void;
  setCommandPaletteOpen: (open: boolean) => void;
}

let toastCounter = 0;

export const useUIStore = create<UIState>()((set) => ({
  sidebarCollapsed: false,
  drawerOpen: false,
  drawerTitle: '',
  drawerContent: null,
  toasts: [],
  commandPaletteOpen: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  openDrawer: (title, content) => set({ drawerOpen: true, drawerTitle: title, drawerContent: content }),
  closeDrawer: () => set({ drawerOpen: false, drawerTitle: '', drawerContent: null }),
  addToast: (message, type = 'success') => {
    const id = `toast-${++toastCounter}`;
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 3000);
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
}));
