import { useQuery } from '@tanstack/react-query'
import { api } from '../../../lib/api.js'

interface SpatialContext {
  mission?: { convoyId?: string | null; name?: string | null; status?: string | null }
  operational?: {
    vehicles?: Array<{
      id: string
      quality?: { freshnessClass?: string; state?: string }
      routeState?: {
        relation?: string
        crossTrackKm?: number | null
        routeProgressPct?: number | null
        scheduleDeltaMin?: number | null
      }
      nearbyCheckpoints?: Array<{
        id: string
        label: string
        distanceM: number
        approaching?: boolean
        passed?: boolean
      }>
    }>
  }
  environment?: Array<{
    id: string
    status?: string
    attributes?: {
      conditions?: string
      hazards?: string[]
      severity?: string
      windSpeedKmh?: number | null
      visibilityM?: number | null
    }
    quality?: { freshnessClass?: string }
  }>
  traffic?: Array<{
    id: string
    entityType?: string
    status?: string
    source?: string
    attributes?: { congestion?: string; closed?: boolean; category?: string; description?: string; magnitudeOfDelay?: string }
    quality?: { freshnessClass?: string }
  }>
  hazards?: Array<{
    id: string
    entityType?: string
    source?: string
    attributes?: { title?: string; categoryTitle?: string; severity?: string; representativePointDerived?: boolean }
    quality?: { freshnessClass?: string }
  }>
  cameras?: Array<{
    id: string
    entityType?: string
    source?: string
    observedAt?: string | null
    quality?: { freshnessClass?: string }
    attributes?: { name?: string; label?: string; coverage?: string }
  }>
  satellites?: Array<{
    id: string
    entityType?: string
    source?: string
    observedAt?: string | null
    quality?: { freshnessClass?: string }
    attributes?: { name?: string; label?: string; caption?: string; positionSource?: string; telemetryLive?: boolean; imagingClaim?: boolean; taskingClaim?: boolean }
  }>
  relations?: Array<{
    predicate: string
    fromId: string
    toId: string
    distanceM?: number | null
    confidence?: number
    operationalConfidence?: number | null
    uncertainty?: string[]
  }>
  events?: Array<{ eventType: string; severity: string; status?: string }>
  coverage?: { layersUnavailable?: string[]; layersPartial?: string[] }
  uncertainty?: string[]
  warnings?: string[]
}

function freshnessLabel(v?: string) {
  if (v === 'LIVE') return { label: 'LIVE', color: '#16c784' }
  if (v === 'DELAYED') return { label: 'DELAYED', color: '#f59e0b' }
  if (v === 'STALE') return { label: 'STALE', color: '#ef4444' }
  if (v === 'MODELLED') return { label: 'MODELLED', color: '#c4b5fd' }
  return { label: v || 'UNKNOWN', color: '#7a7e8a' }
}

function titleCase(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, function(m) { return m.toUpperCase() })
}

function fmtDistance(m?: number | null) {
  if (m == null || !Number.isFinite(m)) return '—'
  return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m'
}

function panelStyle(tint: string) {
  return {
    padding: '9px 10px',
    borderRadius: 9,
    background: 'linear-gradient(180deg, rgba(255,255,255,.035), rgba(255,255,255,.018))',
    border: '1px solid rgba(255,255,255,.065)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,.035)',
    position: 'relative' as const,
    overflow: 'hidden' as const,
  }
}

const FUSION_PREDICATES = [
  'HAZARD_IN_CAMERA_VIEWSHED',
  'HAZARD_NEAR_CAMERA',
  'HAZARD_ON_ROUTE_CORRIDOR',
  'SATELLITE_NEAR_ROUTE',
  'VEHICLE_IN_HAZARD_PROXIMITY',
  'VEHICLE_NEAR_HAZARD',
]

export default function SpatialContextCard({ vehicleId }: { vehicleId: string }) {
  const { data, isLoading, isError } = useQuery<SpatialContext>({
    queryKey: ['spatial-world-context', 'vehicle', vehicleId],
    queryFn: async function() {
      const response = await api.get('/spatial/world-context/vehicle/' + encodeURIComponent(vehicleId))
      return (response.data as { data: SpatialContext }).data
    },
    staleTime: 8_000,
    refetchInterval: 15_000,
    enabled: Boolean(vehicleId),
  })

  if (isLoading) {
    return (
      <div style={{ padding: '13px 14px', borderBottom: '1px solid rgba(255,255,255,.06)', background: 'linear-gradient(180deg, rgba(196,181,253,.035), transparent)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 8.5, color: '#8d93a1', letterSpacing: '.08em' }}>
        BUILDING XD SURVEILLANCE CONTEXT…
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div style={{ padding: '13px 14px', borderBottom: '1px solid rgba(255,255,255,.06)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 8.5, color: '#ef4444' }}>
        XD CONTEXT UNAVAILABLE — OPERATIONAL GPS REMAINS AUTHORITATIVE
      </div>
    )
  }

  const current = data.operational?.vehicles?.find(function(item) { return item.id === 'sonalit:vehicle:' + vehicleId }) || data.operational?.vehicles?.[0]
  const route = current?.routeState
  const freshness = freshnessLabel(current?.quality?.freshnessClass)
  const checkpoint = current?.nearbyCheckpoints?.find(function(cp) { return !cp.passed }) || current?.nearbyCheckpoints?.[0]
  const cameras = data.cameras || []
  const satellites = data.satellites || []
  const hasLive = Boolean(current || data.traffic?.length || data.hazards?.length || data.environment?.length)
  const hasModelled = satellites.length > 0
  const fusionRelations = (data.relations || [])
    .filter(function(r) { return FUSION_PREDICATES.includes(r.predicate) })
    .filter(function(r) { return r.fromId === 'sonalit:vehicle:' + vehicleId || r.fromId === vehicleId || r.toId === 'sonalit:vehicle:' + vehicleId || r.toId === vehicleId })
    .slice(0, 4)
  const contextualRelations = (data.relations || [])
    .filter(function(r) { return r.fromId === 'sonalit:vehicle:' + vehicleId || r.fromId === vehicleId })
    .filter(function(r) { return ['HAZARD_NEAR_ROUTE', 'NATURAL_HAZARD_NEAR_ROUTE', 'EXTERNAL_HAZARD_NEAR_ROUTE', 'TRAFFIC_CLOSURE', 'TRAFFIC_CONGESTION', 'EXTERNAL_INCIDENT_NEAR_ROUTE', 'WITHIN', 'NEAR_INCIDENT', 'APPROACHING', 'NEAR_MARITIME', 'VESSEL_APPROACHING_DESTINATION'].includes(r.predicate) })
    .slice(0, 3)
  const events = (data.events || []).filter(function(e) { return e.status !== 'resolved' }).slice(0, 3)
  const weather = data.environment?.[0]
  const hazards = weather?.attributes?.hazards || []
  const unavailable = [...(data.coverage?.layersUnavailable || []), ...(data.coverage?.layersPartial || []).map(function(v) { return v + ' partial' })]
  const trafficCount = data.traffic?.length || 0
  const vesselCount = (data.relations || []).filter(function(r) { return r.toId.startsWith('kpler:vessel:') || r.toId.includes(':vessel:') }).length

  const metric = function(label: string, value: string, sub: string, accent: string) {
    return (
      <div style={{ minWidth: 0, padding: '8px 9px', borderRadius: 8, background: 'rgba(5,8,14,.44)', border: '1px solid rgba(255,255,255,.055)' }}>
        <div style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 7.5, color: '#656b79', textTransform: 'uppercase', letterSpacing: '.1em' }}>{label}</div>
        <div style={{ marginTop: 3, fontFamily: 'IBM Plex Mono,monospace', fontSize: 10, lineHeight: 1.1, color: accent, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
        <div style={{ marginTop: 3, fontFamily: 'IBM Plex Mono,monospace', fontSize: 7.5, color: '#7d8491', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>
      </div>
    )
  }

  return (
    <div style={{
      padding: '10px 12px 11px',
      borderBottom: '1px solid rgba(255,255,255,.07)',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      background: 'linear-gradient(180deg, rgba(196,181,253,.035), rgba(255,255,255,0) 22%)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 7.5, letterSpacing: '.16em', color: '#9c93b8' }}>XD SURVEILLANCE CONTEXT</div>
          <div style={{ marginTop: 2, fontFamily: 'Barlow Condensed,sans-serif', fontSize: 14, fontWeight: 700, color: '#eef2f7', letterSpacing: '.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.mission?.name || 'Operational spatial picture'}</div>
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 7px', borderRadius: 999, background: 'rgba(255,255,255,.035)', border: '1px solid rgba(255,255,255,.08)', flexShrink: 0 }}>
          {hasLive ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontFamily: 'IBM Plex Mono,monospace', fontSize: 7.5, color: '#74e6ab' }}><i style={{ width: 4, height: 4, borderRadius: '50%', background: '#16c784', boxShadow: '0 0 7px rgba(22,199,132,.6)' }} />LIVE</span> : null}
          {hasLive && hasModelled ? <span style={{ width: 1, height: 9, background: 'rgba(255,255,255,.11)' }} /> : null}
          {hasModelled ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontFamily: 'IBM Plex Mono,monospace', fontSize: 7.5, color: '#c4b5fd' }}><i style={{ width: 4, height: 4, borderRadius: '50%', background: '#c4b5fd', boxShadow: '0 0 7px rgba(196,181,253,.55)' }} />MODELLED</span> : null}
          {!hasLive && !hasModelled ? <span style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 7.5, color: '#7a7e8a' }}>UNKNOWN</span> : null}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 5 }}>
        {metric('Route', titleCase(route?.relation || 'UNKNOWN'), route?.relation === 'OFF_ROUTE' ? 'off-route' : 'route relation', route?.relation === 'OFF_ROUTE' ? '#ef4444' : '#55d99a')}
        {metric('Progress', route?.routeProgressPct != null ? route.routeProgressPct.toFixed(1) + '%' : '—', route?.routeProgressPct != null ? 'corridor position' : 'progress unknown', '#d7e0ea')}
        {metric('X-Track', route?.crossTrackKm != null ? route.crossTrackKm.toFixed(2) + ' km' : '—', route?.crossTrackKm != null ? 'lateral offset' : 'track unknown', '#e8a830')}
        {metric('Schedule', route?.scheduleDeltaMin == null ? '—' : Math.abs(Math.round(route.scheduleDeltaMin)) + ' min', route?.scheduleDeltaMin == null ? 'schedule unknown' : route.scheduleDeltaMin < 0 ? 'behind plan' : 'ahead / on plan', route?.scheduleDeltaMin != null && route.scheduleDeltaMin < 0 ? '#f59e0b' : '#74e6ab')}
      </div>

      {checkpoint && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 9px', borderRadius: 8, background: checkpoint.approaching ? 'rgba(232,168,48,.075)' : 'rgba(255,255,255,.025)', border: '1px solid rgba(232,168,48,.16)' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: checkpoint.approaching ? '#e8a830' : '#7a7e8a', boxShadow: checkpoint.approaching ? '0 0 9px rgba(232,168,48,.45)' : 'none', flexShrink: 0 }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontFamily: 'Barlow Condensed,sans-serif', fontSize: 11.5, fontWeight: 700, color: '#e4e8ee', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{checkpoint.label}</div>
            <div style={{ marginTop: 2, fontFamily: 'IBM Plex Mono,monospace', fontSize: 7.5, color: '#7d8491' }}>{checkpoint.approaching ? 'APPROACHING · ' : ''}{fmtDistance(checkpoint.distanceM)}</div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <div style={panelStyle('#c4b5fd')}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, background: '#c4b5fd', boxShadow: '0 0 12px rgba(196,181,253,.45)' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <span style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 7.5, letterSpacing: '.11em', color: '#8e88a0' }}>ORBITAL</span>
            <span style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 8, color: '#c4b5fd' }}>{satellites.length || '—'}</span>
          </div>
          <div style={{ marginTop: 3, fontFamily: 'Barlow Condensed,sans-serif', fontSize: 11, fontWeight: 700, color: '#ece9f7' }}>Modelled orbital context</div>
          <div style={{ marginTop: 2, fontFamily: 'IBM Plex Mono,monospace', fontSize: 7.5, lineHeight: 1.35, color: '#77718a' }}>SGP4 geometry · not live telemetry</div>
          {satellites.slice(0, 2).map(function(s) {
            const a = s.attributes || {}
            const freshness = freshnessLabel(s.quality?.freshnessClass)
            return (
              <div key={s.id} style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#c4b5fd', boxShadow: '0 0 8px rgba(196,181,253,.45)', flexShrink: 0 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 7.5, color: '#d5d0e6', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(a.name ?? a.label ?? s.id)}</div>
                  <div style={{ marginTop: 1, fontFamily: 'IBM Plex Mono,monospace', fontSize: 6.8, color: freshness.color }}>{freshness.label}</div>
                </div>
              </div>
            )
          })}
          {satellites.length === 0 && <div style={{ marginTop: 7, fontFamily: 'IBM Plex Mono,monospace', fontSize: 7.5, color: '#656b79' }}>No orbital objects in current context</div>}
        </div>

        <div style={panelStyle('#5eead4')}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, background: '#5eead4', boxShadow: '0 0 12px rgba(94,234,212,.38)' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <span style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 7.5, letterSpacing: '.11em', color: '#7faaa3' }}>CAMERAS</span>
            <span style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 8, color: '#5eead4' }}>{cameras.length || '—'}</span>
          </div>
          <div style={{ marginTop: 3, fontFamily: 'Barlow Condensed,sans-serif', fontSize: 11, fontWeight: 700, color: '#dff7f3' }}>Observation infrastructure</div>
          <div style={{ marginTop: 2, fontFamily: 'IBM Plex Mono,monospace', fontSize: 7.5, lineHeight: 1.35, color: '#718c87' }}>Geometry only · no visual acquisition</div>
          {cameras.slice(0, 2).map(function(c) {
            const a = c.attributes || {}
            const freshness = freshnessLabel(c.quality?.freshnessClass)
            return (
              <div key={c.id} style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#5eead4', boxShadow: '0 0 8px rgba(94,234,212,.42)', flexShrink: 0 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 7.5, color: '#cfe9e4', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(a.name ?? a.label ?? c.id)}</div>
                  <div style={{ marginTop: 1, fontFamily: 'IBM Plex Mono,monospace', fontSize: 6.8, color: freshness.color }}>{freshness.label}</div>
                </div>
              </div>
            )
          })}
          {cameras.length === 0 && <div style={{ marginTop: 7, fontFamily: 'IBM Plex Mono,monospace', fontSize: 7.5, color: '#5f7773' }}>No camera infrastructure in current context</div>}
        </div>
      </div>

      {fusionRelations.length > 0 && (
        <div style={{ padding: '8px 9px', borderRadius: 8, background: 'rgba(196,181,253,.035)', border: '1px solid rgba(196,181,253,.12)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <span style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 7.5, letterSpacing: '.1em', color: '#948ca8' }}>CROSS-LAYER FUSION</span>
            <span style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 7.2, color: '#817a90' }}>GEOMETRY ONLY</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
            {fusionRelations.map(function(r, i) {
              const pct = r.confidence != null ? Math.round(r.confidence * 100) + '%' : '—'
              return (
                <div key={r.predicate + ':' + r.toId + ':' + i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontFamily: 'IBM Plex Mono,monospace', fontSize: 7.5 }}>
                  <span style={{ color: '#c4b5fd', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{titleCase(r.predicate)}</span>
                  <span style={{ color: '#77717f', flexShrink: 0 }}>{fmtDistance(r.distanceM)} · {pct}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {trafficCount > 0 && (
        <div style={{ padding: '8px 9px', background: 'rgba(245,158,11,.045)', border: '1px solid rgba(245,158,11,.14)', borderRadius: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 7.5, letterSpacing: '.1em', color: '#82775f' }}>TRAFFIC</span>
            <span style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 7.5, color: '#f59e0b' }}>{trafficCount} SIGNAL{trafficCount === 1 ? '' : 'S'}</span>
          </div>
          <div style={{ marginTop: 4, fontFamily: 'IBM Plex Mono,monospace', fontSize: 7.5, color: '#8e897b' }}>
            {(data.traffic || []).slice(0, 2).map(function(t) {
              return titleCase(t.status || t.attributes?.category || 'TRAFFIC') + (t.attributes?.closed ? ' · CLOSED' : '')
            }).join(' · ')}
          </div>
        </div>
      )}

      {weather && (
        <div style={{ padding: '8px 9px', background: hazards.length ? 'rgba(239,68,68,.055)' : 'rgba(255,255,255,.022)', border: hazards.length ? '1px solid rgba(239,68,68,.15)' : '1px solid rgba(255,255,255,.055)', borderRadius: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 7.5, letterSpacing: '.1em', color: '#727783' }}>ENVIRONMENT</span>
            <span style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 7.5, color: hazards.length ? '#ef4444' : '#63d39f' }}>{hazards.length ? hazards.join(' · ').toUpperCase() : 'NO DECLARED HAZARD'}</span>
          </div>
          <div style={{ marginTop: 4, fontFamily: 'IBM Plex Mono,monospace', fontSize: 7.5, color: '#828894' }}>
            {(weather.attributes?.conditions || 'unknown') + ' · ' + (weather.attributes?.windSpeedKmh != null ? weather.attributes.windSpeedKmh + ' km/h wind' : 'wind —') + ' · ' + (weather.attributes?.visibilityM != null ? (weather.attributes.visibilityM / 1000).toFixed(1) + ' km vis' : 'visibility —')}
          </div>
        </div>
      )}

      {contextualRelations.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {contextualRelations.map(function(r, i) {
            return (
              <div key={r.toId + ':' + i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, fontFamily: 'IBM Plex Mono,monospace', fontSize: 7.5 }}>
                <span style={{ color: r.predicate === 'WITHIN' || r.predicate === 'NEAR_INCIDENT' ? '#ef4444' : '#f59e0b' }}>{titleCase(r.predicate)}</span>
                <span style={{ color: '#7a7e8a' }}>{fmtDistance(r.distanceM)} · {r.confidence != null ? Math.round(r.confidence * 100) + '%' : '—'}</span>
              </div>
            )
          })}
        </div>
      )}

      {events.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 7.5, letterSpacing: '.1em', color: '#656b79' }}>EVENTS</div>
          {events.map(function(e, i) {
            return <div key={e.eventType + ':' + i} style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 7.5, color: e.severity === 'high' || e.severity === 'critical' ? '#ef4444' : '#f59e0b' }}>{titleCase(e.eventType)} · {e.severity.toUpperCase()}</div>
          })}
        </div>
      )}

      <div style={{ marginTop: 1, paddingTop: 7, borderTop: '1px solid rgba(255,255,255,.055)', fontFamily: 'IBM Plex Mono,monospace', fontSize: 7.2, lineHeight: 1.45, color: '#676d79' }}>
        {unavailable.length > 0 ? 'Partial coverage: ' + unavailable.join(', ') + '. ' : ''}Modelled orbital ≠ live telemetry · geometry ≠ visual acquisition · operational GPS remains authority.
      </div>

      {(data.uncertainty?.length || data.warnings?.length) ? (
        <div style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 7.2, lineHeight: 1.4, color: '#6e6c64' }}>
          {data.uncertainty?.[0] || data.warnings?.[0]}
        </div>
      ) : null}
    </div>
  )
}
