import Sparkline from './Sparkline.js'
import { levelColor, levelBg, levelBorder } from '../utils/colors.js'
import type { RiskZone } from '../types/risk.js'
import { IconTrendingUp, IconTrendingDown, IconMinus } from '@tabler/icons-react'

interface Props {
  zone: RiskZone
  active: boolean
  onClick: () => void
}

function VelocityIcon({ v }: { v: string }) {
  if (v === 'rising')  return <IconTrendingUp size={11} color="#E24B4A" />
  if (v === 'falling') return <IconTrendingDown size={11} color="#4ade80" />
  return <IconMinus size={11} color="#6e6c64" />
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function ThreatCard({ zone, active, onClick }: Props) {
  const color = levelColor(zone.level)
  return (
    <div
      onClick={onClick}
      style={{
        display: 'grid',
        gridTemplateColumns: '3px 1fr auto',
        background: active ? levelBg(zone.level) : '#111927',
        border: `1px solid ${active ? levelBorder(zone.level) : 'rgba(255,255,255,.06)'}`,
        borderRadius: 8,
        overflow: 'hidden',
        cursor: 'pointer',
        marginBottom: 6,
        transition: 'background .2s',
      }}
    >
      {/* Colour bar */}
      <div style={{ background: color }} />
      {/* Body */}
      <div style={{ padding: '10px 10px 8px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, color: '#6e6c64' }}>{zone.zone_code}</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#e8e6de', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{zone.name}</span>
          <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: levelBg(zone.level), color, border: `1px solid ${levelBorder(zone.level)}`, textTransform: 'uppercase', flexShrink: 0 }}>{zone.level}</span>
        </div>
        <div style={{ fontSize: 10, color: '#6e6c64', marginBottom: 4 }}>📍 {zone.region}</div>
        <div style={{ fontSize: 11, color: '#9a9890', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: 1.4, marginBottom: 6 }}>{zone.why}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {(zone.tags ?? []).slice(0, 2).map(t => (
            <span key={t} style={{ fontSize: 9, padding: '1px 6px', borderRadius: 10, background: 'rgba(255,255,255,.06)', color: '#9a9890' }}>{t}</span>
          ))}
          <span style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: 'auto' }}>
            <VelocityIcon v={zone.velocity} />
            <span style={{ fontSize: 9, color: '#6e6c64' }}>{zone.velocity}</span>
          </span>
          <Sparkline data={(zone.week_data ?? []).length ? zone.week_data : [0,0,0,0,0,0,0]} color={color} />
        </div>
      </div>
      {/* Meta */}
      <div style={{ padding: '10px 12px', textAlign: 'center', borderLeft: '1px solid rgba(255,255,255,.06)', minWidth: 54 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color, fontFamily: 'Orbitron, sans-serif', lineHeight: 1 }}>{zone.events}</div>
        <div style={{ fontSize: 8, color: '#6e6c64', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>events</div>
        <div style={{ fontSize: 9, color: '#6e6c64' }}>{relTime(zone.updated_at)}</div>
      </div>
    </div>
  )
}
