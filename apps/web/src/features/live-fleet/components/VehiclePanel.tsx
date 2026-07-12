import { useState } from 'react'
import type { ConvoyGroup, LiveVehicle, LiveStatus } from '../types/fleet.js'

const STATUS_COLOR: Record<LiveStatus, string> = {
  move: '#16c784', idle: '#f59e0b', stop: '#475569', offline: '#3e4252', sos: '#ef4444',
}

function fmtAgo(s: number): string {
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h`
}

function TruckIcon({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
      <rect x="1" y="3" width="15" height="13" rx="1"/>
      <path d="M16 8h4l3 5v3h-7V8z"/>
      <circle cx="5.5" cy="18.5" r="2.5"/>
      <circle cx="18.5" cy="18.5" r="2.5"/>
    </svg>
  )
}

function OfficerIcon({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
      <circle cx="12" cy="7.5" r="4.2"/>
      <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>
    </svg>
  )
}

function VehicleRow({ v, selected, onSelect }: { v: LiveVehicle; selected: boolean; onSelect: () => void }) {
  const color = STATUS_COLOR[v.status]
  const spd = Math.round(v.speed_kmh)
  const stale = v.secondsAgo > 1800
  return (
    <div onClick={onSelect} style={{
      display: 'grid', gridTemplateColumns: '38px 1fr 54px',
      alignItems: 'center', gap: 8,
      padding: '7px 14px 7px 22px',
      borderBottom: '1px solid rgba(255,255,255,.03)',
      cursor: 'pointer',
      background: selected ? 'rgba(232,168,48,.04)' : undefined,
      position: 'relative',
      transition: 'background .1s',
    }}>
      {selected && <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 2, background: '#e8a830' }} />}
      {v.status === 'sos' && (
        <div style={{ position: 'absolute', left: 22, top: 0, bottom: 0, width: 2, background: '#ef4444', animation: 'lf-sos-stripe .8s ease-in-out infinite' }} />
      )}

      {/* icon */}
      <div style={{
        width: 34, height: 34, borderRadius: v.kind === 'guardian' ? 17 : 7,
        background: v.status === 'move' ? 'rgba(22,199,132,.1)' : v.status === 'idle' ? 'rgba(245,158,11,.08)' : v.status === 'sos' ? 'rgba(239,68,68,.12)' : 'rgba(71,85,105,.1)',
        border: `1.5px solid ${color}33`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        {v.kind === 'guardian' ? <OfficerIcon color={color} /> : <TruckIcon color={color} />}
      </div>

      {/* info */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 1 }}>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, color: '#e8a830', fontWeight: 500 }}>
            {v.registration.slice(0, 8)}
          </span>
          {v.status === 'sos' && (
            <span style={{ fontSize: 8, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, color: '#ef4444', background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 2, padding: '1px 4px' }}>SOS</span>
          )}
        </div>
        <div style={{ fontSize: 10, color: '#7a7e8a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {v.lat != null ? `${v.lat.toFixed(4)}, ${v.lng!.toFixed(4)}` : 'No GPS fix'}
        </div>
      </div>

      {/* meta */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 14, fontWeight: 600, color: v.status === 'move' ? '#16c784' : v.status === 'sos' ? '#ef4444' : '#475569' }}>
          {spd}<span style={{ fontSize: 8, color: '#7a7e8a' }}> km/h</span>
        </div>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, color: stale ? '#ef4444' : '#3e4252' }}>
          {v.secondsAgo < 99999 ? fmtAgo(v.secondsAgo) : '—'}
        </div>
      </div>
    </div>
  )
}

function ConvoySection({ group, selectedId, onSelect }: {
  group: ConvoyGroup; selectedId: string | null; onSelect: (v: LiveVehicle) => void
}) {
  const [open, setOpen] = useState(true)
  const hasSos = group.vehicles.some(v => v.status === 'sos')
  const movingCount = group.vehicles.filter(v => v.status === 'move').length
  const isOfficerGroup = group.id === '__guardian'

  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,.06)' }}>
      <div onClick={() => setOpen(o => !o)} style={{
        display: 'flex', alignItems: 'center', gap: 9,
        padding: '8px 14px', cursor: 'pointer',
        background: 'none', position: 'relative',
        transition: 'background .1s',
      }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, background: hasSos ? '#ef4444' : '#e8a830' }} />
        <div style={{ width: 28, height: 28, borderRadius: isOfficerGroup ? 14 : 6, background: 'rgba(232,168,48,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {isOfficerGroup ? <OfficerIcon color="#e8a830" /> : <TruckIcon color="#e8a830" />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 14, fontWeight: 600, letterSpacing: '.02em', color: '#dfe0db', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {group.name}
          </div>
          <div style={{ fontSize: 10, color: '#7a7e8a', display: 'flex', alignItems: 'center', gap: 5, marginTop: 1 }}>
            {group.origin && group.destination && <span>{group.origin} → {group.destination}</span>}
            {hasSos && <span style={{ color: '#ef4444', fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace', fontSize: 9 }}>SOS</span>}
            {movingCount > 0 && <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, color: '#16c784', background: 'rgba(22,199,132,.08)', borderRadius: 3, padding: '1px 5px' }}>{movingCount} moving</span>}
          </div>
        </div>
        <svg style={{ color: '#3e4252', transform: open ? 'rotate(90deg)' : undefined, transition: 'transform .18s', flexShrink: 0 }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      </div>

      {open && group.vehicles.map(v => (
        <VehicleRow key={v.id} v={v} selected={selectedId === v.id} onSelect={() => onSelect(v)} />
      ))}
    </div>
  )
}

interface Props {
  groups: ConvoyGroup[]
  selectedId: string | null
  collapsed: boolean
  onToggleCollapse: () => void
  onSelect: (v: LiveVehicle) => void
}

export default function VehiclePanel({ groups, selectedId, collapsed, onToggleCollapse, onSelect }: Props) {
  const [search, setSearch] = useState('')

  const filtered = search.trim()
    ? groups.map(g => ({ ...g, vehicles: g.vehicles.filter(v => v.registration.toLowerCase().includes(search.toLowerCase())) })).filter(g => g.vehicles.length > 0)
    : groups

  return (
    <div style={{
      width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column',
      background: '#080b14', borderRight: '1px solid rgba(255,255,255,.08)',
      position: 'relative', zIndex: 100,
      marginLeft: collapsed ? -300 : 0,
      transition: 'margin-left .22s cubic-bezier(.4,0,.2,1)',
    }}>
      {/* collapse handle */}
      <div onClick={onToggleCollapse} style={{
        position: 'absolute', right: -14, top: '50%', transform: 'translateY(-50%)',
        width: 14, height: 48, background: '#0c1020',
        border: '1px solid rgba(255,255,255,.1)', borderLeft: 'none',
        borderRadius: '0 7px 7px 0',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', zIndex: 200, color: '#3e4252',
      }}>
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          {collapsed ? <polyline points="9 18 15 12 9 6"/> : <polyline points="15 18 9 12 15 6"/>}
        </svg>
      </div>

      {/* header */}
      <div style={{ padding: '10px 14px 0', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, fontWeight: 600, letterSpacing: '.1em', color: '#7a7e8a', textTransform: 'uppercase' }}>Convoys</span>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, color: '#e8a830', background: 'rgba(232,168,48,.1)', border: '1px solid rgba(232,168,48,.2)', borderRadius: 3, padding: '1px 7px' }}>
            {groups.length}
          </span>
        </div>
      </div>

      {/* search */}
      <div style={{ margin: '8px 12px 6px', display: 'flex', alignItems: 'center', gap: 7, background: '#0c1020', border: '1px solid rgba(255,255,255,.06)', borderRadius: 5, padding: '0 10px', height: 28, flexShrink: 0 }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#3e4252" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter vehicles or officers…" style={{ background: 'none', border: 'none', outline: 'none', fontFamily: 'inherit', fontSize: 12, color: '#dfe0db', flex: 1 }} />
      </div>

      {/* list */}
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 20 }}>
        {filtered.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: '#3e4252' }}>No vehicles</div>
        )}
        {filtered.map(g => (
          <ConvoySection key={g.id} group={g} selectedId={selectedId} onSelect={onSelect} />
        ))}
      </div>

      <style>{`
        @keyframes lf-sos-stripe{0%,100%{opacity:1}50%{opacity:.2}}
      `}</style>
    </div>
  )
}
