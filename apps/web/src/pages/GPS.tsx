import { useState, useMemo, useEffect } from 'react'
import { useLiveFleet } from '../features/live-fleet/hooks/useLiveFleet.js'
import StatusStrip from '../features/live-fleet/components/StatusStrip.js'
import VehiclePanel from '../features/live-fleet/components/VehiclePanel.js'
import FleetMap from '../features/live-fleet/components/FleetMap.js'
import DetailCard from '../features/live-fleet/components/DetailCard.js'
import type { LiveVehicle, LiveStatus } from '../features/live-fleet/types/fleet.js'

function useIsMobile() {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1024)
  useEffect(() => {
    const fn = () => setMobile(window.innerWidth < 1024)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])
  return mobile
}

export default function GPS() {
  const { groups, counts } = useLiveFleet()
  const isMobile = useIsMobile()

  const [selected, setSelected]         = useState<LiveVehicle | null>(null)
  const [trackedId, setTrackedId]       = useState<string | null>(null)
  const [panelOpen, setPanelOpen]       = useState(true)
  const [statusFilter, setStatusFilter] = useState<'all' | LiveStatus>('all')
  const [mobileTab, setMobileTab]       = useState<'map' | 'list'>('map')

  // flatten all vehicles for the map (all, regardless of filter)
  const allVehicles = useMemo(() => groups.flatMap(g => g.vehicles), [groups])

  // filtered groups for the panel
  const filteredGroups = useMemo(() => {
    if (statusFilter === 'all') return groups
    return groups
      .map(g => ({ ...g, vehicles: g.vehicles.filter(v => v.status === statusFilter) }))
      .filter(g => g.vehicles.length > 0)
  }, [groups, statusFilter])

  const handleSelect = (v: LiveVehicle) => {
    setSelected(prev => prev?.id === v.id ? null : v)
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100%',
      background: 'var(--d-void)', color: 'var(--d-t1)',
      fontFamily: "'Barlow', Inter, system-ui, sans-serif",
      overflow: 'hidden',
    }}>
      {/* ── Header ── */}
      <div style={{
        height: 44, flexShrink: 0,
        display: 'flex', alignItems: 'center',
        background: 'var(--d-carbon)',
        borderBottom: '1px solid rgba(255,255,255,.08)',
        position: 'relative', zIndex: 1000, gap: 0,
      }}>
        {/* logo block */}
        <div style={{ width: 52, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid var(--d-rim2)', flexShrink: 0 }}>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 15, fontWeight: 700, color: 'var(--d-orange)', letterSpacing: '.2em' }}>S</span>
        </div>
        {/* page id */}
        <div style={{ padding: '0 16px', borderRight: '1px solid var(--d-rim2)', height: '100%', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--d-orange)" strokeWidth="2"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5" fill="var(--d-orange)" stroke="none"/></svg>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 15, fontWeight: 600, letterSpacing: '.06em' }}>LIVE FLEET</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, fontWeight: 600, letterSpacing: '.12em', color: 'var(--d-sig)', background: 'color-mix(in srgb, var(--d-sig) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--d-sig) 18%, transparent)', borderRadius: 3, padding: '2px 8px' }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--d-sig)', animation: 'lf-ldot 1.8s ease-in-out infinite' }} />
            LIVE
          </div>
        </div>

        {/* SOS alert indicator */}
        {counts.sos > 0 && (
          <div style={{ marginLeft: 12, display: 'flex', alignItems: 'center', gap: 6, height: 28, padding: '0 12px', background: 'color-mix(in srgb, var(--d-fire) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--d-fire) 35%, transparent)', borderRadius: 4, animation: 'lf-sos-pulse 2s ease-in-out infinite' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--d-fire)" strokeWidth="2.5"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: '.1em', color: 'var(--d-fire)' }}>{counts.sos} SOS ACTIVE</span>
          </div>
        )}

        {/* Field officers online indicator */}
        {counts.officers > 0 && (
          <div style={{ marginLeft: 12, display: 'flex', alignItems: 'center', gap: 6, height: 28, padding: '0 12px', background: 'rgba(232,168,48,.08)', border: '1px solid rgba(232,168,48,.3)', borderRadius: 4 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--d-orange)" strokeWidth="2"><circle cx="12" cy="7.5" r="4.2"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: '.1em', color: 'var(--d-orange)' }}>{counts.officers} OFFICER{counts.officers === 1 ? '' : 'S'} ONLINE</span>
          </div>
        )}

        {/* mobile tab toggle */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2, padding: '0 12px' }}>
          {(['map', 'list'] as const).map(t => (
            <button key={t} onClick={() => setMobileTab(t)} style={{ padding: '4px 12px', borderRadius: 5, background: mobileTab === t ? 'color-mix(in srgb, var(--d-t1) 7%, transparent)' : 'none', border: 'none', color: mobileTab === t ? 'var(--d-t1)' : 'var(--d-t2)', cursor: 'pointer', fontFamily: "'Barlow Condensed', sans-serif", fontSize: 12, fontWeight: 500, letterSpacing: '.04em', textTransform: 'capitalize' }}>
              {t === 'list' ? `List (${counts.all})` : 'Map'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Status strip ── */}
      <StatusStrip counts={counts} active={statusFilter} onFilter={f => setStatusFilter(f as any)} />

      {/* ── Main content ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>

        {/* left panel: always visible on desktop; on mobile only when list tab */}
        <div style={{ display: (!isMobile || mobileTab === 'list') ? 'flex' : 'none', overflow: 'hidden', flexShrink: 0, ...(isMobile ? { width: '100%' } : {}) }}>
          <VehiclePanel
            groups={filteredGroups}
            selectedId={selected?.id ?? null}
            collapsed={isMobile ? false : !panelOpen}
            onToggleCollapse={() => setPanelOpen(o => !o)}
            onSelect={v => { handleSelect(v); if (isMobile) setMobileTab('map') }}
          />
        </div>

        {/* map: always visible on desktop; on mobile only when map tab */}
        <div style={{ flex: 1, position: 'relative', display: (!isMobile || mobileTab === 'map') ? 'flex' : 'none', minWidth: 0 }}>
          <FleetMap
            vehicles={allVehicles}
            selectedId={selected?.id ?? null}
            onSelect={handleSelect}
            trackedId={trackedId}
          />
          {/* detail card — desktop only (inside map area) */}
          <DetailCard
            vehicle={selected}
            onClose={() => setSelected(null)}
            trackedId={trackedId}
            onToggleTrack={v => setTrackedId(prev => (prev === v.id ? null : v.id))}
          />
        </div>

      </div>

      <style>{`
        @keyframes lf-ldot{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(2)}}
        @keyframes lf-sos-pulse{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}50%{box-shadow:0 0 12px 2px rgba(239,68,68,.2)}}
      `}</style>
    </div>
  )
}
