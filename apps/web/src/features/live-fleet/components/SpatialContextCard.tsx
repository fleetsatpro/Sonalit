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
  security?: Array<{
    id: string
    entityType?: string
    attributes?: { name?: string; risk_level?: string; zone_type?: string }
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
  relations?: Array<{
    predicate: string
    fromId: string
    toId: string
    distanceM?: number | null
    confidence?: number
  }>
  events?: Array<{ eventType: string; severity: string; status?: string }>
  coverage?: { layersUnavailable?: string[] }
  uncertainty?: string[]
  warnings?: string[]
}

function freshnessLabel(v?: string) {
  if (v === 'LIVE') return { label: 'LIVE', cls: '#16c784' }
  if (v === 'DELAYED') return { label: 'DELAYED', cls: '#f59e0b' }
  if (v === 'STALE') return { label: 'STALE', cls: '#ef4444' }
  return { label: v || 'UNKNOWN', cls: '#7a7e8a' }
}

function titleCase(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, function(m) { return m.toUpperCase() })
}

function fmtDistance(m?: number | null) {
  if (m == null || !Number.isFinite(m)) return '—'
  return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m'
}

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
    return <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,.07)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, color: '#7a7e8a' }}>BUILDING SPATIAL CONTEXT…</div>
  }

  if (isError || !data) {
    return <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,.07)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, color: '#ef4444' }}>SPATIAL CONTEXT UNAVAILABLE — OPERATIONAL GPS REMAINS AUTHORITATIVE</div>
  }

  const current = data.operational?.vehicles?.find(function(item) { return item.id === 'sonalit:vehicle:' + vehicleId }) || data.operational?.vehicles?.[0]
  const route = current?.routeState
  const freshness = freshnessLabel(current?.quality?.freshnessClass)
  const checkpoint = current?.nearbyCheckpoints?.find(function(cp) { return !cp.passed }) || current?.nearbyCheckpoints?.[0]
  const contextualRelations = (data.relations || [])
    .filter(function(r) { return r.fromId === 'sonalit:vehicle:' + vehicleId || r.fromId === vehicleId })
    .filter(function(r) { return ['HAZARD_NEAR_ROUTE', 'NATURAL_HAZARD_NEAR_ROUTE', 'EXTERNAL_HAZARD_NEAR_ROUTE', 'TRAFFIC_CLOSURE', 'TRAFFIC_CONGESTION', 'EXTERNAL_INCIDENT_NEAR_ROUTE', 'WITHIN', 'NEAR_INCIDENT', 'APPROACHING', 'NEAR_MARITIME', 'VESSEL_APPROACHING_DESTINATION'].includes(r.predicate) })
    .slice(0, 3)
  const events = (data.events || []).filter(function(e) { return e.status !== 'resolved' }).slice(0, 3)
  const weather = data.environment?.[0]
  const hazards = weather?.attributes?.hazards || []
  const unavailable = data.coverage?.layersUnavailable || []
  const trafficCount = data.traffic?.length || 0
  const vesselCount = (data.relations || []).filter(function(r) { return r.toId.startsWith('kpler:vessel:') || r.toId.includes(':vessel:') }).length

  return (
    <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,.07)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 9, color: '#3e4252', textTransform: 'uppercase', letterSpacing: '.1em' }}>God’s Eye Context</span>
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, color: freshness.cls }}>{freshness.label}</span>
      </div>

      {data.mission?.name && (
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, fontWeight: 700, color: '#dfe0db' }}>{data.mission.name}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <div style={{ background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 6, padding: '7px 8px' }}>
          <div style={{ fontSize: 8, color: '#3e4252', textTransform: 'uppercase', marginBottom: 2 }}>Route</div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, color: route?.relation === 'OFF_ROUTE' ? '#ef4444' : '#16c784', fontWeight: 700 }}>{titleCase(route?.relation || 'UNKNOWN')}</div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 8, color: '#7a7e8a', marginTop: 3 }}>{route?.routeProgressPct != null ? route.routeProgressPct.toFixed(1) + '% progress' : 'progress unknown'}</div>
        </div>

        <div style={{ background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 6, padding: '7px 8px' }}>
          <div style={{ fontSize: 8, color: '#3e4252', textTransform: 'uppercase', marginBottom: 2 }}>Cross-track</div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, color: '#e8a830', fontWeight: 700 }}>{route?.crossTrackKm != null ? route.crossTrackKm.toFixed(2) + ' km' : '—'}</div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 8, color: '#7a7e8a', marginTop: 3 }}>{route?.scheduleDeltaMin == null ? 'schedule unknown' : Math.abs(Math.round(route.scheduleDeltaMin)) + ' min ' + (route.scheduleDeltaMin < 0 ? 'behind' : 'ahead')}</div>
        </div>
      </div>

      {checkpoint && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 6, background: checkpoint.approaching ? 'rgba(232,168,48,.08)' : 'rgba(255,255,255,.025)', border: '1px solid rgba(232,168,48,.18)' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: checkpoint.approaching ? '#e8a830' : '#7a7e8a' }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11, fontWeight: 700, color: '#dfe0db' }}>{checkpoint.label}</div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 8, color: '#7a7e8a' }}>{checkpoint.approaching ? 'APPROACHING · ' : ''}{fmtDistance(checkpoint.distanceM)}</div>
          </div>
        </div>
      )}

      {trafficCount > 0 && (
        <div style={{ padding: '7px 8px', background: 'rgba(245,158,11,.05)', border: '1px solid rgba(245,158,11,.16)', borderRadius: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 8, color: '#3e4252', textTransform: 'uppercase' }}>Traffic Intelligence</span>
            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 8, color: '#f59e0b' }}>{trafficCount} SIGNAL{trafficCount === 1 ? '' : 'S'}</span>
          </div>
          <div style={{ marginTop: 3, fontFamily: 'IBM Plex Mono, monospace', fontSize: 8, color: '#7a7e8a' }}>
            {(data.traffic || []).slice(0, 2).map(function(t) {
              return titleCase(t.status || t.attributes?.category || 'TRAFFIC') + (t.attributes?.closed ? ' · CLOSED' : '')
            }).join(' · ')}
          </div>
        </div>
      )}

      {(vesselCount > 0 || data.hazards?.length) ? (
        <div style={{ padding: '7px 8px', background: 'rgba(56,189,248,.04)', border: '1px solid rgba(56,189,248,.14)', borderRadius: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 8, color: '#3e4252', textTransform: 'uppercase' }}>External Spatial Intel</span>
            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 8, color: '#38bdf8' }}>
              {vesselCount ? vesselCount + ' AIS RELATION' + (vesselCount === 1 ? '' : 'S') : ''}{vesselCount && data.hazards?.length ? ' · ' : ''}{data.hazards?.length ? data.hazards.length + ' NATURAL EVENT' + (data.hazards.length === 1 ? '' : 'S') : ''}
            </span>
          </div>
          <div style={{ marginTop: 3, fontFamily: 'IBM Plex Mono, monospace', fontSize: 8, color: '#7a7e8a' }}>
            {(data.hazards || []).slice(0, 1).map(function(h) {
              return h.attributes?.categoryTitle || h.attributes?.title || 'External natural event'
            }).join('')}
          </div>
        </div>
      ) : null}

      {weather && (
        <div style={{ padding: '7px 8px', background: hazards.length ? 'rgba(239,68,68,.06)' : 'rgba(255,255,255,.025)', border: hazards.length ? '1px solid rgba(239,68,68,.18)' : '1px solid rgba(255,255,255,.06)', borderRadius: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 8, color: '#3e4252', textTransform: 'uppercase' }}>Environment</span>
            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 8, color: hazards.length ? '#ef4444' : '#16c784' }}>{hazards.length ? hazards.join(' · ').toUpperCase() : 'NO DECLARED HAZARD'}</span>
          </div>
          <div style={{ marginTop: 3, fontFamily: 'IBM Plex Mono, monospace', fontSize: 8, color: '#7a7e8a' }}>
            {(weather.attributes?.conditions || 'unknown') + ' · ' + (weather.attributes?.windSpeedKmh != null ? weather.attributes.windSpeedKmh + ' km/h wind' : 'wind —') + ' · ' + (weather.attributes?.visibilityM != null ? (weather.attributes.visibilityM / 1000).toFixed(1) + ' km vis' : 'visibility —')}
          </div>
        </div>
      )}

      {contextualRelations.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {contextualRelations.map(function(r, i) {
            return (
              <div key={r.toId + ':' + i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, fontFamily: 'IBM Plex Mono, monospace', fontSize: 8 }}>
                <span style={{ color: r.predicate === 'WITHIN' || r.predicate === 'NEAR_INCIDENT' ? '#ef4444' : '#f59e0b' }}>{titleCase(r.predicate)}</span>
                <span style={{ color: '#7a7e8a' }}>{fmtDistance(r.distanceM)} · {r.confidence != null ? Math.round(r.confidence * 100) + '%' : '—'}</span>
              </div>
            )
          })}
        </div>
      )}

      {events.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ fontSize: 8, color: '#3e4252', textTransform: 'uppercase' }}>Spatial Events</div>
          {events.map(function(e, i) {
            return <div key={e.eventType + ':' + i} style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 8, color: e.severity === 'high' || e.severity === 'critical' ? '#ef4444' : '#f59e0b' }}>{titleCase(e.eventType)} · {e.severity.toUpperCase()}</div>
          })}
        </div>
      )}

      {unavailable.length > 0 && (
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 8, color: '#7a7e8a' }}>Partial context: {unavailable.join(', ')} unavailable</div>
      )}

      {(data.uncertainty?.length || data.warnings?.length) ? (
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 8, color: '#6e6c64' }}>{data.uncertainty?.[0] || data.warnings?.[0]}</div>
      ) : null}
    </div>
  )
}
