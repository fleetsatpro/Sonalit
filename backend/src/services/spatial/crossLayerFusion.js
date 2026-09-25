'use strict';

/**
 * Cross-layer spatial fusion.
 *
 * This module only emits bounded geometric relationships between already
 * normalised observations. It never upgrades geometric proximity into:
 * - visual acquisition,
 * - confirmed hazard impact or closure authority,
 * - live satellite telemetry,
 * - satellite imaging or tasking claims.
 */

const { projectOntoRoute, haversineKm } = require('../geofence/corridor');
const { pointInViewshed } = require('./cctv/spatialCameraGeometry');

const DEFAULT_CAMERA_NEAR_M = 25_000;
const DEFAULT_HAZARD_NEAR_M = 25_000;
const DEFAULT_HAZARD_PROXIMITY_M = 5_000;
const DEFAULT_SATELLITE_ROUTE_NEAR_M = 50_000;
const MAX_OPERATIONAL_CONFIDENCE = 0.45;
const MAX_RELATIONS = 500;

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pointOf(entity) {
  if (!entity || typeof entity !== 'object') return null;

  const pose = entity.pose || entity.attributes?.pose || entity.attributes?.camera?.pose;
  const latitude = finite(
    entity.latitude ??
    entity.lat ??
    pose?.latitude ??
    pose?.lat ??
    entity.attributes?.latitude ??
    entity.attributes?.lat
  );
  const longitude = finite(
    entity.longitude ??
    entity.lng ??
    entity.lon ??
    pose?.longitude ??
    pose?.lng ??
    pose?.lon ??
    entity.attributes?.longitude ??
    entity.attributes?.lng ??
    entity.attributes?.lon
  );

  if (latitude == null || longitude == null ||
      latitude < -90 || latitude > 90 ||
      longitude < -180 || longitude > 180) {
    return null;
  }

  return { latitude, longitude };
}

function observationConfidence(entity, fallback = 0.5) {
  const value = finite(
    entity?.observationConfidence ??
    entity?.confidence ??
    entity?.operationalConfidence ??
    fallback
  );
  return value == null ? fallback : Math.max(0, Math.min(1, value));
}

function lowOperationalConfidence(a, b, geometryFactor = 0.5) {
  const value = observationConfidence(a) * observationConfidence(b) * geometryFactor;
  return Math.round(Math.min(MAX_OPERATIONAL_CONFIDENCE, Math.max(0, value)) * 1000) / 1000;
}

function sourceReferences(...entities) {
  return entities.flatMap(entity => [
    entity?.source,
    entity?.sourceReference,
    entity?.id
  ].filter(Boolean).map(String));
}

function relationBase({
  predicate,
  from,
  to,
  fromType,
  toType,
  distanceM = null,
  routeDistanceM = null,
  confidence = 0.5,
  operationalConfidence,
  observedAt = null,
  derivedAt,
  evidence = [],
  uncertainty = [],
  sourceRefs = [],
  actionable = false,
  semantics = {}
}) {
  return {
    predicate,
    fromId: String(from),
    toId: String(to),
    fromType,
    toType,
    distanceM: distanceM == null ? null : Math.round(distanceM),
    routeDistanceM: routeDistanceM == null ? null : Math.round(routeDistanceM),
    confidence: Math.round(Math.max(0, Math.min(1, Number(confidence) || 0)) * 1000) / 1000,
    operationalConfidence: Math.round(Math.min(MAX_OPERATIONAL_CONFIDENCE, Math.max(0, Number(operationalConfidence) || 0)) * 1000) / 1000,
    observedAt: observedAt || null,
    derivedAt,
    evidence,
    sourceReferences: sourceRefs.map(String),
    uncertainty: Array.from(new Set(uncertainty.filter(Boolean).map(String))),
    actionable: Boolean(actionable),
    semantics
  };
}

function routeProjection(entity, route) {
  const p = pointOf(entity);
  if (!p || !Array.isArray(route) || route.length < 2) return null;

  const projection = projectOntoRoute(
    route,
    p.latitude,
    p.longitude
  );

  if (!projection || !Number.isFinite(Number(projection.crossTrackKm))) return null;
  return {
    point: p,
    crossTrackM: Number(projection.crossTrackKm) * 1000,
    alongKm: finite(projection.alongKm),
    routeLengthKm: finite(projection.route_len_km)
  };
}

function normalizeCameraModel(camera) {
  return camera?.attributes?.camera || camera;
}

function cameraRangeM(camera) {
  const model = normalizeCameraModel(camera);
  const range = finite(model?.viewshed?.maxRangeM);
  return range != null && range > 0 ? range : DEFAULT_CAMERA_NEAR_M;
}

function hazardRadiusM(hazard, fallback = DEFAULT_HAZARD_PROXIMITY_M) {
  const attrs = hazard?.attributes || {};
  const value = finite(
    attrs.radiusM ??
    attrs.radius_m ??
    attrs.radius ??
    hazard?.radiusM ??
    hazard?.radius_m
  );
  if (value == null || value <= 0) return fallback;
  return Math.min(100_000, value);
}

function isModelledSatellite(satellite) {
  const attrs = satellite?.attributes || {};
  const positionSource = String(
    satellite?.positionSource ??
    attrs.positionSource ??
    attrs.position_source ??
    ''
  ).toLowerCase();

  const positionMode = String(
    attrs.positionMode ??
    attrs.position_mode ??
    ''
  ).toUpperCase();

  return positionSource === 'modelled' ||
    positionSource === 'modeled' ||
    positionMode === 'SGP4_PROPAGATED' ||
    satellite?.telemetryLive === false ||
    attrs.telemetryLive === false;
}

function buildHazardCameraRelations(hazards, cameras, now, nearM = DEFAULT_CAMERA_NEAR_M) {
  const relations = [];

  for (const hazard of Array.isArray(hazards) ? hazards : []) {
    const hazardPoint = pointOf(hazard);
    if (!hazardPoint) continue;

    for (const camera of Array.isArray(cameras) ? cameras : []) {
      const cameraPoint = pointOf(normalizeCameraModel(camera));
      if (!cameraPoint) continue;

      const distance = haversineKm(
        hazardPoint.latitude,
        hazardPoint.longitude,
        cameraPoint.latitude,
        cameraPoint.longitude
      ) * 1000;

      const maxRange = cameraRangeM(camera);
      if (distance > Math.max(maxRange, Number(nearM) || DEFAULT_CAMERA_NEAR_M)) continue;

      const view = pointInViewshed(
        normalizeCameraModel(camera),
        { latitude: hazardPoint.latitude, longitude: hazardPoint.longitude }
      );

      const visible = Boolean(view?.visible);
      const predicate = visible ? 'HAZARD_IN_CAMERA_VIEWSHED' : 'HAZARD_NEAR_CAMERA';
      const operationalConfidence = lowOperationalConfidence(hazard, camera, visible ? 0.55 : 0.45);

      relations.push(relationBase({
        predicate,
        from: hazard.id,
        to: camera.id,
        fromType: 'natural_hazard',
        toType: 'camera',
        distanceM: distance,
        confidence: Math.min(observationConfidence(hazard), observationConfidence(camera)),
        operationalConfidence,
        observedAt: hazard.observedAt || camera.observedAt || null,
        derivedAt: now,
        evidence: [
          { metric: 'distance_m', value: Math.round(distance) },
          { metric: 'camera_max_range_m', value: Math.round(maxRange) },
          ...(visible ? [
            { metric: 'viewshed_membership', value: true },
            { metric: 'bearing_deg', value: view?.bearingDeg ?? null },
            { metric: 'angular_offset_deg', value: view?.angularOffsetDeg ?? null }
          ] : [])
        ],
        uncertainty: [
          'Geometric proximity to a camera does not establish camera acquisition.',
          ...(visible ? ['Viewshed membership does not establish a usable frame, detection, classification or identification.'] : [])
        ],
        sourceRefs: sourceReferences(hazard, camera),
        actionable: false,
        semantics: {
          geometryOnly: true,
          visualAcquisitionClaim: false,
          imagingClaim: false,
          detectionClaim: false
        }
      }));
    }
  }

  return relations;
}

function buildHazardRouteRelations(hazards, route, routeId, corridorId, corridorWidthKm, now, nearM = DEFAULT_HAZARD_NEAR_M) {
  const relations = [];
  const corridorM = Math.max(100, finite(corridorWidthKm) == null ? 0 : Number(corridorWidthKm) * 1000);
  const thresholdM = Math.max(nearM, corridorM + 10_000);

  for (const hazard of Array.isArray(hazards) ? hazards : []) {
    const projection = routeProjection(hazard, route);
    if (!projection || projection.crossTrackM > thresholdM) continue;

    const inCorridor = projection.crossTrackM <= corridorM;
    const predicate = inCorridor ? 'HAZARD_ON_ROUTE_CORRIDOR' : 'HAZARD_NEAR_ROUTE';
    const operationalConfidence = lowOperationalConfidence(hazard, { observationConfidence: 1 }, inCorridor ? 0.5 : 0.4);

    relations.push(relationBase({
      predicate,
      from: hazard.id,
      to: inCorridor ? corridorId : routeId,
      fromType: 'natural_hazard',
      toType: inCorridor ? 'corridor' : 'route',
      distanceM: projection.crossTrackM,
      routeDistanceM: projection.crossTrackM,
      confidence: observationConfidence(hazard),
      operationalConfidence,
      observedAt: hazard.observedAt || null,
      derivedAt: now,
      evidence: [
        { metric: 'cross_track_m', value: Math.round(projection.crossTrackM) },
        { metric: 'along_route_km', value: projection.alongKm },
        { metric: 'corridor_width_m', value: Math.round(corridorM) }
      ],
      uncertainty: [
        'Route proximity is geometric only and does not establish route closure, route obstruction, damage, or operational impact.',
        ...(inCorridor ? ['A hazard within the corridor may still be spatially offset from the actual traversable roadway.'] : [])
      ],
      sourceRefs: sourceReferences(hazard),
      actionable: false,
      semantics: {
        geometryOnly: true,
        closureAuthority: false,
        routeImpactConfirmed: false
      }
    }));
  }

  return relations;
}

function buildSatelliteRouteRelations(satellites, route, routeId, now, nearM = DEFAULT_SATELLITE_ROUTE_NEAR_M) {
  const relations = [];

  for (const satellite of Array.isArray(satellites) ? satellites : []) {
    if (!isModelledSatellite(satellite)) continue;

    const projection = routeProjection(satellite, route);
    if (!projection || projection.crossTrackM > nearM) continue;

    const operationalConfidence = lowOperationalConfidence(
      satellite,
      { observationConfidence: 1 },
      0.55
    );

    const attrs = satellite.attributes || {};
    relations.push(relationBase({
      predicate: 'SATELLITE_NEAR_ROUTE',
      from: satellite.id,
      to: routeId,
      fromType: 'satellite',
      toType: 'route',
      distanceM: projection.crossTrackM,
      routeDistanceM: projection.crossTrackM,
      confidence: observationConfidence(satellite),
      operationalConfidence,
      observedAt: satellite.observedAt || satellite.receivedAt || null,
      derivedAt: now,
      evidence: [
        { metric: 'cross_track_m', value: Math.round(projection.crossTrackM) },
        { metric: 'along_route_km', value: projection.alongKm },
        { metric: 'position_source', value: satellite.positionSource || attrs.positionSource || 'modelled' },
        { metric: 'position_mode', value: attrs.positionMode || 'SGP4_PROPAGATED' }
      ],
      uncertainty: [
        'Satellite position is modelled from orbital elements and is not live satellite telemetry.',
        'Route proximity does not establish imaging, collection, sensor visibility, operator control or tasking.',
      ],
      sourceRefs: sourceReferences(satellite),
      actionable: false,
      semantics: {
        geometryOnly: true,
        positionSource: 'modelled',
        telemetryLive: false,
        imagingClaim: false,
        taskingClaim: false,
        collectionClaim: false
      }
    }));
  }

  return relations;
}

function buildVehicleHazardRelations(vehicles, hazards, now, nearM = DEFAULT_HAZARD_NEAR_M, proximityM = DEFAULT_HAZARD_PROXIMITY_M) {
  const relations = [];

  for (const vehicle of Array.isArray(vehicles) ? vehicles : []) {
    const vehiclePoint = pointOf(vehicle);
    if (!vehiclePoint) continue;

    for (const hazard of Array.isArray(hazards) ? hazards : []) {
      const hazardPoint = pointOf(hazard);
      if (!hazardPoint) continue;

      const distance = haversineKm(
        vehiclePoint.latitude,
        vehiclePoint.longitude,
        hazardPoint.latitude,
        hazardPoint.longitude
      ) * 1000;

      const hazardRadius = hazardRadiusM(hazard, proximityM);
      const exposureThreshold = Math.max(proximityM, hazardRadius);
      if (distance > nearM && distance > exposureThreshold) continue;

      const inProximity = distance <= exposureThreshold;
      const predicate = inProximity ? 'VEHICLE_IN_HAZARD_PROXIMITY' : 'VEHICLE_NEAR_HAZARD';
      const operationalConfidence = lowOperationalConfidence(vehicle, hazard, inProximity ? 0.5 : 0.35);

      relations.push(relationBase({
        predicate,
        from: vehicle.id,
        to: hazard.id,
        fromType: 'vehicle',
        toType: 'natural_hazard',
        distanceM: distance,
        confidence: Math.min(observationConfidence(vehicle), observationConfidence(hazard)),
        operationalConfidence,
        observedAt: vehicle.observedAt || hazard.observedAt || null,
        derivedAt: now,
        evidence: [
          { metric: 'distance_m', value: Math.round(distance) },
          { metric: 'hazard_proximity_threshold_m', value: Math.round(exposureThreshold) }
        ],
        uncertainty: [
          'Spatial exposure is not evidence of impact, contact, injury, damage or confirmed causal relationship.',
          ...(hazard.uncertainty || []),
        ],
        sourceRefs: sourceReferences(vehicle, hazard),
        actionable: false,
        semantics: {
          geometryOnly: true,
          impactConfirmed: false,
          causalRelationshipConfirmed: false
        }
      }));
    }
  }

  return relations;
}

function dedupeRelations(relations) {
  const seen = new Set();
  const out = [];

  for (const relation of Array.isArray(relations) ? relations : []) {
    const key = [
      relation.predicate,
      relation.fromId,
      relation.toId
    ].join('|');

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(relation);
  }

  return out.slice(0, MAX_RELATIONS);
}

function buildCrossLayerFusionRelations({
  vehicles = [],
  cameras = [],
  hazards = [],
  satellites = [],
  route = [],
  routeId = 'context:route',
  corridorId = 'context:corridor',
  corridorWidthKm = 0,
  now = new Date().toISOString(),
  cameraNearM = DEFAULT_CAMERA_NEAR_M,
  hazardNearM = DEFAULT_HAZARD_NEAR_M,
  hazardProximityM = DEFAULT_HAZARD_PROXIMITY_M,
  satelliteRouteNearM = DEFAULT_SATELLITE_ROUTE_NEAR_M,
} = {}) {
  const relations = [
    ...buildHazardCameraRelations(hazards, cameras, now, cameraNearM),
    ...buildHazardRouteRelations(hazards, route, routeId, corridorId, corridorWidthKm, now, hazardNearM),
    ...buildSatelliteRouteRelations(satellites, route, routeId, now, satelliteRouteNearM),
    ...buildVehicleHazardRelations(vehicles, hazards, now, hazardNearM, hazardProximityM),
  ];

  return dedupeRelations(relations);
}

module.exports = {
  DEFAULT_CAMERA_NEAR_M,
  DEFAULT_HAZARD_NEAR_M,
  DEFAULT_HAZARD_PROXIMITY_M,
  DEFAULT_SATELLITE_ROUTE_NEAR_M,
  MAX_OPERATIONAL_CONFIDENCE,
  pointOf,
  isModelledSatellite,
  buildHazardCameraRelations,
  buildHazardRouteRelations,
  buildSatelliteRouteRelations,
  buildVehicleHazardRelations,
  buildCrossLayerFusionRelations,
};
