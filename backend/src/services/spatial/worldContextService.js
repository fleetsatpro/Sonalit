'use strict';

const { getAircraftInBbox } = require('./openskyGateway');

const EARTH_R = 6_371_000;

function bboxFromCenterRadius(lat, lon, radiusM) {
  const dLat = (radiusM / EARTH_R) * (180 / Math.PI);
  const dLon =
    (radiusM / (EARTH_R * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI);
  return [
    Math.max(-180, lon - dLon),
    Math.max(-90, lat - dLat),
    Math.min(180, lon + dLon),
    Math.min(90, lat + dLat),
  ];
}

function distanceM(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return EARTH_R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function buildWorldContext(opts) {
  const {
    orgId, db, subject, center, radiusM, layers,
    maxEntitiesPerLayer, requestId,
  } = opts;

  const warnings = [];
  const layerHealth = [];
  const layersRequested = layers;
  const layersSucceeded = [];
  const layersPartial = [];
  const layersUnavailable = [];

  let operationalEntities = [];
  try {
    const result = await db(
      `SELECT v.id::text AS id,
              COALESCE(v.registration, v.id::text) AS label,
              v.latitude AS lat, v.longitude AS lng,
              v.heading, v.last_ping AS observed_at
       FROM vehicles v
       WHERE v.org_id = $1
         AND v.latitude IS NOT NULL AND v.longitude IS NOT NULL
         AND v.last_ping IS NOT NULL
         AND v.deleted_at IS NULL
       LIMIT 500`,
      [orgId],
    );
    operationalEntities = (result.rows || []).map((r) => ({
      id: `sonalit:vehicle:${r.id}`,
      entityType: 'vehicle',
      source: 'sonalit',
      latitude: Number(r.lat),
      longitude: Number(r.lng),
      observedAt: new Date(r.observed_at).toISOString(),
      receivedAt: new Date().toISOString(),
      headingDeg: r.heading != null ? Number(r.heading) : null,
      status: 'operational',
      attributes: { vehicle_id: r.id, registration: r.label },
      provenance: {
        sourceName: 'Sonalit Tracking',
        observationType: 'operational_telemetry',
      },
      quality: { state: 'good', freshnessClass: 'LIVE' },
      domain: 'sonalit',
    }));
  } catch (err) {
    warnings.push(`operational_vehicles_unavailable: ${err.message}`);
  }

  let resolvedCenter = center;
  if (!resolvedCenter && operationalEntities.length) {
    const first = operationalEntities[0];
    resolvedCenter = { latitude: first.latitude, longitude: first.longitude };
  }

  let bbox = opts.bbox;
  if (!bbox && resolvedCenter) {
    bbox = bboxFromCenterRadius(
      resolvedCenter.latitude, resolvedCenter.longitude, radiusM,
    );
  }

  if (resolvedCenter) {
    operationalEntities = operationalEntities.filter(
      (e) =>
        distanceM(
          resolvedCenter.latitude, resolvedCenter.longitude,
          e.latitude, e.longitude,
        ) <= radiusM * 1.5,
    );
  }

  let aircraft = [];
  if (layers.includes('aircraft') && bbox) {
    try {
      const ac = await getAircraftInBbox({ bbox, orgId, requestId });
      aircraft = (ac.observations || []).slice(0, maxEntitiesPerLayer);
      layerHealth.push({
        layerId: 'aircraft',
        status: ac.health?.status || 'UNKNOWN',
        lastSuccessAt: ac.health?.lastSuccessAt,
        recordCount: ac.health?.recordCount,
        acceptedCount: ac.health?.acceptedCount,
        rejectedCount: ac.health?.rejectedCount,
        reason: ac.health?.lastErrorMessage,
      });
      if (ac.health?.status === 'LIVE' || ac.health?.status === 'DELAYED') {
        layersSucceeded.push('aircraft');
      } else if (ac.health?.status === 'STALE' || ac.health?.status === 'PARTIAL') {
        layersPartial.push('aircraft');
      } else {
        layersUnavailable.push('aircraft');
        warnings.push('aircraft_layer_unavailable');
      }
      if (ac.warnings) warnings.push(...ac.warnings);
    } catch (err) {
      layersUnavailable.push('aircraft');
      layerHealth.push({ layerId: 'aircraft', status: 'UNAVAILABLE', reason: err.message });
      warnings.push(`aircraft_error: ${err.message}`);
    }
  } else if (layers.includes('aircraft') && !bbox) {
    layersUnavailable.push('aircraft');
    warnings.push('aircraft_skipped_no_bbox');
  }

  const relations = [];
  if (resolvedCenter && aircraft.length) {
    for (const ac of aircraft.slice(0, 50)) {
      const d = distanceM(
        resolvedCenter.latitude, resolvedCenter.longitude,
        ac.latitude, ac.longitude,
      );
      if (d <= radiusM) {
        relations.push({
          predicate: 'NEAR',
          fromId: subject?.id
            ? `sonalit:${subject.kind}:${subject.id}`
            : 'context:center',
          toId: ac.id,
          distanceM: Math.round(d),
          confidence: ac.quality?.confidence ?? 0.7,
          derivedAt: new Date().toISOString(),
          source: 'spatial_computation',
        });
      }
    }
  }

  const allExternal = [...aircraft];
  const times = allExternal.map((o) => o.observedAt).filter(Boolean).sort();

  return {
    subject: subject
      ? { ...subject, orgId }
      : { kind: 'none', id: 'context', orgId },
    generatedAt: new Date().toISOString(),
    spatialContext: {
      center: resolvedCenter || undefined,
      radiusM,
      queryScope: bbox ? `bbox:${bbox.join(',')}` : 'unbounded_operational_only',
    },
    entities: operationalEntities,
    relations,
    environment: [],
    movement: aircraft,
    infrastructure: [],
    security: [],
    coverage: {
      layersRequested,
      layersSucceeded,
      layersPartial,
      layersUnavailable,
    },
    layerHealth,
    provenance: [
      { sourceName: 'Sonalit Tracking', attribution: 'Sonalit operational telemetry' },
      ...(aircraft.length
        ? [{
            sourceName: 'OpenSky Network',
            attribution: 'OpenSky Network',
            license: 'OpenSky Network terms',
          }]
        : []),
    ],
    freshness: {
      oldestObservedAt: times[0],
      newestObservedAt: times[times.length - 1],
    },
    uncertainty: warnings.filter(
      (w) => w.includes('unavailable') || w.includes('stale'),
    ),
    warnings,
  };
}

module.exports = { buildWorldContext };
