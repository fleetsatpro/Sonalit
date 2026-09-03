import './index.css';
// Design tokens (--d-void, --d-rail-w, etc.) consumed by AppShell + Rail on
// every route. Previously only Dashboard imported this; without it, the
// margin-left: var(--d-rail-w) rule silently collapsed to 0 on non-Dashboard
// pages, letting the outlet render underneath the sidebar.
import './styles/dashboard.css';
import './i18n/index.js';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './router.js';
import { initOtel } from './lib/otel.js';
import { initSentry, Sentry } from './lib/sentry.js';
import { useAuthStore } from './stores/auth.js';
import OfflineGuard from './components/OfflineGuard.js';
import UpdateAvailableToast from './components/UpdateAvailableToast.js';

initOtel();
initSentry();

// Service-worker update flow. Two problems this addresses:
//   1. A warm WebView (the Android shell keeps the app alive, so it never
//      re-navigates) never re-registers the SW and so never discovers a new
//      deploy — installed users could sit on a stale build indefinitely.
//      Fix: poll registration.update() on an interval and whenever the app
//      returns to the foreground.
//   2. workbox runs with skipWaiting+clientsClaim, so a new SW activates and
//      fires controllerchange while the page is still running the OLD bundle.
//      Fix: reload when that happens. We reload immediately unless the user is
//      actively typing in a visible tab, in which case we defer until the app
//      is next backgrounded — never interrupting mid-input, but never leaving
//      them stuck on stale assets either. A guard prevents a reload loop.
if ('serviceWorker' in navigator) {
  let reloading = false;
  const reloadOnce = () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  };

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const el = document.activeElement as HTMLElement | null;
    const isTyping = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    if (document.visibilityState === 'visible' && isTyping) {
      const onHide = () => {
        if (document.visibilityState === 'hidden') {
          document.removeEventListener('visibilitychange', onHide);
          reloadOnce();
        }
      };
      document.addEventListener('visibilitychange', onHide);
    } else {
      reloadOnce();
    }
  });

  navigator.serviceWorker.ready
    .then((registration) => {
      const check = () => { void registration.update().catch(() => undefined); };
      check();
      window.setInterval(check, 60_000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    })
    .catch(() => undefined);
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
      <Sentry.ErrorBoundary fallback={<p>An unexpected error occurred.</p>}>
        <OfflineGuard>
          <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
          </QueryClientProvider>
          <UpdateAvailableToast />
        </OfflineGuard>
      </Sentry.ErrorBoundary>
    </React.StrictMode>,
  );
}

mount();
