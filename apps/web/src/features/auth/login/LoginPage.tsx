/*
 * Sonalit LoginPage (apps/web)
 * ────────────────────────────
 * Repo conventions detected (see README.md):
 *   Language       → TypeScript (.tsx). Router uses @tanstack/react-router
 *                    (see src/router.tsx).
 *   Auth store     → Zustand, access token in-memory only per T1.2 policy
 *                    (never persisted to localStorage). setAuth(token, user)
 *                    hydrates; getAccessToken() reads the memory value.
 *   API client     → src/lib/api.ts (axios with withCredentials for the
 *                    httpOnly refresh cookie, CSRF double-submit, and a
 *                    401-with-loop-guard refresh interceptor).
 *   Data fetching  → @tanstack/react-query mutations (matches the existing
 *                    Login.tsx pattern).
 *   Styling        → Tailwind + design tokens (`--d-*` cyan-forward). This
 *                    login is deliberately bespoke Sonalit gold branding
 *                    (#F0B429) and lives in one co-located login.css scoped
 *                    under `.sonalit-login-root` so nothing leaks. See
 *                    features/auth/login/README.md.
 *
 * NOTE: this file replaces src/pages/Login.tsx by re-export — see
 * src/pages/Login.tsx.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useAuthStore, getAccessToken } from '../../../stores/auth';

import './login.css';
import Theater from './Theater';
import CustodyChainLedger from './CustodyChainLedger';
import AuthConsole from './AuthConsole';
import ForgotPasswordModal from './ForgotPasswordModal';
import RequestAccessModal from './RequestAccessModal';
import Toast, { useLoginToast } from './Toast';

// Only follow ?redirect= if it's a same-origin path — refuse open-redirects.
function safeRedirectTarget(param: unknown): string | null {
  if (typeof param !== 'string' || !param) return null;
  try {
    const url = new URL(param, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    if (param.startsWith('/') && !param.startsWith('//')) return param;
    return null;
  }
}

export default function LoginPage(): React.ReactElement | null {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();

  // TanStack Router provides ?redirect= via useSearch — but the /login route
  // is defined without a validator, so we fall back to reading window.location.
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const redirectFromSearch = safeRedirectTarget(search?.['redirect']);
  const redirectTo: string =
    redirectFromSearch ??
    safeRedirectTarget(new URLSearchParams(window.location.search).get('redirect')) ??
    '/';

  const { toastProps, fire } = useLoginToast();
  const [forgotOpen, setForgotOpen] = useState<boolean>(false);
  const [requestOpen, setRequestOpen] = useState<boolean>(false);
  const [emailForReset, setEmailForReset] = useState<string>('');
  const currentEmailRef = useRef<string>('');

  // Body scroll-lock while login is mounted.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Already-authenticated guard: token in memory OR persisted user profile.
  useEffect(() => {
    if (getAccessToken() || user) {
      void navigate({ to: redirectTo });
    }
  }, [user, navigate, redirectTo]);

  if (getAccessToken() || user) return null;

  function onLoginSuccess(): void {
    void navigate({ to: redirectTo });
  }

  return (
    <div className="sonalit-login-root">
      <div className="wall-frame" aria-hidden="true">
        <span className="tick tl" />
        <span className="tick tr" />
        <span className="tick bl" />
        <span className="tick br" />
      </div>

      <div className="split">
        <Theater />
        <CustodyChainLedger />
        <AuthConsole
          toast={fire}
          onLoginSuccess={onLoginSuccess}
          onOpenForgot={() => {
            setEmailForReset(currentEmailRef.current);
            setForgotOpen(true);
          }}
          onOpenRequestAccess={() => setRequestOpen(true)}
          currentEmailRef={currentEmailRef}
        />
      </div>

      <ForgotPasswordModal
        open={forgotOpen}
        initialEmail={emailForReset}
        onClose={() => setForgotOpen(false)}
      />
      <RequestAccessModal
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
      />

      <Toast {...toastProps} />
    </div>
  );
}
