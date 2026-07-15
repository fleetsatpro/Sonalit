import type { LiveVehicle, LiveStatus } from '../types/fleet.js'

const STATUS_COLOR: Record<LiveStatus, string> = {
  move: '#16c784', idle: '#f59e0b', stop: '#475569', offline: '#3e4252', sos: '#ef4444',
}
const STATUS_LABEL: Record<LiveStatus, string> = {
  move: 'MOVING', idle: 'IDLE', stop: 'STOPPED', offline: 'OFFLINE', sos: 'SOS ACTIVE',
}

function fmtHeading(h: number | null): string {
  if (h == null) return '—°'
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']
  return `${Math.round(h)}° ${dirs[Math.round(h / 22.5) % 16]}`
}

function fmtAgo(s: number): string {
  if (s > 99000) return '—'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

/** device_health stores -1/NULL for "unknown" — never render a fabricated value. */
function pct(v: number | null | undefined): number | null {
  return v != null && v >= 0 ? v : null
}

function HealthBar({ label, value }: { label: string; value: number | null }) {
  const color = value == null ? '#3e4252' : value < 20 ? '#ef4444' : value < 50 ? '#f59e0b' : '#16c784'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, color: '#7a7e8a', width: 24, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,.06)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${value ?? 0}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, fontWeight: 600, color, width: 30, textAlign: 'right', flexShrink: 0 }}>
        {value == null ? '—' : `${value}%`}
      </span>
    </div>
  )
}

interface Props {
  vehicle: LiveVehicle | null
  onClose: () => void
}

export default function DetailCard({ vehicle: v, onClose }: Props) {
  if (!v) return null

  const color = STATUS_COLOR[v.status]
  const isSos = v.status === 'sos'

  return (
    <div style={{
      position: 'absolute', right: 14, top: 14, zIndex: 800,
      width: 276, background: 'rgba(8,11,20,.97)',
      border: `1px solid ${isSos ? 'rgba(239,68,68,.4)' : 'rgba(255,255,255,.11)'}`,
      borderRadius: 12,
      boxShadow: isSos ? '0 24px 64px rgba(0,0,0,.85),0 0 24px rgba(239,68,68,.12)' : '0 24px 64px rgba(0,0,0,.85)',
      backdropFilter: 'blur(12px)',
      overflow: 'hidden',
    }}>
      {/* accent left */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: color }} />

      {/* header */}
      <div style={{ padding: '12px 14px 10px 17px', display: 'flex', alignItems: 'flex-start', gap: 10, borderBottom: '1px solid rgba(255,255,255,.07)' }}>
        <div style={{ width: 36, height: 36, borderRadius: v.kind === 'guardian' ? 18 : 8, background: isSos ? 'rgba(239,68,68,.1)' : 'rgba(255,255,255,.04)', border: `1.5px solid ${color}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {v.kind === 'guardian' ? (
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
              <circle cx="12" cy="7.5" r="4.2"/>
              <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
              <rect x="1" y="3" width="15" height="13" rx="1"/>
              <path d="M16 8h4l3 5v3h-7V8z"/>
              <circle cx="5.5" cy="18.5" r="2.5"/>
              <circle cx="18.5" cy="18.5" r="2.5"/>
            </svg>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 17, fontWeight: 700, letterSpacing: '.03em', color: '#dfe0db' }}>{v.registration}</div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, color: '#7a7e8a', marginTop: 2 }}>
            {v.kind === 'guardian' ? 'Field Officer · Guardian Device' : (v.convoy_name ?? 'Standalone')}
          </div>
          <div style={{ marginTop: 4, display: 'inline-flex', fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, fontWeight: 700, letterSpacing: '.08em', padding: '2px 7px', borderRadius: 3, color, background: `${color}18`, border: `1px solid ${color}44` }}>
            {STATUS_LABEL[v.status]}
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#3e4252', cursor: 'pointer', fontSize: 16, padding: 2, lineHeight: 1 }}>✕</button>
      </div>

      {/* metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
        {[
          { label: 'Speed', value: `${Math.round(v.speed_kmh)}`, unit: 'km/h', color: v.status === 'move' ? '#16c784' : v.status === 'sos' ? '#ef4444' : '#dfe0db' },
          { label: 'Heading', value: fmtHeading(v.heading), unit: '', color: '#e8a830' },
          { label: 'Last ping', value: fmtAgo(v.secondsAgo), unit: '', color: v.secondsAgo > 1800 ? '#ef4444' : '#dfe0db' },
        ].map(m => (
          <div key={m.label} style={{ padding: '10px 12px', borderRight: '1px solid rgba(255,255,255,.07)' }}>
            <div style={{ fontSize: 9, color: '#3e4252', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 3 }}>{m.label}</div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: m.value.length > 6 ? 12 : 17, fontWeight: 600, color: m.color, lineHeight: 1.2 }}>
              {m.value}{m.unit && <span style={{ fontSize: 9, color: '#3e4252', fontWeight: 400 }}> {m.unit}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* device health — Guardian devices only; vehicles have no battery/signal telemetry */}
      {v.kind === 'guardian' && (
        <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,.07)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 9, color: '#3e4252', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 2 }}>Device Health</div>
          <HealthBar label="BAT" value={pct(v.battery_level)} />
          <HealthBar label="SIG" value={pct(v.signal_strength)} />
        </div>
      )}

      {/* location */}
      {v.lat != null && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,.07)', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#7a7e8a' }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#e8a830" strokeWidth="2"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5" fill="#e8a830" stroke="none"/></svg>
          {v.lat.toFixed(5)}, {v.lng!.toFixed(5)}
        </div>
      )}

      {/* actions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, padding: '9px 10px' }}>
        {[
          { label: 'Call', icon: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.1 19.79 19.79 0 0 1 1.61 4.53 2 2 0 0 1 3.58 2.34h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.91A16 16 0 0 0 14 16l.91-.91a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 17z', danger: false },
          { label: 'Msg', icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z', danger: false },
          { label: 'Track', icon: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z', danger: false },
          { label: 'Alert', icon: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01', danger: true },
        ].map(a => (
          <button key={a.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '7px 4px', borderRadius: 7, cursor: 'pointer', background: a.danger ? 'rgba(239,68,68,.07)' : 'rgba(255,255,255,.04)', border: `1px solid ${a.danger ? 'rgba(239,68,68,.2)' : 'rgba(255,255,255,.06)'}`, color: a.danger ? '#fca5a5' : '#7a7e8a', fontSize: 10, fontFamily: 'inherit', transition: 'all .12s' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={a.icon}/></svg>
            {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}
