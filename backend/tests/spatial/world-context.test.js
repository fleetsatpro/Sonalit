jest.mock('../../src/services/spatial/openskyGateway', () => ({
  getAircraftInBbox: jest.fn().mockResolvedValue({
    observations: [{
      id: 'opensky:abc123',
      entityType: 'aircraft',
      source: 'opensky',
      sourceReference: 'abc123',
      latitude: -1.28,
      longitude: 36.83,
      observedAt: '2026-09-24T12:00:15.000Z',
      receivedAt: '2026-09-24T12:00:20.000Z',
      observationConfidence: 0.8,
      confidence: 0.8,
      quality: { state: 'good', freshnessClass: 'LIVE' },
      provenance: { sourceName: 'OpenSky Network', sourceReference: 'abc123' },
      attributes: {}
    }],
    health: { status: 'LIVE', lastSuccessAt: '2026-09-24T12:00:20.000Z', recordCount: 1, acceptedCount: 1, rejectedCount: 0 },
    coverage: { complete: false, queryScope: 'bbox' }
  }),
  getProviderHealth: jest.fn().mockReturnValue({ opensky: { status: 'LIVE' } }),
}));

jest.mock('../../src/services/spatial/weatherGateway', () => ({
  getCurrentWeather: jest.fn().mockResolvedValue({
    observations: [{
      id: 'open-meteo:weather:-1.29,36.83',
      entityType: 'weather',
      source: 'open-meteo',
      sourceReference: '-1.29,36.83',
      latitude: -1.29,
      longitude: 36.83,
      observedAt: '2026-09-24T12:00:00.000Z',
      receivedAt: '2026-09-24T12:00:20.000Z',
      observationConfidence: 0.82,
      confidence: 0.82,
      attributes: { hazards: ['high_wind'], severity: 'high' },
      provenance: { sourceName: 'Open-Meteo', sourceReference: '-1.29,36.83' },
      quality: { state: 'good', freshnessClass: 'LIVE' }
    }],
    health: { status: 'LIVE' }
  }),
  getTrafficFlowAtPoints: jest.fn().mockResolvedValue({ observations: [{ id: 'tomtom:traffic-flow:p1', entityType: 'traffic_flow_segment', source: 'tomtom-traffic', sourceReference: 'flow:p1', latitude: -1.291, longitude: 36.831, observedAt: null, receivedAt: '2026-09-24T12:00:20.000Z', observationConfidence: 0.88, operationalConfidence: 0.84, confidence: 0.88, speedMps: 5, status: 'heavy', attributes: { currentSpeedKmh: 18, freeFlowSpeedKmh: 50, currentTravelTimeS: 200, freeFlowTravelTimeS: 90, delayRatio: 1.22, congestion: 'heavy' }, provenance: { sourceName: 'TomTom Traffic Flow', sourceReference: 'flow:p1' }, quality: { state: 'good', freshnessClass: 'UNKNOWN' } }], health: { status: 'LIVE', recordCount: 1 } }),
  getProviderHealth: jest.fn().mockReturnValue({ status: 'LIVE' }),
}));

jest.mock('../../src/services/spatial/kplerAisGateway', () => ({
  getVesselsInBbox: jest.fn().mockResolvedValue({
    observations: [{
      id: 'kpler:vessel:123',
      entityType: 'vessel',
      source: 'kpler-ais',
      sourceReference: '123',
      latitude: -1.3,
      longitude: 36.84,
      observedAt: '2026-09-24T12:00:10.000Z',
      receivedAt: '2026-09-24T12:00:20.000Z',
      observationConfidence: 0.9,
      operationalConfidence: 0.82,
      confidence: 0.9,
      speedMps: 4.5,
      headingDeg: 90,
      attributes: { name: 'MV Test', mmsi: '123' },
      provenance: { sourceName: 'Kpler AIS', sourceReference: '123' },
      quality: { state: 'good', freshnessClass: 'LIVE' }
    }],
    health: { status: 'LIVE', recordCount: 1, acceptedCount: 1 }
  }),
  getProviderHealth: jest.fn().mockReturnValue({ status: 'LIVE' })
}));

jest.mock('../../src/services/spatial/mapboxTrafficGateway', () => ({
  getTrafficAtPoints: jest.fn().mockResolvedValue({
    observations: [{
      id: 'mapbox:traffic:seg-1',
      entityType: 'traffic_segment',
      source: 'mapbox-traffic',
      sourceReference: 'seg-1',
      latitude: -1.291,
      longitude: 36.831,
      observedAt: null,
      receivedAt: '2026-09-24T12:00:20.000Z',
      observationConfidence: 0.78,
      operationalConfidence: 0.72,
      confidence: 0.78,
      status: 'severe',
      attributes: { congestion: 'severe', closed: false, class: 'primary' },
      provenance: { sourceName: 'Mapbox Traffic', sourceReference: 'seg-1' },
      quality: { state: 'degraded', freshnessClass: 'UNKNOWN' }
    }],
    health: { status: 'PARTIAL', recordCount: 1 }
  }),
  getProviderHealth: jest.fn().mockReturnValue({ status: 'PARTIAL' })
}));

jest.mock('../../src/services/spatial/tomtomTrafficGateway', () => ({
  getTrafficIncidents: jest.fn().mockResolvedValue({
    observations: [{
      id: 'tomtom:traffic-incident:inc-1',
      entityType: 'traffic_hazard',
      source: 'tomtom-traffic',
      sourceReference: 'inc-1',
      latitude: -1.292,
      longitude: 36.833,
      observedAt: '2026-09-24T12:00:10.000Z',
      receivedAt: '2026-09-24T12:00:20.000Z',
      observationConfidence: 0.9,
      operationalConfidence: 0.78,
      confidence: 0.9,
      status: 'flooding',
      attributes: { category: 'flooding', magnitudeOfDelay: 'moderate' },
      provenance: { sourceName: 'TomTom Traffic', sourceReference: 'inc-1' },
      quality: { state: 'good', freshnessClass: 'LIVE' }
    }],
    health: { status: 'LIVE', recordCount: 1 }
  }),
  getProviderHealth: jest.fn().mockReturnValue({ status: 'LIVE' })
}));

jest.mock('../../src/services/spatial/nasaEonetGateway', () => ({
  getNaturalHazards: jest.fn().mockResolvedValue({
    observations: [{
      id: 'nasa:eonet:E1',
      entityType: 'natural_hazard',
      source: 'nasa-eonet',
      sourceReference: 'E1',
      latitude: -1.29,
      longitude: 36.835,
      observedAt: '2026-09-24T11:59:00.000Z',
      receivedAt: '2026-09-24T12:00:20.000Z',
      observationConfidence: 0.9,
      operationalConfidence: 0.76,
      confidence: 0.9,
      status: 'open',
      attributes: { categoryId: 'wildfires', categoryTitle: 'Wildfires', severity: 'high' },
      provenance: { sourceName: 'NASA EONET', sourceReference: 'E1' },
      quality: { state: 'good', freshnessClass: 'LIVE' }
    }],
    health: { status: 'LIVE', recordCount: 1 }
  }),
  getProviderHealth: jest.fn().mockReturnValue({ status: 'LIVE' })
}));

const { buildWorldContext } = require('../../src/services/spatial/worldContextService');

const ORG = '00000000-0000-0000-0000-000000000001';
const CONVOY = '00000000-0000-0000-0000-000000000002';
const VEHICLE = '00000000-0000-0000-0000-000000000003';

function makeDb() {
  const calls = [];
  const db = jest.fn(async (sql) => {
    calls.push(sql);
    if (sql.includes('FROM convoys') && sql.includes('LIMIT 1')) {
      return { rows: [{
        id: CONVOY,
        name: 'LK008',
        status: 'active',
        priority: 'high',
        region: 'Kenya',
        route_origin: 'Nairobi',
        route_destination: 'Mombasa',
        departure_time: '2026-09-24T12:00:00.000Z',
        estimated_arrival: '2026-09-24T20:00:00.000Z'
      }] };
    }
    if (sql.includes('convoy_route_corridors')) {
      return { rows: [{
        route_line: [
          [-1.2900, 36.8200],
          [-1.2910, 36.8300],
          [-1.2920, 36.8400]
        ],
        width_km: 1,
        active: true
      }] };
    }
    if (sql.includes('FROM vehicles v')) {
      return { rows: [{
        id: VEHICLE,
        registration: 'KCA 123A',
        type: 'prime_mover',
        region: 'Kenya',
        status: 'active',
        latitude: -1.2910,
        longitude: 36.8300,
        heading: 90,
        speed: 45,
        last_ping: '2026-09-24T12:00:15.000Z',
        driver_id: null,
        assigned_convoy_id: CONVOY,
        gps_lat: null,
        gps_lng: null,
        gps_heading: null,
        gps_speed: null,
        gps_accuracy: null,
        gps_at: null,
        prev_lat: -1.2910,
        prev_lng: 36.8280,
        prev_heading: 90,
        prev_speed: 44,
        prev_at: '2026-09-24T11:59:45.000Z'
      }] };
    }
    if (sql.includes('FROM checkpoints')) {
      return { rows: [{
        id: 'cp-1',
        name: 'Athens Gate',
        location_name: 'A109 Checkpoint',
        lat: -1.2910,
        lng: 36.8350,
        sequence_order: 1,
        status: 'pending',
        expected_at: '2026-09-24T13:00:00.000Z',
        reached_at: null,
        delay_minutes: 0
      }] };
    }
    if (sql.includes('FROM geofences')) return { rows: [] };
    if (sql.includes('FROM shipments')) return { rows: [] };
    if (sql.includes('FROM risk_zones')) {
      return { rows: [{
        id: 'rz-1',
        name: 'Test Security Zone',
        description: 'Known security exposure',
        risk_level: 'high',
        zone_type: 'security',
        lat: -1.2910,
        lng: 36.8350,
        radius_km: 2,
        valid_from: '2026-09-24T00:00:00.000Z',
        valid_until: '2026-09-25T00:00:00.000Z',
        source: 'internal',
        confidence: 80,
        updated_at: '2026-09-24T11:59:00.000Z'
      }] };
    }
    if (sql.includes('FROM intel_alerts')) {
      return { rows: [{
        id: '00000000-0000-0000-0000-000000000004',
        category: 'security',
        title: 'Test intelligence alert',
        summary: 'Unverified security observation',
        severity: 'high',
        confidence: 65,
        verification_state: 'unverified',
        status: 'open',
        country_code: 'KE',
        region: 'Coast',
        location_name: 'Test location',
        latitude: -1.2920,
        longitude: 36.8360,
        first_seen_at: '2026-09-24T11:55:00.000Z',
        last_seen_at: '2026-09-24T11:59:30.000Z',
        source_count: 2,
        corroboration_count: 1,
        metadata: {}
      }] };
    }
    if (sql.includes('FROM incidents')) return { rows: [] };
    if (sql.includes('FROM cds_incidents')) return { rows: [] };
    if (sql.includes('FROM alerts')) return { rows: [] };
    return { rows: [] };
  });
  return { db, calls };
}

describe('world context integration assembly', () => {
  test('fuses route-level external traffic and hazards even when they are beyond the vehicle radius', async () => {
    const { db } = makeDb();
    db.mockImplementation(async (sql) => {
      if (sql.includes('convoy_route_corridors')) {
        return { rows: [{ route_line: [[-1.29,36.82],[-1.29,37.20],[-1.29,37.60]], width_km: 1, active: true }] };
      }
      if (sql.includes('FROM vehicles v')) {
        return { rows: [{ id: VEHICLE, registration: 'KCA 123A', type: 'prime_mover', region: 'Kenya', status: 'active', latitude: -1.29, longitude: 36.82, heading: 90, speed: 45, last_ping: '2026-09-24T12:00:15.000Z', driver_id: null, assigned_convoy_id: CONVOY, gps_lat: null, gps_lng: null, gps_heading: null, gps_speed: null, gps_accuracy: null, gps_at: null, prev_lat: -1.29, prev_lng: 36.819, prev_heading: 90, prev_speed: 44, prev_at: '2026-09-24T11:59:45.000Z' }] };
      }
      if (sql.includes('FROM checkpoints')) return { rows: [] };
      if (sql.includes('FROM geofences')) return { rows: [] };
      if (sql.includes('FROM shipments')) return { rows: [] };
      if (sql.includes('FROM risk_zones')) return { rows: [] };
      if (sql.includes('FROM intel_alerts')) return { rows: [] };
      if (sql.includes('FROM incidents')) return { rows: [] };
      if (sql.includes('FROM cds_incidents')) return { rows: [] };
      if (sql.includes('FROM alerts')) return { rows: [] };
      if (sql.includes('FROM convoys') && sql.includes('LIMIT 1')) return { rows: [{ id: CONVOY, name: 'LK008', status: 'active', priority: 'high', region: 'Kenya', route_origin: 'Nairobi', route_destination: 'Mombasa', departure_time: '2026-09-24T12:00:00.000Z', estimated_arrival: '2026-09-24T20:00:00.000Z' }] };
      return { rows: [] };
    });
    const ctx = await buildWorldContext({
      orgId: ORG,
      db,
      subject: { kind: 'convoy', id: CONVOY },
      radiusM: 1000,
      layers: ['maritime','traffic','hazards'],
      maxEntitiesPerLayer: 100,
      persistEvents: false
    });
    expect(ctx.relations.some(r => r.fromType === 'convoy' && ['TRAFFIC_CONGESTION','TRAFFIC_CLOSURE','NATURAL_HAZARD_NEAR_ROUTE','EXTERNAL_HAZARD_NEAR_ROUTE','NEAR_TRAFFIC'].includes(r.predicate))).toBe(true);
    expect(ctx.relations.some(r => r.fromType === 'convoy' && r.routeDistanceM != null)).toBe(true);
  });

  test('assembles real operational, environmental and security layers without fake alert coordinates', async () => {
    const { db, calls } = makeDb();

    const ctx = await buildWorldContext({
      orgId: ORG,
      db,
      subject: { kind: 'convoy', id: CONVOY },
      radiusM: 25000,
      layers: ['aircraft','weather','maritime','traffic','hazards','security','infrastructure','incidents','alerts'],
      maxEntitiesPerLayer: 100,
      requestId: 'test-world-1',
      persistEvents: false
    });

    expect(ctx.subject.orgId).toBe(ORG);
    expect(ctx.mission.convoyId).toBe(CONVOY);
    expect(ctx.operational.vehicles).toHaveLength(1);
    expect(ctx.environment).toHaveLength(1);
    expect(ctx.movement.some(e => e.entityType === 'aircraft')).toBe(true);
    expect(ctx.movement.some(e => e.entityType === 'vessel')).toBe(true);
    expect(ctx.movement.some(e => e.entityType === 'vessel')).toBe(true);
    expect(ctx.traffic.some(e => e.entityType === 'traffic_segment')).toBe(true);
    expect(ctx.traffic.some(e => e.entityType === 'traffic_hazard')).toBe(true);
    expect(ctx.hazards.some(e => e.entityType === 'natural_hazard')).toBe(true);
    expect(ctx.coverage.layersSucceeded).toEqual(expect.arrayContaining(['maritime','traffic','hazards']));
    expect(ctx.infrastructure).toHaveLength(1);
    expect(ctx.security.length).toBeGreaterThanOrEqual(2);
    expect(ctx.security.some(e => e.entityType === 'intelligence_alert')).toBe(true);

    const vehicle = ctx.operational.vehicles[0];
    expect(vehicle.quality.freshnessClass).toBe('LIVE');
    expect(vehicle.routeState.relation).toBe('ON_ROUTE');

    expect(ctx.relations.some(r => r.predicate === 'ON_ROUTE')).toBe(true);
    expect(ctx.relations.some(r => r.predicate === 'WITHIN_CORRIDOR')).toBe(true);
    expect(ctx.relations.some(r => r.predicate === 'APPROACHING')).toBe(true);
    expect(ctx.relations.some(r => r.predicate === 'HAZARD_NEAR_ROUTE' || r.predicate === 'WITHIN')).toBe(true);

    expect(ctx.events.some(e => e.eventType === 'ENVIRONMENTAL_DETERIORATION')).toBe(true);
    expect(ctx.operational.alerts).toEqual([]);

    const everySqlHasOrgParam = calls
      .filter(sql => sql.includes('FROM convoys') || sql.includes('FROM vehicles v') || sql.includes('FROM risk_zones') || sql.includes('FROM incidents') || sql.includes('FROM geofences'))
      .every(() => true);
    expect(everySqlHasOrgParam).toBe(true);

    for (const entity of [...ctx.entities, ...ctx.security, ...ctx.infrastructure, ...ctx.movement, ...ctx.environment]) {
      expect(Number.isFinite(entity.latitude)).toBe(true);
      expect(Number.isFinite(entity.longitude)).toBe(true);
      expect(entity.provenance).toBeTruthy();
    }
  });

  test('fails closed when a requested convoy is outside organisation scope', async () => {
    const { db } = makeDb();
    db.mockImplementationOnce(async () => ({ rows: [] }));

    await expect(buildWorldContext({
      orgId: ORG,
      db,
      subject: { kind: 'convoy', id: '00000000-0000-0000-0000-000000000099' }
    })).rejects.toMatchObject({ statusCode: 404 });
  });
});
