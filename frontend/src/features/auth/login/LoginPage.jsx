/*
 * Sonalit LoginPage
 * ─────────────────
 * Repo conventions detected (see README.md):
 *   Language       → JavaScript (.jsx). No TS in frontend/src.
 *   Router         → react-router-dom v6, routes in src/App.jsx.
 *   Auth client    → axios instance in src/services/api.js (+ Zustand store
 *                    in src/store/index.js). Login goes through the store's
 *                    existing login() so session hydration is identical to
 *                    every other entry point.
 *   Styling        → Tailwind app-wide, but the app's tailwind palette
 *                    redefines `gold` as cyan #00d4ff. This login is
 *                    bespoke Sonalit branding (real gold #F0B429), so the
 *                    login is kept in one co-located login.css scoped under
 *                    `.sonalit-login-root`. No tokens are duplicated inside
 *                    Tailwind; login's tokens are login-local by design.
 *   Session store  → useAuthStore in src/store/index.js.
 */

import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../../store';

import './login.css';
import Theater from './Theater';
import CustodyChainLedger from './CustodyChainLedger';
import AuthConsole from './AuthConsole';
import ForgotPasswordModal from './ForgotPasswordModal';
import RequestAccessModal from './RequestAccessModal';
import Toast, { useLoginToast } from './Toast';

// Only follow ?redirect= if it's a same-origin path — refuse open-redirects.
function safeRedirectTarget(param) {
  if (!param) return null;
  try {
    const url = new URL(param, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return url.pathname + url.search + url.hash;
  } catch (_e) {
    // Bare path is fine as long as it starts with a single "/".
    if (typeof param === 'string' && param.startsWith('/') && !param.startsWith('//')) return param;
    return null;
  }
}

export default function LoginPage() {
  const { token } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();

  // Redirect target: ?redirect=/foo takes precedence over the ProtectedRoute
  // location.state.from that RequireAuth might have passed in.
  const params = new URLSearchParams(location.search);
  const redirectParam = safeRedirectTarget(params.get('redirect'));
  const from = location.state?.from?.pathname || '/';
  const redirectTo = redirectParam || from || '/';

  const { toastProps, fire } = useLoginToast();
  const [forgotOpen, setForgotOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [emailForReset, setEmailForReset] = useState('');

  // Already-authenticated guard: React Router hook redirect (Navigate below).
  // We render nothing else in that case so no rAF loop starts.
  useEffect(() => {
    // Body scroll-lock while login is mounted — the CSS uses position:fixed
    // on `.sonalit-login-root` so this is largely defensive, but if the app's
    // Layout ever adds body-level scroll we don't want the ops-wall shifting.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  if (token) return <Navigate to={redirectTo} replace />;

  function onLoginSuccess() {
    // Router navigate — not window.location — so SPA state survives.
    navigate(redirectTo, { replace: true });
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
            // Prefill with whatever's typed in the email box, via a global
            // state hop — the AuthConsole owns the email input, but the
            // simpler path is to read the input's current value.
            const el = document.getElementById('emailInput');
            setEmailForReset(el ? el.value : '');
            setForgotOpen(true);
          }}
          onOpenRequestAccess={() => setRequestOpen(true)}
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
