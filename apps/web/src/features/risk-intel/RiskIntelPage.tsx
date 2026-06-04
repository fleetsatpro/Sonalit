import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../../stores/auth.js'
import { api } from '../../lib/api.js'
import { useRiskZones } from './hooks/useRiskZones.js'
import { useRiskRealtime } from './hooks/useRiskRealtime.js'
import { levelColor } from './utils/colors.js'
import ContinentBar from './components/ContinentBar.js'
import LiveTicker from './components/LiveTicker.js'
import ThreatList from './components/ThreatList.js'
import RiskMap from './components/RiskMap.js'
import DetailDrawer from './components/DetailDrawer.js'
import type { Continent, RiskLevel } from './types/risk.js'

export default function RiskIntelPage() {
  const queryClient = useQueryClient()
  const user = useAuthStore(s => s.user)
  const orgId = user?.org_id ?? ''

  const [activeCont, setActiveCont]       = useState<Continent>('global')
  const [levelFilter, setLevelFilter]     = useState<RiskLevel | 'all'>('all')
  const [activeZoneId, setActiveZoneId]   = useState<string | null>(null)
  const [heatVisible, setHeatVisible]     = useState(true)
  const [activeTab, setActiveTab]         = useState<'map' | 'list'>('map')

  const { data, isLoading } = useRiskZones(activeCont, levelFilter)
  const zones = data?.zones ?? []
  const counts = data?.counts ?? { high: 0, medium: 0, low: 0, total: 0 }

  useRiskRealtime(orgId, queryClient)

  const activeZone = zones.find(z => z.id === activeZoneId) ?? null

  const handleExport = async () => {
    const params = new URLSearchParams()
    if (activeCont !== 'global') params.set('continent', activeCont)
    if (levelFilter !== 'all') params.set('level', levelFilter)
    const res = await api.get(`/risk/export?${params}`, { responseType: 'blob' })
    const url = URL.createObjectURL(res.data as Blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `risk-intel-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: '#0a1220',
      color: '#e8e6df',
      fontFamily: 'Inter, system-ui, sans-serif',
      overflow: 'hidden',
    }}>
      {/* Top header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        borderBottom: '1px solid rgba(255,255,255,.07)',
        flexShrink: 0,
        background: '#0d1520',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#E24B4A', boxShadow: '0 0 8px #E24B4A' }} />
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#F0B429' }}>
            Risk Intelligence
          </span>
        </div>

        {/* Stats bar */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          {isLoading ? (
            <span style={{ fontSize: 11, color: '#4e4c44' }}>Loading…</span>
          ) : (
            <>
              {(['high', 'medium', 'low'] as RiskLevel[]).map(level => (
                <div key={level} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: levelColor(level) }} />
                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, color: levelColor(level) }}>
                    {counts[level]}
                  </span>
                  <span style={{ fontSize: 10, color: '#4e4c44', textTransform: 'capitalize' }}>{level}</span>
                </div>
              ))}
              <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,.1)' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, color: '#9a9890' }}>{counts.total}</span>
                <span style={{ fontSize: 10, color: '#4e4c44' }}>total</span>
              </div>
            </>
          )}
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setHeatVisible(v => !v)}
            style={{
              padding: '4px 10px',
              background: heatVisible ? 'rgba(240,180,41,.12)' : 'rgba(255,255,255,.04)',
              border: `1px solid ${heatVisible ? 'rgba(240,180,41,.3)' : 'rgba(255,255,255,.08)'}`,
              borderRadius: 5,
              cursor: 'pointer',
              fontSize: 10,
              color: heatVisible ? '#F0B429' : '#6e6c64',
            }}
          >Heat</button>
          <button
            onClick={handleExport}
            style={{
              padding: '4px 10px',
              background: 'rgba(255,255,255,.04)',
              border: '1px solid rgba(255,255,255,.08)',
              borderRadius: 5,
              cursor: 'pointer',
              fontSize: 10,
              color: '#9a9890',
            }}
          >Export CSV</button>
        </div>
      </div>

      {/* Live ticker */}
      <LiveTicker />

      {/* Continent bar */}
      <ContinentBar active={activeCont} zones={zones} onChange={setActiveCont} />

      {/* Mobile tab switcher */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid rgba(255,255,255,.06)',
        flexShrink: 0,
      }}
        className="lg:hidden"
      >
        {(['map', 'list'] as const).map(t => (
          <button key={t} onClick={() => setActiveTab(t)} style={{
            flex: 1, padding: '7px', background: 'none',
            border: 'none', borderBottom: activeTab === t ? '2px solid #F0B429' : '2px solid transparent',
            cursor: 'pointer', fontSize: 11, fontWeight: 600,
            color: activeTab === t ? '#F0B429' : '#6e6c64',
            textTransform: 'capitalize',
          }}>{t}</button>
        ))}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        {/* Left panel — threat list */}
        <div style={{
          width: 280,
          borderRight: '1px solid rgba(255,255,255,.06)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          flexShrink: 0,
        }}>
          <ThreatList
            zones={zones}
            levelFilter={levelFilter}
            activeId={activeZoneId}
            onSelect={id => setActiveZoneId(id === activeZoneId ? null : id)}
            onLevelChange={setLevelFilter}
          />
        </div>

        {/* Right panel — map */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {isLoading && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5, pointerEvents: 'none' }}>
              <span style={{ fontSize: 12, color: '#4e4c44' }}>Loading threat data…</span>
            </div>
          )}
          <RiskMap
            zones={zones}
            activeCont={activeCont}
            activeZoneId={activeZoneId}
            heatVisible={heatVisible}
            onZoneClick={id => setActiveZoneId(id === activeZoneId ? null : id)}
          />
        </div>

        {/* Detail drawer */}
        <DetailDrawer
          zone={activeZone}
          onClose={() => setActiveZoneId(null)}
        />
      </div>
    </div>
  )
}
