import { useState } from 'react';
import TopBar from './components/TopBar.jsx';
import Sidebar from './components/Sidebar.jsx';
import ChatArea from './components/ChatArea.jsx';
import MetricsPanel from './components/MetricsPanel.jsx';

const ENV_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY;

const PHASES = [
  { n: 1, label: 'CORE',        name: 'Monster Foundation',        range: 'M0–9',   color: 'var(--green)' },
  { n: 2, label: 'INTELLIGENCE',name: 'Warehouse & Border',        range: 'M9–18',  color: 'var(--cyan)' },
  { n: 3, label: 'MARKET',      name: 'Marketplace & Finance',     range: 'M18–27', color: 'var(--amber)' },
  { n: 4, label: 'AUTONOMY',    name: 'AI & Vision',               range: 'M27–36', color: 'var(--orange)' },
  { n: 5, label: 'ECOSYSTEM',   name: 'Global Mesh',               range: 'M36–48', color: 'var(--purple)' },
  { n: 6, label: 'ANTICIPATION',name: 'Predictive Network',        range: 'M48–60', color: 'var(--red)' },
  { n: 7, label: 'SINGULARITY', name: 'Autonomous Supply Chain',   range: 'M60+',   color: '#f43f5e' },
];

function ApiKeyGate({ onKey }) {
  const [val, setVal] = useState('');
  const [err, setErr] = useState('');

  const submit = () => {
    if (!val.trim().startsWith('sk-ant-')) { setErr('Key must begin with sk-ant-'); return; }
    onKey(val.trim());
  };

  return (
    <div className="api-key-prompt">
      <div style={{ width: 64, height: 64, background: 'var(--amber-glow)', border: '2px solid var(--amber)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 30, height: 30, background: 'var(--amber)', clipPath: 'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)' }} />
      </div>

      <div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--text-primary)', textAlign: 'center' }}>
          MLOS <span style={{ color: 'var(--amber)' }}>COPILOT</span>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--cyan)', letterSpacing: '0.14em', textAlign: 'center', marginTop: 4 }}>
          AUTHORISATION REQUIRED · SOVEREIGN EDITION V2.0
        </div>
      </div>

      {/* Phase Map */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 400 }}>
        {PHASES.map(p => (
          <div key={p.n} style={{ padding: '3px 8px', borderRadius: 'var(--radius-sm)', background: `${p.color}12`, border: `1px solid ${p.color}44`, fontFamily: 'var(--font-mono)', fontSize: 8, color: p.color, letterSpacing: '0.06em' }}>
            P{p.n} · {p.label}
          </div>
        ))}
      </div>

      <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--text-secondary)', maxWidth: 380, textAlign: 'center', lineHeight: 1.6 }}>
        Authentication required to access the MLOS cognitive layer.
        35 operational domains · 7 production phases · Full Sovereign Edition system prompt loaded.
      </div>

      <div className="api-key-form">
        <input className="api-key-input" type="password" placeholder="sk-ant-api03-..."
          value={val} onChange={e => { setVal(e.target.value); setErr(''); }}
          onKeyDown={e => e.key === 'Enter' && submit()} autoFocus />
        {err && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--red)' }}>⚠ {err}</div>}
        <button className="api-key-submit" onClick={submit}>AUTHENTICATE · ESTABLISH LINK</button>
      </div>

      <div className="api-key-note">
        No key stored server-side · Session only · Obtain at{' '}
        <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" style={{ color: 'var(--amber)', textDecoration: 'none' }}>console.anthropic.com</a>
      </div>
      <div className="api-key-note" style={{ marginTop: 3 }}>
        Or set VITE_ANTHROPIC_API_KEY in .env to bypass this screen
      </div>
    </div>
  );
}

export default function App() {
  const [activeModule, setActiveModule]   = useState('overview');
  const [apiKey, setApiKey]               = useState(ENV_KEY || '');
  const [autonomyLevel, setAutonomyLevel] = useState(1);
  const [userClass, setUserClass]         = useState('operator');

  const needsKey = !apiKey || !apiKey.startsWith('sk-ant-');
  const incidents = 2;

  return (
    <div className="app-shell">
      <TopBar
        incidents={incidents}
        autonomyLevel={autonomyLevel}
        setAutonomyLevel={setAutonomyLevel}
        userClass={userClass}
        setUserClass={setUserClass}
      />
      <div className="app-main">
        {needsKey ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)' }}>
            <ApiKeyGate onKey={setApiKey} />
          </div>
        ) : (
          <>
            <Sidebar activeModule={activeModule} setActiveModule={setActiveModule} />
            <ChatArea
              apiKey={apiKey}
              activeModule={activeModule}
              userClass={userClass}
              autonomyLevel={autonomyLevel}
            />
            <MetricsPanel />
          </>
        )}
      </div>
    </div>
  );
}
