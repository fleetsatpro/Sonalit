import { useState, useEffect, useRef } from 'react';
import {
  AlertTriangle, Truck, Package, User, Activity,
  ChevronRight, Zap, CheckCircle, Clock,
} from 'lucide-react';

const C = {
  bg: '#060e1a', panel: '#0b1829', surface: '#0d2240',
  cyan: '#00d4ff', cyanBg: 'rgba(0,212,255,0.07)', cyanBd: 'rgba(0,212,255,0.18)',
  blue: '#0066ff', success: '#00ff88', warning: '#ffaa00',
  danger: '#ff3355', muted: '#4a7090', body: '#c8ddf0', bright: '#e8f4ff',
};

// ── RiskScoreBadge ─────────────────────────────────────────────────────────────
export function RiskScoreBadge({ score, trend }) {
  const color =
    score >= 75 ? C.danger :
    score >= 50 ? C.warning :
    score >= 25 ? C.cyan : C.success;

  const label =
    score >= 75 ? 'CRITICAL' :
    score >= 50 ? 'HIGH' :
    score >= 25 ? 'MODERATE' : 'LOW';

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: `${color}18`, border: `1px solid ${color}40`,
      borderRadius: 6, padding: '3px 10px',
    }}>
      <span style={{
        fontFamily: 'IBM Plex Mono', fontSize: 18, fontWeight: 700,
        color, lineHeight: 1,
      }}>{score}</span>
      <div>
        <div style={{ fontFamily: 'IBM Plex Mono', fontSize: 8, color, letterSpacing: '0.15em' }}>{label}</div>
        {trend !== undefined && (
          <div style={{ fontFamily: 'IBM Plex Mono', fontSize: 8, color: trend > 0 ? C.danger : C.success }}>
            {trend > 0 ? '▲' : '▼'} {Math.abs(trend)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── ConfidenceBand ─────────────────────────────────────────────────────────────
export function ConfidenceBand({ value, label }) {
  const color = value >= 80 ? C.success : value >= 60 ? C.warning : C.danger;
  const tier = value >= 80 ? 'HIGH' : value >= 60 ? 'MODERATE' : 'LOW';

  return (
    <div style={{ width: '100%' }}>
      {label && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 9, color: C.muted, letterSpacing: '0.12em' }}>{label}</span>
          <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 9, color, fontWeight: 700, letterSpacing: '0.1em' }}>{tier} · {value}%</span>
        </div>
      )}
      <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{
          width: `${value}%`, height: '100%',
          background: `linear-gradient(90deg, ${color}88, ${color})`,
          borderRadius: 2, transition: 'width 0.6s ease',
        }} />
      </div>
    </div>
  );
}

// ── StatusBadge ────────────────────────────────────────────────────────────────
export function StatusBadge({ status }) {
  const cfg = {
    'ON TIME':  { color: C.success, bg: `${C.success}18` },
    'DELAYED':  { color: C.warning, bg: `${C.warning}18` },
    'INCIDENT': { color: C.danger,  bg: `${C.danger}18`  },
    'HOLD':     { color: C.muted,   bg: 'rgba(74,112,144,0.18)' },
  };
  const { color, bg } = cfg[status?.toUpperCase()] || cfg['HOLD'];
  const isLive = status?.toUpperCase() === 'ON TIME';

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontFamily: 'IBM Plex Mono', fontSize: 9, fontWeight: 700,
      letterSpacing: '0.14em', color, background: bg,
      border: `1px solid ${color}40`, borderRadius: 4, padding: '2px 8px',
    }}>
      <span style={{
        width: 5, height: 5, borderRadius: '50%', background: color,
        animation: isLive ? 'pulse 1.5s ease-in-out infinite' : 'none',
      }} />
      {status?.toUpperCase()}
    </span>
  );
}

// ── SLACountdown ───────────────────────────────────────────────────────────────
export function SLACountdown({ deadline }) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const calc = () => setRemaining(Math.max(0, new Date(deadline) - Date.now()));
    calc();
    const t = setInterval(calc, 1000);
    return () => clearInterval(t);
  }, [deadline]);

  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  const urgent = mins < 15;
  const expired = remaining === 0;

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontFamily: 'IBM Plex Mono', fontSize: 11, fontWeight: 700,
      color: expired ? C.danger : urgent ? C.warning : C.cyan,
      background: expired ? `${C.danger}12` : urgent ? `${C.warning}12` : C.cyanBg,
      border: `1px solid ${expired ? C.danger : urgent ? C.warning : C.cyan}30`,
      borderRadius: 6, padding: '4px 10px',
    }}>
      <Clock size={12} />
      {expired ? 'EXPIRED' : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`}
    </div>
  );
}

// ── TelemetryGauge ─────────────────────────────────────────────────────────────
export function TelemetryGauge({ label, value, unit, min = 0, max = 100, color = C.cyan }) {
  const pct = Math.min(1, Math.max(0, (value - min) / (max - min)));
  const angle = pct * 180 - 90;
  const r = 28, cx = 36, cy = 36;
  const arcPath = `M 8 36 A 28 28 0 0 1 64 36`;
  const fillArc = pct > 0
    ? `M 8 36 A 28 28 0 ${pct > 0.5 ? 1 : 0} 1 ${cx + r * Math.cos((angle) * Math.PI / 180)} ${cy + r * Math.sin((angle) * Math.PI / 180)}`
    : '';

  return (
    <div style={{
      textAlign: 'center', padding: '8px', background: C.surface,
      border: `1px solid ${C.cyanBd}`, borderRadius: 4, minWidth: 70,
    }}>
      <svg width="72" height="44" viewBox="0 0 72 44">
        <path d={arcPath} fill="none" stroke="rgba(0,212,255,0.1)" strokeWidth="4" strokeLinecap="round" />
        {pct > 0 && <path d={fillArc} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" />}
        <text x="36" y="32" textAnchor="middle" fontSize="13" fontWeight="700" fontFamily="IBM Plex Mono" fill={color}>{value}</text>
        <text x="36" y="42" textAnchor="middle" fontSize="8" fontFamily="IBM Plex Mono" fill={C.muted}>{unit}</text>
      </svg>
      <div style={{ fontSize: 8, fontFamily: 'IBM Plex Mono', color: C.muted, letterSpacing: '0.12em', marginTop: 2 }}>{label}</div>
    </div>
  );
}

// ── AlertCard ──────────────────────────────────────────────────────────────────
export function AlertCard({ type, severity, message, timestamp, location, onAcknowledge }) {
  const sevColor = severity === 'critical' ? C.danger : severity === 'high' ? C.warning : severity === 'medium' ? C.cyan : C.success;

  return (
    <div style={{
      background: C.surface, border: `1px solid ${sevColor}30`,
      borderLeft: `3px solid ${sevColor}`, borderRadius: 6,
      padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={13} color={sevColor} />
          <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 10, fontWeight: 700, color: sevColor, letterSpacing: '0.12em' }}>{type}</span>
          <span style={{
            fontFamily: 'IBM Plex Mono', fontSize: 8, padding: '1px 6px',
            background: `${sevColor}20`, border: `1px solid ${sevColor}40`,
            borderRadius: 3, color: sevColor, letterSpacing: '0.1em',
          }}>{severity?.toUpperCase()}</span>
        </div>
        <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 9, color: C.muted }}>
          {timestamp ? new Date(timestamp).toLocaleTimeString() : '--:--'}
        </span>
      </div>
      <p style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, color: C.body, margin: 0, lineHeight: 1.5 }}>{message}</p>
      {location && (
        <div style={{ fontFamily: 'IBM Plex Mono', fontSize: 9, color: C.muted }}>LOC: {location}</div>
      )}
      {onAcknowledge && (
        <button onClick={onAcknowledge} style={{
          alignSelf: 'flex-start', fontFamily: 'IBM Plex Mono', fontSize: 9,
          letterSpacing: '0.1em', color: C.cyan, background: C.cyanBg,
          border: `1px solid ${C.cyanBd}`, borderRadius: 4, padding: '3px 10px',
          cursor: 'pointer',
        }}>ACKNOWLEDGE</button>
      )}
    </div>
  );
}

// ── EntityTag ──────────────────────────────────────────────────────────────────
export function EntityTag({ type, id, label }) {
  const cfg = {
    vehicle:  { icon: Truck,    color: C.cyan    },
    shipment: { icon: Package,  color: C.success },
    driver:   { icon: User,     color: C.warning },
    default:  { icon: Activity, color: C.muted   },
  };
  const { icon: Icon, color } = cfg[type] || cfg.default;

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontFamily: 'IBM Plex Mono', fontSize: 9, fontWeight: 600,
      color, background: `${color}15`, border: `1px solid ${color}30`,
      borderRadius: 4, padding: '2px 7px', letterSpacing: '0.08em',
    }}>
      <Icon size={9} />
      {label || id}
    </span>
  );
}

// ── AIRecommendationCard ───────────────────────────────────────────────────────
export function AIRecommendationCard({ level, title, rationale, confidence, affected, onApprove, onDismiss }) {
  const levelCfg = {
    advisory:   { label: 'ADVISORY',          color: C.blue    },
    approval:   { label: 'APPROVAL REQUIRED', color: C.warning },
    autonomous: { label: 'AUTONOMOUS',        color: C.success },
  };
  const { label, color } = levelCfg[level] || levelCfg.advisory;

  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.cyanBd}`,
      borderLeft: `3px solid ${color}`, borderRadius: 8, padding: 16,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontFamily: 'IBM Plex Mono', fontSize: 8, fontWeight: 700,
          color, background: `${color}18`, border: `1px solid ${color}40`,
          borderRadius: 3, padding: '2px 7px', letterSpacing: '0.12em',
        }}>{label}</span>
      </div>
      <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 14, fontWeight: 600, color: C.bright }}>{title}</div>
      <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, color: C.body, lineHeight: 1.6 }}>{rationale}</div>
      <ConfidenceBand value={confidence} label="Confidence" />
      {affected?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {affected.map(a => (
            <span key={a} style={{
              fontFamily: 'IBM Plex Mono', fontSize: 9,
              color: C.cyan, background: C.cyanBg,
              border: `1px solid ${C.cyanBd}`, borderRadius: 3, padding: '1px 6px',
            }}>{a}</span>
          ))}
        </div>
      )}
      {level === 'approval' && (
        <div style={{ display: 'flex', gap: 8 }}>
          {onApprove && (
            <button onClick={onApprove} style={{
              flex: 1, fontFamily: 'IBM Plex Mono', fontSize: 10, fontWeight: 700,
              letterSpacing: '0.1em', color: C.bg, background: C.cyan,
              border: 'none', borderRadius: 5, padding: '7px 0', cursor: 'pointer',
            }}>APPROVE</button>
          )}
          {onDismiss && (
            <button onClick={onDismiss} style={{
              flex: 1, fontFamily: 'IBM Plex Mono', fontSize: 10, fontWeight: 700,
              letterSpacing: '0.1em', color: C.muted, background: 'transparent',
              border: `1px solid rgba(74,112,144,0.3)`, borderRadius: 5, padding: '7px 0', cursor: 'pointer',
            }}>DISMISS</button>
          )}
        </div>
      )}
    </div>
  );
}

// ── ProbabilityBar ─────────────────────────────────────────────────────────────
export function ProbabilityBar({ low, mid, high, unit }) {
  const total = (low || 0) + (mid || 0) + (high || 0);
  const pLow = total > 0 ? (low / total) * 100 : 33;
  const pMid = total > 0 ? (mid / total) * 100 : 34;
  const pHigh = total > 0 ? (high / total) * 100 : 33;

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', height: 14, borderRadius: 4, overflow: 'hidden', gap: 1 }}>
        <div style={{ width: `${pLow}%`, background: C.success, opacity: 0.8 }} title={`Early: ${low}${unit || ''}`} />
        <div style={{ width: `${pMid}%`, background: C.cyan, opacity: 0.8 }} title={`On-time: ${mid}${unit || ''}`} />
        <div style={{ width: `${pHigh}%`, background: C.warning, opacity: 0.8 }} title={`Late: ${high}${unit || ''}`} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
        <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 8, color: C.success }}>EARLY {pLow.toFixed(0)}%</span>
        <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 8, color: C.cyan }}>ON-TIME {pMid.toFixed(0)}%</span>
        <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 8, color: C.warning }}>LATE {pHigh.toFixed(0)}%</span>
      </div>
    </div>
  );
}

// ── AuditEntry ─────────────────────────────────────────────────────────────────
export function AuditEntry({ timestamp, actor, action, entity }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '8px 0', borderBottom: '1px solid rgba(0,212,255,0.06)',
    }}>
      <div style={{
        width: 6, height: 6, borderRadius: '50%', background: C.cyan,
        marginTop: 5, flexShrink: 0,
      }} />
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 9, color: C.cyan, fontWeight: 600 }}>{actor}</span>
          <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11, color: C.body }}>{action}</span>
          {entity && <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 9, color: C.muted }}>{entity}</span>}
        </div>
        <div style={{ fontFamily: 'IBM Plex Mono', fontSize: 8, color: C.muted, marginTop: 2 }}>
          {timestamp ? new Date(timestamp).toLocaleString() : '—'}
        </div>
      </div>
    </div>
  );
}

// ── ModuleNavItem ──────────────────────────────────────────────────────────────
export function ModuleNavItem({ icon: Icon, label, desc, active, collapsed, onClick }) {
  return (
    <button onClick={onClick} style={{
      width: '100%', display: 'flex', alignItems: 'center',
      gap: collapsed ? 0 : 10, padding: collapsed ? '10px 0' : '10px 14px',
      justifyContent: collapsed ? 'center' : 'flex-start',
      background: active ? C.cyanBg : 'transparent',
      border: 'none', borderLeft: active ? `2px solid ${C.cyan}` : '2px solid transparent',
      cursor: 'pointer', transition: 'all 0.15s ease', borderRadius: collapsed ? 8 : 0,
    }}>
      <Icon size={16} color={active ? C.cyan : C.muted} style={{ flexShrink: 0 }} />
      {!collapsed && (
        <div style={{ textAlign: 'left', overflow: 'hidden' }}>
          <div style={{
            fontFamily: 'IBM Plex Mono', fontSize: 10, fontWeight: 700,
            letterSpacing: '0.1em', color: active ? C.bright : C.body,
          }}>{label}</div>
          {desc && <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 10, color: C.muted, marginTop: 1 }}>{desc}</div>}
        </div>
      )}
    </button>
  );
}

// ── LivePulse ──────────────────────────────────────────────────────────────────
export function LivePulse({ label, ms }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const interval = ms || 2000;
    const t = setInterval(() => setTick(n => n + 1), interval);
    return () => clearInterval(t);
  }, [ms]);

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <div style={{ position: 'relative', width: 8, height: 8 }}>
        <div style={{
          position: 'absolute', inset: 0, borderRadius: '50%',
          background: C.success, animation: 'ping 1.5s cubic-bezier(0,0,0.2,1) infinite',
          opacity: 0.4,
        }} />
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.success }} />
      </div>
      {label && (
        <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 9, color: C.success, letterSpacing: '0.12em' }}>
          {label}
        </span>
      )}
      <style>{`
        @keyframes ping {
          75%, 100% { transform: scale(2.2); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
