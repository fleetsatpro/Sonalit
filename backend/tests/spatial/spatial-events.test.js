const { detectSpatialEvents } = require('../../src/services/spatial/spatialEvents');

function vehicle(overrides) {
  return Object.assign({
    id: 'vehicle-1',
    convoyId: 'convoy-1',
    observedAt: '2026-09-24T12:00:00.000Z',
    freshnessMs: 10000,
    quality: { freshnessClass: 'LIVE' },
    observationConfidence: 0.9,
    sourceReferences: ['vehicles:vehicle-1'],
    routeState: {
      relation: 'ON_ROUTE',
      crossTrackKm: 0.2,
      scheduleDeltaMin: 0,
      corridorKm: 2,
    },
    previousRouteState: { relation: 'ON_ROUTE', crossTrackKm: 0.1 },
    speedKmh: 45,
    historyGapMs: 30000,
    stationaryDurationMs: 0,
    nearbyCheckpoints: [],
  }, overrides || {});
}

describe('deterministic spatial events', () => {
  test('creates corridor exit with evidence', () => {
    const events = detectSpatialEvents({
      mission: { convoyId: 'convoy-1' },
      operational: {
        vehicles: [vehicle({
          routeState: {
            relation: 'OFF_ROUTE',
            crossTrackKm: 3.1,
            scheduleDeltaMin: -2,
            corridorKm: 2,
          },
          previousRouteState: { relation: 'ON_ROUTE' },
        })],
      },
      relations: [],
      environment: [],
    }, { now: Date.parse('2026-09-24T12:00:10.000Z') });

    const event = events.find(e => e.eventType === 'CORRIDOR_EXIT');
    expect(event).toBeTruthy();
    expect(event.eventKey).toBe('CORRIDOR_EXIT:vehicle:vehicle-1');
    expect(event.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: 'cross_track_km', value: 3.1 }),
    ]));
  });

  test('creates corridor re-entry and resolves the prior exit key', () => {
    const events = detectSpatialEvents({
      mission: { convoyId: 'convoy-1' },
      operational: {
        vehicles: [vehicle({
          routeState: { relation: 'ON_ROUTE', crossTrackKm: 0.2, corridorKm: 2 },
          previousRouteState: { relation: 'OFF_ROUTE' },
        })],
      },
      relations: [],
      environment: [],
    });
    const event = events.find(e => e.eventType === 'CORRIDOR_REENTRY');
    expect(event.resolvesEventKey).toBe('CORRIDOR_EXIT:vehicle:vehicle-1');
  });

  test('detects stale telemetry and impossible movement separately', () => {
    const events = detectSpatialEvents({
      mission: { convoyId: 'convoy-1' },
      operational: {
        vehicles: [vehicle({
          freshnessMs: 4_000_000,
          quality: { freshnessClass: 'STALE' },
          impliedSpeedKmh: 245,
        })],
      },
      relations: [],
      environment: [],
    });
    expect(events.some(e => e.eventType === 'STALE_TELEMETRY')).toBe(true);
    expect(events.some(e => e.eventType === 'POSITION_JUMP')).toBe(true);
  });

  test('detects a checkpoint approach from movement toward the checkpoint', () => {
    const events = detectSpatialEvents({
      mission: { convoyId: 'convoy-1' },
      operational: {
        vehicles: [vehicle({
          nearbyCheckpoints: [{
            id: 'cp-1',
            distanceM: 1600,
            previousDistanceM: 1900,
            approachDeltaM: 300,
            approaching: true,
            passed: false,
          }],
        })],
      },
      relations: [],
      environment: [],
    });
    expect(events.some(e => e.eventType === 'CHECKPOINT_APPROACH')).toBe(true);
  });

  test('turns weather hazards into an explicit contextual event', () => {
    const events = detectSpatialEvents({
      mission: { convoyId: 'convoy-1' },
      operational: { vehicles: [] },
      relations: [],
      environment: [{
        id: 'weather:1',
        observedAt: '2026-09-24T12:00:00.000Z',
        attributes: { hazards: ['high_wind'], severity: 'high' },
        provenance: { sourceReference: 'weather:1' },
      }],
    });
    const event = events.find(e => e.eventType === 'ENVIRONMENTAL_DETERIORATION');
    expect(event).toBeTruthy();
    expect(event.evidence[0].value).toBe('high_wind');
  });
  test('does not turn unverified intelligence into an actionable security event', () => {
    const events = detectSpatialEvents({
      mission: { convoyId: 'convoy-1' },
      operational: { vehicles: [] },
      relations: [{
        predicate: 'NEAR',
        fromId: 'sonalit:vehicle:vehicle-1',
        toId: 'sonalit:intel_alert:alert-1',
        fromType: 'vehicle',
        toType: 'intelligence_alert',
        distanceM: 1200,
        confidence: 0.8,
        operationalConfidence: 0.4,
        actionable: false,
        evidence: [{ metric: 'verification_state', value: 'unverified' }]
      }],
      environment: []
    });
    expect(events.find(e => e.eventType === 'INCIDENT_NEAR_CONVOY')).toBeUndefined();
    expect(events.find(e => e.eventType === 'HAZARD_NEAR_ROUTE')).toBeUndefined();
  });

  test('promotes an external traffic closure near a convoy route into an operational event', () => {
    const events = detectSpatialEvents({
      mission: { convoyId: 'convoy-1' },
      operational: { vehicles: [vehicle()] },
      relations: [{
        predicate: 'TRAFFIC_CLOSURE',
        fromId: 'vehicle-1',
        toId: 'mapbox:traffic:seg-1',
        fromType: 'vehicle',
        toType: 'traffic_segment',
        distanceM: 700,
        confidence: 0.82,
        operationalConfidence: 0.72,
        actionable: true,
        sourceReferences: ['seg-1'],
        evidence: [{ metric: 'closed', value: true }]
      }],
      environment: []
    });
    const event = events.find(e => e.eventType === 'TRAFFIC_CLOSURE');
    expect(event).toBeTruthy();
    expect(event.severity).toBe('high');
    expect(event.convoyId).toBe('convoy-1');
  });

  test('promotes a natural hazard near the route while preserving source uncertainty', () => {
    const events = detectSpatialEvents({
      mission: { convoyId: 'convoy-1' },
      operational: { vehicles: [vehicle()] },
      relations: [{
        predicate: 'NATURAL_HAZARD_NEAR_ROUTE',
        fromId: 'vehicle-1',
        toId: 'nasa:eonet:E1',
        fromType: 'vehicle',
        toType: 'natural_hazard',
        distanceM: 4500,
        confidence: 0.9,
        operationalConfidence: 0.7,
        actionable: true,
        sourceReferences: ['E1'],
        uncertainty: ['Representative point derived from provider geometry.']
      }],
      environment: []
    });
    const event = events.find(e => e.eventType === 'NATURAL_HAZARD_NEAR_ROUTE');
    expect(event).toBeTruthy();
    expect(event.severity).toBe('high');
    expect(event.uncertainty).toEqual(expect.arrayContaining(['Representative point derived from provider geometry.']));
  });

  test('does not alert on non-actionable external intelligence relations', () => {
    const events = detectSpatialEvents({
      mission: { convoyId: 'convoy-1' },
      operational: { vehicles: [vehicle()] },
      relations: [{
        predicate: 'TRAFFIC_CLOSURE',
        fromId: 'vehicle-1',
        toId: 'mapbox:traffic:seg-unknown',
        fromType: 'vehicle',
        toType: 'traffic_segment',
        distanceM: 500,
        confidence: 0.8,
        operationalConfidence: 0.4,
        actionable: false
      }],
      environment: []
    });
    expect(events.find(e => e.eventType === 'TRAFFIC_CLOSURE')).toBeUndefined();
  });

});
