import { useState } from 'react'
import { levelColor, levelBg, levelBorder } from '../utils/colors.js'
import { useZoneEvents } from '../hooks/useZoneEvents.js'
import AnalyticsTab from './AnalyticsTab.js'
import ConvoysTab from './ConvoysTab.js'
import type { RiskZone } from '../types/risk.js'

interface Props {
  zone: RiskZone | null
  onClose: () => void
  isMobile?: boolean
}

const TABS = ['overview', 'analytics', 'convoys'] as const
type Tab = typeof TABS[number]

export default function DetailDrawer({ zone, onClose, isMobile = false }: Props) {
  const [tab, setTab] = useState<Tab>('overview')
  const { data: evData } = useZoneEvents(zone?.id ?? null)
  const events = evData?.events ?? []

  const visible = !!zone

  const drawerStyle: React.CSSProperties = isMobile ? {
    position: 'fixed',
    inset: 0,
    background: '#0d1520',
    zIndex: 60,
    transform: visible ? 'translateY(0)' : 'translateY(100%)',
    transition: 'transform .25s cubic-bezier(.4,0,.2,1)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  } : {
    position: 'fixed',
    top: 0,
    right: 0,
    bottom: 0,
    width: 360,
    background: '#0d1520',
    borderLeft: '1px solid rgba(255,255,255,.08)',
    zIndex: 50,
    transform: visible ? 'translateX(0)' : 'translateX(100%)',
    transition: 'transform .25s cubic-bezier(.4,0,.2,1)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  }

  if (!zone) {
    return <div style={drawerStyle} />
  }

  const color = levelColor(zone.level)
  const bg = levelBg(zone.level)
  const border = levelBorder(zone.level)

  return (
    <div style={drawerStyle}>
      {/* Header */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,.07)', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{
                fontFamily: 'IBM Plex Mono, monospace',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '.12em',
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
                padding: '1px 6px',
                textTransform: 'uppercase',
              }}>{zone.level}</span>
            </div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#e8e6df' }}>{zone.name}</h3>
            <div style={{ fontSize: 11, color: '#6e6c64', marginTop: 2 }}>{zone.region}</div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#6e6c64',
              cursor: 'pointer',
              fontSize: 18,
              lineHeight: 1,
              padding: 4,
            }}
          >✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, marginTop: 10 }}>
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: tab === t ? `2px solid ${color}` : '2px solid transparent',
                color: tab === t ? color : '#6e6c64',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: tab === t ? 600 : 400,
                padding: '4px 10px',
                textTransform: 'capitalize',
                transition: 'color .15s',
              }}
            >{t}</button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {tab === 'overview' && (
          <div style={{ padding: '16px' }}>
            {zone.why && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: '#6e6c64', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.08em' }}>Situation</div>
                <p style={{ margin: 0, fontSize: 12, color: '#c8c6bf', lineHeight: 1.65 }}>{zone.why}</p>
              </div>
            )}
            {zone.when_active && (
              <div style={{ marginBottom: 14, padding: '8px 12px', background: 'rgba(255,255,255,.03)', borderRadius: 6 }}>
                <div style={{ fontSize: 10, color: '#6e6c64', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.08em' }}>Active Window</div>
                <div style={{ fontSize: 12, color: '#e8e6df' }}>{zone.when_active}</div>
              </div>
            )}
            {zone.precaution && (
              <div style={{ padding: '10px 12px', background: 'rgba(240,180,41,.06)', border: '1px solid rgba(240,180,41,.18)', borderRadius: 6 }}>
                <div style={{ fontSize: 10, color: '#F0B429', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.08em' }}>Precaution</div>
                <p style={{ margin: 0, fontSize: 12, color: '#e8e6df', lineHeight: 1.6 }}>{zone.precaution}</p>
              </div>
            )}
            {zone.tags?.length > 0 && (
              <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {zone.tags.map(tag => (
                  <span key={tag} style={{
                    fontSize: 10,
                    color: '#9a9890',
                    background: 'rgba(255,255,255,.06)',
                    border: '1px solid rgba(255,255,255,.08)',
                    borderRadius: 4,
                    padding: '2px 7px',
                  }}>{tag}</span>
                ))}
              </div>
            )}
          </div>
        )}
        {tab === 'analytics' && <AnalyticsTab zone={zone} events={events} />}
        {tab === 'convoys' && <ConvoysTab zone={zone} />}
      </div>
    </div>
  )
}
