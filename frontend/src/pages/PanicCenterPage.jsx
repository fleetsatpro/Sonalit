import { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import {
  AlertOctagon, MapPin, Clock, Battery, Shield, CheckCircle,
  Skull, Activity, AlertTriangle, Volume2
} from 'lucide-react';
import { guardianAPI } from '../services/api';
import socketService from '../services/socket';

const G = {
  bg: '#080C14', card: 'rgba(255,255,255,0.025)', border: 'rgba(255,255,255,0.07)',
  gold: '#F0B429', goldBg: 'rgba(240,180,41,0.08)',
  green: '#22c55e', greenBg: 'rgba(34,197,94,0.08)',
  red: '#ef4444', redBg: 'rgba(239,68,68,0.08)', redBd: 'rgba(239,68,68,0.25)',
  amber: '#f59e0b', amberBg: 'rgba(245,158,11,0.08)',
  cyan: '#22D3A0', cyanBg: 'rgba(34,211,160,0.08)',
  blue: '#3b82f6', blueBg: 'rgba(59,130,246,0.08)',
  orange: '#f97316', orangeBg: 'rgba(249,115,22,0.08)',
  text: '#e2e8f0', muted: '#94a3b8', low: '#475569',
};

const PANIC_MODE_CONFIG = {
  hijack:   { label: 'HIJACK',   color: G.red,    bg: G.redBg,    icon: Skull,         border: G.redBd },
  security: { label: 'SECURITY', color: G.orange,  bg: G.orangeBg, icon: Shield,        border: 'rgba(249,115,22,0.3)' },
  medical:  { label: 'MEDICAL',  color: G.blue,    bg: G.blueBg,   icon: Activity,      border: 'rgba(59,130,246,0.3)' },
  silent:   { label: 'SILENT',   color: G.amber,   bg: G.amberBg,  icon: AlertTriangle, border: 'rgba(245,158,11,0.3)' },
  loud:     { label: 'LOUD',     color: G.red,     bg: G.redBg,    icon: Volume2,       border: G.redBd },
};

const PANIC_COLORS = {
  hijack: '#F25252', security: '#F59E0B', medical: '#60a5fa', silent: '#a78bfa', loud: '#F25252',
};
const getModeColor = m => PANIC_COLORS[m?.toLowerCase()] || '#F25252';

function getPanicConfig(mode) {
  return PANIC_MODE_CONFIG[mode?.toLowerCase()] || {
    label: (mode || 'UNKNOWN').toUpperCase(),
    color: G.red, bg: G.redBg, icon: AlertOctagon, border: G.redBd,
  };
}

function formatDuration(start, end) {
  const ms = new Date(end) - new Date(start);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function useElapsedSeconds(ts) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!ts) return;
    const update = () => setElapsed(Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
    update();
    const i = setInterval(update, 1000);
    return () => clearInterval(i);
  }, [ts]);
  return elapsed;
}

function ElapsedTimer({ since }) {
  const elapsed = useElapsedSeconds(since);
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  if (h > 0) return <>{h}:{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}</>;
  return <>{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}</>;
}

function ElapsedBadge({ ts, color }) {
  const elapsed = useElapsedSeconds(ts);
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  const label = h > 0
    ? `${h}h ${m}m ${s}s ago`
    : m > 0
      ? `${m}m ${s}s ago`
      : `${s}s ago`;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <Clock size={12} style={{ color: color || G.red }} />
      <span style={{ fontSize: 12, fontWeight: 700, color: color || G.red, fontFamily: 'IBM Plex Mono, monospace' }}>{label}</span>
    </div>
  );
}

function fmtRelative(ts) {
  if (!ts) return '—';
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function ActivePanicCard({ panic, onResolve, onMap }) {
  const mode = panic.mode || panic.panic_mode;
  const modeColor = getModeColor(mode);
  const cfg = getPanicConfig(mode);
  const ModeIcon = cfg.icon;

  return (
    <div style={{
      background: 'rgba(10,6,12,0.97)',
      border: '1px solid rgba(242,82,82,0.5)',
      borderRadius: 16,
      overflow: 'hidden',
      animation: 'panicBorder 1.2s ease-in-out infinite',
    }}>
      {/* Color stripe at top based on mode */}
      <div style={{
        height: 3,
        background: modeColor,
        boxShadow: `0 0 20px ${modeColor}`,
      }} />

      {/* Main content */}
      <div style={{ padding: 20 }}>
        {/* Mode badge + device name + elapsed */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <span style={{
              display: 'inline-block',
              padding: '4px 10px',
              borderRadius: 6,
              fontSize: 9,
              fontFamily: 'IBM Plex Mono, monospace',
              fontWeight: 800,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              background: `${modeColor}18`,
              border: `1px solid ${modeColor}40`,
              color: modeColor,
              marginBottom: 8,
            }}>
              {mode?.replace('_', ' ')}
            </span>
            <div style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>
              {panic.device_name || panic.device_id || 'Unknown Device'}
            </div>
            <div style={{ fontSize: 10, fontFamily: 'IBM Plex Mono, monospace', color: '#94a3b8', marginTop: 4 }}>
              {panic.device_model || '—'} · IMEI: {panic.device_imei ? panic.device_imei.slice(-6) : '—'}
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
            <div style={{
              fontSize: 22, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700,
              color: '#F25252', fontVariantNumeric: 'tabular-nums',
            }}>
              <ElapsedTimer since={panic.triggered_at || panic.created_at} />
            </div>
            <div style={{ fontSize: 8, color: '#475569', letterSpacing: '0.12em', fontFamily: 'IBM Plex Mono, monospace' }}>ELAPSED</div>
          </div>
        </div>

        {/* Location + battery row */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
          {panic.battery_level != null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Battery size={12} style={{ color: G.muted }} />
              <span style={{ fontSize: 10, fontFamily: 'IBM Plex Mono, monospace', color: '#94a3b8' }}>
                {panic.battery_level}%
              </span>
            </div>
          )}
          {panic.lat && (
            <div style={{ fontSize: 10, fontFamily: 'IBM Plex Mono, monospace', color: '#94a3b8' }}>
              {parseFloat(panic.lat).toFixed(5)}, {parseFloat(panic.lng).toFixed(5)}
            </div>
          )}
          {panic.message && (
            <div style={{ fontSize: 11, color: '#cbd5e1', fontStyle: 'italic', width: '100%' }}>
              "{panic.message}"
            </div>
          )}
          {!panic.lat && (
            <span style={{ fontSize: 10, color: G.low, fontFamily: 'IBM Plex Mono, monospace' }}>
              Location unavailable
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => onResolve(panic)}
            style={{
              flex: 1, padding: '10px 16px',
              background: 'rgba(34,211,160,0.1)', border: '1px solid rgba(34,211,160,0.3)',
              borderRadius: 10, color: '#22D3A0',
              fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, letterSpacing: '0.1em',
              cursor: 'pointer', transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(34,211,160,0.18)';
              e.currentTarget.style.borderColor = 'rgba(34,211,160,0.5)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(34,211,160,0.1)';
              e.currentTarget.style.borderColor = 'rgba(34,211,160,0.3)';
            }}
          >
            <CheckCircle size={13} />
            RESOLVE
          </button>
          {panic.lat && panic.lng && (
            <a
              href={`https://maps.google.com/?q=${panic.lat},${panic.lng}`}
              target="_blank"
              rel="noreferrer"
              style={{
                padding: '10px 16px',
                background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.3)',
                borderRadius: 10, color: '#60a5fa',
                fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, letterSpacing: '0.1em',
                cursor: 'pointer', transition: 'all 0.15s', textDecoration: 'none',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(96,165,250,0.18)';
                e.currentTarget.style.borderColor = 'rgba(96,165,250,0.5)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(96,165,250,0.1)';
                e.currentTarget.style.borderColor = 'rgba(96,165,250,0.3)';
              }}
            >
              <MapPin size={13} />
              MAP
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PanicCenterPage() {
  const [activePanics, setActivePanics] = useState([]);
  const [resolvedPanics, setResolvedPanics] = useState([]);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [activeRes, histRes] = await Promise.all([
        guardianAPI.panic({ active_only: 'true' }),
        guardianAPI.panic({ limit: 50 }),
      ]);
      setActivePanics(activeRes.data?.data || activeRes.data?.panics || []);
      const all = histRes.data?.data || histRes.data?.panics || [];
      setResolvedPanics(all.filter(p => p.resolved_at));
    } catch {
      // silent — don't spam toast on refresh
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    intervalRef.current = setInterval(load, 20000);
    return () => clearInterval(intervalRef.current);
  }, [load]);

  useEffect(() => {
    const onPanic = (data) => {
      const newPanic = {
        _id: data.panic_id || `local-${Date.now()}`,
        device_id: data.device_id,
        device_name: data.device_name || data.device_id,
        mode: data.mode || data.panic_mode || 'security',
        triggered_at: data.triggered_at || data.created_at || data.timestamp || new Date().toISOString(),
        lat: data.lat, lng: data.lng,
        battery_level: data.battery_level,
        resolved: false,
      };
      setActivePanics(prev => {
        if (prev.some(p => (p._id || p.id) === (newPanic._id || newPanic.id))) return prev;
        return [newPanic, ...prev];
      });
      toast.error(`PANIC: ${newPanic.device_name} — ${(newPanic.mode || 'UNKNOWN').toUpperCase()}`, {
        icon: '🚨',
        duration: 10000,
        style: { background: '#1a0000', border: '1px solid rgba(239,68,68,0.4)', color: '#fca5a5' },
      });
    };

    socketService.on('device:panic', onPanic);
    return () => socketService.off('device:panic', onPanic);
  }, []);

  async function handleResolve(panic) {
    const id = panic._id || panic.id;
    try {
      await guardianAPI.resolvePanic(id);
      setActivePanics(prev => prev.filter(p => (p._id || p.id) !== id));
      setResolvedPanics(prev => [
        { ...panic, resolved: true, resolved_at: new Date().toISOString() },
        ...prev,
      ].slice(0, 50));
      toast.success('Panic resolved');
    } catch {
      toast.error('Failed to resolve panic');
    }
  }

  function handleMap(panic) {
    window.open(`https://maps.google.com/?q=${panic.lat},${panic.lng}`, '_blank');
  }

  return (
    <div style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes glowDanger { 0%,100%{box-shadow:0 0 10px rgba(242,82,82,0.2)} 50%{box-shadow:0 0 28px rgba(242,82,82,0.5)} }
        @keyframes panicBorder { 0%,100%{box-shadow:0 0 0 0 rgba(242,82,82,0)} 50%{box-shadow:0 0 30px 4px rgba(242,82,82,0.18)} }
        @keyframes spin { to { transform: rotate(360deg) } }
      `}</style>

      {/* Page Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <div style={{
          width: 48, height: 48, borderRadius: 14,
          background: 'rgba(242,82,82,0.12)',
          border: '1px solid rgba(242,82,82,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: activePanics.length > 0 ? '0 0 20px rgba(242,82,82,0.3)' : 'none',
          animation: activePanics.length > 0 ? 'glowDanger 1s ease-in-out infinite' : 'none',
          flexShrink: 0,
        }}>
          <AlertOctagon size={22} style={{ color: '#F25252' }} />
        </div>
        <div>
          <div style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: '#475569', letterSpacing: '0.2em', marginBottom: 2 }}>
            EMERGENCY OPERATIONS
          </div>
          <h1 style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 22, fontWeight: 900, color: '#e2e8f0', letterSpacing: '0.15em', margin: 0 }}>
            PANIC CENTER
            {activePanics.length > 0 && (
              <span style={{ marginLeft: 12, fontSize: 13, color: '#F25252', animation: 'pulse 1s infinite', fontFamily: 'IBM Plex Mono, monospace' }}>
                {activePanics.length} ACTIVE
              </span>
            )}
          </h1>
          <p style={{ fontSize: 12, color: G.muted, margin: '2px 0 0' }}>
            {activePanics.length > 0
              ? `${activePanics.length} active SOS alert${activePanics.length > 1 ? 's' : ''} — immediate response required`
              : 'Emergency operations center — no active alerts'}
          </p>
        </div>
      </div>

      {/* Active panics */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 180 }}>
          <div style={{ width: 32, height: 32, border: '2px solid rgba(242,82,82,0.3)', borderTopColor: '#F25252', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        </div>
      ) : activePanics.length === 0 ? (
        <div style={{
          background: 'rgba(34,211,160,0.06)',
          border: '1px solid rgba(34,211,160,0.2)',
          borderRadius: 14, padding: '32px 24px', textAlign: 'center', marginBottom: 28,
        }}>
          <CheckCircle size={28} style={{ color: '#22D3A0', margin: '0 auto 10px' }} />
          <p style={{ fontSize: 15, fontWeight: 700, color: '#22D3A0', margin: '0 0 4px', fontFamily: 'Orbitron, sans-serif', letterSpacing: '0.08em' }}>ALL CLEAR</p>
          <p style={{ fontSize: 12, color: G.muted, margin: 0 }}>No active panic events at this time</p>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#F25252', animation: 'pulse 1s ease-in-out infinite' }} />
            <span style={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', color: '#F25252', letterSpacing: '0.15em', fontWeight: 700 }}>
              ACTIVE PANICS — {activePanics.length}
            </span>
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: 14, marginBottom: 32,
          }}>
            {activePanics.map(p => (
              <ActivePanicCard
                key={p._id || p.id || p.device_id}
                panic={p}
                onResolve={handleResolve}
                onMap={handleMap}
              />
            ))}
          </div>
        </>
      )}

      {/* Resolved history */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <CheckCircle size={14} style={{ color: G.muted }} />
          <span style={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', color: G.muted, letterSpacing: '0.15em', fontWeight: 700 }}>
            RESOLVED HISTORY
          </span>
          <span style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 5, padding: '1px 7px', fontSize: 9, color: G.low, fontFamily: 'IBM Plex Mono, monospace',
          }}>
            {resolvedPanics.length}
          </span>
        </div>

        {resolvedPanics.length === 0 ? (
          <div style={{
            background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 12, padding: '24px', textAlign: 'center',
          }}>
            <p style={{ fontSize: 12, color: G.low, margin: 0, fontFamily: 'IBM Plex Mono, monospace' }}>No resolved panics yet</p>
          </div>
        ) : (
          <div style={{ background: '#0D1321', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    {['Device', 'Mode', 'Triggered', 'Duration', 'Status'].map(h => (
                      <th key={h} style={{
                        padding: '10px 14px', textAlign: 'left',
                        color: '#475569', fontSize: 9, letterSpacing: '0.15em',
                        textTransform: 'uppercase', fontWeight: 700,
                      }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {resolvedPanics.map((p, i) => {
                    const modeColor = getModeColor(p.mode || p.panic_mode);
                    return (
                      <tr
                        key={p._id || p.id || i}
                        style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.015)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <td style={{ padding: '10px 14px', color: '#e2e8f0', fontWeight: 600 }}>
                          {p.device_name || p.device_id || '—'}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{
                            padding: '2px 8px', borderRadius: 5, fontSize: 9, fontWeight: 800,
                            letterSpacing: '0.1em',
                            background: `${modeColor}18`,
                            color: modeColor,
                            border: `1px solid ${modeColor}35`,
                          }}>
                            {(p.mode || p.panic_mode || 'unknown').toUpperCase()}
                          </span>
                        </td>
                        <td style={{ padding: '10px 14px', color: '#94a3b8' }}>
                          {new Date(p.triggered_at || p.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td style={{ padding: '10px 14px', color: '#94a3b8' }}>
                          {p.resolved_at ? formatDuration(p.triggered_at || p.created_at, p.resolved_at) : '—'}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{ fontSize: 9, fontWeight: 700, color: '#22D3A0', letterSpacing: '0.12em' }}>RESOLVED</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
