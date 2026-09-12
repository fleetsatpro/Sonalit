import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../../lib/api.js'
import { subscribe } from '../../../lib/centrifuge.js'
import { useAuthStore } from '../../../stores/auth.js'
import type { LiveStatus, LiveVehicle, ConvoyGroup, StatusCounts } from '../types/fleet.js'

interface DashVehicle {
  id: string; registration: string; convoy_id: string | null
  status: string; speed_kmh: number; last_ping_at: string | null
}
interface DashConvoy {
  id: string; name: string; origin: string | null; destination: string | null
}
interface GpsPos {
  device_id: string; vehicle_id: string | null; name?: string | null
  lat: number; lng: number; speed: number | null; heading: number | null; timestamp: string | null
  panic_active?: boolean; battery_level?: number | null; signal_strength?: number | null
  health_recorded_at?: string | null
  officer_name?: string | null; officer_phone?: string | null
}
// Realtime publishes on the org# channel carry a `type` field; GPS position
// updates are always 'location' (gpsWorker.js, guardian.js POST /location).
// Everything else on that channel (panic, panic_cancel, geofence:event,
// device.command, convoy.update, comms.*, ...) also carries device_id or
// vehicle_id, so without this check those events were being treated as GPS
// position updates and clobbering the real position with whatever partial
// fields they happened to carry (no lat/lng at all in most cases) — the
// device's marker would then vanish or freeze the instant any unrelated
// event fired for it.
interface RealtimeEvent { type?: string; device_id?: string; vehicle_id?: string }

function deriveStatus(speedKmh: number, secsAgo: number): LiveStatus {
  if (secsAgo > 1800) return 'offline'
  if (speedKmh > 5) return 'move'
  if (secsAgo < 300) return 'idle'
  return 'stop'
}

export function useLiveFleet() {
  const orgId = useAuthStore(s => s.user?.org_id ?? '')

  // keyed by vehicle_id (or device_id as fallback)
  const [positions, setPositions] = useState<Map<string, GpsPos>>(new Map())
  const posRef = useRef(positions)
  posRef.current = positions

  // device_ids with an unresolved panic_events row — seeded from /gps/track's
  // panic_active column, kept live by 'panic' / 'panic_cancel' publishes so a
  // brand-new SOS (or its cancellation) reflects on the map without a reload.
  const [panicDevices, setPanicDevices] = useState<Set<string>>(new Set())

  const { data: dashVehicles } = useQuery<DashVehicle[]>({
    queryKey: ['live-fleet-vehicles'],
    queryFn: async () => {
      const r = await api.get<{ data: DashVehicle[] }>('/dashboard/vehicles')
      return r.data.data ?? []
    },
    enabled: !!orgId,
    refetchInterval: 30_000,
    staleTime: 15_000,
  })

  const { data: dashConvoys } = useQuery<DashConvoy[]>({
    queryKey: ['live-fleet-convoys'],
    queryFn: async () => {
      const r = await api.get<{ data: DashConvoy[] }>('/dashboard/convoys')
      return r.data.data ?? []
    },
    enabled: !!orgId,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  // GPS positions — always fetch; used as primary source when no vehicle
  // records. Polled every 15s as a resilience floor: realtime Centrifugo
  // pushes are the fast path, but when that layer is down or unreachable
  // (publishes fail server-side, or the browser's websocket can't connect)
  // this poll is what keeps the map moving instead of freezing until a
  // manual page reload.
  useQuery<GpsPos[]>({
    queryKey: ['live-fleet-gps-init'],
    queryFn: async () => {
      const r = await api.get<GpsPos[]>('/gps/track')
      const next = new Map<string, GpsPos>()
      const panicking = new Set<string>()
      for (const p of r.data) {
        const key = p.vehicle_id ?? p.device_id
        next.set(key, p)
        if (p.panic_active) panicking.add(p.device_id)
      }
      setPositions(next)
      setPanicDevices(panicking)
      return r.data
    },
    enabled: !!orgId,
    staleTime: 0,
    refetchInterval: 15_000,
  })

  // Real-time GPS updates via Centrifuge
  useEffect(() => {
    if (!orgId) return
    return subscribe<GpsPos & RealtimeEvent>(`org#${orgId}`, ev => {
      if (ev.type && ev.type !== 'location') return
      if (!ev.device_id && !ev.vehicle_id) return
      const key = ev.vehicle_id ?? ev.device_id!
      setPositions(prev => {
        const next = new Map(prev)
        // A live location ping never carries battery/signal/health data
        // (that only comes from the periodic /gps/track fetch) — replacing
        // the whole entry instead of merging would wipe those fields the
        // instant a device's next GPS fix arrives.
        const existing = prev.get(key)
        next.set(key, existing ? { ...existing, ...ev } : ev)
        return next
      })
    })
  }, [orgId])

  // Real-time panic (SOS) state via Centrifuge — kept separate from the
  // position stream since panic events don't carry a position payload.
  useEffect(() => {
    if (!orgId) return
    return subscribe<RealtimeEvent>(`org#${orgId}`, ev => {
      if (ev.type === 'panic' && ev.device_id) {
        setPanicDevices(prev => (prev.has(ev.device_id!) ? prev : new Set(prev).add(ev.device_id!)))
      } else if (ev.type === 'panic_cancel' && ev.device_id) {
        setPanicDevices(prev => {
          if (!prev.has(ev.device_id!)) return prev
          const next = new Set(prev)
          next.delete(ev.device_id!)
          return next
        })
      }
    })
  }, [orgId])

  const convoyMap = useMemo(() => {
    const m = new Map<string, DashConvoy>()
    for (const c of (dashConvoys ?? [])) m.set(c.id, c)
    return m
  }, [dashConvoys])

  // Build a registration lookup from dashboard vehicles
  const vehicleRegMap = useMemo(() => {
    const m = new Map<string, DashVehicle>()
    for (const v of (dashVehicles ?? [])) m.set(v.id, v)
    return m
  }, [dashVehicles])

  const { groups, counts } = useMemo(() => {
    const now = Date.now()
    const byConvoy = new Map<string, LiveVehicle[]>()
    const standalone: LiveVehicle[] = []
    const officers: LiveVehicle[] = []
    const counts: StatusCounts = { all: 0, move: 0, idle: 0, stop: 0, sos: 0, offline: 0, officers: 0 }
    // Keys already represented by a vehicle row below, so the guardian pass
    // doesn't double-count a device whose ping happens to share a vehicle's key.
    const usedKeys = new Set<string>()

    // Seed: start from dashboard vehicles if available, otherwise from GPS positions
    const useDashboard = (dashVehicles?.length ?? 0) > 0

    if (useDashboard) {
      for (const v of dashVehicles!) {
        usedKeys.add(v.id)
        const pos = positions.get(v.id)
        const secsAgo = pos?.timestamp ? Math.floor((now - new Date(pos.timestamp).getTime()) / 1000) : 99999
        const speedKmh = pos ? (pos.speed ?? 0) : v.speed_kmh
        const isPanic = !!pos && panicDevices.has(pos.device_id)
        const status = isPanic ? 'sos' : deriveStatus(speedKmh, secsAgo)
        const lv: LiveVehicle = {
          id: v.id,
          registration: v.registration,
          convoy_id: v.convoy_id,
          convoy_name: v.convoy_id ? (convoyMap.get(v.convoy_id)?.name ?? null) : null,
          status,
          lat: pos?.lat ?? null,
          lng: pos?.lng ?? null,
          speed_kmh: speedKmh,
          heading: pos?.heading ?? null,
          last_ping_at: pos?.timestamp ?? v.last_ping_at,
          secondsAgo: secsAgo,
          panic_active: isPanic,
          location_desc: '',
          kind: 'vehicle',
          battery_level: pos?.battery_level ?? null,
          signal_strength: pos?.signal_strength ?? null,
          health_recorded_at: pos?.health_recorded_at ?? null,
          officer_name: pos?.officer_name ?? null,
          officer_phone: pos?.officer_phone ?? null,
        }
        counts.all++
        counts[status]++
        if (v.convoy_id) {
          if (!byConvoy.has(v.convoy_id)) byConvoy.set(v.convoy_id, [])
          byConvoy.get(v.convoy_id)!.push(lv)
        } else {
          standalone.push(lv)
        }
      }
    } else {
      // Fallback: build from GPS positions directly (like old GPS.tsx)
      for (const [key, pos] of positions) {
        usedKeys.add(key)
        const secsAgo = pos.timestamp ? Math.floor((now - new Date(pos.timestamp).getTime()) / 1000) : 99999
        const speedKmh = pos.speed ?? 0
        const isPanic = panicDevices.has(pos.device_id)
        const status = isPanic ? 'sos' : deriveStatus(speedKmh, secsAgo)
        const dashV = pos.vehicle_id ? vehicleRegMap.get(pos.vehicle_id) : undefined
        const lv: LiveVehicle = {
          id: key,
          registration: pos.name || dashV?.registration || pos.vehicle_id?.slice(0, 8) || pos.device_id.slice(0, 8),
          convoy_id: null,
          convoy_name: null,
          status,
          lat: pos.lat,
          lng: pos.lng,
          speed_kmh: speedKmh,
          heading: pos.heading,
          last_ping_at: pos.timestamp,
          secondsAgo: secsAgo,
          panic_active: isPanic,
          location_desc: '',
          kind: pos.vehicle_id ? 'vehicle' : 'guardian',
          battery_level: pos.battery_level ?? null,
          signal_strength: pos.signal_strength ?? null,
          health_recorded_at: pos.health_recorded_at ?? null,
          officer_name: pos.officer_name ?? null,
          officer_phone: pos.officer_phone ?? null,
        }
        counts.all++
        counts[status]++
        // "officers" backs the header's "N OFFICER(S) ONLINE" badge — it must
        // mean actually reachable right now, not "has a device record with
        // any position ever", or the badge contradicts the OFFLINE label the
        // same officer's own marker shows a few pixels away.
        if (lv.kind === 'guardian' && status !== 'offline') counts.officers++
        standalone.push(lv)
      }
    }

    // Guardian (field officer) devices with no vehicle assignment are a
    // separate position stream from /gps/track — when dashVehicles exists,
    // the loop above never visits them since it only walks dashVehicles.
    // Surface every one whose key wasn't already consumed by a vehicle above.
    if (useDashboard) {
      for (const [key, pos] of positions) {
        if (usedKeys.has(key) || pos.vehicle_id) continue
        usedKeys.add(key)
        const secsAgo = pos.timestamp ? Math.floor((now - new Date(pos.timestamp).getTime()) / 1000) : 99999
        const speedKmh = pos.speed ?? 0
        const isPanic = panicDevices.has(pos.device_id)
        const status = isPanic ? 'sos' : deriveStatus(speedKmh, secsAgo)
        const lv: LiveVehicle = {
          id: key,
          registration: pos.name || pos.device_id.slice(0, 8),
          convoy_id: null,
          convoy_name: null,
          status,
          lat: pos.lat,
          lng: pos.lng,
          speed_kmh: speedKmh,
          heading: pos.heading,
          last_ping_at: pos.timestamp,
          secondsAgo: secsAgo,
          panic_active: isPanic,
          location_desc: '',
          kind: 'guardian',
          battery_level: pos.battery_level ?? null,
          signal_strength: pos.signal_strength ?? null,
          health_recorded_at: pos.health_recorded_at ?? null,
          officer_name: pos.officer_name ?? null,
          officer_phone: pos.officer_phone ?? null,
        }
        counts.all++
        counts[status]++
        if (status !== 'offline') counts.officers++
        officers.push(lv)
      }
    }

    const groups: ConvoyGroup[] = []
    for (const [cid, vehicles] of byConvoy) {
      const convoy = convoyMap.get(cid)
      groups.push({
        id: cid,
        name: convoy?.name ?? cid,
        origin: convoy?.origin ?? null,
        destination: convoy?.destination ?? null,
        vehicles,
      })
    }
    if (standalone.length) {
      groups.push({
        id: '__standalone',
        name: 'Vehicles',
        origin: null,
        destination: null,
        vehicles: standalone,
      })
    }
    if (officers.length) {
      groups.push({
        id: '__guardian',
        name: 'Field Officers',
        origin: null,
        destination: null,
        vehicles: officers,
      })
    }

    return { groups, counts }
  }, [dashVehicles, positions, convoyMap, vehicleRegMap, panicDevices])

  return { groups, counts }
}
