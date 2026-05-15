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

function getPanicConfig(mode) {
  return PANIC_MODE_CONFIG[mode?.toLowerCase()] || {
    label: (mode || 'UNKNOWN').toUpperCase(),
    color: G.red, bg: G.redBg, icon: AlertOctagon, border: G.redBd,
  };
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
      <span style={{ fontSize: 12, fontWeight: 700, color: color || G.red, fontFamily: 'monospace' }}>{label}</span>
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
  const cfg = getPanicConfig(panic.mode || panic.panic_mode);
  const ModeIcon = cfg.icon;

  return (
    <div style={{
      background: cfg.bg,
      border: `1px solid ${cfg.border}`,
      borderRadius: 16,
      padding: '20px 22px',
      animation: 'panicCardPulse 2s ease-in-out infinite',
      boxShadow: `0 0 30px ${cfg.bg}`,
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%', background: cfg.bg,
              border: `2px solid ${cfg.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, animation: 'pulse 1s ease-in-out infinite',
            }}>
              <ModeIcon size={15} style={{ color: cfg.color }} />
            </div>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 800, color: G.text, margin: 0, lineHeight: 1 }}>
                {panic.device_name || panic.device_id || 'Unknown Device'}
              </h3>
              <span style={{
                fontSize: 10, fontWeight: 700, color: cfg.color, fontFamily: 'monospace',
                letterSpacing: '0.12em',
              }}>
                {cfg.label} MODE
              </span>
            </div>
          </div>
        </div>

        {/* Pulsing SOS indicator */}
        <div style={{
          background: cfg.bg, border: `1px solid ${cfg.border}`,
          borderRadius: 8, padding: '4px 12px',
          animation: 'pulse 1s ease-in-out infinite',
        }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: cfg.color, fontFamily: 'monospace', letterSpacing: '0.15em' }}>
            SOS
          </span>
        </div>
      </div>

      {/* Info grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div>
          <p style={{ fontSize: 9, color: G.low, fontFamily: 'monospace', letterSpacing: '0.12em', marginBottom: 3 }}>TRIGGERED</p>
          <ElapsedBadge ts={panic.triggered_at || panic.created_at} color={cfg.color} />
        </div>
        <div>
          <p style={{ fontSize: 9, color: G.low, fontFamily: 'monospace', letterSpacing: '0.12em', marginBottom: 3 }}>BATTERY AT TRIGGER</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Battery size={12} style={{ color: G.muted }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: G.text, fontFamily: 'monospace' }}>
              {panic.battery_level != null ? `${panic.battery_level}%` : '—'}
            </span>
          </div>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <p style={{ fontSize: 9, color: G.low, fontFamily: 'monospace', letterSpacing: '0.12em', marginBottom: 3 }}>LAST KNOWN LOCATION</p>
          {panic.lat && panic.lng ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <MapPin size={12} style={{ color: G.muted }} />
              <span style={{ fontSize: 12, fontFamily: 'monospace', color: G.text }}>
                {Number(panic.lat).toFixed(6)}, {Number(panic.lng).toFixed(6)}
              </span>
            </div>
          ) : (
            <span style={{ fontSize: 11, color: G.low }}>Location unavailable</span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => onResolve(panic)}
          style={{
            flex: 1, background: G.greenBg, border: `1px solid ${G.green}30`,
            borderRadius: 10, padding: '10px 0', fontSize: 11, fontWeight: 700,
            color: G.green, cursor: 'pointer', letterSpacing: '0.08em',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(34,197,94,0.15)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = G.greenBg; }}
        >
          <CheckCircle size={13} />
          RESOLVE
        </button>
        {panic.lat && panic.lng && (
          <button
            onClick={() => onMap(panic)}
            style={{
              flex: 1, background: G.cyanBg, border: `1px solid ${G.cyan}30`,
              borderRadius: 10, padding: '10px 0', fontSize: 11, fontWeight: 700,
              color: G.cyan, cursor: 'pointer', letterSpacing: '0.08em',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(34,211,160,0.15)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = G.cyanBg; }}
          >
            <MapPin size={13} />
            MAP LOCATE
          </button>
        )}
      </div>
    </div>
  );
}

function ResolvedRow({ panic, idx }) {
  const cfg = getPanicConfig(panic.mode || panic.panic_mode);
  return (
    <tr style={{ background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
      <td style={{ padding: '10px 14px', fontSize: 12, color: G.text }}>
        {panic.device_name || panic.device_id || '—'}
      </td>
      <td style={{ padding: '10px 14px' }}>
        <span style={{
          background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`,
          borderRadius: 5, padding: '1px 7px', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', fontFamily: 'monospace',
        }}>
          {cfg.label}
        </span>
      </td>
      <td style={{ padding: '10px 14px', fontSize: 11, color: G.muted, fontFamily: 'monospace' }}>
        {fmtDate(panic.triggered_at || panic.created_at)}
      </td>
      <td style={{ padding: '10px 14px', fontSize: 11, color: G.muted, fontFamily: 'monospace' }}>
        {fmtDate(panic.resolved_at)}
      </td>
      <td style={{ padding: '10px 14px', fontSize: 11, color: G.muted }}>
        {panic.resolved_by || '—'}
      </td>
      <td style={{ padding: '10px 14px' }}>
        <span style={{
          background: G.greenBg, color: G.green, border: `1px solid ${G.green}25`,
          borderRadius: 5, padding: '1px 7px', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', fontFamily: 'monospace',
        }}>
          RESOLVED
        </span>
      </td>
    </tr>
  );
}

export default function PanicCenterPage() {
  const [panics, setPanics] = useState([]);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await guardianAPI.panic();
      const all = res.data?.data || res.data?.panics || res.data || [];
      setPanics(all);
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
        triggered_at: data.timestamp || new Date().toISOString(),
        lat: data.lat, lng: data.lng,
        battery_level: data.battery_level,
        resolved: false,
      };
      setPanics(prev => [newPanic, ...prev]);
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
      setPanics(prev => prev.map(p =>
        (p._id || p.id) === id
          ? { ...p, resolved: true, resolved_at: new Date().toISOString() }
          : p
      ));
      toast.success('Panic resolved');
    } catch {
      toast.error('Failed to resolve panic');
    }
  }

  function handleMap(panic) {
    window.open(`https://maps.google.com/?q=${panic.lat},${panic.lng}`, '_blank');
  }

  const active   = panics.filter(p => !p.resolved && !p.resolved_at);
  const resolved = panics.filter(p => p.resolved || p.resolved_at).slice(0, 50);

  return (
    <div style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes panicCardPulse { 0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0.1)} 50%{box-shadow:0 0 30px 4px rgba(239,68,68,0.2)} }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28 }}>
        <div style={{ position: 'relative' }}>
          <AlertOctagon size={28} style={{ color: G.red }} />
          {active.length > 0 && (
            <div style={{
              position: 'absolute', top: -4, right: -4,
              width: 12, height: 12, borderRadius: '50%', background: G.red,
              border: `2px solid ${G.bg}`,
              animation: 'pulse 1s ease-in-out infinite',
            }} />
          )}
        </div>
        <div>
          <h1 style={{
            fontSize: 24, fontWeight: 900, color: G.red,
            fontFamily: 'monospace', letterSpacing: '0.12em', margin: 0,
            textShadow: `0 0 30px ${G.red}60`,
          }}>
            PANIC CENTER
          </h1>
          <p style={{ fontSize: 12, color: G.muted, margin: 0 }}>
            {active.length > 0
              ? `${active.length} active SOS alert${active.length > 1 ? 's' : ''} — immediate response required`
              : 'Emergency operations center — no active alerts'}
          </p>
        </div>
      </div>

      {/* Active panics */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 180 }}>
          <div style={{ width: 32, height: 32, border: `2px solid ${G.red}30`, borderTopColor: G.red, borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      ) : active.length === 0 ? (
        <div style={{
          background: G.greenBg, border: `1px solid ${G.green}25`,
          borderRadius: 14, padding: '32px 24px', textAlign: 'center', marginBottom: 28,
        }}>
          <CheckCircle size={28} style={{ color: G.green, margin: '0 auto 10px' }} />
          <p style={{ fontSize: 15, fontWeight: 700, color: G.green, margin: '0 0 4px' }}>All Clear</p>
          <p style={{ fontSize: 12, color: G.muted, margin: 0 }}>No active panic events at this time</p>
        </div>
      ) : (
        <>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14,
          }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: G.red, animation: 'pulse 1s ease-in-out infinite' }} />
            <span style={{ fontSize: 11, fontFamily: 'monospace', color: G.red, letterSpacing: '0.15em', fontWeight: 700 }}>
              ACTIVE PANICS — {active.length}
            </span>
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 14, marginBottom: 32,
          }}>
            {active.map(p => (
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
          <span style={{ fontSize: 11, fontFamily: 'monospace', color: G.muted, letterSpacing: '0.15em', fontWeight: 700 }}>
            RESOLVED HISTORY
          </span>
          <span style={{
            background: G.card, border: `1px solid ${G.border}`,
            borderRadius: 5, padding: '1px 7px', fontSize: 9, color: G.low, fontFamily: 'monospace',
          }}>
            {resolved.length}
          </span>
        </div>

        {resolved.length === 0 ? (
          <div style={{
            background: G.card, border: `1px solid ${G.border}`,
            borderRadius: 12, padding: '24px', textAlign: 'center',
          }}>
            <p style={{ fontSize: 12, color: G.low, margin: 0 }}>No resolved panics yet</p>
          </div>
        ) : (
          <div style={{ background: G.card, border: `1px solid ${G.border}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${G.border}` }}>
                    {['DEVICE', 'MODE', 'TRIGGERED', 'RESOLVED', 'BY', 'STATUS'].map(h => (
                      <th key={h} style={{
                        padding: '10px 14px', textAlign: 'left', fontSize: 9,
                        fontFamily: 'monospace', color: G.low, letterSpacing: '0.12em',
                        fontWeight: 700,
                      }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {resolved.map((p, i) => (
                    <ResolvedRow key={p._id || p.id || i} panic={p} idx={i} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
