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
  device_id: string; vehicle_id: string | null
  lat: number; lng: number; speed: number | null; heading: number | null; timestamp: string
}
interface GpsEvent extends GpsPos {}

function deriveStatus(v: DashVehicle, secsAgo: number): LiveStatus {
  if (secsAgo > 1800) return 'offline'
  if (v.speed_kmh > 5) return 'move'
  if (secsAgo < 300) return 'idle'
  return 'stop'
}

export function useLiveFleet() {
  const orgId = useAuthStore(s => s.user?.org_id ?? '')

  // live positions: keyed by vehicle_id
  const [positions, setPositions] = useState<Map<string, GpsPos>>(new Map())
  const posRef = useRef(positions)
  posRef.current = positions

  const { data: dashVehicles } = useQuery<DashVehicle[]>({
    queryKey: ['live-fleet-vehicles'],
    queryFn: async () => { const r = await api.get<{ data: DashVehicle[] }>('/dashboard/vehicles'); return r.data.data ?? [] },
    enabled: !!orgId,
    refetchInterval: 30_000,
    staleTime: 15_000,
  })

  const { data: dashConvoys } = useQuery<DashConvoy[]>({
    queryKey: ['live-fleet-convoys'],
    queryFn: async () => { const r = await api.get<{ data: DashConvoy[] }>('/dashboard/convoys'); return r.data.data ?? [] },
    enabled: !!orgId,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  // Initial GPS positions
  useQuery<GpsPos[]>({
    queryKey: ['live-fleet-gps-init'],
    queryFn: async () => {
      const r = await api.get<GpsPos[]>('/gps/track')
      const next = new Map<string, GpsPos>()
      for (const p of r.data) { if (p.vehicle_id) next.set(p.vehicle_id, p) }
      setPositions(next)
      return r.data
    },
    enabled: !!orgId,
    staleTime: 0,
  })

  // Real-time GPS updates
  useEffect(() => {
    if (!orgId) return
    return subscribe<GpsEvent>(`org#${orgId}`, ev => {
      if (!ev.vehicle_id) return
      setPositions(prev => {
        const next = new Map(prev)
        next.set(ev.vehicle_id!, {
          device_id: ev.device_id,
          vehicle_id: ev.vehicle_id ?? null,
          lat: ev.lat, lng: ev.lng,
          speed: ev.speed, heading: ev.heading,
          timestamp: ev.timestamp,
        })
        return next
      })
    })
  }, [orgId])

  const convoyMap = useMemo(() => {
    const m = new Map<string, DashConvoy>()
    for (const c of (dashConvoys ?? [])) m.set(c.id, c)
    return m
  }, [dashConvoys])

  const { groups, counts } = useMemo(() => {
    const now = Date.now()
    const byConvoy = new Map<string, LiveVehicle[]>()
    const standalone: LiveVehicle[] = []
    const counts: StatusCounts = { all: 0, move: 0, idle: 0, stop: 0, sos: 0, offline: 0 }

    for (const v of (dashVehicles ?? [])) {
      const pos = positions.get(v.id)
      const secsAgo = pos ? Math.floor((now - new Date(pos.timestamp).getTime()) / 1000) : 99999
      const status: LiveStatus = deriveStatus(v, secsAgo)
      const lv: LiveVehicle = {
        id: v.id,
        registration: v.registration,
        convoy_id: v.convoy_id,
        convoy_name: v.convoy_id ? (convoyMap.get(v.convoy_id)?.name ?? null) : null,
        status,
        lat: pos?.lat ?? null,
        lng: pos?.lng ?? null,
        speed_kmh: pos ? ((pos.speed ?? 0) * 3.6) : v.speed_kmh,
        heading: pos?.heading ?? null,
        last_ping_at: pos?.timestamp ?? v.last_ping_at,
        secondsAgo: secsAgo,
        panic_active: false,
        location_desc: '',
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

    const groups: ConvoyGroup[] = []
    for (const [cid, vehicles] of byConvoy) {
      const convoy = convoyMap.get(cid)
      groups.push({ id: cid, name: convoy?.name ?? cid, origin: convoy?.origin ?? null, destination: convoy?.destination ?? null, vehicles })
    }
    if (standalone.length) groups.push({ id: '__standalone', name: 'Standalone Vehicles', origin: null, destination: null, vehicles: standalone })

    return { groups, counts }
  }, [dashVehicles, positions, convoyMap])

  return { groups, counts }
}
