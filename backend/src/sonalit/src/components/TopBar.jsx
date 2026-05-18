import { useState, useEffect, useRef } from 'react';
import { Zap, AlertTriangle, ChevronDown } from 'lucide-react';

const STATUSES = [
  { key:'fleet',   label:'FLEET',   state:'nominal',  dot:'g' },
  { key:'border',  label:'BORDER',  state:'advisory', dot:'o' },
  { key:'weather', label:'WEATHER', state:'nominal',  dot:'g' },
  { key:'cyber',   label:'CYBER',   state:'nominal',  dot:'g' },
];

const AUTONOMY = [
  { level:1, label:'L1 · ADVISORY',   desc:'Recommendations only. Human approves all actions.' },
  { level:2, label:'L2 · AUTO-DRAFT', desc:'Prepares full action packages for human approval.' },
  { level:3, label:'L3 · AUTONOMOUS', desc:'Full autonomous execution at confidence threshold.' },
];

const USER_CLASSES = [
  { id:'operator',   label:'OPERATOR',     color:'var(--amber)',  desc:'Dispatcher / Fleet Manager' },
  { id:'strategist', label:'STRATEGIST',   color:'var(--purple)', desc:'C-Suite / Director' },
  { id:'field',      label:'FIELD ACTOR',  color:'var(--green)',  desc:'Driver / Warehouse / Contractor' },
  { id:'system',     label:'SYSTEM ACTOR', color:'var(--cyan)',   desc:'API / Automation / Webhook' },
];

function Dropdown({ show, onClose, title, children }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!show) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    // slight delay so opening click doesn't immediately close
    const t = setTimeout(() => document.addEventListener('pointerdown', handler), 50);
    return () => { clearTimeout(t); document.removeEventListener('pointerdown', handler); };
  }, [show, onClose]);

  if (!show) return null;
  return (
    <div ref={ref} className="tb-menu">
      <div className="tb-menu-title">{title}</div>
      {children}
    </div>
  );
}

export default function TopBar({ incidents, autonomyLevel, setAutonomyLevel, userClass, setUserClass }) {
  const [time, setTime]     = useState(new Date());
  const [showAL, setShowAL] = useState(false);
  const [showUC, setShowUC] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const utc  = time.toISOString().slice(11,19);
  const date = time.toISOString().slice(0,10);
  const curAL = AUTONOMY.find(a => a.level === autonomyLevel);
  const curUC = USER_CLASSES.find(u => u.id === userClass);

  return (
    <header className="topbar">
      {/* Logo */}
      <div className="tb-logo">
        <div className="tb-mark" />
        <div>
          <div className="tb-name">SONA<span>LIT</span></div>
          <div className="tb-sub">LOGISTICS INTELLIGENCE PLATFORM</div>
        </div>
      </div>

      <div className="tb-sep tb-desktop" />

      {/* Status pills — desktop only */}
      <div className="status-group tb-desktop">
        {STATUSES.map(s => (
          <div key={s.key} className={`status-pill ${s.state}`}>
            <div className={`s-dot ${s.dot}`} />{s.label}
          </div>
        ))}
      </div>

      <div className="tb-space" />

      {/* User Class — desktop only */}
      <div className="tb-drop-wrap tb-desktop">
        <button className="tb-drop-btn uc"
          style={{ borderColor:`${curUC.color}44`, color:curUC.color }}
          onClick={() => { setShowUC(v => !v); setShowAL(false); }}>
          ◈ {curUC.label} <ChevronDown size={9} style={{ opacity:.6 }} />
        </button>
        <Dropdown show={showUC} onClose={() => setShowUC(false)} title="USER CLASS (§1.3)">
          {USER_CLASSES.map(uc => (
            <div key={uc.id} className="tb-menu-item"
              style={{ background: userClass===uc.id ? `${uc.color}14`:'transparent', borderColor: userClass===uc.id ? `${uc.color}44`:'transparent' }}
              onClick={() => { setUserClass(uc.id); setShowUC(false); }}>
              <div className="tb-menu-item-name" style={{ color:uc.color }}>{uc.label}</div>
              <div className="tb-menu-item-desc">{uc.desc}</div>
            </div>
          ))}
        </Dropdown>
      </div>

      {/* Autonomy Level — desktop only */}
      <div className="tb-drop-wrap tb-desktop">
        <button className="tb-drop-btn al"
          onClick={() => { setShowAL(v => !v); setShowUC(false); }}>
          <Zap size={10} /> {curAL.label} <ChevronDown size={9} style={{ opacity:.6 }} />
        </button>
        <Dropdown show={showAL} onClose={() => setShowAL(false)} title="AUTONOMY LEVEL (§8)">
          {AUTONOMY.map(al => (
            <div key={al.level} className="tb-menu-item"
              style={{ background: autonomyLevel===al.level ? 'var(--cyan-glow)':'transparent', borderColor: autonomyLevel===al.level ? 'var(--cyan-dim)':'transparent' }}
              onClick={() => { setAutonomyLevel(al.level); setShowAL(false); }}>
              <div className="tb-menu-item-name" style={{ color:'var(--cyan)' }}>LEVEL {al.level} — {al.label}</div>
              <div className="tb-menu-item-desc">{al.desc}</div>
            </div>
          ))}
        </Dropdown>
      </div>

      {/* Incident badge */}
      <div className="tb-incident">
        <AlertTriangle size={11} />
        {incidents} INCIDENT{incidents!==1?'S':''} ACTIVE
      </div>

      <div className="tb-sep tb-desktop" />

      {/* Clock — desktop only */}
      <div className="tb-clock tb-desktop">
        <span style={{ color:'var(--text-low)' }}>{date} · </span>
        <span style={{ color:'var(--cyan)' }}>{utc}</span>
        <span style={{ color:'var(--text-low)', fontSize:9, marginLeft:3 }}>UTC</span>
      </div>
    </header>
  );
}
