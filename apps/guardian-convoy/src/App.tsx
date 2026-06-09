import React, { useState, CSSProperties } from 'react';
import type { AuthState } from './features/guardian-convoy/types/ConvoyReport';

// ----------- Screen types -----------

export type ScreenName = 'login' | 'home' | 'sod' | 'eod' | 'seals' | 'sos' | 'history';

export interface ScreenProps {
  navigate: (screen: ScreenName) => void;
  auth: AuthState | null;
  setAuth: (auth: AuthState | null) => void;
}

// ----------- Placeholder screens -----------

function LoginScreen({ navigate, setAuth }: ScreenProps) {
  const [cfoId, setCfoId] = useState('');
  const [pin, setPin] = useState('');
  const [convoyId, setConvoyId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cfoId.trim() || !pin.trim() || !convoyId.trim()) {
      setError('All fields are required');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { reportApi } = await import('./features/guardian-convoy/api/reportApi');
      const data = await reportApi.login(cfoId.trim(), pin.trim(), convoyId.trim());
      setAuth(data);
      navigate('home');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setError(err?.response?.data?.error ?? err?.message ?? 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const s: Record<string, CSSProperties> = {
    root: {
      minHeight: '100vh',
      background: 'var(--void)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
    },
    logo: {
      fontFamily: 'var(--cond)',
      fontSize: 32,
      fontWeight: 700,
      color: 'var(--lime)',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      marginBottom: 8,
    },
    tagline: {
      fontFamily: 'var(--sans)',
      fontSize: 13,
      color: 'rgba(255,255,255,0.45)',
      marginBottom: 40,
      letterSpacing: '0.04em',
    },
    card: {
      width: '100%',
      maxWidth: 360,
      background: 'var(--card)',
      border: '1px solid var(--rim)',
      borderRadius: 16,
      padding: '28px 24px',
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
    },
    label: {
      fontFamily: 'var(--cond)',
      fontSize: 11,
      fontWeight: 600,
      color: 'rgba(255,255,255,0.45)',
      textTransform: 'uppercase',
      letterSpacing: '0.1em',
      marginBottom: 6,
      display: 'block',
    },
    input: {
      width: '100%',
      background: 'var(--surface)',
      border: '1px solid var(--rim2)',
      borderRadius: 8,
      padding: '12px 14px',
      color: 'rgba(255,255,255,0.9)',
      fontFamily: 'var(--mono)',
      fontSize: 15,
      outline: 'none',
    },
    btn: {
      width: '100%',
      background: 'var(--lime)',
      color: 'var(--void)',
      fontFamily: 'var(--cond)',
      fontWeight: 700,
      fontSize: 17,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      border: 'none',
      borderRadius: 10,
      padding: '14px 0',
      cursor: 'pointer',
      marginTop: 4,
      opacity: loading ? 0.6 : 1,
    },
    errMsg: {
      fontFamily: 'var(--sans)',
      fontSize: 13,
      color: 'var(--red)',
      textAlign: 'center',
    },
  };

  return (
    <div style={s.root}>
      <div style={s.logo}>Guardian Convoy</div>
      <div style={s.tagline}>Field Officer Portal</div>
      <form style={s.card} onSubmit={handleLogin}>
        <div>
          <label style={s.label}>CFO ID</label>
          <input
            style={s.input}
            type="text"
            autoComplete="username"
            value={cfoId}
            onChange={e => setCfoId(e.target.value)}
            placeholder="CFO-0001"
          />
        </div>
        <div>
          <label style={s.label}>PIN</label>
          <input
            style={s.input}
            type="password"
            autoComplete="current-password"
            value={pin}
            onChange={e => setPin(e.target.value)}
            placeholder="••••••"
          />
        </div>
        <div>
          <label style={s.label}>Convoy ID</label>
          <input
            style={s.input}
            type="text"
            value={convoyId}
            onChange={e => setConvoyId(e.target.value)}
            placeholder="CVY-20240001"
          />
        </div>
        {error && <p style={s.errMsg}>{error}</p>}
        <button style={s.btn} type="submit" disabled={loading}>
          {loading ? 'Authenticating…' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}

function HomeScreen({ navigate, auth }: ScreenProps) {
  const s: Record<string, CSSProperties> = {
    root: {
      flex: 1,
      background: 'var(--void)',
      padding: '24px 16px 100px',
    },
    header: {
      marginBottom: 24,
    },
    greeting: {
      fontFamily: 'var(--cond)',
      fontSize: 26,
      fontWeight: 700,
      color: 'rgba(255,255,255,0.9)',
      letterSpacing: '0.03em',
    },
    convoy: {
      fontFamily: 'var(--mono)',
      fontSize: 12,
      color: 'var(--lime)',
      marginTop: 4,
    },
    route: {
      fontFamily: 'var(--sans)',
      fontSize: 13,
      color: 'rgba(255,255,255,0.5)',
      marginTop: 2,
    },
    grid: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 12,
    },
    tile: {
      background: 'var(--card)',
      border: '1px solid var(--rim)',
      borderRadius: 12,
      padding: '20px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      cursor: 'pointer',
    },
    tileIcon: {
      fontSize: 24,
    },
    tileLabel: {
      fontFamily: 'var(--cond)',
      fontSize: 15,
      fontWeight: 600,
      color: 'rgba(255,255,255,0.85)',
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
    },
    tileDesc: {
      fontFamily: 'var(--sans)',
      fontSize: 12,
      color: 'rgba(255,255,255,0.4)',
    },
    sosTile: {
      gridColumn: '1 / -1',
      background: 'rgba(239,68,68,0.08)',
      border: '1px solid rgba(239,68,68,0.25)',
      borderRadius: 12,
      padding: '20px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      cursor: 'pointer',
    },
    sosLabel: {
      fontFamily: 'var(--cond)',
      fontSize: 20,
      fontWeight: 700,
      color: 'var(--red)',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
    },
    sosDesc: {
      fontFamily: 'var(--sans)',
      fontSize: 12,
      color: 'rgba(255,255,255,0.4)',
      marginTop: 2,
    },
  };

  const convoy = auth?.convoy;

  return (
    <div style={s.root}>
      <div style={s.header}>
        <div style={s.greeting}>
          {auth?.cfo ? `Hello, ${auth.cfo.name.split(' ')[0]}` : 'Dashboard'}
        </div>
        {convoy && (
          <>
            <div style={s.convoy}>{convoy.id}</div>
            <div style={s.route}>
              {convoy.origin} → {convoy.destination} ({convoy.distance_km} km)
            </div>
          </>
        )}
      </div>

      <div style={s.grid}>
        <div style={s.tile} onClick={() => navigate('sod')}>
          <span style={s.tileIcon}>🌅</span>
          <span style={s.tileLabel}>SOD Report</span>
          <span style={s.tileDesc}>Start-of-day photos & seals</span>
        </div>
        <div style={s.tile} onClick={() => navigate('eod')}>
          <span style={s.tileIcon}>🌇</span>
          <span style={s.tileLabel}>EOD Report</span>
          <span style={s.tileDesc}>End-of-day delivery docs</span>
        </div>
        <div style={s.tile} onClick={() => navigate('seals')}>
          <span style={s.tileIcon}>🔒</span>
          <span style={s.tileLabel}>Seals</span>
          <span style={s.tileDesc}>Verify cargo seals</span>
        </div>
        <div style={s.tile} onClick={() => navigate('history')}>
          <span style={s.tileIcon}>📋</span>
          <span style={s.tileLabel}>History</span>
          <span style={s.tileDesc}>Past convoy reports</span>
        </div>
        <div style={s.sosTile} onClick={() => navigate('sos')}>
          <span style={{ fontSize: 32 }}>🚨</span>
          <div>
            <div style={s.sosLabel}>Emergency SOS</div>
            <div style={s.sosDesc}>Broadcast incident to control room</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlaceholderScreen({ title, navigate: _navigate }: { title: string; navigate: (s: ScreenName) => void }) {
  const s: CSSProperties = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--void)',
    color: 'rgba(255,255,255,0.5)',
    fontFamily: 'var(--cond)',
    fontSize: 20,
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    paddingBottom: 80,
  };
  return <div style={s}>{title}</div>;
}

// ----------- Bottom Nav -----------

interface BottomNavProps {
  current: ScreenName;
  navigate: (screen: ScreenName) => void;
}

function BottomNav({ current, navigate }: BottomNavProps) {
  const items: Array<{ screen: ScreenName; label: string; icon: string }> = [
    { screen: 'home', label: 'Home', icon: '⊞' },
    { screen: 'sod', label: 'SOD', icon: '↑' },
    { screen: 'eod', label: 'EOD', icon: '↓' },
    { screen: 'seals', label: 'Seals', icon: '⊗' },
    { screen: 'sos', label: 'SOS', icon: '!' },
  ];

  const s: Record<string, CSSProperties> = {
    nav: {
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      background: 'var(--deep)',
      borderTop: '1px solid var(--rim)',
      display: 'flex',
      zIndex: 100,
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    },
    item: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '10px 0 8px',
      cursor: 'pointer',
      gap: 3,
    },
    icon: {
      fontSize: 18,
      lineHeight: 1,
    },
    label: {
      fontFamily: 'var(--cond)',
      fontSize: 10,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
    },
  };

  return (
    <nav style={s.nav}>
      {items.map(({ screen, label, icon }) => {
        const active = current === screen;
        const isSos = screen === 'sos';
        const color = isSos ? 'var(--red)' : active ? 'var(--lime)' : 'rgba(255,255,255,0.35)';
        return (
          <div
            key={screen}
            style={s.item}
            onClick={() => navigate(screen)}
            role="button"
            aria-current={active ? 'page' : undefined}
          >
            <span style={{ ...s.icon, color }}>{icon}</span>
            <span style={{ ...s.label, color }}>{label}</span>
          </div>
        );
      })}
    </nav>
  );
}

// ----------- App root -----------

export default function App() {
  const [screen, setScreen] = useState<ScreenName>('login');
  const [auth, setAuth] = useState<AuthState | null>(null);

  const navigate = (s: ScreenName) => setScreen(s);

  const handleSetAuth = (a: AuthState | null) => {
    setAuth(a);
    if (!a) setScreen('login');
  };

  const screenProps: ScreenProps = { navigate, auth, setAuth: handleSetAuth };

  const appStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    background: 'var(--void)',
  };

  function renderScreen() {
    switch (screen) {
      case 'login':
        return <LoginScreen {...screenProps} />;
      case 'home':
        return <HomeScreen {...screenProps} />;
      case 'sod':
        return <PlaceholderScreen title="SOD Report" navigate={navigate} />;
      case 'eod':
        return <PlaceholderScreen title="EOD Report" navigate={navigate} />;
      case 'seals':
        return <PlaceholderScreen title="Seal Register" navigate={navigate} />;
      case 'sos':
        return <PlaceholderScreen title="Emergency SOS" navigate={navigate} />;
      case 'history':
        return <PlaceholderScreen title="History" navigate={navigate} />;
    }
  }

  return (
    <div style={appStyle}>
      {renderScreen()}
      {auth && screen !== 'login' && (
        <BottomNav current={screen} navigate={navigate} />
      )}
    </div>
  );
}
