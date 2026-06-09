export type RiskLevel = 'high' | 'medium' | 'low'
export type Velocity = 'rising' | 'stable' | 'falling'
export type Continent = 'global' | 'africa' | 'asia' | 'europe' | 'americas' | 'mideast' | 'oceania'

export interface RiskZone {
  id: string
  zone_code: string
  continent: string
  level: RiskLevel
  name: string
  region: string
  why: string
  when_active: string
  precaution: string
  tags: string[]
  map_lon: number
  map_lat: number
  confidence: number
  velocity: Velocity
  events: number
  events_24h: number
  week_data: number[]
  updated_at: string
}

export interface RiskEvent {
  id: string
  occurred_at: string
  description: string
  level: RiskLevel
  source: string
}

export interface RiskConvoy {
  id: string
  name: string
  status: string
  continent: string
  affected_zones: string[]
  driver_name?: string
  highest_level: RiskLevel
}

export interface TickerItem {
  level: RiskLevel
  zone_code: string
  text: string
  occurred_at: string
}

export interface RiskCounts {
  high: number
  medium: number
  low: number
  total: number
}

export interface RiskZonesResponse {
  zones: RiskZone[]
  counts: RiskCounts
}
