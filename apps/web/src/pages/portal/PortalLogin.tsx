import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { AlertTriangle, Loader2, Package } from 'lucide-react';

const API_BASE = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '/api/v1';

type PageState = 'email' | 'sent' | 'verifying' | 'error';

const CARD_STYLE: React.CSSProperties = {
  background: 'rgba(13,20,38,0.7)',
};

export default function PortalLogin(): React.ReactElement {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { token?: string };
  const token = typeof search.token === 'string' ? search.token : null;

  const [pageState, setPageState] = useState<PageState>(token ? 'verifying' : 'email');
  const [email, setEmail] = useState('');
  const [submittedEmail, setSubmittedEmail] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [sending, setSending] = useState(false);
  const verifyCalledRef = useRef(false);

  // Auto-verify when token is present in URL
  useEffect(() => {
    if (!token || verifyCalledRef.current) return;
    verifyCalledRef.current = true;

    setPageState('verifying');

    fetch(`${API_BASE}/portal/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? `Verification failed (${res.status})`);
        }
        return res.json();
      })
      .then(() => {
        void navigate({ to: '/portal/dashboard' });
      })
      .catch((err: Error) => {
        setErrorMsg(err.message);
        setPageState('error');
      });
  }, [token, navigate]);

  const handleSendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setSending(true);
    setErrorMsg('');

    try {
      const res = await fetch(`${API_BASE}/portal/auth/request-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: email.trim() }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }

      setSubmittedEmail(email.trim());
      setPageState('sent');
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: '#050813' }}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-white/[0.07] p-8"
        style={CARD_STYLE}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 mb-8 justify-center">
          <Package size={20} className="text-orange-400 shrink-0" />
          <span
            className="font-black text-lg tracking-wider uppercase"
            style={{
              fontFamily: "'Barlow Condensed','Arial Narrow',sans-serif",
              background: 'linear-gradient(90deg,#ff9040,#f07020)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            SONALIT
          </span>
        </div>

        {/* Email entry state */}
        {pageState === 'email' && (
          <form onSubmit={(e) => void handleSendLink(e)}>
            <h1 className="text-white text-xl font-bold text-center mb-6">
              Cargo Portal Login
            </h1>

            <div className="mb-4">
              <label
                htmlFor="portal-email"
                className="block text-xs font-medium text-white/60 mb-1.5"
              >
                Email address
              </label>
              <input
                id="portal-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full rounded-lg border border-white/[0.10] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder-gray-600 outline-none focus:border-orange-500/60 focus:ring-1 focus:ring-orange-500/30 transition-colors"
              />
            </div>

            {errorMsg && (
              <div className="flex items-start gap-2 rounded-lg border border-red-700/50 bg-red-900/20 px-3 py-2.5 mb-4">
                <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
                <p className="text-red-400 text-xs">{errorMsg}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={sending || !email.trim()}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-white transition-colors"
            >
              {sending ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Sending…
                </>
              ) : (
                'Send login link'
              )}
            </button>
          </form>
        )}

        {/* Sent / check inbox state */}
        {pageState === 'sent' && (
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-green-900/40 border border-green-700 flex items-center justify-center mx-auto mb-4">
              <span className="text-green-400 text-xl">✓</span>
            </div>
            <h2 className="text-white text-lg font-bold mb-2">Check your inbox</h2>
            <p className="text-green-400 text-sm font-medium mb-1">{submittedEmail}</p>
            <p className="text-white/40 text-xs">The link expires in 15 minutes.</p>
            <button
              onClick={() => { setPageState('email'); setEmail(''); }}
              className="mt-6 text-xs text-gray-500 hover:text-gray-400 transition-colors underline underline-offset-2"
            >
              Use a different email
            </button>
          </div>
        )}

        {/* Verifying state */}
        {pageState === 'verifying' && (
          <div className="flex flex-col items-center justify-center py-4 gap-3">
            <Loader2 size={24} className="animate-spin text-orange-400" />
            <p className="text-white/60 text-sm">Signing you in…</p>
          </div>
        )}

        {/* Error state */}
        {pageState === 'error' && (
          <div>
            <div className="flex items-start gap-3 rounded-lg border border-red-700/50 bg-red-900/20 px-4 py-3 mb-6">
              <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-red-300 text-sm font-semibold">Sign-in failed</p>
                <p className="text-red-400/80 text-xs mt-1">{errorMsg}</p>
              </div>
            </div>
            <button
              onClick={() => { setPageState('email'); setErrorMsg(''); }}
              className="w-full flex items-center justify-center rounded-lg border border-white/[0.10] bg-white/[0.04] hover:bg-white/[0.07] px-4 py-2.5 text-sm font-medium text-white/80 transition-colors"
            >
              Back to login
            </button>
          </div>
        )}
      </div>

      <p className="mt-6 text-xs text-gray-600 text-center">
        This portal is provided by SONALIT Fleet Operations.
      </p>
    </div>
  );
}
