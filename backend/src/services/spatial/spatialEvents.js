'use strict';

/**
 * Deterministic spatial-event detector + persistence bridge.
 * Uses the existing Sonalit alert contract; it does not create a second
 * operational alert authority.
 */

const DEFAULTS = {
  deviationKm: 0.5,
  unexpectedStopMs: 10 * 60 * 1000,
  longDwellMs: 30 * 60 * 1000,
  staleMs: 5 * 60 * 1000,
  gpsGapMs: 5 * 60 * 1000,
  jumpMaxKmh: 160,
  headingJumpDeg: 110,
  checkpointApproachM: 2000,
  checkpointPassM: 250,
  checkpointApproachDeltaM: 150,
  eventBucketMs: 60 * 1000,
};

function clamp01(n) {
  const v = Number(n);
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

function severityFor(type) {
  if (type === 'CORRIDOR_EXIT' || type === 'POSITION_JUMP') return 'high';
  if (type === 'INCIDENT_NEAR_CONVOY' || type === 'HAZARD_NEAR_ROUTE' || type === 'EXTERNAL_INCIDENT_NEAR_ROUTE' || type === 'EXTERNAL_HAZARD_NEAR_ROUTE' || type === 'TRAFFIC_CLOSURE') return 'high';
  if (type === 'TRAFFIC_CONGESTION' || type === 'VESSEL_APPROACHING_DESTINATION') return 'medium';
  if (type === 'NATURAL_HAZARD_NEAR_ROUTE') return 'high';
  if (type === 'ENVIRONMENTAL_DETERIORATION') return 'medium';
  if (type === 'STALE_TELEMETRY' || type === 'GPS_GAP') return 'medium';
  return 'low';
}


const EVENT_MODES = Object.freeze({
  stateful: new Set([
    'CORRIDOR_EXIT',
    'ROUTE_DEVIATION',
    'STALE_TELEMETRY',
    'GPS_GAP',
    'UNEXPECTED_STOP',
    'LONG_DWELL',
    'CHECKPOINT_APPROACH',
    'INCIDENT_NEAR_CONVOY',
    'HAZARD_NEAR_ROUTE',
    'EXTERNAL_INCIDENT_NEAR_ROUTE',
    'EXTERNAL_HAZARD_NEAR_ROUTE',
    'TRAFFIC_CLOSURE',
    'TRAFFIC_CONGESTION',
    'VESSEL_APPROACHING_DESTINATION',
    'NATURAL_HAZARD_NEAR_ROUTE',
    'ENVIRONMENTAL_DETERIORATION'
  ]),
  occurrence: new Set([
    'CORRIDOR_REENTRY',
    'TELEMETRY_RECOVERED',
    'POSITION_JUMP',
    'HEADING_ANOMALY',
    'CHECKPOINT_PASS'
  ])
});

const EVENT_AUTHORITY_LAYER = Object.freeze({
  EXTERNAL_INCIDENT_NEAR_ROUTE: 'traffic',
  EXTERNAL_HAZARD_NEAR_ROUTE: 'traffic',
  TRAFFIC_CLOSURE: 'traffic',
  TRAFFIC_CONGESTION: 'traffic',
  VESSEL_APPROACHING_DESTINATION: 'maritime',
  NATURAL_HAZARD_NEAR_ROUTE: 'hazards',
  ENVIRONMENTAL_DETERIORATION: 'weather'
});

const EVENT_AUTHORITY_PROVIDER = Object.freeze({
  VESSEL_APPROACHING_DESTINATION: 'kpler-ais',
  NATURAL_HAZARD_NEAR_ROUTE: 'nasa-eonet',
  ENVIRONMENTAL_DETERIORATION: 'weather'
});

function sourceProviderFromReferences(references) {
  const values = Array.isArray(references) ? references : [];
  for (const value of values) {
    const ref = String(value || '').toLowerCase();
    if (ref.startsWith('tomtom:')) return 'tomtom-traffic-incidents';
    if (ref.startsWith('mapbox:')) return 'mapbox-traffic';
    if (ref.startsWith('kpler:')) return 'kpler-ais';
    if (ref.startsWith('open-meteo:')) return 'weather';
    if (ref.startsWith('eonet:') || ref.startsWith('nasa-eonet:')) return 'nasa-eonet';
  }
  return null;
}

function providerCanReconcile(context, eventType, sourceReferences) {
  const provider = EVENT_AUTHORITY_PROVIDER[eventType] || sourceProviderFromReferences(sourceReferences);
  if (!provider) return true;
  const providerHealth = context && context.providerHealth && context.providerHealth[provider];
  if (!providerHealth) return false;
  return ['LIVE', 'DELAYED'].includes(String(providerHealth.status || '').toUpperCase());
}

function eventMode(type) {
  if (EVENT_MODES.occurrence.has(type)) return 'occurrence';
  return 'stateful';
}

function eventRequiresFreshExternalAuthority(type) {
  return Boolean(EVENT_AUTHORITY_LAYER[type]);
}

function layerCanReconcile(context, eventType) {
  const layerId = EVENT_AUTHORITY_LAYER[eventType];
  if (!layerId) return true;

  const coverage = context && context.coverage || {};
  if (Array.isArray(coverage.layersUnavailable) && coverage.layersUnavailable.includes(layerId)) return false;
  if (Array.isArray(coverage.layersPartial) && coverage.layersPartial.includes(layerId)) return false;

  const health = (context && context.layerHealth || []).find(function(item) {
    return item && item.layerId === layerId;
  });
  if (!health) return false;

  return ['LIVE', 'DELAYED'].includes(String(health.status || '').toUpperCase());
}

function eventCanAutoResolve(context, eventType, sourceReferences) {
  if (!EVENT_MODES.stateful.has(eventType)) return false;
  if (eventRequiresFreshExternalAuthority(eventType)) {
    return layerCanReconcile(context, eventType) && providerCanReconcile(context, eventType, sourceReferences);
  }

  // Internal conditions are only reconciled when the evaluated operational
  // context is present AND its critical spatial reads succeeded. A swallowed
  // DB failure must never look like "the condition disappeared".
  return Boolean(
    context &&
    context.dataHealth &&
    context.dataHealth.ok === true &&
    ((context.mission && context.mission.convoyId) ||
      (context.operational && Array.isArray(context.operational.vehicles) && context.operational.vehicles.length))
  );
}

function alertTypeFor(type) {
  if (
    type === 'CORRIDOR_EXIT' ||
    type === 'CORRIDOR_REENTRY' ||
    type === 'ROUTE_DEVIATION' ||
    type === 'CHECKPOINT_APPROACH' ||
    type === 'CHECKPOINT_PASS'
  ) return 'geofence';

  if (
    type === 'INCIDENT_NEAR_CONVOY' ||
    type === 'HAZARD_NEAR_ROUTE' ||
    type === 'EXTERNAL_INCIDENT_NEAR_ROUTE' ||
    type === 'EXTERNAL_HAZARD_NEAR_ROUTE' ||
    type === 'TRAFFIC_CLOSURE' ||
    type === 'TRAFFIC_CONGESTION' ||
    type === 'VESSEL_APPROACHING_DESTINATION' ||
    type === 'NATURAL_HAZARD_NEAR_ROUTE' ||
    type === 'ENVIRONMENTAL_DETERIORATION'
  ) return 'security';

  if (type === 'STALE_TELEMETRY' || type === 'GPS_GAP') return 'communication';

  return 'geofence';
}

function evidenceConfidence(vehicle) {
  const freshness = String(vehicle && vehicle.quality && vehicle.quality.freshnessClass || 'UNKNOWN');
  const freshnessScore = {
    LIVE: 1, DELAYED: 0.82, STALE: 0.25, PARTIAL: 0.45, UNKNOWN: 0.2, UNAVAILABLE: 0
  }[freshness] || 0.2;
  const accuracy = Number(vehicle && vehicle.accuracyM);
  const accuracyScore = Number.isFinite(accuracy)
    ? Math.max(0.2, Math.min(1, 1 - Math.max(0, accuracy - 10) / 250))
    : 0.7;
  return clamp01(freshnessScore * 0.65 + accuracyScore * 0.35);
}

function makeEvent(input) {
  const vehicle = input.vehicle || {};
  const type = input.type;
  const key = input.eventKey || (type + ':vehicle:' + String(vehicle.id || ''));
  const base = input.confidence == null ? evidenceConfidence(vehicle) : clamp01(input.confidence);

  return {
    eventKey: key,
    eventType: type,
    subjectType: input.subjectType || 'vehicle',
    subjectId: String(input.subjectId || vehicle.id || ''),
    convoyId: input.convoyId || vehicle.convoyId || null,
    relatedEntities: input.relatedEntities || [],
    previousState: input.previousState || null,
    newState: input.newState || null,
    observedAt: input.observedAt || vehicle.observedAt || null,
    detectedAt: new Date().toISOString(),
    severity: input.severity || severityFor(type),
    confidence: base,
    operationalConfidence: input.operationalConfidence == null
      ? clamp01(base * 0.9)
      : clamp01(input.operationalConfidence),
    evidence: input.evidence || [],
    sourceReferences: input.sourceReferences || vehicle.sourceReferences || [],
    uncertainty: input.uncertainty || vehicle.uncertainty || [],
    ruleVersion: 'spatial-v2',
    status: eventMode(type) === 'occurrence' ? 'resolved' : 'open',
    resolvesEventKey: input.resolvesEventKey || null,
  };
}

function detectSpatialEvents(context, options) {
  const cfg = Object.assign({}, DEFAULTS, options || {});
  const now = Number.isFinite(Number(cfg.now)) ? Number(cfg.now) : Date.now();
  const events = [];

  for (const vehicle of ((context && context.operational && context.operational.vehicles) || [])) {
    const route = vehicle.routeState || {};
    const previousRoute = vehicle.previousRouteState || {};
    const relation = route.relation || 'UNKNOWN';
    const previousRelation = previousRoute.relation || null;
    const convoyId = context && context.mission && context.mission.convoyId
      ? context.mission.convoyId
      : vehicle.convoyId || null;

    if (relation === 'OFF_ROUTE') {
      events.push(makeEvent({
        type: 'CORRIDOR_EXIT',
        vehicle,
        convoyId,
        previousState: previousRelation || 'UNKNOWN',
        newState: 'OUTSIDE_CORRIDOR',
        evidence: [
          { metric: 'cross_track_km', value: Number(route.crossTrackKm) },
          { metric: 'corridor_km', value: Number(route.corridorKm) },
          { metric: 'telemetry_freshness', value: vehicle.quality && vehicle.quality.freshnessClass || 'UNKNOWN' }
        ]
      }));
    } else if (previousRelation === 'OFF_ROUTE' && relation === 'ON_ROUTE') {
      events.push(makeEvent({
        type: 'CORRIDOR_REENTRY',
        vehicle,
        convoyId,
        previousState: 'OUTSIDE_CORRIDOR',
        newState: 'WITHIN_CORRIDOR',
        severity: 'low',
        evidence: [
          { metric: 'cross_track_km', value: Number(route.crossTrackKm) },
          { metric: 'reentry', value: true }
        ],
        resolvesEventKey: 'CORRIDOR_EXIT:vehicle:' + String(vehicle.id)
      }));
    }

    const crossTrack = Number(route.crossTrackKm);
    const deviationThreshold = Math.max(0.1, Number(vehicle.deviationThresholdKm) || cfg.deviationKm);
    if (relation === 'ON_ROUTE' && Number.isFinite(crossTrack) && crossTrack > deviationThreshold) {
      events.push(makeEvent({
        type: 'ROUTE_DEVIATION',
        vehicle,
        convoyId,
        severity: 'medium',
        previousState: previousRelation,
        newState: 'DEVIATED',
        evidence: [
          { metric: 'cross_track_km', value: crossTrack },
          { metric: 'deviation_threshold_km', value: deviationThreshold },
          { metric: 'schedule_delta_min', value: Number(route.scheduleDeltaMin) || 0 }
        ]
      }));
    }

    const freshness = String(vehicle.quality && vehicle.quality.freshnessClass || 'UNKNOWN');
    const ageMs = Number(vehicle.freshnessMs);
    if (freshness === 'STALE' || (Number.isFinite(ageMs) && ageMs > cfg.staleMs)) {
      events.push(makeEvent({
        type: 'STALE_TELEMETRY',
        vehicle,
        convoyId,
        severity: ageMs > 30 * 60 * 1000 ? 'high' : 'medium',
        previousState: 'FRESH',
        newState: 'STALE',
        evidence: [
          { metric: 'telemetry_age_ms', value: ageMs },
          { metric: 'last_observed_at', value: vehicle.observedAt || null }
        ],
        uncertainty: ['No current positioning update is available.']
      }));
    } else if (vehicle.recoveredFreshness) {
      events.push(makeEvent({
        type: 'TELEMETRY_RECOVERED',
        vehicle,
        convoyId,
        severity: 'low',
        previousState: 'STALE',
        newState: 'LIVE',
        evidence: [{ metric: 'telemetry_age_ms', value: ageMs }],
        resolvesEventKey: 'STALE_TELEMETRY:vehicle:' + String(vehicle.id)
      }));
    }

    const gapMs = Number(vehicle.historyGapMs);
    if (Number.isFinite(gapMs) && gapMs > cfg.gpsGapMs) {
      events.push(makeEvent({
        type: 'GPS_GAP',
        vehicle,
        convoyId,
        severity: gapMs > 30 * 60 * 1000 ? 'high' : 'medium',
        previousState: 'CONTINUOUS',
        newState: 'GAP',
        evidence: [
          { metric: 'gap_ms', value: gapMs },
          { metric: 'previous_observed_at', value: vehicle.previousObservedAt || null },
          { metric: 'observed_at', value: vehicle.observedAt || null }
        ],
        uncertainty: ['Movement during the gap is not observed.']
      }));
    }

    const impliedKmh = Number(vehicle.impliedSpeedKmh);
    if (Number.isFinite(impliedKmh) && impliedKmh > cfg.jumpMaxKmh) {
      events.push(makeEvent({
        type: 'POSITION_JUMP',
        vehicle,
        convoyId,
        eventKey: 'POSITION_JUMP:vehicle:' + String(vehicle.id) + ':' + Math.floor(now / cfg.eventBucketMs),
        severity: 'high',
        evidence: [
          { metric: 'implied_speed_kmh', value: impliedKmh },
          { metric: 'threshold_kmh', value: cfg.jumpMaxKmh },
          { metric: 'interval_ms', value: gapMs }
        ],
        uncertainty: ['The jump may reflect GPS error, delayed delivery, or impossible movement.']
      }));
    }

    const headingDelta = Math.abs(Number(vehicle.headingDeltaDeg));
    if (Number.isFinite(headingDelta) && headingDelta > cfg.headingJumpDeg && Number(vehicle.speedKmh) > 15) {
      events.push(makeEvent({
        type: 'HEADING_ANOMALY',
        vehicle,
        convoyId,
        eventKey: 'HEADING_ANOMALY:vehicle:' + String(vehicle.id) + ':' + Math.floor(now / (10 * 60 * 1000)),
        severity: 'medium',
        evidence: [
          { metric: 'heading_delta_deg', value: headingDelta },
          { metric: 'speed_kmh', value: Number(vehicle.speedKmh) }
        ],
        uncertainty: ['Sharp heading change may be a real turn or noisy heading telemetry.']
      }));
    }

    const stationaryMs = Number(vehicle.stationaryDurationMs);
    if (Number.isFinite(stationaryMs) && stationaryMs >= cfg.unexpectedStopMs) {
      events.push(makeEvent({
        type: stationaryMs >= cfg.longDwellMs ? 'LONG_DWELL' : 'UNEXPECTED_STOP',
        vehicle,
        convoyId,
        severity: stationaryMs >= cfg.longDwellMs ? 'high' : 'medium',
        evidence: [
          { metric: 'stationary_duration_ms', value: stationaryMs },
          { metric: 'speed_kmh', value: Number(vehicle.speedKmh) || 0 }
        ]
      }));
    }

    for (const cp of vehicle.nearbyCheckpoints || []) {
      if (cp.approaching) {
        events.push(makeEvent({
          type: 'CHECKPOINT_APPROACH',
          vehicle,
          convoyId,
          eventKey: 'CHECKPOINT_APPROACH:vehicle:' + String(vehicle.id) + ':checkpoint:' + String(cp.id),
          severity: 'low',
          relatedEntities: [{ id: String(cp.id), type: 'checkpoint', distanceM: cp.distanceM }],
          evidence: [
            { metric: 'checkpoint_distance_m', value: cp.distanceM },
            { metric: 'approach_delta_m', value: cp.approachDeltaM }
          ]
        }));
      }
      if (cp.passed) {
        events.push(makeEvent({
          type: 'CHECKPOINT_PASS',
          vehicle,
          convoyId,
          eventKey: 'CHECKPOINT_PASS:vehicle:' + String(vehicle.id) + ':checkpoint:' + String(cp.id) + ':' + Math.floor(now / cfg.eventBucketMs),
          severity: 'low',
          relatedEntities: [{ id: String(cp.id), type: 'checkpoint', distanceM: cp.distanceM }],
          evidence: [
            { metric: 'checkpoint_distance_m', value: cp.distanceM },
            { metric: 'previous_distance_m', value: cp.previousDistanceM }
          ]
        }));
      }
    }
  }

  for (const relation of (context && context.relations || [])) {
    if (relation.actionable === false) continue;

    const isIncident = relation.predicate === 'NEAR_INCIDENT';
    const isRiskZone = relation.predicate === 'HAZARD_NEAR_ROUTE' ||
      (relation.predicate === 'WITHIN' && relation.toType === 'risk_zone');
    const isTrafficClosure = relation.predicate === 'TRAFFIC_CLOSURE';
    const isTrafficCongestion = relation.predicate === 'TRAFFIC_CONGESTION';
    const isExternalIncident = relation.predicate === 'EXTERNAL_INCIDENT_NEAR_ROUTE';
    const isExternalHazard = relation.predicate === 'EXTERNAL_HAZARD_NEAR_ROUTE';
    const isVesselApproach = relation.predicate === 'VESSEL_APPROACHING_DESTINATION';
    const isNaturalHazard = relation.predicate === 'NATURAL_HAZARD_NEAR_ROUTE';
    if (!isIncident && !isRiskZone && !isTrafficClosure && !isTrafficCongestion && !isExternalIncident && !isExternalHazard && !isVesselApproach && !isNaturalHazard) continue;

    const type = isIncident ? 'INCIDENT_NEAR_CONVOY'
      : isRiskZone ? 'HAZARD_NEAR_ROUTE'
      : isTrafficClosure ? 'TRAFFIC_CLOSURE'
      : isTrafficCongestion ? 'TRAFFIC_CONGESTION'
      : isExternalIncident ? 'EXTERNAL_INCIDENT_NEAR_ROUTE'
      : isExternalHazard ? 'EXTERNAL_HAZARD_NEAR_ROUTE'
      : isNaturalHazard ? 'NATURAL_HAZARD_NEAR_ROUTE'
      : 'VESSEL_APPROACHING_DESTINATION';
    const subjectType = relation.fromType === 'vehicle'
      ? 'vehicle'
      : (relation.fromType === 'vessel'
        ? 'convoy'
        : (context && context.mission && context.mission.convoyId ? 'convoy' : 'context'));
    const subjectId = relation.fromType === 'vehicle'
      ? String(relation.fromId)
      : String(context && context.mission && context.mission.convoyId || relation.fromId);

    events.push({
      eventKey: type + ':' + String(relation.fromId) + ':' + String(relation.toId),
      eventType: type,
      subjectType,
      subjectId,
      convoyId: context && context.mission && context.mission.convoyId || null,
      relatedEntities: [{ id: relation.toId, type: relation.toType || 'context', distanceM: relation.distanceM }],
      previousState: null,
      newState: 'NEAR',
      observedAt: relation.observedAt || null,
      detectedAt: new Date().toISOString(),
      severity: relation.severity || 'high',
      confidence: clamp01(relation.confidence == null ? 0.7 : relation.confidence),
      operationalConfidence: clamp01(relation.operationalConfidence == null ? 0.7 : relation.operationalConfidence),
      evidence: relation.evidence || [],
      sourceReferences: relation.sourceReferences || [],
      uncertainty: relation.uncertainty || [],
      ruleVersion: 'spatial-v2',
      status: 'open'
    });
  }

  for (const env of (context && context.environment || [])) {
    const hazards = Array.isArray(env.attributes && env.attributes.hazards) ? env.attributes.hazards : [];
    if (!hazards.length) continue;
    const anchorVehicle = context && context.operational && context.operational.vehicles && context.operational.vehicles[0];
    events.push({
      eventKey: 'ENVIRONMENTAL_DETERIORATION:' + String(env.id),
      eventType: 'ENVIRONMENTAL_DETERIORATION',
      subjectType: anchorVehicle ? 'vehicle' : (context && context.mission && context.mission.convoyId ? 'convoy' : 'context'),
      subjectId: String(anchorVehicle ? anchorVehicle.id : (context && context.mission && context.mission.convoyId || 'context')),
      convoyId: context && context.mission && context.mission.convoyId || null,
      relatedEntities: [{ id: env.id, type: 'weather' }].concat(anchorVehicle ? [{ id: anchorVehicle.id, type: 'vehicle' }] : []),
      previousState: null,
      newState: 'DEGRADED',
      observedAt: env.observedAt || null,
      detectedAt: new Date().toISOString(),
      severity: env.attributes && env.attributes.severity === 'high' ? 'high' : 'medium',
      confidence: 0.8,
      operationalConfidence: 0.7,
      evidence: hazards.map(function(h) { return { metric: 'weather_hazard', value: h }; }),
      sourceReferences: [env.provenance && env.provenance.sourceReference || env.id],
      uncertainty: ['Weather context does not by itself determine road safety.'],
      ruleVersion: 'spatial-v2',
      status: 'open'
    });
  }

  return events;
}


async function reconcileSpatialEvents(db, context, events, options) {
  const cfg = options || {};
  if (!db || !cfg.orgId || !context) return [];

  const mission = context.mission || null;
  const operationalVehicles = context.operational && Array.isArray(context.operational.vehicles)
    ? context.operational.vehicles
    : [];
  const convoyId = mission && mission.convoyId ? String(mission.convoyId) : null;
  if (!convoyId && !operationalVehicles.length) return [];

  const subjectIds = [];
  if (context.subject && context.subject.id) subjectIds.push(String(context.subject.id));
  for (const vehicle of operationalVehicles) {
    if (vehicle && vehicle.id) subjectIds.push(String(vehicle.id));
  }
  const uniqueSubjectIds = [...new Set(subjectIds)];
  if (!uniqueSubjectIds.length) return [];

  const rowsResult = await db(
    'SELECT id,event_key,event_type,subject_type,subject_id,convoy_id,source_references FROM spatial_events ' +
    'WHERE org_id=$1 AND status=\'open\' AND (convoy_id=$2 OR subject_id = ANY($3::text[]))',
    [cfg.orgId, convoyId, uniqueSubjectIds],
  );
  const openEvents = rowsResult.rows || [];
  const activeKeys = new Set((events || []).map(function(event) {
    return String(event.eventKey);
  }));
  const resolved = [];

  for (const row of openEvents) {
    const eventType = String(row.event_type || '');
    const sourceReferences = Array.isArray(row.source_references)
      ? row.source_references
      : (typeof row.source_references === 'string'
        ? (() => { try { return JSON.parse(row.source_references); } catch (_) { return []; } })()
        : []);
    if (!eventCanAutoResolve(context, eventType, sourceReferences)) continue;
    if (activeKeys.has(String(row.event_key))) continue;

    const result = await db(
      'UPDATE spatial_events SET status=\'resolved\',resolved_at=NOW(),resolved_by=$1,resolution_reason=$2,updated_at=NOW(),last_seen_at=COALESCE(last_seen_at,updated_at) ' +
      'WHERE org_id=$3 AND id=$4 AND status=\'open\' RETURNING id,event_key',
      [
        cfg.userId || null,
        eventRequiresFreshExternalAuthority(eventType)
          ? 'Fresh authoritative spatial layer no longer reports the condition.'
          : 'Fresh mission evaluation no longer reports the condition.',
        cfg.orgId,
        row.id,
      ],
    );
    resolved.push.apply(resolved, result.rows || []);
  }

  return resolved;
}

async function persistSpatialEvents(db, events, options) {
  const cfg = options || {};
  if (!db || !cfg.orgId || !Array.isArray(events)) return { created: [], updated: [], resolved: [] };

  const created = [];
  const updated = [];
  const resolved = [];

  for (const event of events) {
    if (event.resolvesEventKey) {
      const resolvedRows = await db(
        'UPDATE spatial_events SET status=\'resolved\',resolved_at=NOW(),resolved_by=$1,resolution_reason=$2,updated_at=NOW() ' +
        'WHERE org_id=$3 AND event_key=$4 AND status=\'open\' RETURNING id,event_key',
        [
          cfg.userId || null,
          'Explicit resolving transition emitted by the spatial event detector.',
          cfg.orgId,
          event.resolvesEventKey
        ]
      );
      resolved.push.apply(resolved, resolvedRows.rows || []);
    }

    const insert = await db(
      'INSERT INTO spatial_events ' +
      '(org_id,event_key,event_type,subject_type,subject_id,convoy_id,related_entities,previous_state,new_state,observed_at,detected_at,severity,confidence,operational_confidence,evidence,source_references,uncertainty,rule_version,status,last_seen_at) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW()) ' +
      'ON CONFLICT (org_id,event_key) WHERE status=\'open\' DO NOTHING RETURNING *',
      [
        cfg.orgId,
        event.eventKey,
        event.eventType,
        event.subjectType,
        event.subjectId,
        event.convoyId || null,
        JSON.stringify(event.relatedEntities || []),
        event.previousState || null,
        event.newState || null,
        event.observedAt || null,
        event.detectedAt || new Date().toISOString(),
        event.severity || 'medium',
        clamp01(event.confidence),
        clamp01(event.operationalConfidence),
        JSON.stringify(event.evidence || []),
        JSON.stringify(event.sourceReferences || []),
        JSON.stringify(event.uncertainty || []),
        event.ruleVersion || 'spatial-v2',
        event.status || (eventMode(event.eventType) === 'occurrence' ? 'resolved' : 'open'),
      ]
    );

    let row = insert.rows && insert.rows[0];
    const wasCreated = Boolean(row);

    if (!row) {
      const refreshed = await db(
        'UPDATE spatial_events SET ' +
        'observed_at=$1,updated_at=NOW(),last_seen_at=NOW(),severity=$2,confidence=$3,operational_confidence=$4,' +
        'related_entities=$5,new_state=$6,evidence=$7,source_references=$8,uncertainty=$9,rule_version=$10 ' +
        'WHERE org_id=$11 AND event_key=$12 AND status=\'open\' RETURNING *',
        [
          event.observedAt || null,
          event.severity || 'medium',
          clamp01(event.confidence),
          clamp01(event.operationalConfidence),
          JSON.stringify(event.relatedEntities || []),
          event.newState || null,
          JSON.stringify(event.evidence || []),
          JSON.stringify(event.sourceReferences || []),
          JSON.stringify(event.uncertainty || []),
          event.ruleVersion || 'spatial-v2',
          cfg.orgId,
          event.eventKey,
        ]
      );
      row = refreshed.rows && refreshed.rows[0];
    }

    if (!row) continue;
    if (wasCreated) created.push(row);
    else updated.push(row);

    // Occurrence events are already resolved in the spatial_events ledger, but
    // still create the normal Sonalit alert exactly once at first persistence.
    if (!wasCreated) continue;

    const alertType = alertTypeFor(event.eventType);
    const evidenceText = (event.evidence || []).slice(0, 3).map(function(e) {
      return String(e.metric) + '=' + String(e.value);
    }).join(', ');
    const message = ('Spatial ' + event.eventType.replace(/_/g, ' ').toLowerCase() +
      (evidenceText ? ': ' + evidenceText : '') +
      ' [spatial-event:' + event.eventKey + ']').slice(0, 500);

    if (event.subjectType === 'vehicle' || (event.subjectType === 'convoy' && event.convoyId)) {
      const rawVehicleId = event.subjectType === 'vehicle'
        ? String(event.subjectId).replace(/^sonalit:vehicle:/, '')
        : null;

      try {
        const alertResult = await db(
          'INSERT INTO alerts (vehicle_id,convoy_id,type,severity,message,created_by,org_id,created_at,updated_at) ' +
          'VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW()) RETURNING id',
          [
            rawVehicleId,
            event.convoyId || null,
            alertType,
            event.severity || 'medium',
            message,
            cfg.userId || null,
            cfg.orgId
          ]
        );

        if (typeof cfg.publish === 'function') {
          try {
            cfg.publish('org#' + cfg.orgId, {
              type: 'spatial.event',
              eventId: row.id,
              eventType: event.eventType,
              eventKey: event.eventKey,
              subjectId: event.subjectId,
              convoyId: event.convoyId || null,
              severity: event.severity,
              confidence: event.confidence
            });
            if (alertResult.rows && alertResult.rows[0]) {
              cfg.publish('org#' + cfg.orgId, {
                type: 'alert.new',
                alertId: alertResult.rows[0].id,
                vehicleId: rawVehicleId,
                convoyId: event.convoyId || null,
                alertType: alertType,
                severity: event.severity,
                message: message
              });
            }
          } catch (_) {}
        }
      } catch (alertError) {
        // Event state is authoritative; downstream alert delivery is best-effort.
        // The event remains persisted and can be replayed/reconciled later.
        if (cfg.logger && typeof cfg.logger.warn === 'function') {
          cfg.logger.warn('Spatial alert bridge failed: ' + alertError.message);
        }
      }
    }
  }

  const lifecycleResolved = await reconcileSpatialEvents(db, cfg.context || null, events, cfg);
  resolved.push.apply(resolved, lifecycleResolved);

  return { created, updated, resolved };
}

module.exports = {
  detectSpatialEvents,
  persistSpatialEvents,
  reconcileSpatialEvents,
  DEFAULTS,
  EVENT_MODES,
  EVENT_AUTHORITY_LAYER,
  eventMode,
  eventCanAutoResolve,
  layerCanReconcile,
  providerCanReconcile,
  sourceProviderFromReferences
};
