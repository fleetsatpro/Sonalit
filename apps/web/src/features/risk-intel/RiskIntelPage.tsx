import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../../stores/auth.js'
import { api } from '../../lib/api.js'
import { useRiskZones } from './hooks/useRiskZones.js'
import { useRiskRealtime } from './hooks/useRiskRealtime.js'
import { levelColor } from './utils/colors.js'
import ContinentBar from './components/ContinentBar.js'
import LiveTicker from './components/LiveTicker.js'
import LiveFeedPanel from './components/LiveFeedPanel.js'
import ThreatList from './components/ThreatList.js'
import RiskMap from './components/RiskMap.js'
import DetailDrawer from './components/DetailDrawer.js'
import type { Continent, RiskLevel } from './types/risk.js'

function useIsMobile() {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1024)
  useEffect(() => {
    const fn = () => setMobile(window.innerWidth < 1024)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])
  return mobile
}

export default function RiskIntelPage() {
  const queryClient = useQueryClient()
  const user = useAuthStore(s => s.user)
  const orgId = user?.org_id ?? ''
  const isMobile = useIsMobile()

  const [activeCont, setActiveCont]     = useState<Continent>('global')
  const [levelFilter, setLevelFilter]   = useState<RiskLevel | 'all'>('all')
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null)
  const [heatVisible, setHeatVisible]   = useState(true)
  const [activeTab, setActiveTab]       = useState<'map' | 'list' | 'feed'>('list')
  const [refreshState, setRefreshState] = useState<'idle' | 'refreshing' | 'done'>('idle')

  const { data, isLoading } = useRiskZones(activeCont, levelFilter)
  const zones  = data?.zones  ?? []
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

  const handleRefreshIntel = async () => {
    if (refreshState === 'refreshing') return
    setRefreshState('refreshing')
    try {
      await api.post('/risk/refresh-intel')
    } catch {
      // fall through — still worth re-polling in case it started server-side
    }
    // The sweep runs in the background (external OSINT calls can take
    // ~1 min) — give it time to land before refetching.
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ['risk-zones'] })
      queryClient.invalidateQueries({ queryKey: ['risk-ticker'] })
      queryClient.invalidateQueries({ queryKey: ['risk-live-feed'] })
      setRefreshState('done')
      setTimeout(() => setRefreshState('idle'), 3000)
    }, 25000)
  }

  const handleZoneSelect = (id: string) => {
    setActiveZoneId(id === activeZoneId ? null : id)
    // On mobile, selecting a zone while in list view keeps list visible;
    // selecting from map popup switches to show the drawer via map view
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

      {/* ── Header ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: isMobile ? '8px 12px' : '10px 16px',
        borderBottom: '1px solid rgba(255,255,255,.07)',
        flexShrink: 0,
        background: '#0d1520',
        gap: 8,
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#E24B4A', boxShadow: '0 0 6px #E24B4A', flexShrink: 0 }} />
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: isMobile ? 11 : 12, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#F0B429' }}>
            Risk Intel
          </span>
        </div>

        {/* Counts */}
        <div style={{ display: 'flex', gap: isMobile ? 8 : 14, alignItems: 'center', flexWrap: 'wrap' }}>
          {!isLoading && (['high', 'medium', 'low'] as RiskLevel[]).map(level => (
            <div key={level} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: levelColor(level), flexShrink: 0 }} />
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, color: levelColor(level) }}>{counts[level]}</span>
              {!isMobile && <span style={{ fontSize: 9, color: '#4e4c44', textTransform: 'capitalize' }}>{level}</span>}
            </div>
          ))}
          {!isLoading && (
            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, color: '#6e6c64' }}>/{counts.total}</span>
          )}
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => setHeatVisible(v => !v)}
            style={{
              padding: '3px 8px',
              background: heatVisible ? 'rgba(240,180,41,.12)' : 'rgba(255,255,255,.04)',
              border: `1px solid ${heatVisible ? 'rgba(240,180,41,.3)' : 'rgba(255,255,255,.08)'}`,
              borderRadius: 5, cursor: 'pointer', fontSize: 10,
              color: heatVisible ? '#F0B429' : '#6e6c64',
            }}
          >Heat</button>
          {!isMobile && (
            <button
              onClick={handleExport}
              style={{ padding: '3px 8px', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 5, cursor: 'pointer', fontSize: 10, color: '#9a9890' }}
            >CSV</button>
          )}
          {user?.role === 'admin' && (
            <button
              onClick={handleRefreshIntel}
              disabled={refreshState === 'refreshing'}
              title="Pull fresh OSINT events now instead of waiting for the next scheduled sweep"
              style={{
                padding: '3px 8px',
                background: refreshState === 'done' ? 'rgba(76,175,80,.12)' : 'rgba(255,255,255,.04)',
                border: `1px solid ${refreshState === 'done' ? 'rgba(76,175,80,.3)' : 'rgba(255,255,255,.08)'}`,
                borderRadius: 5,
                cursor: refreshState === 'refreshing' ? 'wait' : 'pointer',
                fontSize: 10,
                color: refreshState === 'done' ? '#4CAF50' : '#9a9890',
                opacity: refreshState === 'refreshing' ? 0.6 : 1,
              }}
            >{refreshState === 'refreshing' ? 'Refreshing…' : refreshState === 'done' ? 'Refreshed ✓' : 'Refresh Intel'}</button>
          )}
        </div>
      </div>

      {/* ── Live ticker ── */}
      <LiveTicker continent={activeCont} />

      {/* ── Continent bar ── */}
      <ContinentBar active={activeCont} zones={zones} onChange={c => { setActiveCont(c); if (isMobile) setActiveTab('map') }} />

      {/* ── Mobile tab bar ── */}
      {isMobile && (
        <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,.06)', flexShrink: 0 }}>
          {(['list', 'map', 'feed'] as const).map(t => (
            <button key={t} onClick={() => setActiveTab(t)} style={{
              flex: 1, padding: '8px', background: 'none', border: 'none',
              borderBottom: activeTab === t ? '2px solid #F0B429' : '2px solid transparent',
              cursor: 'pointer', fontSize: 12, fontWeight: 600,
              color: activeTab === t ? '#F0B429' : '#6e6c64',
              textTransform: 'capitalize',
            }}>{t === 'list' ? `Zones (${zones.length})` : t === 'map' ? 'Map' : 'Live Feed'}</button>
          ))}
        </div>
      )}

      {/* ── Main content ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>

        {/* Left panel — threat list */}
        <div style={{
          width: isMobile ? '100%' : 280,
          borderRight: isMobile ? 'none' : '1px solid rgba(255,255,255,.06)',
          display: (!isMobile || activeTab === 'list') ? 'flex' : 'none',
          flexDirection: 'column',
          overflow: 'hidden',
          flexShrink: 0,
        }}>
          <ThreatList
            zones={zones}
            levelFilter={levelFilter}
            activeId={activeZoneId}
            onSelect={id => { handleZoneSelect(id) }}
            onLevelChange={setLevelFilter}
          />
        </div>

        {/* Right panel — map */}
        <div style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          display: (!isMobile || activeTab === 'map') ? 'flex' : 'none',
          flexDirection: 'column',
        }}>
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
            onZoneClick={id => {
              handleZoneSelect(id)
              if (isMobile) setActiveTab('map')
            }}
          />
        </div>

        {/* Live feed — every OSINT article behind the zones/ticker, most recent
           first. The 16 zones stay curated; this panel is what's actually live. */}
        <div style={{
          width: isMobile ? '100%' : 320,
          borderLeft: isMobile ? 'none' : '1px solid rgba(255,255,255,.06)',
          display: (!isMobile || activeTab === 'feed') ? 'flex' : 'none',
          flexDirection: 'column',
          overflow: 'hidden',
          flexShrink: 0,
          background: '#0a1220',
        }}>
          <LiveFeedPanel continent={activeCont} />
        </div>

        {/* Detail drawer — full-width on mobile, 360px slide-in on desktop */}
        <DetailDrawer
          zone={activeZone}
          onClose={() => setActiveZoneId(null)}
          isMobile={isMobile}
        />
      </div>
    </div>
  )
}
