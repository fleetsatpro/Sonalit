import React, { useState, useEffect, useRef } from 'react';
import { reportApi } from '../api/reportApi';

const T = {
  void: '#060a08', deep: '#0c1410', surface: '#111d16',
  card: '#162019', raised: '#1d2c21',
  rim: 'rgba(255,255,255,0.07)', rim2: 'rgba(255,255,255,0.12)',
  lime: '#a8e63d', limeBg: 'rgba(168,230,61,0.10)', limeRim: 'rgba(168,230,61,0.25)',
  green: '#22c55e', greenBg: 'rgba(34,197,94,0.10)',
  orange: '#f97316', orangeBg: 'rgba(249,115,22,0.10)',
  red: '#ef4444', redBg: 'rgba(239,68,68,0.10)',
  text: '#d4e8d6', body: '#8aaa8e', sub: '#5a7a5e', muted: '#3d5442', white: '#f0f8f2',
  cond: "'Barlow Condensed', sans-serif",
  mono: "'Share Tech Mono', monospace",
  sans: "'Barlow', sans-serif",
};

interface LoginScreenProps {
  navigate: (screen: string) => void;
  onLogin?: (auth: any) => void;
}

const pulseKF = `
@keyframes guardianPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(168,230,61,0.45), 0 0 24px rgba(168,230,61,0.18); }
  50%        { box-shadow: 0 0 0 8px rgba(168,230,61,0), 0 0 32px rgba(168,230,61,0.28); }
}
@keyframes scanline {
  0%   { top: -2px; opacity: 0; }
  5%   { opacity: 0.55; }
  95%  { opacity: 0.55; }
  100% { top: 100%; opacity: 0; }
}
`;

export function LoginScreen({ navigate, onLogin }: LoginScreenProps) {
  const [cfoId, setCfoId]       = useState('');
  const [pin, setPin]           = useState('');
  const [convoyId, setConvoyId] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [focusField, setFocusField] = useState<string | null>(null);

  const submitRef = useRef(false);

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = pulseKF;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitRef.current) return;
    if (!cfoId.trim() || !pin.trim() || !convoyId.trim()) {
      setError('All fields are required.');
      return;
    }
    submitRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const data = await reportApi.login(cfoId.trim(), pin.trim(), convoyId.trim());
      onLogin?.(data);
      navigate('home');
    } catch {
      setError('Authentication failed. Please verify your credentials.');
    } finally {
      setLoading(false);
      submitRef.current = false;
    }
  }

  const fieldStyle = (name: string): React.CSSProperties => ({
    width: '100%',
    boxSizing: 'border-box',
    background: T.card,
    border: `1px solid ${focusField === name ? T.limeRim : T.rim}`,
    borderRadius: 10,
    padding: '13px 16px',
    color: T.text,
    fontFamily: T.mono,
    fontSize: 14,
    outline: 'none',
    transition: 'border-color 0.2s',
    letterSpacing: name === 'pin' ? 6 : 0,
  });

  return (
    <div style={{
      minHeight: '100dvh',
      background: `radial-gradient(ellipse at 50% 30%, rgba(168,230,61,0.04) 0%, transparent 70%), ${T.void}`,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 20px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Ghost watermark */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        fontFamily: T.cond, fontSize: 'clamp(80px, 22vw, 160px)',
        fontWeight: 900, color: T.white, opacity: 0.025,
        letterSpacing: 8, userSelect: 'none', pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}>GUARDIAN</div>

      {/* Scanline */}
      <div style={{
        position: 'absolute', left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, transparent, ${T.lime}, transparent)`,
        animation: 'scanline 5s linear infinite',
        pointerEvents: 'none',
      }} />

      {/* Brand block */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginBottom: 36 }}>
        <div style={{
          width: 76, height: 76, borderRadius: 22,
          background: T.limeBg,
          border: `1.5px solid ${T.limeRim}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'guardianPulse 2.4s ease-in-out infinite',
        }}>
          <span style={{ fontFamily: T.cond, fontSize: 30, fontWeight: 900, color: T.void, lineHeight: 1 }}>G</span>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: T.cond, fontSize: 40, fontWeight: 900, color: T.white, letterSpacing: 4, lineHeight: 1 }}>
            GUARDIAN
          </div>
          <div style={{ fontFamily: T.mono, fontSize: 9, color: T.sub, letterSpacing: 3, marginTop: 4 }}>
            FIELD OPERATIONS INTELLIGENCE
          </div>
          <div style={{
            display: 'inline-block', marginTop: 8,
            background: T.limeBg, border: `1px solid ${T.limeRim}`,
            borderRadius: 4, padding: '3px 10px',
            fontFamily: T.cond, fontSize: 11, fontWeight: 700,
            color: T.lime, letterSpacing: 2,
          }}>CFO FIELD REPORTING APP</div>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} style={{ width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={{ fontFamily: T.cond, fontSize: 11, fontWeight: 700, color: T.sub, letterSpacing: 2, display: 'block', marginBottom: 6 }}>
            CFO ID
          </label>
          <input
            value={cfoId}
            onChange={e => setCfoId(e.target.value)}
            onFocus={() => setFocusField('cfoId')}
            onBlur={() => setFocusField(null)}
            placeholder="e.g. CFO-00124"
            autoCapitalize="characters"
            style={fieldStyle('cfoId')}
          />
        </div>

        <div>
          <label style={{ fontFamily: T.cond, fontSize: 11, fontWeight: 700, color: T.sub, letterSpacing: 2, display: 'block', marginBottom: 6 }}>
            PIN
          </label>
          <input
            type="password"
            value={pin}
            onChange={e => setPin(e.target.value)}
            onFocus={() => setFocusField('pin')}
            onBlur={() => setFocusField(null)}
            placeholder="••••••"
            style={fieldStyle('pin')}
          />
        </div>

        <div>
          <label style={{ fontFamily: T.cond, fontSize: 11, fontWeight: 700, color: T.sub, letterSpacing: 2, display: 'block', marginBottom: 6 }}>
            CONVOY ASSIGNMENT ID
          </label>
          <input
            value={convoyId}
            onChange={e => setConvoyId(e.target.value)}
            onFocus={() => setFocusField('convoyId')}
            onBlur={() => setFocusField(null)}
            placeholder="e.g. CNV-2026-0041"
            autoCapitalize="characters"
            style={fieldStyle('convoyId')}
          />
        </div>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0' }}>
          <div style={{ flex: 1, height: 1, background: T.rim }} />
          <span style={{ fontFamily: T.mono, fontSize: 9, color: T.muted, letterSpacing: 2, whiteSpace: 'nowrap' }}>
            LINKED TO GUARDIAN AGENT
          </span>
          <div style={{ flex: 1, height: 1, background: T.rim }} />
        </div>

        {error && (
          <div style={{
            background: T.redBg, border: `1px solid ${T.red}`,
            borderRadius: 8, padding: '10px 14px',
            fontFamily: T.mono, fontSize: 12, color: T.red,
          }}>{error}</div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            background: loading ? T.muted : T.lime,
            color: T.void, border: 'none', borderRadius: 10,
            padding: '15px 0', width: '100%', cursor: loading ? 'not-allowed' : 'pointer',
            fontFamily: T.cond, fontSize: 17, fontWeight: 900, letterSpacing: 3,
            transition: 'background 0.2s, transform 0.1s',
          }}
        >
          {loading ? 'AUTHENTICATING…' : 'AUTHENTICATE & DEPLOY'}
        </button>
      </form>

      {/* Footer */}
      <div style={{ marginTop: 36, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontFamily: T.mono, fontSize: 10, color: T.muted, letterSpacing: 1 }}>
          v2.6.0 · {navigator.platform || 'Mobile'} · {window.innerWidth}×{window.innerHeight}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: T.green }} />
          <span style={{ fontFamily: T.mono, fontSize: 10, color: T.sub, letterSpacing: 1 }}>GPS AVAILABLE</span>
        </div>
      </div>
    </div>
  );
}
