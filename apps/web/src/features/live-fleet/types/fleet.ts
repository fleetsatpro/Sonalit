export type LiveStatus = 'move' | 'idle' | 'stop' | 'offline' | 'sos'

export interface LiveVehicle {
  id: string
  registration: string
  convoy_id: string | null
  convoy_name: string | null
  status: LiveStatus
  lat: number | null
  lng: number | null
  speed_kmh: number
  heading: number | null
  last_ping_at: string | null
  secondsAgo: number
  panic_active: boolean
  location_desc: string
  /** 'guardian' = a field officer's Guardian device, not tied to any vehicle. */
  kind: 'vehicle' | 'guardian'
  /**
   * Latest device_health reading for Guardian devices; null/undefined = not
   * reported. health_recorded_at is the reading's own timestamp — it can be
   * far older than last_ping_at (a GPS fix and a battery/signal check are
   * independent events), so a UI showing these numbers must show their age
   * too, or a long-stale reading looks like live telemetry.
   */
  battery_level: number | null
  signal_strength: number | null
  health_recorded_at: string | null
}

export interface ConvoyGroup {
  id: string
  name: string
  origin: string | null
  destination: string | null
  vehicles: LiveVehicle[]
}

export interface StatusCounts {
  all: number
  move: number
  idle: number
  stop: number
  sos: number
  offline: number
  /** Field officers (Guardian devices) currently reporting a position, out of `all`. */
  officers: number
}
