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

const CDS_HASH_PREFIX = 'cds:';
const CDS_VIEWS = new Set<CDSView>([
  'dashboard', 'live', 'containers', 'bookings', 'locks', 'drivers',
  'transporters', 'port', 'pulse', 'inbox', 'billing', 'reports',
  'analytics', 'settings',
]);

function viewFromLocation(): CDSView {
  if (typeof window === 'undefined') return 'dashboard';
  const hash = window.location.hash.replace(/^#/, '');
  const candidate = hash.startsWith(CDS_HASH_PREFIX)
    ? hash.slice(CDS_HASH_PREFIX.length)
    : '';
  return CDS_VIEWS.has(candidate as CDSView) ? candidate as CDSView : 'dashboard';
}

interface CDSUIState {
  activeView: CDSView;
  setActiveView: (view: CDSView) => void;
  drawerOpen: boolean;
  drawerTitle: string;
  drawerContent: React.ReactNode | null;
  toasts: Toast[];
  openDrawer: (title: string, content: React.ReactNode) => void;
  closeDrawer: () => void;
  addToast: (message: string, type?: Toast['type']) => void;
}

let toastCounter = 0;

export const useCDSStore = create<CDSUIState>()((set) => ({
  // CDS views are URL-backed now, so browser/device Back can unwind one
  // submodule at a time instead of leaving the CDS surface altogether.
  activeView: viewFromLocation(),
  setActiveView: (view) => {
    set({ activeView: view });

    if (typeof window === 'undefined') return;

    const url = new URL(window.location.href);
    url.hash = view === 'dashboard' ? '' : `${CDS_HASH_PREFIX}${view}`;

    // Preserve the router's existing history state. We deliberately keep the
    // pathname at /cds: CDS views are an internal module state, not separate
    // top-level application routes. Each selection still gets its own browser
    // history entry, making Back deterministic without creating 14 new routes.
    window.history.pushState(
      { ...(window.history.state ?? {}), sonalitCDSView: view },
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );
  },
  drawerOpen: false,
  drawerTitle: '',
  drawerContent: null,
  toasts: [],
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
}));

// Browser/device Back emits popstate. Reconcile the CDS UI with the history
// entry instead of allowing the outer application shell to become the next
// visible destination.
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    useCDSStore.setState({ activeView: viewFromLocation() });
  });
}
