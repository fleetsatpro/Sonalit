import { useState, useEffect, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { Shield, Eye, EyeOff, ArrowRight, Loader2, Lock, AlertCircle } from 'lucide-react';
import { useAuthStore, getAccessToken } from '../stores/auth.js';
import { api } from '../lib/api.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface AuthResponse {
  token: string;
  user: { id: string; name: string; email: string; role: string; org_id: string };
}

export default function HandoverLogin() {
  const user = useAuthStore((s) => s.user);
  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [emailErr, setEmailErr] = useState(false);
  const [pwErr, setPwErr] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success'>('idle');
  const [time, setTime] = useState(() => fmtTime());

  const emailRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const iv = setInterval(() => setTime(fmtTime()), 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  useEffect(() => {
    if (getAccessToken() || user) {
      void navigate({ to: '/handover' });
    }
  }, [user, navigate]);

  if (getAccessToken() || user) return null;

  const loginMut = useMutation<AuthResponse, unknown, { email: string; password: string }>({
    mutationFn: async (v) => {
      const res = await api.post<AuthResponse>('/auth/login', v);
      return res.data;
    },
    onSuccess: (data) => {
      setAuth(data.token, data.user);
      setStatus('success');
      setTimeout(() => void navigate({ to: '/handover' }), 400);
    },
    onError: (err) => {
      setStatus('idle');
      const anyErr = err as { response?: { status?: number; data?: { error?: string; message?: string } } };
      setError(anyErr?.response?.data?.error ?? anyErr?.response?.data?.message ?? 'Incorrect email or password.');
      pwRef.current?.focus();
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setEmailErr(false);
    setPwErr(false);

    const emailVal = email.trim();
    let bad = false;
    if (!EMAIL_RE.test(emailVal)) { setEmailErr(true); bad = true; }
    if (password.length < 8) { setPwErr(true); bad = true; }
    if (bad) {
      (EMAIL_RE.test(emailVal) ? pwRef : emailRef).current?.focus();
      return;
    }

    setStatus('loading');
    loginMut.mutate({ email: emailVal, password });
  }

  return (
    <>
      <div className="ho-login-root">
        {/* Subtle ambient glow */}
        <div className="ho-login-glow" aria-hidden="true" />

        <div className="ho-login-card">
          {/* Header */}
          <div className="ho-login-header">
            <div className="ho-login-logo">
              <Shield size={20} strokeWidth={2} />
            </div>
            <div className="ho-login-brand">
              <span className="ho-login-brand-name">SONALIT</span>
              <span className="ho-login-brand-sep" />
              <span className="ho-login-brand-label">HANDOVER</span>
            </div>
          </div>

          {/* Title */}
          <div className="ho-login-title-block">
            <h1 className="ho-login-title">Sign in</h1>
            <p className="ho-login-sub">Enter your credentials to access the handover system.</p>
          </div>

          {/* Form */}
          <form onSubmit={onSubmit} noValidate className="ho-login-form">
            <div className="ho-login-field">
              <label htmlFor="ho-email" className="ho-login-label">Email</label>
              <input
                ref={emailRef}
                id="ho-email"
                type="email"
                autoComplete="username"
                placeholder="name@company.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setEmailErr(false); setError(null); }}
                className={`ho-login-input ${emailErr ? 'ho-login-input-err' : ''}`}
                aria-invalid={emailErr}
              />
              {emailErr && (
                <span className="ho-login-field-err">
                  <AlertCircle size={12} /> Enter a valid email address
                </span>
              )}
            </div>

            <div className="ho-login-field">
              <label htmlFor="ho-pw" className="ho-login-label">Password</label>
              <div className={`ho-login-pw-wrap ${pwErr ? 'ho-login-input-err' : ''}`}>
                <input
                  ref={pwRef}
                  id="ho-pw"
                  type={showPw ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setPwErr(false); setError(null); }}
                  onKeyDown={(e) => setCapsOn(e.getModifierState('CapsLock'))}
                  onKeyUp={(e) => setCapsOn(e.getModifierState('CapsLock'))}
                  onBlur={() => setCapsOn(false)}
                  className="ho-login-input ho-login-input-pw"
                  aria-invalid={pwErr}
                  minLength={8}
                />
                <button
                  type="button"
                  className="ho-login-pw-toggle"
                  onClick={() => setShowPw((s) => !s)}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {pwErr && (
                <span className="ho-login-field-err">
                  <AlertCircle size={12} /> Password must be at least 8 characters
                </span>
              )}
              {capsOn && (
                <span className="ho-login-field-warn">
                  <Lock size={11} /> Caps Lock is on
                </span>
              )}
            </div>

            {error && (
              <div className="ho-login-error">
                <AlertCircle size={14} /> {error}
              </div>
            )}

            <button
              type="submit"
              className={`ho-login-cta ${status === 'success' ? 'ho-login-cta-ok' : ''}`}
              disabled={status === 'loading'}
            >
              {status === 'loading' ? (
                <Loader2 size={18} className="ho-spin" />
              ) : status === 'success' ? (
                <span>Signed in</span>
              ) : (
                <>
                  <span>Sign in</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          {/* Footer */}
          <div className="ho-login-footer">
            <div className="ho-login-footer-line" />
            <div className="ho-login-footer-row">
              <span className="ho-login-footer-clock">{time}</span>
              <span className="ho-login-footer-sec">
                <Lock size={10} /> Encrypted
              </span>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .ho-login-root {
          position: fixed;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--d-void);
          color: var(--d-t1);
          font-family: var(--d-font);
          -webkit-font-smoothing: antialiased;
          overflow: hidden;
          z-index: 1;
        }

        .ho-login-glow {
          position: absolute;
          top: -30%;
          left: 50%;
          width: 600px;
          height: 600px;
          transform: translateX(-50%);
          background: radial-gradient(circle, rgba(34,232,255,.06) 0%, transparent 70%);
          pointer-events: none;
        }

        .ho-login-card {
          position: relative;
          width: 100%;
          max-width: 400px;
          padding: 40px 32px 32px;
          margin: 0 16px;
        }

        .ho-login-header {
          display: flex;
          align-items: center;
          gap: 14px;
          margin-bottom: 36px;
        }

        .ho-login-logo {
          width: 40px;
          height: 40px;
          border-radius: 10px;
          background: linear-gradient(135deg, rgba(34,232,255,.15), rgba(139,107,255,.15));
          border: 1px solid rgba(34,232,255,.2);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--d-sig);
        }

        .ho-login-brand {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .ho-login-brand-name {
          font-family: var(--d-font-display);
          font-size: 13px;
          font-weight: 600;
          letter-spacing: .2em;
          color: var(--d-t1);
        }

        .ho-login-brand-sep {
          width: 1px;
          height: 14px;
          background: var(--d-rim3);
        }

        .ho-login-brand-label {
          font-family: var(--d-font-mono);
          font-size: 10px;
          letter-spacing: .18em;
          color: var(--d-sig);
          font-weight: 600;
        }

        .ho-login-title-block {
          margin-bottom: 32px;
        }

        .ho-login-title {
          font-family: var(--d-font);
          font-size: 24px;
          font-weight: 700;
          color: var(--d-t1);
          margin: 0 0 8px;
          line-height: 1.2;
        }

        .ho-login-sub {
          font-size: 13px;
          color: var(--d-t2);
          line-height: 1.5;
          margin: 0;
        }

        .ho-login-form {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .ho-login-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .ho-login-label {
          font-family: var(--d-font-mono);
          font-size: 10px;
          font-weight: 600;
          letter-spacing: .12em;
          text-transform: uppercase;
          color: var(--d-t2);
        }

        .ho-login-input {
          width: 100%;
          padding: 12px 14px;
          background: var(--d-deep);
          border: 1px solid var(--d-rim2);
          border-radius: 8px;
          color: var(--d-t1);
          font-family: var(--d-font);
          font-size: 14px;
          outline: none;
          transition: border-color .15s, box-shadow .15s;
        }
        .ho-login-input::placeholder {
          color: var(--d-t3);
        }
        .ho-login-input:focus {
          border-color: var(--d-sig3);
          box-shadow: 0 0 0 3px rgba(34,232,255,.08);
        }
        .ho-login-input-err {
          border-color: var(--d-fire) !important;
        }
        .ho-login-input-err:focus {
          box-shadow: 0 0 0 3px rgba(255,59,92,.1) !important;
        }

        .ho-login-pw-wrap {
          display: flex;
          align-items: center;
          background: var(--d-deep);
          border: 1px solid var(--d-rim2);
          border-radius: 8px;
          transition: border-color .15s, box-shadow .15s;
        }
        .ho-login-pw-wrap:focus-within {
          border-color: var(--d-sig3);
          box-shadow: 0 0 0 3px rgba(34,232,255,.08);
        }
        .ho-login-pw-wrap .ho-login-input-pw {
          flex: 1;
          border: none;
          background: none;
          border-radius: 8px 0 0 8px;
        }
        .ho-login-pw-wrap .ho-login-input-pw:focus {
          box-shadow: none;
        }

        .ho-login-pw-toggle {
          flex-shrink: 0;
          width: 42px;
          height: 42px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: none;
          color: var(--d-t3);
          cursor: pointer;
          transition: color .15s;
        }
        .ho-login-pw-toggle:hover {
          color: var(--d-t2);
        }

        .ho-login-field-err {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          color: var(--d-fire);
        }

        .ho-login-field-warn {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          color: var(--d-warn);
        }

        .ho-login-error {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 10px 12px;
          background: rgba(255,59,92,.08);
          border: 1px solid rgba(255,59,92,.2);
          border-radius: 8px;
          font-size: 12px;
          color: #ff8a99;
        }

        .ho-login-cta {
          width: 100%;
          padding: 13px;
          border: none;
          border-radius: 8px;
          background: var(--d-sig);
          color: var(--d-void);
          font-family: var(--d-font);
          font-size: 14px;
          font-weight: 600;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          cursor: pointer;
          transition: filter .15s, transform .08s, background .2s;
          margin-top: 4px;
        }
        .ho-login-cta:hover:not(:disabled) {
          filter: brightness(1.1);
        }
        .ho-login-cta:active:not(:disabled) {
          transform: scale(.99);
        }
        .ho-login-cta:disabled {
          opacity: .7;
          cursor: default;
        }
        .ho-login-cta-ok {
          background: var(--d-ok);
        }

        .ho-login-footer {
          margin-top: 40px;
        }

        .ho-login-footer-line {
          height: 1px;
          background: var(--d-rim);
          margin-bottom: 16px;
        }

        .ho-login-footer-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .ho-login-footer-clock {
          font-family: var(--d-font-mono);
          font-size: 11px;
          color: var(--d-t3);
          font-variant-numeric: tabular-nums;
        }

        .ho-login-footer-sec {
          display: flex;
          align-items: center;
          gap: 4px;
          font-family: var(--d-font-mono);
          font-size: 10px;
          color: var(--d-t3);
        }

        .ho-spin {
          animation: ho-spin-anim .7s linear infinite;
        }
        @keyframes ho-spin-anim {
          to { transform: rotate(360deg); }
        }

        /* autofill */
        .ho-login-root input:-webkit-autofill,
        .ho-login-root input:-webkit-autofill:hover,
        .ho-login-root input:-webkit-autofill:focus {
          -webkit-text-fill-color: var(--d-t1);
          -webkit-box-shadow: 0 0 0 1000px var(--d-deep) inset;
          transition: background-color 9999s ease-in-out 0s;
          caret-color: var(--d-t1);
        }

        @media (prefers-reduced-motion: reduce) {
          .ho-spin { animation: none; }
        }
      `}</style>
    </>
  );
}

function fmtTime() {
  return new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
