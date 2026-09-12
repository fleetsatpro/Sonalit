import { useEffect, useState } from 'react'
import type { StatusCounts, LiveStatus } from '../types/fleet.js'

const ITEMS: Array<{ key: keyof StatusCounts; label: string; color: string; bg: string }> = [
  { key: 'all',     label: 'ALL',     color: '#7a7e8a', bg: 'transparent' },
  { key: 'move',    label: 'MOVING',  color: '#16c784', bg: 'rgba(22,199,132,.08)' },
  { key: 'idle',    label: 'IDLE',    color: '#f59e0b', bg: 'rgba(245,158,11,.08)' },
  { key: 'stop',    label: 'STOPPED', color: '#475569', bg: 'transparent' },
  { key: 'sos',     label: 'SOS',     color: '#ef4444', bg: 'rgba(239,68,68,.08)' },
  { key: 'offline', label: 'OFFLINE', color: '#3e4252', bg: 'transparent' },
]

interface Props {
  counts: StatusCounts
  active: keyof StatusCounts | LiveStatus
  onFilter: (f: keyof StatusCounts) => void
}

export default function StatusStrip({ counts, active, onFilter }: Props) {
  const [clock, setClock] = useState('')

  useEffect(() => {
    const tick = () => {
      const now = new Date()
      const h = String(now.getHours()).padStart(2, '0')
      const m = String(now.getMinutes()).padStart(2, '0')
      const s = String(now.getSeconds()).padStart(2, '0')
      setClock(`${h}:${m}:${s} EAT`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div style={{
      height: 30, flexShrink: 0,
      display: 'flex', alignItems: 'center',
      background: 'rgba(5,7,13,.9)',
      borderBottom: '1px solid rgba(255,255,255,.06)',
      overflowX: 'auto', scrollbarWidth: 'none',
      paddingLeft: 52,
    }}>
      {ITEMS.map(it => {
        const on = active === it.key
        return (
          <button key={it.key} onClick={() => onFilter(it.key)} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '0 14px', height: '100%',
            background: on ? 'rgba(255,255,255,.04)' : 'none',
            border: 'none', borderRight: '1px solid rgba(255,255,255,.06)',
            cursor: 'pointer', flexShrink: 0,
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: it.color,
              boxShadow: it.key === 'sos' ? `0 0 5px ${it.color}` : undefined,
            }} />
            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, fontWeight: 600, color: it.color }}>
              {counts[it.key]}
            </span>
            <span style={{ fontSize: 11, color: 'rgba(122,126,138,.6)' }}>{it.label}</span>
          </button>
        )
      })}

      <div style={{ marginLeft: 'auto', padding: '0 14px', display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
        <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#16c784', animation: 'lf-pulse 1s ease-in-out infinite' }} />
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, color: 'rgba(122,126,138,.7)' }}>{clock}</span>
      </div>

      <style>{`@keyframes lf-pulse{0%,100%{opacity:1}50%{opacity:.25}}`}</style>
    </div>
  )
}
