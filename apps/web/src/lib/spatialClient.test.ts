import { describe, expect, it } from 'vitest'
import { externalWorldFeatures, spatialEntityLayer, WORLD_CONTEXT_LAYERS, worldContextEntities } from './spatialClient.js'

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
  it('normalises the complete 11-layer world fabric and preserves modelled orbital altitude metadata', () => {
    const satellite = {
      id: 'celestrak:25544',
      entityType: 'satellite',
      latitude: -1.29,
      longitude: 36.83,
      altitudeM: 408000,
      source: 'celestrak',
      quality: { freshnessClass: 'MODELLED' },
      attributes: { name: 'ISS (ZARYA)', positionMode: 'SGP4_PROPAGATED', imagingClaim: false, taskingClaim: false },
    }
    const context = {
      generatedAt: '2026-09-24T12:00:00Z',
      movement: [{ id: 'air-1', entityType: 'aircraft', latitude: -1, longitude: 36, quality: { freshnessClass: 'LIVE' } }],
      environment: [{ id: 'wx-1', entityType: 'weather', latitude: -1.1, longitude: 36.1, quality: { freshnessClass: 'LIVE' } }],
      traffic: [{ id: 'trf-1', entityType: 'traffic_segment', latitude: -1.2, longitude: 36.2, quality: { freshnessClass: 'UNKNOWN' } }],
      hazards: [{ id: 'haz-1', entityType: 'natural_hazard', latitude: -1.3, longitude: 36.3, quality: { freshnessClass: 'LIVE' } }],
      security: [{ id: 'sec-1', entityType: 'risk_zone', latitude: -1.4, longitude: 36.4, quality: { freshnessClass: 'UNKNOWN' } }],
      infrastructure: [{ id: 'inf-1', entityType: 'facility', latitude: -1.5, longitude: 36.5, quality: { freshnessClass: 'UNKNOWN' } }],
      incidents: [{ id: 'inc-1', entityType: 'incident', latitude: -1.6, longitude: 36.6, quality: { freshnessClass: 'LIVE' } }],
      operational: { alerts: [{ id: 'alert-1', entityType: 'alert', latitude: null as unknown as number, longitude: null as unknown as number, quality: { freshnessClass: 'LIVE' } }] },
      cameras: [{ id: 'cam-1', entityType: 'spatial_camera', latitude: -1.7, longitude: 36.7, quality: { freshnessClass: 'LIVE' } }],
      satellites: [satellite],
      entities: [satellite],
    }
    const entities = worldContextEntities(context)
    expect(WORLD_CONTEXT_LAYERS).toHaveLength(11)
    expect(new Set(entities.map(entity => entity.id)).size).toBe(10)
    expect(entities.filter(entity => entity.entityType === 'satellite')).toHaveLength(1) // the same satellite is supplied through two buckets
    expect(spatialEntityLayer(satellite)).toBe('satellites')
    const layerSamples = [
      ['aircraft', 'aircraft'], ['weather', 'weather'], ['vessel', 'maritime'],
      ['traffic_flow_segment', 'traffic'], ['natural_hazard', 'hazards'], ['risk_zone', 'security'],
      ['facility', 'infrastructure'], ['incident', 'incidents'], ['alert', 'alerts'],
      ['spatial_camera', 'cameras'], ['satellite', 'satellites'],
    ] as const
    for (const [entityType, layer] of layerSamples) {
      expect(spatialEntityLayer({ ...satellite, id: entityType, entityType })).toBe(layer)
    }
    expect(externalWorldFeatures(context).features.find(f => f.properties.kind === 'satellite')?.properties.freshness).toBe('MODELLED')
  })

})
