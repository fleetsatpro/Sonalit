import { create } from 'zustand';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
}

export type CDSView =
  | 'dashboard' | 'live' | 'containers' | 'bookings' | 'locks'
  | 'drivers' | 'transporters' | 'port' | 'pulse' | 'inbox'
  | 'billing' | 'reports' | 'analytics' | 'settings';

interface CDSUIState {
  activeView: CDSView;
  setActiveView: (view: CDSView) => void;
  drawerOpen: boolean;
  drawerTitle: string;
  drawerContent: React.ReactNode | null;
  toasts: Toast[];
  viewMode: 'kanban' | 'list';
  openDrawer: (title: string, content: React.ReactNode) => void;
  closeDrawer: () => void;
  addToast: (message: string, type?: Toast['type']) => void;
  toggleViewMode: () => void;
}

let toastCounter = 0;

export const useCDSStore = create<CDSUIState>()((set) => ({
  activeView: 'dashboard' as CDSView,
  setActiveView: (view) => set({ activeView: view }),
  drawerOpen: false,
  drawerTitle: '',
  drawerContent: null,
  toasts: [],
  viewMode: 'kanban' as const,
  openDrawer: (title, content) =>
    set({ drawerOpen: true, drawerTitle: title, drawerContent: content }),
  closeDrawer: () =>
    set({ drawerOpen: false, drawerTitle: '', drawerContent: null }),
  addToast: (message, type = 'success') => {
    const id = `toast-${++toastCounter}`;
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 3000);
  },
  toggleViewMode: () =>
    set((s) => ({ viewMode: s.viewMode === 'kanban' ? 'list' : 'kanban' })),
}));
