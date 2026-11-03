'use strict';

const {
  MAX_OPERATIONAL_CONFIDENCE,
  buildCrossLayerFusionRelations,
  isModelledSatellite,
} = require('../../src/services/spatial/crossLayerFusion');

describe('cross-layer spatial fusion', () => {
  const now = '2026-09-25T20:00:00.000Z';
  const route = [
    { lat: -1.2900, lng: 36.8200 },
    { lat: -1.2910, lng: 36.8300 },
    { lat: -1.2920, lng: 36.8400 }
  ];

  const vehicle = {
    id: 'sonalit:vehicle:v1',
    entityType: 'vehicle',
    latitude: -1.2910,
    longitude: 36.8310,
    observedAt: now,
    observationConfidence: 0.9,
    operationalConfidence: 0.9
  };

  const hazard = {
    id: 'usgs:eq:h1',
    entityType: 'natural_hazard',
    latitude: -1.2910,
    longitude: 36.8350,
    observedAt: now,
    observationConfidence: 0.98,
    operationalConfidence: 0.22,
    attributes: { hazardType: 'earthquake', severity: 'moderate' },
    uncertainty: ['Detection does not establish route or fleet impact.']
  };

  const camera = {
    id: 'cctv:cam1',
    entityType: 'camera',
    latitude: -1.2910,
    longitude: 36.8300,
    observedAt: now,
    observationConfidence: 0.9,
    attributes: {
      camera: {
        pose: {
          latitude: -1.2910,
          longitude: 36.8300,
          headingDeg: 90,
          confidence: 'verified'
        },
        viewshed: {
          horizontalFovDeg: 120,
          maxRangeM: 10_000,
          minRangeM: 0
        }
      }
    }
  };

  const satellite = {
    id: 'celestrak:25544',
    entityType: 'satellite',
    latitude: -1.2910,
    longitude: 36.8300,
    receivedAt: now,
    observationConfidence: 0.98,
    operationalConfidence: 0.35,
    positionSource: 'modelled',
    telemetryLive: false,
    attributes: {
      positionMode: 'SGP4_PROPAGATED',
      positionSource: 'modelled',
      telemetryLive: false,
      imagingClaim: false,
      taskingClaim: false
    }
  };

  test('emits the four Gate 3 relation families', () => {
    const relations = buildCrossLayerFusionRelations({
      vehicles: [vehicle],
      cameras: [camera],
      hazards: [hazard],
      satellites: [satellite],
      route,
      routeId: 'sonalit:route:convoy-1',
      corridorId: 'sonalit:corridor:convoy-1',
      corridorWidthKm: 1,
      now
    });

    expect(relations.some(r => r.predicate === 'HAZARD_IN_CAMERA_VIEWSHED')).toBe(true);
    expect(relations.some(r => r.predicate === 'HAZARD_ON_ROUTE_CORRIDOR')).toBe(true);
    expect(relations.some(r => r.predicate === 'SATELLITE_NEAR_ROUTE')).toBe(true);
    expect(relations.some(r => r.predicate === 'VEHICLE_IN_HAZARD_PROXIMITY')).toBe(true);
  });

  test('keeps all Gate 3 relations low-confidence and non-actionable', () => {
    const relations = buildCrossLayerFusionRelations({
      vehicles: [vehicle],
      cameras: [camera],
      hazards: [hazard],
      satellites: [satellite],
      route,
      routeId: 'sonalit:route:convoy-1',
      corridorId: 'sonalit:corridor:convoy-1',
      corridorWidthKm: 1,
      now
    });

    expect(relations.length).toBeGreaterThanOrEqual(4);
    for (const relation of relations) {
      expect(relation.operationalConfidence).toBeLessThanOrEqual(MAX_OPERATIONAL_CONFIDENCE);
      expect(relation.actionable).toBe(false);
      expect(relation.uncertainty.length).toBeGreaterThan(0);
      expect(relation.semantics.geometryOnly).toBe(true);
    }
  });

  test('never upgrades satellite geometry into telemetry, imaging or tasking claims', () => {
    const relations = buildCrossLayerFusionRelations({
      satellites: [satellite],
      route,
      routeId: 'sonalit:route:convoy-1',
      corridorId: 'sonalit:corridor:convoy-1',
      corridorWidthKm: 1,
      now
    });

    const relation = relations.find(r => r.predicate === 'SATELLITE_NEAR_ROUTE');
    expect(relation).toBeTruthy();
    expect(relation.semantics.positionSource).toBe('modelled');
    expect(relation.semantics.telemetryLive).toBe(false);
    expect(relation.semantics.imagingClaim).toBe(false);
    expect(relation.semantics.taskingClaim).toBe(false);
    expect(relation.semantics.collectionClaim).toBe(false);
    expect(isModelledSatellite(satellite)).toBe(true);
  });

  test('does not create cross-layer relations without usable geometry', () => {
    const relations = buildCrossLayerFusionRelations({
      vehicles: [{ ...vehicle, latitude: null }],
      cameras: [{ ...camera, latitude: null }],
      hazards: [{ ...hazard, longitude: null }],
      satellites: [{ ...satellite, latitude: null }],
      route,
      now
    });
    expect(relations).toEqual([]);
  });

  test('deduplicates by predicate and endpoints', () => {
    const relations = buildCrossLayerFusionRelations({
      vehicles: [vehicle, { ...vehicle }],
      hazards: [hazard, { ...hazard }],
      route,
      now
    });
    const keys = relations.map(r => [r.predicate, r.fromId, r.toId].join('|'));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
