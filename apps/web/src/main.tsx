import './index.css';
import './i18n/index.js';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './router.js';
import { initOtel } from './lib/otel.js';
import { useAuthStore } from './stores/auth.js';
import OfflineGuard from './components/OfflineGuard.js';

initOtel();

// T2.6: Guard against reload-loop — only reload when page is not actively used.
// An unconditional reload on controllerchange causes a loop when the SW updates
// while the user is mid-session (e.g. filling a form).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (document.visibilityState === 'hidden') {
      window.location.reload();
    }
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 2 },
    mutations: { retry: 0 },
  },
});

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');

// T2.5: Await Zustand rehydration before mounting the router so the auth
// guard in beforeLoad can read persisted user state synchronously.
async function mount() {
  await new Promise<void>((resolve) => {
    const unsub = useAuthStore.persist.onFinishHydration(() => {
      unsub();
      resolve();
    });
    // If already hydrated (e.g. SSR or immediate storage), resolve right away.
    if (useAuthStore.persist.hasHydrated()) resolve();
  });

  ReactDOM.createRoot(rootEl!).render(
    <React.StrictMode>
      <OfflineGuard>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </OfflineGuard>
    </React.StrictMode>,
  );
}

mount();
