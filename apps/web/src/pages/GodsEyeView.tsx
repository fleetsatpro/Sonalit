import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Globe2, Layers3, RadioTower, Orbit } from 'lucide-react'
import { api } from '../lib/api.js'
import { useLiveFleet } from '../features/live-fleet/hooks/useLiveFleet.js'
import FleetMap from '../features/live-fleet/components/FleetMap.js'
import CorridorGlobe from '../components/geofences/CorridorGlobe.js'
import type { GlobeMember, RiskZone } from '../components/geofences/CorridorWorldScene.js'
import type { LiveVehicle } from '../features/live-fleet/types/fleet.js'

type View = '2D' | '3D'

function toGlobeMember(v: LiveVehicle): GlobeMember {
  return {
    id: v.id,
    name: v.registration,
    officer_name: v.officer_name,
    lat: v.lat,
    lng: v.lng,
    status: v.status === 'move' ? 'on_track' : v.status === 'sos' ? 'off_route' : v.status,
    heading: v.heading,
    speed_kph: v.speed_kmh,
    position_state: v.secondsAgo > 1800 ? 'stale' : v.lat == null ? 'no_fix' : 'observed',
    position_confidence: v.lat == null ? 0 : v.secondsAgo > 1800 ? 0.5 : 1,
    position_uncertainty_m: v.lat == null ? 9999 : v.secondsAgo > 1800 ? 500 : 25,
    vehicle_type: v.kind === 'guardian' ? 'guardian' : 'vehicle',
  }
}

export default function GodsEyeView() {
  const { groups, counts } = useLiveFleet()
  const [view, setView] = useState<View>('2D')
  const [selected, setSelected] = useState<LiveVehicle | null>(null)
  const allVehicles = useMemo(() => groups.flatMap(g => g.vehicles), [groups])
  const members = useMemo(() => allVehicles.map(toGlobeMember), [allVehicles])

  const { data: zones = [] } = useQuery<RiskZone[]>({
    queryKey: ['gev-riskzones'],
    queryFn: async () => {
      const r = await api.get<{ data: Array<{ h3_index: string; name: string; risk_level: string; center_lat: number; center_lon: number; radius_km: number }> }>('/riskzones')
      return (r.data.data ?? []).map(z => ({
        zone_id: z.h3_index,
        name: z.name,
        risk_level: z.risk_level,
        lat: z.center_lat,
        lng: z.center_lon,
        radius_km: z.radius_km,
      }))
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: '#05070d', color: '#dfe0db', fontFamily: "'Barlow', Inter, system-ui, sans-serif", overflow: 'hidden' }}>
      <header style={{ height: 58, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', background: '#080b14', borderBottom: '1px solid rgba(196,181,253,.16)', zIndex: 1000 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'rgba(196,181,253,.12)', border: '1px solid rgba(196,181,253,.25)', color: '#c4b5fd' }}>
          <Globe2 size={18} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 16, fontWeight: 700, letterSpacing: '.08em', color: '#f1f5f9' }}>GOD'S EYE VIEW</div>
          <div style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 8.5, letterSpacing: '.12em', color: '#8f96a3' }}>GLOBAL SPATIAL PICTURE · SONALIT OPERATIONAL AUTHORITY</div>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: 4, borderRadius: 9, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)' }}>
          <button onClick={() => setView('2D')} aria-pressed={view === '2D'} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 11px', borderRadius: 7, border: 'none', cursor: 'pointer', background: view === '2D' ? 'rgba(196,181,253,.16)' : 'transparent', color: view === '2D' ? '#ede9fe' : '#7a7e8a', fontFamily: 'IBM Plex Mono,monospace', fontSize: 9, fontWeight: 700, letterSpacing: '.08em' }}><Layers3 size={13}/> WORLD 2D</button>
          <button onClick={() => setView('3D')} aria-pressed={view === '3D'} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 11px', borderRadius: 7, border: 'none', cursor: 'pointer', background: view === '3D' ? 'rgba(196,181,253,.16)' : 'transparent', color: view === '3D' ? '#ede9fe' : '#7a7e8a', fontFamily: 'IBM Plex Mono,monospace', fontSize: 9, fontWeight: 700, letterSpacing: '.08em' }}><Orbit size={13}/> XD 3D / 8D</button>
        </div>
      </header>

      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {view === '2D' ? (
          <>
            <FleetMap
              vehicles={allVehicles}
              selectedId={selected?.id ?? null}
              onSelect={v => setSelected(v)}
            />
            <div style={{ position: 'absolute', left: 14, top: 14, zIndex: 700, width: 255, pointerEvents: 'none', background: 'rgba(5,7,13,.86)', border: '1px solid rgba(196,181,253,.16)', borderRadius: 12, padding: '10px 12px', boxShadow: '0 18px 45px rgba(0,0,0,.35)', backdropFilter: 'blur(14px)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 8, color: '#b8aef1', letterSpacing: '.14em' }}>GEV LAYERS</span>
                <span style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 8, color: '#8f96a3' }}>11 REQUESTED</span>
              </div>
              <div style={{ marginTop: 7, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>
                {[
                  ['AIR', '#60a5fa', 'Aircraft'],
                  ['WX', '#a7f3d0', 'Weather'],
                  ['SEA', '#22d3ee', 'Maritime'],
                  ['TRF', '#eab308', 'Traffic'],
                  ['HAZ', '#ef4444', 'Hazards'],
                  ['SEC', '#fb923c', 'Security'],
                  ['INF', '#cbd5e1', 'Infrastructure'],
                  ['INC', '#fb7185', 'Incidents'],
                  ['ALT', '#f0abfc', 'Alerts'],
                  ['CAM', '#5eead4', 'Cameras'],
                  ['ORB', '#c4b5fd', 'Satellites'],
                ].map(([k,c,label]) => <span key={k} title={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'IBM Plex Mono,monospace', fontSize: 7.5, color: '#cbd5e1' }}><i style={{ width: 7, height: 7, borderRadius: '50%', background: c }} />{k}</span>)}
              </div>
              <div style={{ marginTop: 8, paddingTop: 7, borderTop: '1px solid rgba(255,255,255,.06)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <RadioTower size={11} color="#16c784" />
                <span style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 7.5, color: '#7a7e8a' }}>{counts.all} operational entities · {counts.officers} Guardian positions</span>
              </div>
            </div>
            <div style={{ position: 'absolute', right: 14, bottom: 14, zIndex: 700, pointerEvents: 'none', fontFamily: 'IBM Plex Mono,monospace', fontSize: 7.5, color: '#6f7480', background: 'rgba(5,7,13,.78)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 8, padding: '6px 8px' }}>
              External observations enrich the world picture; they do not replace Sonalit telemetry, convoy state or evidence.
            </div>
          </>
        ) : (
          <CorridorGlobe route={[]} corridorKm={1} members={members} zones={zones} fill surface="gev" fixedView="3D" />
        )}

        {selected && view === '2D' && (
          <div style={{ position: 'absolute', right: 12, bottom: 12, zIndex: 800, width: 280, background: 'rgba(5,7,13,.95)', border: '1px solid rgba(196,181,253,.16)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.5)', pointerEvents: 'auto' }}>
            <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 8, color: '#b8aef1', letterSpacing: '.12em' }}>GEV OPERATIONAL ENTITY</span>
              <button onClick={() => setSelected(null)} aria-label="Close entity card" style={{ background: 'none', border: 'none', color: '#7a7e8a', cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ padding: '12px' }}>
              <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 18, fontWeight: 700, color: '#f1f5f9' }}>{selected.registration}</div>
              <div style={{ marginTop: 3, fontFamily: 'IBM Plex Mono,monospace', fontSize: 9, color: '#7a7e8a' }}>{selected.convoy_name ?? 'Standalone'} · {selected.status.toUpperCase()}</div>
              <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 5 }}>
                <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 7, padding: 7 }}><span style={{ display: 'block', fontSize: 7, color: '#5f6572' }}>SPEED</span><b style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 12, color: '#e8a830' }}>{Math.round(selected.speed_kmh)}</b><small style={{ fontSize: 7, color: '#6f7480' }}> km/h</small></div>
                <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 7, padding: 7 }}><span style={{ display: 'block', fontSize: 7, color: '#5f6572' }}>HEADING</span><b style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 12, color: '#c4b5fd' }}>{selected.heading == null ? '—' : Math.round(selected.heading) + '°'}</b></div>
                <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 7, padding: 7 }}><span style={{ display: 'block', fontSize: 7, color: '#5f6572' }}>LAST FIX</span><b style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 10, color: selected.secondsAgo > 1800 ? '#ef4444' : '#16c784' }}>{selected.secondsAgo}s</b></div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
