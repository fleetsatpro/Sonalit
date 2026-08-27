import React, { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useAuthStore } from '../../../stores/auth';
import {
  passwordLogin, getPasskeyOptions, verifyPasskey,
  base64UrlToBuffer, bufferToBase64Url,
  SSO_URLS,
  type AuthResponse,
} from './authApi';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ATTEMPTS = 5;

// SSO (Google/Microsoft) and the self-serve forgot-password / request-access
// flows have no backend routes yet (see authApi.ts TODO markers), so clicking
// them 404s. Hide them by default and gate behind env flags so they can be
// switched back on the moment those backend routes ship — no code change needed.
const SSO_ENABLED = import.meta.env['VITE_AUTH_SSO_ENABLED'] === 'true';
const SELF_SERVE_ENABLED = import.meta.env['VITE_AUTH_SELF_SERVE_ENABLED'] === 'true';

function pad(n: number): string { return n.toString().padStart(2, '0'); }

type Props = {
  toast: (msg: string, isError?: boolean) => void;
  onLoginSuccess: () => void;
  onOpenForgot: () => void;
  onOpenRequestAccess: () => void;
  currentEmailRef: React.MutableRefObject<string>;
  handover?: boolean;
};

type AttemptsNote = { kind: 'warn' | 'locked' | null; text: string };

export default function AuthConsole({
  toast, onLoginSuccess, onOpenForgot, onOpenRequestAccess, currentEmailRef, handover,
}: Props): React.ReactElement {
  const setAuth = useAuthStore((s) => s.setAuth);

  const [tab, setTab] = useState<'password' | 'passkey'>('password');
  const tabPwRef = useRef<HTMLButtonElement | null>(null);
  const tabPkRef = useRef<HTMLButtonElement | null>(null);

  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [rememberMe, setRememberMe] = useState<boolean>(false);
  const [showPw, setShowPw] = useState<boolean>(false);
  const [emailErr, setEmailErr] = useState<boolean>(false);
  const [pwErr, setPwErr] = useState<boolean>(false);
  const [capsOn, setCapsOn] = useState<boolean>(false);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);

  const defaultCta = handover ? 'SIGN IN' : 'ACCESS DASHBOARD';
  const [ctaState, setCtaState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [ctaLabel, setCtaLabel] = useState<string>(defaultCta);
  const [failedAttempts, setFailedAttempts] = useState<number>(0);
  const [attemptsNote, setAttemptsNote] = useState<AttemptsNote>({ kind: null, text: '' });
  const [lockRemaining, setLockRemaining] = useState<number>(0);
  const lockTimerRef = useRef<number | undefined>(undefined);

  const [passkeyEmail, setPasskeyEmail] = useState<string>('');
  const [clock, setClock] = useState<string>('--:--:-- UTC');

  useEffect(() => {
    const tick = (): void => {
      const d = new Date();
      setClock(`${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`);
    };
    tick();
    const iv = window.setInterval(tick, 1000);
    return () => window.clearInterval(iv);
  }, []);

  useEffect(() => () => window.clearInterval(lockTimerRef.current), []);

  // Keep the LoginPage's ref updated so ForgotPasswordModal can prefill it.
  useEffect(() => { currentEmailRef.current = email; }, [email, currentEmailRef]);

  function startLockout(seconds: number): void {
    setLockRemaining(seconds);
    setAttemptsNote({ kind: 'locked', text: `Too many attempts. Try again in ${seconds}s.` });
    window.clearInterval(lockTimerRef.current);
    lockTimerRef.current = window.setInterval(() => {
      setLockRemaining((r) => {
        const next = r - 1;
        if (next <= 0) {
          window.clearInterval(lockTimerRef.current);
          setAttemptsNote({ kind: null, text: '' });
          setFailedAttempts(0);
          return 0;
        }
        setAttemptsNote({ kind: 'locked', text: `Too many attempts. Try again in ${next}s.` });
        return next;
      });
    }, 1000);
  }

  function handleFailedAttempt(message?: string): void {
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

  function resetCta(): void {
    setCtaState('idle');
    setCtaLabel(defaultCta);
  }

  const passwordMutation = useMutation<AuthResponse, unknown, { email: string; password: string }>({
    mutationFn: (v) => passwordLogin(v.email, v.password),
    onSuccess: (data) => {
      setAuth(data.token, data.user);
      setCtaState('success');
      setCtaLabel(handover ? 'SIGNED IN' : 'ACCESS GRANTED');
      onLoginSuccess();
    },
    onError: (err) => {
      const anyErr = err as { response?: { status?: number; headers?: Record<string, string>; data?: { error?: string; message?: string } } };
      const status = anyErr?.response?.status;
      if (status === 429) {
        const retry = parseInt(anyErr.response!.headers?.['retry-after'] ?? '30', 10);
        resetCta();
        startLockout(Number.isFinite(retry) ? retry : 30);
        return;
      }
      resetCta();
      const msg = anyErr?.response?.data?.error ?? anyErr?.response?.data?.message ?? 'Incorrect email or password.';
      handleFailedAttempt(msg);
      passwordRef.current?.focus();
    },
  });

  const passkeyMutation = useMutation<AuthResponse, unknown, string>({
    mutationFn: async (emailForPasskey) => {
      if (!window.PublicKeyCredential) throw new Error('Passkeys are not supported on this device or browser.');
      const options = await getPasskeyOptions(emailForPasskey);
      const publicKey: PublicKeyCredentialRequestOptions = {
        challenge: base64UrlToBuffer(options.challenge),
        timeout: options.timeout ?? 60000,
        userVerification: options.userVerification ?? 'preferred',
      };
      if (options.rpId) publicKey.rpId = options.rpId;
      if (options.allowCredentials) {
        publicKey.allowCredentials = options.allowCredentials.map((c) => {
          const desc: PublicKeyCredentialDescriptor = { id: base64UrlToBuffer(c.id), type: 'public-key' };
          if (c.transports) desc.transports = c.transports as AuthenticatorTransport[];
          return desc;
        });
      }
      const credential = await navigator.credentials.get({ publicKey });
      if (!credential || credential.type !== 'public-key') throw new Error('No passkey selected');
      const pkc = credential as PublicKeyCredential;
      const resp = pkc.response as AuthenticatorAssertionResponse;
      return verifyPasskey({
        id: pkc.id,
        rawId: bufferToBase64Url(pkc.rawId),
        type: pkc.type,
        response: {
          authenticatorData: bufferToBase64Url(resp.authenticatorData),
          clientDataJSON:    bufferToBase64Url(resp.clientDataJSON),
          signature:         bufferToBase64Url(resp.signature),
          userHandle:        resp.userHandle ? bufferToBase64Url(resp.userHandle) : null,
        },
      });
    },
    onSuccess: (data) => {
      setAuth(data.token, data.user);
      onLoginSuccess();
    },
    onError: (err) => {
      const name = (err as { name?: string })?.name;
      const message = (err as { message?: string })?.message;
      if (name === 'NotAllowedError') toast('Passkey sign-in was cancelled.', true);
      else if (message?.startsWith('Passkeys are not supported')) toast(message, true);
      else toast('Passkey sign-in failed. Try your password instead.', true);
    },
  });

  function activateTab(which: 'password' | 'passkey'): void {
    setTab(which);
    (which === 'password' ? tabPwRef : tabPkRef).current?.focus();
  }

  function onTabKey(e: React.KeyboardEvent<HTMLButtonElement>): void {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    activateTab(tab === 'password' ? 'passkey' : 'password');
  }

  function checkCaps(e: React.KeyboardEvent<HTMLInputElement>): void {
    const on = e.getModifierState && e.getModifierState('CapsLock');
    setCapsOn(!!on);
  }

  function clearFieldErrors(): void {
    if (emailErr) setEmailErr(false);
    if (pwErr) setPwErr(false);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>): void {
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
    passwordMutation.mutate({ email: emailVal, password });
    // TODO(griff): rememberMe is captured but /auth/login doesn't accept it
    // yet — plumb through when we honour session-lifetime preference.
    void rememberMe;
  }

  async function onPasskey(): Promise<void> {
    const targetEmail = passkeyEmail.trim() || email.trim();
    if (!targetEmail) {
      toast('Enter your email first, then continue with passkey.', true);
      return;
    }
    passkeyMutation.mutate(targetEmail);
  }

  function onSsoGoogle(): void    { window.location.href = SSO_URLS.google; }
  function onSsoMicrosoft(): void { window.location.href = SSO_URLS.microsoft; }

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
          {handover ? 'HANDOVER OFFICER' : 'OPERATOR ACCESS'}
          <span className="oc-clock">{clock}</span>
        </div>
        <h1 className="console-title">{handover ? 'Handover Sign-in' : 'Welcome back'}</h1>
        <p className="console-sub">{handover ? 'Sign in to submit handover forms.' : 'Sign in to your operations dashboard.'}</p>
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
            {SELF_SERVE_ENABLED && (
              <button type="button" className="forgot-link" onClick={onOpenForgot}>Forgot password?</button>
            )}
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
          <div className="field" style={{ marginTop: -6 }}>
            <label className="field-label" htmlFor="passkeyEmailInput">EMAIL ADDRESS</label>
            <div className="field-input-row">
              <input
                type="email" id="passkeyEmailInput"
                placeholder="you@company.com" autoComplete="username"
                value={passkeyEmail} onChange={(e) => setPasskeyEmail(e.target.value)}
              />
            </div>
          </div>
          <button
            type="button"
            className={'cta' + (passkeyMutation.isPending ? ' loading' : '')}
            disabled={passkeyMutation.isPending}
            onClick={() => void onPasskey()}
          >
            <span className="cta-label">CONTINUE WITH PASSKEY</span>
            <svg className="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="spinner" aria-hidden="true" />
          </button>
        </div>
      )}

      {SSO_ENABLED && (
        <>
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
        </>
      )}

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
        {SELF_SERVE_ENABLED && (
          <div className="footer-link">
            Don&apos;t have an account?{' '}
            <button type="button" onClick={onOpenRequestAccess}>Request access</button>
          </div>
        )}
      </div>
    </section>
  );
}
