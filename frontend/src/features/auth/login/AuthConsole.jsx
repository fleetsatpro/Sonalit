import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../../../store';
import {
  ENDPOINTS,
  getPasskeyOptions,
  verifyPasskey,
} from './authApi';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ATTEMPTS = 5;

function pad(n) { return n.toString().padStart(2, '0'); }

// Base64 ⇄ Uint8Array — hand-rolled per the reference; matches the byte layout
// @simplewebauthn expects for authenticationResponse if we ever swap this out.
function b64ToBytes(str) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}
function bytesToB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

export default function AuthConsole({
  toast,
  onLoginSuccess,
  onOpenForgot,
  onOpenRequestAccess,
}) {
  const login = useAuthStore((s) => s.login);

  // Tabs
  const [tab, setTab] = useState('password');
  const tabPwRef = useRef(null);
  const tabPkRef = useRef(null);

  // Password form
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [emailErr, setEmailErr] = useState(false);
  const [pwErr, setPwErr] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const emailRef = useRef(null);
  const passwordRef = useRef(null);

  // CTA state
  const [ctaState, setCtaState] = useState('idle'); // idle|loading|success|error
  const [ctaLabel, setCtaLabel] = useState('ACCESS DASHBOARD');
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [attemptsNote, setAttemptsNote] = useState({ kind: null, text: '' });
  const [lockRemaining, setLockRemaining] = useState(0);
  const lockTimerRef = useRef(null);

  // Passkey state
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  // Live clock
  const [clock, setClock] = useState('--:--:-- UTC');

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setClock(`${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`);
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => () => clearInterval(lockTimerRef.current), []);

  // Lockout countdown ticker.
  function startLockout(seconds) {
    setLockRemaining(seconds);
    setAttemptsNote({ kind: 'locked', text: `Too many attempts. Try again in ${seconds}s.` });
    clearInterval(lockTimerRef.current);
    lockTimerRef.current = setInterval(() => {
      setLockRemaining((r) => {
        const next = r - 1;
        if (next <= 0) {
          clearInterval(lockTimerRef.current);
          setAttemptsNote({ kind: null, text: '' });
          setFailedAttempts(0);
          return 0;
        }
        setAttemptsNote({ kind: 'locked', text: `Too many attempts. Try again in ${next}s.` });
        return next;
      });
    }, 1000);
  }

  function handleFailedAttempt(message) {
    const remaining = MAX_ATTEMPTS - (failedAttempts + 1);
    setFailedAttempts((n) => n + 1);
    if (remaining <= 0) { startLockout(30); return; }
    const s = remaining === 1 ? '' : 's';
    setAttemptsNote({
      kind: 'warn',
      text: message
        ? `${message} — ${remaining} attempt${s} remaining.`
        : `${remaining} attempt${s} remaining before temporary lockout.`,
    });
  }

  function resetCta() {
    setCtaState('idle');
    setCtaLabel('ACCESS DASHBOARD');
  }

  function activateTab(which) {
    setTab(which);
    // Move focus to the newly-active tab so keyboard users end up in the right pane.
    (which === 'password' ? tabPwRef : tabPkRef).current?.focus();
  }

  function onTabKey(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    activateTab(tab === 'password' ? 'passkey' : 'password');
  }

  function checkCaps(e) {
    const on = e.getModifierState && e.getModifierState('CapsLock');
    setCapsOn(!!on);
  }

  function clearFieldErrors() {
    if (emailErr) setEmailErr(false);
    if (pwErr) setPwErr(false);
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (lockRemaining > 0) return;
    setAttemptsNote({ kind: null, text: '' });
    setEmailErr(false); setPwErr(false);

    const emailVal = email.trim();
    let bad = false;
    if (!EMAIL_RE.test(emailVal)) { setEmailErr(true); bad = true; }
    if (password.length < 8) { setPwErr(true); bad = true; }
    if (bad) {
      (EMAIL_RE.test(emailVal) ? passwordRef : emailRef).current?.focus();
      return;
    }

    setCtaState('loading');
    setCtaLabel('AUTHENTICATING…');
    try {
      // Password login goes through the app's existing Zustand store so the
      // session hydrates the same as every other entry point (token in
      // localStorage, /me fetched by App.jsx effect, socket connect etc.).
      // rememberMe is currently captured but not sent — backend /auth/login
      // doesn't accept it today; TODO(griff): plumb through if we start
      // honouring session-lifetime preference.
      const result = await login(emailVal, password);
      if (result?.ok) {
        setCtaState('success');
        setCtaLabel('ACCESS GRANTED');
        onLoginSuccess();
        return;
      }
      // 429 handling — the app's axios interceptor doesn't surface headers, so
      // we defer to whatever server-side rate-limit message came back. If we
      // ever expose Retry-After from the response, wire it here via
      // result.retryAfter to call startLockout(retryAfter).
      resetCta();
      handleFailedAttempt(result?.error || 'Incorrect email or password.');
      passwordRef.current?.focus();
    } catch (err) {
      if (err?.response?.status === 429) {
        const retry = parseInt(err.response.headers?.['retry-after'] || '30', 10);
        resetCta();
        startLockout(Number.isFinite(retry) ? retry : 30);
        return;
      }
      setCtaState('error');
      setCtaLabel('CONNECTION ERROR');
      toast('Could not reach the sign-in service. Check your connection and try again.', true);
      setTimeout(resetCta, 2200);
    }
  }

  async function onPasskey() {
    if (!window.PublicKeyCredential) {
      toast('Passkeys are not supported on this device or browser.', true);
      return;
    }
    setPasskeyLoading(true);
    try {
      const options = await getPasskeyOptions();
      options.challenge = b64ToBytes(options.challenge);
      if (options.allowCredentials) {
        options.allowCredentials = options.allowCredentials.map((cred) => ({
          ...cred,
          id: b64ToBytes(cred.id),
        }));
      }
      const credential = await navigator.credentials.get({ publicKey: options });
      await verifyPasskey({
        id: credential.id,
        rawId: bytesToB64(credential.rawId),
        type: credential.type,
        response: {
          authenticatorData: bytesToB64(credential.response.authenticatorData),
          clientDataJSON:    bytesToB64(credential.response.clientDataJSON),
          signature:         bytesToB64(credential.response.signature),
        },
      });
      // TODO(griff): once /auth/passkey/verify returns { token, user }, hydrate
      // the store the same way password login does. For now we optimistically
      // trigger the same success flow — the parent's redirect will fail-safe
      // to /login if the store has no token.
      onLoginSuccess();
    } catch (err) {
      if (err && err.name === 'NotAllowedError') toast('Passkey sign-in was cancelled.', true);
      else toast('Passkey sign-in failed. Try your password instead.', true);
    } finally {
      setPasskeyLoading(false);
    }
  }

  // SSO — full-page redirect (backend handles the OAuth start URL).
  function onSsoGoogle()    { window.location.href = ENDPOINTS.ssoGoogle; }
  function onSsoMicrosoft() { window.location.href = ENDPOINTS.ssoMicrosoft; }

  const ctaClassName =
    'cta' +
    (ctaState === 'loading' ? ' loading' : '') +
    (ctaState === 'success' ? ' success' : '') +
    (ctaState === 'error'   ? ' error'   : '');

  return (
    <section className="console" aria-label="Sign in">
      <div className="console-head">
        <div className="console-eyebrow">
          <span className="box" />
          OPERATOR ACCESS
          <span className="oc-clock">{clock}</span>
        </div>
        <h1 className="console-title">Welcome back</h1>
        <p className="console-sub">Sign in to your operations dashboard.</p>
      </div>

      <div className="tabs" role="tablist" aria-label="Sign-in method">
        <button
          type="button" ref={tabPwRef}
          className={'tab' + (tab === 'password' ? ' active' : '')}
          role="tab" aria-selected={tab === 'password'} aria-controls="passwordPane"
          tabIndex={tab === 'password' ? 0 : -1}
          onClick={() => activateTab('password')} onKeyDown={onTabKey}
        >PASSWORD</button>
        <button
          type="button" ref={tabPkRef}
          className={'tab' + (tab === 'passkey' ? ' active' : '')}
          role="tab" aria-selected={tab === 'passkey'} aria-controls="passkeyPane"
          tabIndex={tab === 'passkey' ? 0 : -1}
          onClick={() => activateTab('passkey')} onKeyDown={onTabKey}
        >PASSKEY</button>
      </div>

      {tab === 'password' && (
        <form id="passwordPane" role="tabpanel" aria-labelledby="tabPassword" noValidate onSubmit={onSubmit}>
          <div className="field">
            <label className="field-label" htmlFor="emailInput">EMAIL ADDRESS</label>
            <div className={'field-input-row' + (emailErr ? ' error' : '')}>
              <input
                type="email" id="emailInput" name="email"
                placeholder="you@company.com" autoComplete="username"
                aria-describedby="emailError" aria-invalid={emailErr} required
                ref={emailRef}
                value={email}
                onChange={(e) => { setEmail(e.target.value); clearFieldErrors(); }}
              />
              <svg className="field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="M3 7l9 6 9-6" />
              </svg>
            </div>
            <div className={'field-msg err' + (emailErr ? ' show' : '')} id="emailError" role="alert">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v5M12 16v.01" strokeLinecap="round" />
              </svg>
              <span>Enter a valid email address</span>
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="passwordInput">PASSWORD</label>
            <div className={'field-input-row' + (pwErr ? ' error' : '')}>
              <input
                type={showPw ? 'text' : 'password'} id="passwordInput" name="password"
                placeholder="Enter your password" autoComplete="current-password"
                aria-describedby="passwordError capsWarning" aria-invalid={pwErr} minLength={8} required
                ref={passwordRef}
                value={password}
                onChange={(e) => { setPassword(e.target.value); clearFieldErrors(); }}
                onKeyDown={checkCaps} onKeyUp={checkCaps} onBlur={() => setCapsOn(false)}
              />
              <button
                type="button" className="field-icon-btn"
                aria-label={showPw ? 'Hide password' : 'Show password'}
                aria-pressed={showPw}
                onClick={() => setShowPw((s) => !s)}
              >
                {showPw ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.7 17.7 0 0 1-3.2 4.1M6.5 6.6C4 8.2 2 12 2 12s3.5 7 10 7c1.3 0 2.5-.2 3.6-.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
            <div className={'field-msg err' + (pwErr ? ' show' : '')} id="passwordError" role="alert">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v5M12 16v.01" strokeLinecap="round" />
              </svg>
              <span>Password must be at least 8 characters</span>
            </div>
            <div className={'field-msg warn' + (capsOn ? ' show' : '')} id="capsWarning">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M12 3l8 8h-5v7H9v-7H4l8-8Z" strokeLinejoin="round" />
              </svg>
              <span>Caps Lock is on</span>
            </div>
          </div>

          <div className="field-row">
            <label className="remember">
              <input
                type="checkbox" id="rememberMe" name="rememberMe"
                checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)}
              />
              <span>Remember me</span>
            </label>
            <button type="button" className="forgot-link" onClick={onOpenForgot}>Forgot password?</button>
          </div>

          <button
            type="submit" className={ctaClassName}
            disabled={ctaState === 'loading' || lockRemaining > 0}
          >
            <span className="cta-label">{ctaLabel}</span>
            <svg className="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="spinner" aria-hidden="true" />
          </button>

          <div
            className={
              'attempts-note ' +
              (attemptsNote.kind === 'warn'   ? 'warn '   : '') +
              (attemptsNote.kind === 'locked' ? 'locked ' : '') +
              (attemptsNote.text ? 'show' : '')
            }
            role="status" aria-live="polite"
          >
            {attemptsNote.text}
          </div>
        </form>
      )}

      {tab === 'passkey' && (
        <div id="passkeyPane" role="tabpanel" aria-labelledby="tabPasskey">
          <div className="passkey-body">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <rect x="4" y="10" width="16" height="10" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              <circle cx="12" cy="15" r="1.6" />
            </svg>
            <p>Use your device passkey — fingerprint, face, or hardware key — to sign in without a password.</p>
          </div>
          <button
            type="button"
            className={'cta' + (passkeyLoading ? ' loading' : '')}
            disabled={passkeyLoading}
            onClick={onPasskey}
          >
            <span className="cta-label">CONTINUE WITH PASSKEY</span>
            <svg className="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="spinner" aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="divider">OR CONTINUE WITH</div>
      <div className="sso-row">
        <button type="button" className="sso-btn" onClick={onSsoGoogle}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.85A11 11 0 0 0 12 23Z" />
            <path fill="#FBBC05" d="M5.84 14.09A6.6 6.6 0 0 1 5.5 12c0-.73.12-1.43.34-2.09V7.06H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.94l3.66-2.85Z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1a11 11 0 0 0-9.82 6.06l3.66 2.85C6.71 7.31 9.14 5.38 12 5.38Z" />
          </svg>
          <span>Google</span>
        </button>
        <button type="button" className="sso-btn" onClick={onSsoMicrosoft}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="2" y="2" width="9" height="9" fill="#F25022" />
            <rect x="13" y="2" width="9" height="9" fill="#7FBA00" />
            <rect x="2" y="13" width="9" height="9" fill="#00A4EF" />
            <rect x="13" y="13" width="9" height="9" fill="#FFB900" />
          </svg>
          <span>Microsoft</span>
        </button>
      </div>

      <div className="console-foot">
        <div className="trust-row">
          <div className="trust-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 3l8 3v6c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V6l8-3Z" strokeLinejoin="round" />
            </svg>
            <span>SOC 2</span>
          </div>
          <div className="trust-sep" />
          <div className="trust-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="5" y="10" width="14" height="10" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
            <span>AES-256</span>
          </div>
          <div className="trust-sep" />
          <div className="trust-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M3 12h4l2-7 4 14 2-7h6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>99.99% UPTIME</span>
          </div>
        </div>
        <div className="footer-link">
          Don&apos;t have an account?{' '}
          <button type="button" onClick={onOpenRequestAccess}>Request access</button>
        </div>
      </div>
    </section>
  );
}
