import { describe, expect, it } from 'vitest'
import { externalWorldFeatures } from './spatialClient.js'

describe('externalWorldFeatures', () => {
  it('keeps external observations isolated and deduplicated', () => {
    const result = externalWorldFeatures({
      generatedAt: '2026-09-24T12:00:00Z',
      movement: [
        {
          id: 'opensky:aircraft:a1',
          entityType: 'aircraft',
          latitude: -1.29,
          longitude: 36.82,
          observedAt: '2026-09-24T11:59:55Z',
          quality: { freshnessClass: 'LIVE' },
          attributes: { callsign: 'KEN123' },
        },
      ],
      hazards: [
        {
          id: 'nasa:eonet:h1',
          entityType: 'natural_hazard',
          latitude: -1.30,
          longitude: 36.83,
          observedAt: null,
          quality: { freshnessClass: 'UNKNOWN' },
          attributes: { title: 'Wildfire' },
        },
      ],
      traffic: [
        {
          id: 'tomtom:traffic:i1',
          entityType: 'traffic_incident',
          latitude: -1.31,
          longitude: 36.84,
          quality: { freshnessClass: 'LIVE' },
          attributes: { category: 'roadClosed' },
        },
        {
          id: 'tomtom:traffic:i1',
          entityType: 'traffic_incident',
          latitude: -1.31,
          longitude: 36.84,
          quality: { freshnessClass: 'LIVE' },
          attributes: { category: 'roadClosed' },
        },
      ],
    })

    expect(result.features).toHaveLength(3)
    expect(result.features.find(f => f.properties.kind === 'aircraft')?.properties.label).toBe('KEN123')
    expect(result.features.find(f => f.properties.kind === 'natural_hazard')?.properties.freshness).toBe('UNKNOWN')
  })
})
