import './index.css';
// Design tokens (--d-void, --d-rail-w, etc.) consumed by AppShell + Rail on
// every route. Previously only Dashboard imported this; without it, the
// margin-left: var(--d-rail-w) rule silently collapsed to 0 on non-Dashboard
// pages, letting the outlet render underneath the sidebar.
import './styles/dashboard.css';
import './styles/intelligence-centre-3d.css';
import './styles/intelligence-centre-command.css';
// Public marketing site design system. Every rule is scoped under
// .sonalit-public, so it is inert on every application route — it lives here
// rather than in the marketing components because scripts/prerender.tsx has to
// import that component tree outside Vite, where a CSS import would throw.
import './styles/marketing.css';
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

async function mount() {
  await new Promise<void>((resolve) => {
    const unsub = useAuthStore.persist.onFinishHydration(() => {
      unsub();
      resolve();
    });
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
