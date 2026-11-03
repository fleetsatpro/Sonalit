import { useState, useEffect } from 'react';
import { Zap, AlertTriangle, ChevronDown } from 'lucide-react';

const STATUSES = [
  { key: 'fleet',   label: 'FLEET',   state: 'nominal',  dot: 'green' },
  { key: 'border',  label: 'BORDER',  state: 'advisory', dot: 'orange' },
  { key: 'weather', label: 'WEATHER', state: 'nominal',  dot: 'green' },
  { key: 'cyber',   label: 'CYBER',   state: 'nominal',  dot: 'green' },
];

const AUTONOMY_LEVELS = [
  { level: 1, label: 'L1 · ADVISORY',   desc: 'Recommend only. All actions require human approval.' },
  { level: 2, label: 'L2 · AUTO-DRAFT', desc: 'Prepares full action packages for human approval.' },
  { level: 3, label: 'L3 · AUTONOMOUS', desc: 'Full autonomous execution at configured confidence threshold.' },
];

const USER_CLASSES = [
  { id: 'operator',   label: 'OPERATOR',     color: 'var(--amber)',  desc: 'Dispatcher / Fleet Manager / Supervisor' },
  { id: 'strategist', label: 'STRATEGIST',   color: 'var(--purple)', desc: 'C-Suite / Director / Procurement Head' },
  { id: 'field',      label: 'FIELD ACTOR',  color: 'var(--green)',  desc: 'Driver / Warehouse Staff / Contractor' },
  { id: 'system',     label: 'SYSTEM ACTOR', color: 'var(--cyan)',   desc: 'API / Automation Engine / Webhook Consumer' },
];

export default function TopBar({ incidents, autonomyLevel, setAutonomyLevel, userClass, setUserClass }) {
  const [time, setTime] = useState(new Date());
  const [showAutonomy, setShowAutonomy] = useState(false);
  const [showUserClass, setShowUserClass] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const utc  = time.toISOString().slice(11, 19);
  const date = time.toISOString().slice(0, 10);
  const currentAL = AUTONOMY_LEVELS.find(a => a.level === autonomyLevel);
  const currentUC = USER_CLASSES.find(u => u.id === userClass);

  const dropdownBase = {
    position: 'absolute', top: 'calc(100% + 6px)', right: 0,
    background: 'var(--bg-elevated)', border: '1px solid var(--border-bright)',
    borderRadius: 'var(--radius-md)', padding: 6, zIndex: 300,
    boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
  };

  return (
    <header className="topbar" style={{ position: 'relative', zIndex: 200 }}>
      <div className="topbar-logo">
        <div className="topbar-logo-mark" />
        <div>
          <div className="topbar-title">MONSTER LOGISTICS OS</div>
          <div className="topbar-subtitle">SOVEREIGN EDITION · V2.0 · 35 MODULES · 7 PHASES</div>
        </div>
      </div>

      <div className="topbar-divider" />

      <div className="topbar-status-group">
        {STATUSES.map(s => (
          <div key={s.key} className={`status-pill ${s.state}`}>
            <div className={`status-dot ${s.dot}`} />
            {s.label}
          </div>
        ))}
      </div>

      <div className="topbar-spacer" />

      {/* User Class Dropdown */}
      <div style={{ position: 'relative' }}>
        <button onClick={() => { setShowUserClass(v => !v); setShowAutonomy(false); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px',
            borderRadius: 'var(--radius-sm)', background: 'var(--bg-elevated)',
            border: `1px solid ${currentUC.color}55`, fontFamily: 'var(--font-mono)',
            fontSize: 10, color: currentUC.color, cursor: 'pointer', letterSpacing: '0.06em',
          }}>
          <span style={{ fontSize: 10 }}>◈</span>
          {currentUC.label}
          <ChevronDown size={9} style={{ marginLeft: 2, opacity: 0.6 }} />
        </button>

        {showUserClass && (
          <div style={{ ...dropdownBase, minWidth: 240 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-muted)', padding: '3px 8px 6px', letterSpacing: '0.12em' }}>
              SELECT USER CLASS (§1.3)
            </div>
            {USER_CLASSES.map(uc => (
              <div key={uc.id} onClick={() => { setUserClass(uc.id); setShowUserClass(false); }}
                style={{
                  padding: '7px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                  background: userClass === uc.id ? `${uc.color}14` : 'transparent',
                  border: `1px solid ${userClass === uc.id ? uc.color + '44' : 'transparent'}`,
                  marginBottom: 3,
                }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: uc.color, letterSpacing: '0.06em' }}>{uc.label}</div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{uc.desc}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Autonomy Level Dropdown */}
      <div style={{ position: 'relative' }}>
        <button onClick={() => { setShowAutonomy(v => !v); setShowUserClass(false); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px',
            borderRadius: 'var(--radius-sm)', background: 'var(--cyan-glow)',
            border: '1px solid var(--cyan-dim)', fontFamily: 'var(--font-mono)',
            fontSize: 10, color: 'var(--cyan)', cursor: 'pointer', letterSpacing: '0.06em',
          }}>
          <Zap size={10} />
          AUTONOMY · {currentAL.label}
          <ChevronDown size={9} style={{ marginLeft: 2, opacity: 0.6 }} />
        </button>

        {showAutonomy && (
          <div style={{ ...dropdownBase, minWidth: 280 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-muted)', padding: '3px 8px 6px', letterSpacing: '0.12em' }}>
              MODULE 08 · AI DECISION ENGINE (§8)
            </div>
            {AUTONOMY_LEVELS.map(al => (
              <div key={al.level} onClick={() => { setAutonomyLevel(al.level); setShowAutonomy(false); }}
                style={{
                  padding: '7px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                  background: autonomyLevel === al.level ? 'var(--cyan-glow)' : 'transparent',
                  border: `1px solid ${autonomyLevel === al.level ? 'var(--cyan-dim)' : 'transparent'}`,
                  marginBottom: 3,
                }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: 'var(--cyan)', letterSpacing: '0.06em' }}>
                  LEVEL {al.level} — {al.label}
                </div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{al.desc}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Incidents */}
      <div className={`incident-badge ${incidents > 0 ? 'critical' : ''}`}
           style={incidents === 0 ? { borderColor: 'var(--border-mid)', background: 'transparent', color: 'var(--text-muted)' } : {}}>
        <AlertTriangle size={10} />
        {incidents} INCIDENT{incidents !== 1 ? 'S' : ''} ACTIVE
      </div>

      <div className="topbar-divider" />

      <div className="topbar-clock">
        <span style={{ color: 'var(--text-muted)' }}>{date} · </span>
        <span style={{ color: 'var(--cyan)' }}>{utc}</span>
        <span style={{ color: 'var(--text-muted)', fontSize: '9px', marginLeft: '3px' }}>UTC</span>
      </div>
    </header>
  );
}
