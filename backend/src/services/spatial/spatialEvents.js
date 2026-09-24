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
  if (type === 'INCIDENT_NEAR_CONVOY' || type === 'HAZARD_NEAR_ROUTE') return 'high';
  if (type === 'ENVIRONMENTAL_DETERIORATION') return 'medium';
  if (type === 'STALE_TELEMETRY' || type === 'GPS_GAP') return 'medium';
  return 'low';
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
    status: 'open',
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
    const isIncident = relation.predicate === 'NEAR_INCIDENT';
    const isRiskZone = relation.predicate === 'HAZARD_NEAR_ROUTE' ||
      (relation.predicate === 'WITHIN' && relation.toType === 'risk_zone');
    if (!isIncident && !isRiskZone) continue;

    const type = isIncident ? 'INCIDENT_NEAR_CONVOY' : 'HAZARD_NEAR_ROUTE';
    const subjectType = relation.fromType === 'vehicle'
      ? 'vehicle'
      : (context && context.mission && context.mission.convoyId ? 'convoy' : 'context');
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

async function persistSpatialEvents(db, events, options) {
  const cfg = options || {};
  if (!db || !cfg.orgId || !Array.isArray(events)) return { created: [], resolved: [] };

  const created = [];
  const resolved = [];

  for (const event of events) {
    if (event.resolvesEventKey) {
      const resolvedRows = await db(
        'UPDATE spatial_events SET status=\\'resolved\\', resolved_at=NOW(), resolved_by=$1, updated_at=NOW() WHERE org_id=$2 AND event_key=$3 AND status=\\'open\\' RETURNING id,event_key',
        [cfg.userId || null, cfg.orgId, event.resolvesEventKey]
      );
      resolved.push.apply(resolved, resolvedRows.rows || []);
    }

    const result = await db(
      'INSERT INTO spatial_events ' +
      '(org_id,event_key,event_type,subject_type,subject_id,convoy_id,related_entities,previous_state,new_state,observed_at,detected_at,severity,confidence,operational_confidence,evidence,source_references,uncertainty,rule_version,status) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,\\'open\\') ' +
      'ON CONFLICT (org_id,event_key) WHERE status=\\'open\\' DO NOTHING RETURNING *',
      [
        cfg.orgId, event.eventKey, event.eventType, event.subjectType, event.subjectId,
        event.convoyId || null, JSON.stringify(event.relatedEntities || []),
        event.previousState || null, event.newState || null, event.observedAt || null,
        event.detectedAt || new Date().toISOString(), event.severity || 'medium',
        clamp01(event.confidence), clamp01(event.operationalConfidence),
        JSON.stringify(event.evidence || []), JSON.stringify(event.sourceReferences || []),
        JSON.stringify(event.uncertainty || []), event.ruleVersion || 'spatial-v2'
      ]
    );

    const row = result.rows && result.rows[0];
    if (!row) continue;
    created.push(row);

    const alertType = alertTypeFor(event.eventType);
    const evidenceText = (event.evidence || []).slice(0, 3).map(function(e) {
      return String(e.metric) + '=' + String(e.value);
    }).join(', ');
    const message = ('Spatial ' + event.eventType.replace(/_/g, ' ').toLowerCase() +
      (evidenceText ? ': ' + evidenceText : '') +
      ' [spatial-event:' + event.eventKey + ']').slice(0, 500);

    if (event.subjectType === 'vehicle') {
      const alertResult = await db(
        'INSERT INTO alerts (vehicle_id,convoy_id,type,severity,message,created_by,org_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW()) RETURNING id',
        [
          event.subjectId,
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
              vehicleId: event.subjectId,
              convoyId: event.convoyId || null,
              alertType: alertType,
              severity: event.severity,
              message: message
            });
          }
        } catch (_) {}
      }
    }
  }

  return { created: created, resolved: resolved };
}

module.exports = {
  detectSpatialEvents,
  persistSpatialEvents,
  DEFAULTS
};
