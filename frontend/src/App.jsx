import { useState } from 'react';
import TopBar    from './components/TopBar.jsx';
import Sidebar   from './components/Sidebar.jsx';
import ChatArea  from './components/ChatArea.jsx';
import MetricsPanel from './components/MetricsPanel.jsx';
import BottomNav from './components/BottomNav.jsx';
import Settings  from './components/Settings.jsx';

const ENV_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY;

const PHASES = [
  { n:1, l:'CORE',          c:'var(--green)' },
  { n:2, l:'INTELLIGENCE',  c:'var(--cyan)' },
  { n:3, l:'MARKET',        c:'var(--amber)' },
  { n:4, l:'AUTONOMY',      c:'var(--orange)' },
  { n:5, l:'ECOSYSTEM',     c:'var(--purple)' },
  { n:6, l:'ANTICIPATION',  c:'var(--red)' },
  { n:7, l:'SINGULARITY',   c:'#f43f5e' },
];

function AuthGate({ onKey }) {
  const [val, setVal] = useState('');
  const [err, setErr] = useState('');

  const submit = () => {
    const k = val.trim();
    if (!k.startsWith('sk-ant-')) { setErr('Key must begin with sk-ant-'); return; }
    onKey(k);
  };

  return (
    <div className="auth-wrap">
      <div className="auth-box">
        <div style={{ width:68, height:68, background:'var(--amber-glow)', border:'2px solid var(--amber)', borderRadius:14, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ width:32, height:32, background:'var(--amber)', clipPath:'polygon(50% 0%,100% 38%,82% 100%,18% 100%,0% 38%)' }} />
        </div>

        <div>
          <div className="auth-title">SONA<span>LIT</span></div>
          <div className="auth-sub">LOGISTICS INTELLIGENCE PLATFORM · SECURE ACCESS</div>
        </div>

        <div className="auth-phases">
          {PHASES.map(p => (
            <div key={p.n} className="auth-phase"
              style={{ background:`${p.c}14`, border:`1px solid ${p.c}44`, color:p.c }}>
              P{p.n} · {p.l}
            </div>
          ))}
        </div>

        <div className="auth-desc">
          Enter your Anthropic API key to activate Sonalit AI —
          35 operational domains, 7 production phases,
          autonomous logistics intelligence running on the full Sonalit platform.
        </div>

        <div className="auth-form">
          <input
            className="auth-input"
            type="password"
            placeholder="sk-ant-api03-…"
            value={val}
            onChange={e => { setVal(e.target.value); setErr(''); }}
            onKeyDown={e => e.key === 'Enter' && submit()}
          />
          {err && <div className="auth-err">⚠ {err}</div>}
          <button className="auth-btn" onClick={submit}>
            ACTIVATE SONALIT AI
          </button>
        </div>

        <div className="auth-note">
          Key used only for direct API calls · not stored · session only<br />
          Get yours at{' '}
          <a href="https://console.anthropic.com" target="_blank" rel="noreferrer">
            console.anthropic.com
          </a>
          <br />
          Or set <code style={{ color:'var(--amber)' }}>VITE_ANTHROPIC_API_KEY</code> in{' '}
          <code style={{ color:'var(--amber)' }}>.env</code> to skip this screen
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [apiKey,        setApiKey]        = useState(ENV_KEY || '');
  const [activeModule,  setActiveModule]  = useState('overview');
  const [autonomyLevel, setAutonomyLevel] = useState(1);
  const [userClass,     setUserClass]     = useState('operator');
  const [mobileTab,     setMobileTab]     = useState('chat');

  const needsKey = !apiKey || !apiKey.startsWith('sk-ant-');

  const selectModule = (mod) => {
    setActiveModule(mod);
    setMobileTab('chat');
  };

  return (
    <div className="app-shell">
      <TopBar
        incidents={2}
        autonomyLevel={autonomyLevel}
        setAutonomyLevel={setAutonomyLevel}
        userClass={userClass}
        setUserClass={setUserClass}
      />

      <div className="app-main">
        {needsKey ? (
          <AuthGate onKey={setApiKey} />
        ) : (
          <>
            <Sidebar
              activeModule={activeModule}
              setActiveModule={selectModule}
              mobileActive={mobileTab === 'modules'}
            />
            <ChatArea
              apiKey={apiKey}
              activeModule={activeModule}
              userClass={userClass}
              autonomyLevel={autonomyLevel}
              mobileActive={mobileTab === 'chat'}
            />
            <MetricsPanel
              mobileActive={mobileTab === 'metrics'}
            />
            <Settings
              autonomyLevel={autonomyLevel}
              setAutonomyLevel={setAutonomyLevel}
              userClass={userClass}
              setUserClass={setUserClass}
              mobileActive={mobileTab === 'settings'}
            />
          </>
        )}
      </div>

      {!needsKey && (
        <BottomNav active={mobileTab} setActive={setMobileTab} />
      )}
    </div>
  );
}
