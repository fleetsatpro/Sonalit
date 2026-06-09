import { levelColor, levelBg, levelBorder } from '../utils/colors.js'
import type { RiskZone } from '../types/risk.js'

interface Props {
  zone: RiskZone
  x: number
  y: number
  onOpen: () => void
}

export default function MapPopup({ zone, x, y, onOpen }: Props) {
  const color = levelColor(zone.level)
  const bg = levelBg(zone.level)
  const border = levelBorder(zone.level)

  return (
    <div style={{
      position: 'absolute',
      left: x + 12,
      top: y - 30,
      background: '#0d1520',
      border: `1px solid ${border}`,
      borderRadius: 8,
      padding: '10px 12px',
      width: 200,
      pointerEvents: 'auto',
      zIndex: 20,
      boxShadow: '0 8px 32px rgba(0,0,0,.5)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <span style={{
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '.1em',
          color: '#F0B429',
          textTransform: 'uppercase',
        }}>{zone.zone_code}</span>
        <span style={{
          fontSize: 9,
          fontWeight: 700,
          color,
          background: bg,
          border: `1px solid ${border}`,
          borderRadius: 4,
          padding: '0 5px',
          textTransform: 'uppercase',
        }}>{zone.level}</span>
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#e8e6df', marginBottom: 2 }}>{zone.name}</div>
      <div style={{ fontSize: 10, color: '#9a9890', marginBottom: 8 }}>{zone.region}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: '#6e6c64' }}>Events 24h</span>
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, color }}>{zone.events_24h}</span>
      </div>
      <button
        onClick={onOpen}
        style={{
          width: '100%',
          padding: '5px',
          background: bg,
          border: `1px solid ${border}`,
          borderRadius: 5,
          cursor: 'pointer',
          fontSize: 10,
          fontWeight: 600,
          color,
        }}
      >View Details →</button>
    </div>
  )
}
