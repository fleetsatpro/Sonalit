'use strict';

const { resolveSpatialSubject } = require('./subjectResolver');

const { spatialProviderManager } = require('./providerManager');
const {
  routeRelation,
  circleRelation,
  contextRelevance,
  relativeDirectionFromHeading,
  bearingDeg,
} = require('./relationEngine');
const { projectOntoRoute, haversineKm } = require('../geofence/corridor');
const { detectSpatialEvents, persistSpatialEvents } = require('./spatialEvents');

const EARTH_R = 6371000;
const LIVE_MS = 45000;
const DELAYED_MS = 300000;
const MAX_EXTERNAL_RADIUS_M = 100000;
const ALLOWED_LAYERS = new Set(['aircraft','weather','maritime','traffic','hazards','security','infrastructure','incidents','alerts']);

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function iso(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function classifyOperationalFreshness(value, now) {
  const observed = iso(value);
  if (!observed) return 'UNKNOWN';
  const age = Math.max(0, now - Date.parse(observed));
  if (age <= LIVE_MS) return 'LIVE';
  if (age <= DELAYED_MS) return 'DELAYED';
  return 'STALE';
}

function bboxFromCenterRadius(lat, lng, radiusM) {
  const dLat = radiusM / EARTH_R * 180 / Math.PI;
  const cos = Math.max(0.01, Math.abs(Math.cos(lat * Math.PI / 180)));
  const dLng = radiusM / (EARTH_R * cos) * 180 / Math.PI;
  return [
    Math.max(-180, lng - dLng),
    Math.max(-90, lat - dLat),
    Math.min(180, lng + dLng),
    Math.min(90, lat + dLat),
  ];
}

function distanceM(aLat, aLng, bLat, bLng) {
  return haversineKm(aLat, aLng, bLat, bLng) * 1000;
}

function parseJson(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch (_) { return null; }
}

function normaliseRoute(value) {
  value = parseJson(value);
  if (value && !Array.isArray(value) && Array.isArray(value.coordinates)) value = value.coordinates;
  if (value && !Array.isArray(value) && Array.isArray(value.path)) value = value.path;
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const point of value) {
    if (Array.isArray(point) && point.length >= 2) {
      const a = num(point[0]); const b = num(point[1]);
      if (a == null || b == null) continue;
      const geoJson = Math.abs(a) <= 90 && Math.abs(b) > 90;
      out.push(geoJson ? { lat: a, lng: b } : { lat: b, lng: a });
      continue;
    }
    if (point && typeof point === 'object') {
      const lat = num(point.lat ?? point.latitude);
      const lng = num(point.lng ?? point.lon ?? point.longitude);
      if (lat != null && lng != null) out.push({ lat, lng });
    }
  }
  return out.filter(function(p) {
    return p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180;
  });
}

function routeLengthKm(route) {
  let total = 0;
  for (let i = 0; i < route.length - 1; i++) {
    total += haversineKm(route[i].lat, route[i].lng, route[i + 1].lat, route[i + 1].lng);
  }
  return total;
}

function bboxFromRoute(route, paddingM) {
  if (!Array.isArray(route) || route.length < 2) return null;
  const pad = Number(paddingM) > 0 ? Number(paddingM) : 15000;
  let minLat=90,maxLat=-90,minLng=180,maxLng=-180;
  for (const p of route) {
    if (!p || !Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lng))) continue;
    minLat=Math.min(minLat,Number(p.lat)); maxLat=Math.max(maxLat,Number(p.lat));
    minLng=Math.min(minLng,Number(p.lng)); maxLng=Math.max(maxLng,Number(p.lng));
  }
  if (minLat===90) return null;
  const dLat=pad/EARTH_R*180/Math.PI;
  const cos=Math.max(0.01,Math.abs(Math.cos(((minLat+maxLat)/2)*Math.PI/180)));
  const dLng=pad/(EARTH_R*cos)*180/Math.PI;
  return [Math.max(-180,minLng-dLng),Math.max(-90,minLat-dLat),Math.min(180,maxLng+dLng),Math.min(90,maxLat+dLat)];
}

async function safeRows(db, sql, params) {
  try {
    const result = await db(sql, params || []);
    return result.rows || [];
  } catch (_) {
    return [];
  }
}

async function getConvoy(db, orgId, convoyId) {
  const rows = await safeRows(db,
    "SELECT id::text AS id,name,status,priority,region,route_origin,route_destination,departure_time,estimated_arrival FROM convoys WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL LIMIT 1",
    [convoyId, orgId]
  );
  return rows[0] || null;
}

async function getRoute(db, orgId, convoyId) {
  const corridor = await safeRows(db,
    "SELECT route_line,width_km,active FROM convoy_route_corridors WHERE convoy_id=$1 AND org_id=$2 ORDER BY active DESC,id DESC LIMIT 1",
    [convoyId, orgId]
  );
  let route = normaliseRoute(corridor[0] && corridor[0].route_line);
  let widthKm = num(corridor[0] && corridor[0].width_km);
  let active = Boolean(corridor[0] && corridor[0].active);

  if (route.length < 2) {
    const waypoints = await safeRows(db,
      "SELECT seq,name,lat,lng FROM convoy_route_waypoints WHERE convoy_id=$1 AND lat IS NOT NULL AND lng IS NOT NULL ORDER BY seq",
      [convoyId]
    );
    route = waypoints.map(function(w) {
      return { lat: Number(w.lat), lng: Number(w.lng), name: w.name, seq: w.seq };
    });
    if (route.length >= 2) {
      widthKm = widthKm == null ? 2 : widthKm;
      active = true;
    }
  }
  return {
    route: route,
    widthKm: widthKm != null && widthKm > 0 ? widthKm : 2,
    active: active,
    lengthKm: routeLengthKm(route),
  };
}

async function getVehicles(db, orgId, convoyId, vehicleId) {
  const where = vehicleId
    ? "v.id=$2"
    : "(v.assigned_convoy_id=$2 OR EXISTS (SELECT 1 FROM convoy_assignments ca WHERE ca.convoy_id=$2 AND ca.vehicle_id=v.id))";

  return safeRows(db,
    "SELECT v.id::text AS id,v.registration,v.type,v.region,v.status,v.latitude,v.longitude,v.heading,v.speed,v.last_ping,v.driver_id,v.assigned_convoy_id::text AS assigned_convoy_id," +
    " lg.lat AS gps_lat,lg.lng AS gps_lng,lg.heading AS gps_heading,lg.speed AS gps_speed,lg.accuracy AS gps_accuracy,lg.timestamp AS gps_at," +
    " prev.lat AS prev_lat,prev.lng AS prev_lng,prev.heading AS prev_heading,prev.speed AS prev_speed,prev.timestamp AS prev_at," +
    " COALESCE(history.recent_points, '[]'::json) AS recent_points" +
    " FROM vehicles v" +
    " LEFT JOIN LATERAL (SELECT lat,lng,heading,speed,accuracy,timestamp FROM gps_logs WHERE vehicle_id=v.id ORDER BY timestamp DESC,id DESC LIMIT 1) lg ON true" +
    " LEFT JOIN LATERAL (SELECT lat,lng,heading,speed,timestamp FROM gps_logs WHERE vehicle_id=v.id ORDER BY timestamp DESC,id DESC OFFSET 1 LIMIT 1) prev ON true" +
    " LEFT JOIN LATERAL (SELECT json_agg(h ORDER BY h.timestamp DESC) AS recent_points FROM (SELECT lat,lng,heading,speed,timestamp FROM gps_logs WHERE vehicle_id=v.id ORDER BY timestamp DESC,id DESC LIMIT 30) h) history ON true" +
    " WHERE v.org_id=$1 AND v.deleted_at IS NULL AND " + where +
    " ORDER BY v.registration",
    [orgId, vehicleId || convoyId]
  );
}

async function getCheckpoints(db, convoyId) {
  if (!convoyId) return [];
  return safeRows(db,
    "SELECT id::text AS id,name,location_name,lat,lng,sequence_order,status,expected_at,reached_at,delay_minutes FROM checkpoints WHERE convoy_id=$1 AND lat IS NOT NULL AND lng IS NOT NULL ORDER BY sequence_order",
    [convoyId]
  );
}

async function getInfrastructure(db, orgId, convoyId) {
  const checkpoints = await getCheckpoints(db, convoyId);
  const geofences = await safeRows(db,
    "SELECT id::text AS id,name,type,coordinates,radius,region,active,updated_at FROM geofences WHERE org_id=$1 AND active=true ORDER BY updated_at DESC LIMIT 250",
    [orgId]
  );
  const cdsGeofences = await safeRows(db,
    "SELECT id::text AS id,name,type,category,geometry,center_lat,center_lng,radius_m,active,updated_at FROM cds_geofences WHERE org_id=$1 AND active=true AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 250",
    [orgId]
  );
  const shipments = await safeRows(db,
    "SELECT id::text AS id,tracking_number,customer_name,status,origin_address,origin_lat,origin_lng,destination_address,destination_lat,destination_lng,estimated_arrival,actual_delivery FROM shipments WHERE convoy_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100",
    [convoyId]
  );
  const guardianDevices = await safeRows(db,
    "SELECT gd.id::text AS id,gd.name,gd.status,gd.panic_active,gd.assignment_type,gd.assignment_id::text AS assignment_id,gd.last_lat,gd.last_lng,gd.last_speed,gd.last_seen,gd.last_fix_at,fo.name AS officer_name,fo.phone AS officer_phone,dh.battery_level,dh.signal_strength,dh.recorded_at AS health_recorded_at,dl.heading,dl.timestamp AS heading_at FROM guardian_devices gd LEFT JOIN field_officers fo ON fo.device_id=gd.id AND fo.org_id=$1 LEFT JOIN LATERAL (SELECT heading,timestamp FROM device_locations WHERE device_id=gd.id ORDER BY timestamp DESC LIMIT 1) dl ON true LEFT JOIN LATERAL (SELECT battery_level,signal_strength,recorded_at FROM device_health WHERE device_id=gd.id ORDER BY recorded_at DESC LIMIT 1) dh ON true WHERE gd.org_id=$1 AND gd.deleted_at IS NULL AND gd.last_lat IS NOT NULL AND gd.last_lng IS NOT NULL ORDER BY gd.last_seen DESC NULLS LAST LIMIT 250",
    [orgId]
  );
  return { checkpoints, geofences, cdsGeofences, shipments, guardianDevices };
}

async function getSecurity(db, orgId, convoyId) {
  const riskZones = await safeRows(db,
    "SELECT id::text AS id,name,description,risk_level,zone_type,lat,lng,radius_km,valid_from,valid_until,source,confidence,updated_at FROM risk_zones WHERE (org_id=$1 OR org_id IS NULL) AND COALESCE(is_active,active,true)=true AND (valid_from IS NULL OR valid_from<=NOW()) AND (valid_until IS NULL OR valid_until>=NOW()) AND lat IS NOT NULL AND lng IS NOT NULL ORDER BY CASE LOWER(COALESCE(risk_level,'medium')) WHEN 'no_go' THEN 0 WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,name LIMIT 250",
    [orgId]
  );
  const incidents = await safeRows(db,
    "SELECT id::text AS id,convoy_id::text AS convoy_id,title,description,severity,status,created_at,updated_at FROM incidents WHERE org_id=$1 AND deleted_at IS NULL AND status NOT IN ('resolved','closed') AND ($2::uuid IS NULL OR convoy_id=$2) ORDER BY created_at DESC LIMIT 100",
    [orgId, convoyId || null]
  );
  const cdsIncidents = await safeRows(db,
    "SELECT id::text AS id,convoy_id::text AS convoy_id,incident_number,title,description,severity,status,lat,lng,created_at,updated_at FROM cds_incidents WHERE org_id=$1 AND status NOT IN ('resolved','closed') AND ($2::uuid IS NULL OR convoy_id=$2) ORDER BY created_at DESC LIMIT 100",
    [orgId, convoyId || null]
  );
  const intelAlerts = await safeRows(db,
    "SELECT id::text AS id,category,title,summary,severity,confidence,verification_state,status,country_code,region,location_name,latitude,longitude,first_seen_at,last_seen_at,source_count,corroboration_count,metadata FROM intel_alerts WHERE org_id=$1 AND status NOT IN ('resolved','closed') ORDER BY last_seen_at DESC LIMIT 250",
    [orgId]
  );
  return { riskZones, incidents: incidents.concat(cdsIncidents), intelAlerts };
}

async function getAlerts(db, orgId, convoyId) {
  return safeRows(db,
    "SELECT a.id::text AS id,a.vehicle_id::text AS vehicle_id,a.convoy_id::text AS convoy_id,a.type,a.severity,a.message,a.created_at,a.acknowledged_at FROM alerts a WHERE a.org_id=$1 AND a.deleted_at IS NULL AND a.resolved_at IS NULL AND ($2::uuid IS NULL OR a.convoy_id=$2) ORDER BY CASE a.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,a.created_at DESC LIMIT 100",
    [orgId, convoyId || null]
  );
}

function quality(freshness, reason) {
  return {
    state: freshness === 'LIVE' ? 'good' : freshness === 'DELAYED' ? 'degraded' : freshness === 'STALE' ? 'stale' : 'unknown',
    freshnessClass: freshness,
    reason: reason
  };
}

function baseObservation(row, now, extra) {
  const observedAt = iso(row.observedAt);
  const freshness = classifyOperationalFreshness(observedAt, now);
  const obsConf = row.observationConfidence == null ? 0.8 : Math.max(0, Math.min(1, Number(row.observationConfidence)));
  return Object.assign({
    id: String(row.id),
    entityType: row.entityType,
    source: row.source || 'sonalit',
    sourceReference: row.sourceReference || String(row.id),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    altitudeM: row.altitudeM == null ? null : Number(row.altitudeM),
    observedAt: observedAt,
    receivedAt: new Date(now).toISOString(),
    freshnessMs: observedAt ? Math.max(0, now - Date.parse(observedAt)) : undefined,
    observationConfidence: obsConf,
    interpretationConfidence: null,
    operationalConfidence: null,
    accuracyM: row.accuracyM == null ? null : Number(row.accuracyM),
    confidence: obsConf,
    headingDeg: row.headingDeg == null ? null : Number(row.headingDeg),
    speedMps: row.speedMps == null ? null : Number(row.speedMps),
    status: row.status,
    attributes: row.attributes || {},
    provenance: row.provenance || { sourceName: row.source || 'Sonalit' },
    coverage: row.coverage,
    quality: row.quality || quality(freshness, null)
  }, extra || {});
}

function securityObservation(row, now) {
  const conf = num(row.confidence);
  const obsConf = conf == null ? 0.7 : conf > 1 ? conf / 100 : conf;
  return baseObservation({
    id: 'sonalit:risk_zone:' + row.id,
    entityType: 'risk_zone',
    source: 'sonalit-risk',
    sourceReference: row.id,
    latitude: row.lat,
    longitude: row.lng,
    observedAt: row.updated_at || row.valid_from,
    observationConfidence: obsConf,
    status: row.risk_level,
    attributes: {
      name: row.name,
      description: row.description,
      risk_level: row.risk_level,
      zone_type: row.zone_type,
      radius_km: num(row.radius_km) || 0,
      valid_from: row.valid_from,
      valid_until: row.valid_until,
      source: row.source || 'internal'
    },
    provenance: { sourceName: 'Sonalit Risk Intelligence', sourceReference: row.id, observationType: 'risk_zone' },
    coverage: { complete: false, bounded: true, queryScope: 'organisation-scoped risk registry' }
  }, now);
}

function guardianDeviceObservation(row, now) {
  const lat = num(row.last_lat);
  const lng = num(row.last_lng);
  if (lat == null || lng == null) return null;
  const observedAt = iso(row.last_fix_at || row.last_seen);
  const freshness = classifyOperationalFreshness(observedAt, now);
  const heading = num(row.heading);
  const speedKmh = num(row.last_speed);
  const obsConf = row.last_fix_at ? 0.92 : 0.78;
  return baseObservation({
    id: 'sonalit:guardian:' + row.id,
    entityType: 'guardian_device',
    source: 'sonalit-guardian',
    sourceReference: row.id,
    latitude: lat,
    longitude: lng,
    observedAt,
    observationConfidence: obsConf,
    headingDeg: heading,
    speedMps: speedKmh == null ? null : speedKmh / 3.6,
    status: row.panic_active ? 'panic' : row.status,
    attributes: {
      name: row.name,
      status: row.status,
      panic_active: Boolean(row.panic_active),
      assignment_type: row.assignment_type || null,
      assignment_id: row.assignment_id || null,
      officer_name: row.officer_name || null,
      officer_phone: row.officer_phone || null,
      battery_level: row.battery_level == null ? null : Number(row.battery_level),
      signal_strength: row.signal_strength == null ? null : Number(row.signal_strength),
      heading_at: iso(row.heading_at),
      health_recorded_at: iso(row.health_recorded_at),
      last_fix_at: iso(row.last_fix_at)
    },
    provenance: {
      sourceName: 'Sonalit Guardian Telemetry',
      sourceReference: row.id,
      observationType: 'guardian_device_position'
    },
    coverage: {
      complete: false,
      bounded: true,
      queryScope: 'organisation-scoped Guardian devices with current location'
    },
    quality: {
      state: freshness === 'LIVE' ? 'good' : freshness === 'DELAYED' ? 'degraded' : freshness === 'STALE' ? 'stale' : 'unknown',
      freshnessClass: freshness,
      reason: row.last_fix_at ? undefined : 'Guardian heartbeat timestamp used because last GPS-fix timestamp is unavailable'
    }
  }, now, {
    interpretationConfidence: 0.98,
    operationalConfidence: row.panic_active ? 1 : 0.92,
    uncertainty: row.last_fix_at ? [] : ['Position recency is anchored to last_seen because no distinct GPS-fix timestamp is available.']
  });
}

function checkpointObservation(row, now) {
  return baseObservation({
    id: 'sonalit:checkpoint:' + row.id,
    entityType: 'checkpoint',
    source: 'sonalit-operations',
    sourceReference: row.id,
    latitude: row.lat,
    longitude: row.lng,
    observedAt: row.reached_at || row.expected_at,
    status: row.status,
    attributes: {
      name: row.name,
      location_name: row.location_name,
      sequence_order: row.sequence_order,
      expected_at: row.expected_at,
      reached_at: row.reached_at,
      delay_minutes: row.delay_minutes
    },
    provenance: { sourceName: 'Sonalit Convoy Operations', sourceReference: row.id, observationType: 'checkpoint' },
    coverage: { complete: true, bounded: true, queryScope: 'convoy checkpoints' },
    quality: { state: 'good', freshnessClass: 'UNKNOWN', reason: 'static operational checkpoint record' }
  }, now, { interpretationConfidence: 1, operationalConfidence: 0.95 });
}

function intelAlertObservation(row, now) {
  const lat = num(row.latitude);
  const lng = num(row.longitude);
  if (lat == null || lng == null) return null;
  const rawConfidence = num(row.confidence);
  const observationConfidence = rawConfidence == null ? 0.35 : Math.max(0, Math.min(1, rawConfidence > 1 ? rawConfidence / 100 : rawConfidence));
  const observedAt = iso(row.last_seen_at || row.first_seen_at);
  return baseObservation({
    id: 'sonalit:intel_alert:' + row.id,
    entityType: 'intelligence_alert',
    source: 'sonalit-intelligence',
    sourceReference: row.id,
    latitude: lat,
    longitude: lng,
    observedAt: observedAt,
    observationConfidence: observationConfidence,
    status: row.verification_state || row.status,
    attributes: {
      category: row.category,
      title: row.title,
      summary: row.summary,
      severity: row.severity,
      verification_state: row.verification_state,
      status: row.status,
      country_code: row.country_code,
      region: row.region,
      location_name: row.location_name,
      source_count: row.source_count,
      corroboration_count: row.corroboration_count,
      metadata: row.metadata
    },
    provenance: {
      sourceName: 'Sonalit Intelligence Alerts',
      sourceReference: row.id,
      observationType: 'derived_intelligence_alert'
    },
    coverage: {
      complete: false,
      bounded: true,
      queryScope: 'organisation-scoped open intelligence alerts'
    }
  }, now, {
    interpretationConfidence: observationConfidence,
    operationalConfidence: row.verification_state === 'verified' ? observationConfidence : observationConfidence * 0.75
  });
}

function incidentObservation(row, now) {
  if (num(row.lat) == null || num(row.lng) == null) return null;
  return baseObservation({
    id: 'sonalit:incident:' + row.id,
    entityType: 'incident',
    source: 'sonalit-incidents',
    sourceReference: row.id,
    latitude: row.lat,
    longitude: row.lng,
    observedAt: row.updated_at || row.created_at,
    status: row.status,
    observationConfidence: 0.9,
    attributes: {
      title: row.title,
      description: row.description,
      severity: row.severity,
      status: row.status,
      convoy_id: row.convoy_id || null,
      incident_number: row.incident_number || null
    },
    provenance: { sourceName: 'Sonalit Incident System', sourceReference: row.id, observationType: 'incident' },
    coverage: { complete: false, bounded: true, queryScope: 'organisation-scoped active incidents with coordinates' }
  }, now, { interpretationConfidence: 0.95, operationalConfidence: 0.9 });
}

function geofenceObservation(row, now) {
  const coords = parseJson(row.coordinates);
  let lat = num(row.lat);
  let lng = num(row.lng);
  if (coords && typeof coords === 'object' && !Array.isArray(coords)) {
    lat = lat == null ? num(coords.lat ?? coords.latitude) : lat;
    lng = lng == null ? num(coords.lng ?? coords.longitude) : lng;
  }
  if (lat == null || lng == null) return null;
  return baseObservation({
    id: 'sonalit:geofence:' + row.id,
    entityType: 'geofence',
    source: 'sonalit-geofences',
    sourceReference: row.id,
    latitude: lat,
    longitude: lng,
    observedAt: row.updated_at,
    status: row.type,
    attributes: { name: row.name, type: row.type, radius: num(row.radius), region: row.region },
    provenance: { sourceName: 'Sonalit Geofence Registry', sourceReference: row.id, observationType: 'operational_geofence' },
    coverage: { complete: true, bounded: true, queryScope: 'organisation-scoped active geofences' },
    quality: { state: 'good', freshnessClass: 'UNKNOWN', reason: 'static operational geofence definition' }
  }, now, { interpretationConfidence: 1, operationalConfidence: 0.95 });
}

function cdsFacilityObservation(row, now) {
  const lat = num(row.center_lat);
  const lng = num(row.center_lng);
  if (lat == null || lng == null) return null;
  return baseObservation({
    id: 'sonalit:cds_geofence:' + row.id,
    entityType: 'facility',
    source: 'sonalit-cds',
    sourceReference: row.id,
    latitude: lat,
    longitude: lng,
    observedAt: row.updated_at,
    status: row.active ? 'active' : 'inactive',
    geometry: parseJson(row.geometry) || undefined,
    attributes: {
      name: row.name,
      category: row.category,
      type: row.type,
      radiusM: num(row.radius_m),
      active: Boolean(row.active),
      businessDomain: 'container-delivery-system'
    },
    provenance: { sourceName: 'Sonalit CDS Geofence Registry', sourceReference: row.id, observationType: 'cds_facility_boundary' },
    coverage: { complete: true, bounded: true, queryScope: 'organisation-scoped active CDS port/warehouse/border/customer geofences' },
    quality: { state: 'good', freshnessClass: 'UNKNOWN', reason: 'static CDS facility boundary' }
  }, now, { interpretationConfidence: 1, operationalConfidence: 0.95 });
}

function makeVehicle(row, mission, routeInfo, checkpoints, now) {
  const canonicalAt = iso(row.last_ping);
  const gpsAt = iso(row.gps_at);
  const useGps = gpsAt && (!canonicalAt || Date.parse(gpsAt) > Date.parse(canonicalAt));
  const lat = num(useGps ? row.gps_lat : row.latitude);
  const lng = num(useGps ? row.gps_lng : row.longitude);
  const observedAt = useGps ? gpsAt : canonicalAt;
  const heading = num(useGps ? row.gps_heading : row.heading);
  const speedKmh = num(useGps ? row.gps_speed : row.speed) ?? 0;
  const freshness = classifyOperationalFreshness(observedAt, now);

  const previous = row.prev_at ? {
    lat: num(row.prev_lat),
    lng: num(row.prev_lng),
    heading: num(row.prev_heading),
    speedKmh: num(row.prev_speed) ?? 0,
    observedAt: iso(row.prev_at)
  } : null;

  const recentPointsRaw = Array.isArray(parseJson(row.recent_points)) ? parseJson(row.recent_points) : [];
  const recentPoints = recentPointsRaw
    .map(function(point) {
      return {
        lat: num(point.lat),
        lng: num(point.lng),
        speedKmh: num(point.speed) ?? 0,
        heading: num(point.heading),
        observedAt: iso(point.timestamp)
      };
    })
    .filter(function(point) {
      return point.lat != null && point.lng != null && point.observedAt;
    })
    .sort(function(a,b) { return Date.parse(b.observedAt) - Date.parse(a.observedAt); });

  const gapMs = previous && observedAt ? Math.max(0, Date.parse(observedAt) - Date.parse(previous.observedAt)) : null;
  const impliedKmh = previous && lat != null && lng != null && gapMs > 0
    ? distanceM(previous.lat, previous.lng, lat, lng) / (gapMs / 3600000)
    : null;
  const headingDelta = previous && previous.heading != null && heading != null
    ? Math.abs((((heading - previous.heading) + 540) % 360) - 180)
    : null;

  let routeState = {
    relation: 'UNKNOWN',
    crossTrackKm: null,
    alongKm: null,
    expectedAlongKm: null,
    routeProgressPct: null,
    scheduleDeltaKm: null,
    scheduleDeltaMin: null,
    corridorKm: routeInfo.widthKm
  };
  let previousRouteState = null;

  if (lat != null && lng != null && routeInfo.route.length >= 2) {
    const elapsed = mission && mission.departureTime
      ? Math.max(0, now - Date.parse(mission.departureTime))
      : 0;
    const rr = routeRelation({ lat, lng }, routeInfo.route, routeInfo.widthKm, 8, elapsed, 45);
    const routeLen = Number(rr.evidence.route_len_km) || 0;
    routeState = {
      relation: rr.relation,
      crossTrackKm: rr.evidence.cross_track_km,
      alongKm: rr.evidence.along_km,
      expectedAlongKm: rr.evidence.expected_along_km,
      routeProgressPct: routeLen > 0 ? Math.max(0, Math.min(100, Number(rr.evidence.along_km) / routeLen * 100)) : null,
      scheduleDeltaKm: rr.evidence.schedule_delta_km,
      scheduleDeltaMin: rr.evidence.schedule_delta_min,
      corridorKm: routeInfo.widthKm
    };

    if (previous && previous.lat != null && previous.lng != null) {
      const previousElapsed = mission && mission.departureTime
        ? Math.max(0, Date.parse(previous.observedAt) - Date.parse(mission.departureTime))
        : 0;
      const pr = routeRelation(previous, routeInfo.route, routeInfo.widthKm, 8, previousElapsed, 45);
      previousRouteState = {
        relation: pr.relation,
        crossTrackKm: pr.evidence.cross_track_km,
        alongKm: pr.evidence.along_km
      };
    }
  }

  const nearbyCheckpoints = checkpoints.map(function(cp) {
    const d = lat != null && lng != null ? distanceM(lat, lng, Number(cp.lat), Number(cp.lng)) : null;
    const pd = previous && d != null ? distanceM(previous.lat, previous.lng, Number(cp.lat), Number(cp.lng)) : null;
    const approaching = d != null && d <= 2000 && (pd == null || pd - d >= 150);
    const passed = d != null && pd != null && pd > 500 && d <= 250;
    return {
      id: String(cp.id),
      label: cp.name || cp.location_name || 'Checkpoint',
      distanceM: d == null ? null : Math.round(d),
      previousDistanceM: pd == null ? null : Math.round(pd),
      approachDeltaM: d == null || pd == null ? null : Math.round(pd - d),
      approaching,
      passed,
      expectedAt: cp.expected_at || null,
      status: cp.status || null,
      uncertainty: pd == null ? ['No prior fix is available to confirm approach direction.'] : []
    };
  }).filter(function(cp) {
    return cp.distanceM != null && cp.distanceM <= 10000;
  }).sort(function(a,b) {
    return a.distanceM - b.distanceM;
  });

  const sourceReferences = [];
  if (useGps && row.gps_at) sourceReferences.push('gps_logs:' + row.id);
  else if (row.last_ping) sourceReferences.push('vehicles:' + row.id);

  if (lat == null || lng == null) return null;

  const obs = baseObservation({
    id: 'sonalit:vehicle:' + row.id,
    entityType: 'vehicle',
    source: 'sonalit',
    sourceReference: row.id,
    latitude: lat,
    longitude: lng,
    headingDeg: heading,
    speedMps: speedKmh / 3.6,
    accuracyM: useGps ? num(row.gps_accuracy) : null,
    observedAt: observedAt,
    observationConfidence: useGps && row.gps_accuracy != null
      ? Math.max(0.2, Math.min(1, 1 - Math.max(0, Number(row.gps_accuracy) - 10) / 250))
      : 0.92,
    status: row.status,
    attributes: {
      vehicle_id: row.id,
      registration: row.registration,
      type: row.type,
      region: row.region,
      driver_id: row.driver_id,
      assigned_convoy_id: row.assigned_convoy_id || null
    },
    provenance: { sourceName: 'Sonalit Tracking', sourceReference: row.id, observationType: 'operational_vehicle_telemetry' },
    coverage: { complete: true, bounded: true, queryScope: 'organisation-scoped canonical telemetry' }
  }, now);

  obs.convoyId = row.assigned_convoy_id || mission?.convoyId || null;
  obs.positionSource = useGps ? 'gps_history' : 'canonical_vehicle';
  obs.previousObservedAt = previous?.observedAt || null;
  obs.historyGapMs = gapMs;
  obs.impliedSpeedKmh = Number.isFinite(impliedKmh) ? Math.round(impliedKmh * 100) / 100 : null;
  obs.headingDeltaDeg = headingDelta;
  obs.stationaryDurationMs = speedKmh <= 2 && previous && gapMs != null && distanceM(previous.lat, previous.lng, lat, lng) <= 75 ? gapMs : 0;
  obs.recoveredFreshness = freshness === 'LIVE' || freshness === 'DELAYED';
  obs.speedKmh = speedKmh;
  obs.sourceReferences = sourceReferences;
  obs.uncertainty = freshness === 'STALE' ? ['Current vehicle position is stale.'] : [];
  obs.routeState = routeState;
  obs.previousRouteState = previousRouteState;
  obs.nearbyCheckpoints = nearbyCheckpoints;
  obs.deviationThresholdKm = routeInfo.widthKm;
  return obs;
}

async function buildWorldContext(opts) {
  const input = opts || {};
  const orgId = input.orgId;
  const db = input.db;
  if (!orgId || !db) {
    const error = new Error('Organisation context and database are required');
    error.statusCode = 403;
    throw error;
  }

  const now = Date.now();
  const requested = Array.isArray(input.layers) ? input.layers : ['aircraft','weather','maritime','traffic','hazards','security','infrastructure','incidents','alerts'];
  const layers = Array.from(new Set(requested.filter(function(l) {
    return typeof l === 'string' && ALLOWED_LAYERS.has(l);
  }).slice(0, 10)));

  let subject = input.subject || { kind: 'none', id: 'context' };
  const subjectResolution = await resolveSpatialSubject({ db, orgId, subject });
  let missionRow = subjectResolution.missionRow;

  let vehicleRows = [];
  let mission = null;
  let routeInfo = { route: [], widthKm: 2, active: false, lengthKm: 0 };
  let infrastructureRaw = { checkpoints: [], geofences: [], shipments: [] };
  let securityRaw = { riskZones: [], incidents: [] };
  let alertRows = [];

  if (missionRow) {
    mission = {
      convoyId: missionRow.id,
      name: missionRow.name,
      status: missionRow.status,
      priority: missionRow.priority,
      origin: missionRow.route_origin || null,
      destination: missionRow.route_destination || null,
      departureTime: iso(missionRow.departure_time),
      estimatedArrival: iso(missionRow.estimated_arrival)
    };
    routeInfo = await getRoute(db, orgId, missionRow.id);
    infrastructureRaw = await getInfrastructure(db, orgId, missionRow.id);
    securityRaw = await getSecurity(db, orgId, missionRow.id);
    alertRows = await getAlerts(db, orgId, missionRow.id);
    vehicleRows = await getVehicles(db, orgId, missionRow.id, null);
  } else if (subject.kind === 'vehicle') {
    // The resolver proves tenant ownership. Re-read the complete operational
    // projection because route/telemetry calculations need history fields.
    vehicleRows = await getVehicles(db, orgId, null, String(subject.id));
    const assigned = vehicleRows[0]?.assigned_convoy_id || null;
    if (assigned) {
      missionRow = await getConvoy(db, orgId, assigned);
      if (missionRow) {
        mission = {
          convoyId: missionRow.id,
          name: missionRow.name,
          status: missionRow.status,
          priority: missionRow.priority,
          origin: missionRow.route_origin || null,
          destination: missionRow.route_destination || null,
          departureTime: iso(missionRow.departure_time),
          estimatedArrival: iso(missionRow.estimated_arrival)
        };
        routeInfo = await getRoute(db, orgId, missionRow.id);
        infrastructureRaw = await getInfrastructure(db, orgId, missionRow.id);
        securityRaw = await getSecurity(db, orgId, missionRow.id);
        alertRows = await getAlerts(db, orgId, missionRow.id);
      }
    }
  }

  const operationalVehicles = vehicleRows.map(function(row) {
    return makeVehicle(row, mission, routeInfo, infrastructureRaw.checkpoints, now);
  }).filter(Boolean);

  let resolvedCenter = null;
  if (input.center && Number.isFinite(Number(input.center.latitude)) && Number.isFinite(Number(input.center.longitude))) {
    resolvedCenter = { latitude: Number(input.center.latitude), longitude: Number(input.center.longitude) };
  } else if (subject.kind !== 'vehicle' && subjectResolution.center) {
    resolvedCenter = subjectResolution.center;
  } else if (operationalVehicles.length) {
    const total = operationalVehicles.reduce(function(a,v) {
      return { lat: a.lat + v.latitude, lng: a.lng + v.longitude };
    }, { lat: 0, lng: 0 });
    resolvedCenter = {
      latitude: total.lat / operationalVehicles.length,
      longitude: total.lng / operationalVehicles.length
    };
  } else if (routeInfo.route.length) {
    resolvedCenter = { latitude: routeInfo.route[0].lat, longitude: routeInfo.route[0].lng };
  }

  const boundedRadiusM = Math.max(1000, Math.min(Number(input.radiusM) || 25000, 250000));
  const externalRadiusM = Math.min(boundedRadiusM, MAX_EXTERNAL_RADIUS_M);
  const maxEntitiesPerLayer = Math.max(1, Math.min(250, Number(input.maxEntitiesPerLayer) || 100));
  const bbox = input.bbox || (resolvedCenter ? bboxFromCenterRadius(resolvedCenter.latitude, resolvedCenter.longitude, externalRadiusM) : null);
  const routeBbox = bboxFromRoute(routeInfo.route, Math.max(10000, routeInfo.widthKm * 1000));
  const externalBbox = routeBbox && ((routeBbox[2] - routeBbox[0]) * (routeBbox[3] - routeBbox[1]) <= 25) ? routeBbox : bbox;

  const movement = [];
  const environment = [];
  const traffic = [];
  const hazards = [];
  const infrastructure = [];
  const security = [];
  const layerHealth = [];
  const warnings = [];
  const uncertainty = [];
  const layersSucceeded = [];
  const layersPartial = [];
  const layersUnavailable = [];

  if (layers.includes('aircraft') && bbox) {
    try {
      const result = await spatialProviderManager.query('opensky', { bbox: bbox, orgId: orgId, requestId: input.requestId, signal: input.signal });
      movement.push.apply(movement, (result.observations || []).slice(0, Math.max(1, Math.min(250, Number(input.maxEntitiesPerLayer) || 100))));
      const status = result.health?.status || 'UNKNOWN';
      if (status === 'LIVE' || status === 'DELAYED') layersSucceeded.push('aircraft');
      else if (status === 'STALE' || status === 'PARTIAL') layersPartial.push('aircraft');
      else layersUnavailable.push('aircraft');
      layerHealth.push({
        layerId: 'aircraft',
        status: status,
        lastSuccessAt: result.health?.lastSuccessAt,
        lastAttemptAt: result.health?.lastAttemptAt,
        recordCount: result.health?.recordCount,
        acceptedCount: result.health?.acceptedCount,
        rejectedCount: result.health?.rejectedCount,
        reason: result.health?.lastErrorMessage
      });
    } catch (_) {
      layersUnavailable.push('aircraft');
      warnings.push('aircraft_layer_unavailable');
      uncertainty.push('Aircraft provider unavailable.');
      layerHealth.push({ layerId: 'aircraft', status: 'UNAVAILABLE', reason: 'External movement provider failed.' });
    }
  }

  if (layers.includes('weather') && resolvedCenter) {
    const points = [resolvedCenter];
    if (routeInfo.route.length >= 3) points.push(routeInfo.route[Math.floor((routeInfo.route.length - 1) / 2)]);
    if (routeInfo.route.length >= 2) points.push(routeInfo.route[routeInfo.route.length - 1]);
    const unique = new Map();
    points.slice(0, 3).forEach(function(p) {
      const key = Number(p.latitude ?? p.lat).toFixed(3) + ',' + Number(p.longitude ?? p.lng).toFixed(3);
      unique.set(key, { latitude: Number(p.latitude ?? p.lat), longitude: Number(p.longitude ?? p.lng) });
    });
    const results = await Promise.allSettled(Array.from(unique.values()).map(function(p) {
      return spatialProviderManager.query('weather', { latitude: p.latitude, longitude: p.longitude, requestId: input.requestId, signal: input.signal });
    }));
    const environmentById = new Map();
    results.forEach(function(r) {
      if (r.status !== 'fulfilled') return;
      for (const observation of (r.value.observations || [])) {
        if (observation && observation.id) environmentById.set(observation.id, observation);
      }
    });
    environment.push.apply(environment, Array.from(environmentById.values()));
    if (environment.length) {
      layersSucceeded.push('weather');
      layerHealth.push({ layerId: 'weather', status: environment.some(e => e.quality?.freshnessClass === 'LIVE') ? 'LIVE' : 'DELAYED', recordCount: environment.length });
    } else {
      layersUnavailable.push('weather');
      uncertainty.push('Weather provider returned no usable observation.');
      layerHealth.push({ layerId: 'weather', status: 'UNAVAILABLE', reason: 'No usable weather observation.' });
    }
  }

  if (layers.includes('hazards') && bbox) {
    try {
      const result = await spatialProviderManager.query('nasa-eonet', { bbox: externalBbox || bbox, maxRecords: maxEntitiesPerLayer, signal: input.signal });
      hazards.push.apply(hazards, result.observations || []);
      const status = result.health?.status || 'UNKNOWN';
      if (status === 'LIVE' || status === 'DELAYED') layersSucceeded.push('hazards');
      else if (status === 'STALE' || status === 'PARTIAL') layersPartial.push('hazards');
      else layersUnavailable.push('hazards');
      layerHealth.push({ layerId: 'hazards', status, lastSuccessAt: result.health?.lastSuccessAt, lastAttemptAt: result.health?.lastAttemptAt, recordCount: result.health?.recordCount, acceptedCount: result.health?.acceptedCount, rejectedCount: result.health?.rejectedCount, reason: result.health?.lastErrorMessage });
    } catch (_) {
      layersUnavailable.push('hazards');
      warnings.push('hazards_layer_unavailable');
      uncertainty.push('Natural hazard provider unavailable.');
      layerHealth.push({ layerId: 'hazards', status: 'UNAVAILABLE', reason: 'NASA EONET external natural event provider failed.' });
    }
  }

  if (layers.includes('maritime') && bbox) {
    try {
      const result = await spatialProviderManager.query('kpler-ais', { bbox: externalBbox || bbox, maxRecords: maxEntitiesPerLayer, signal: input.signal });
      movement.push.apply(movement, (result.observations || []).slice(0, Math.max(1, Math.min(250, Number(maxEntitiesPerLayer) || 100))));
      const status = result.health?.status || 'UNKNOWN';
      if (status === 'LIVE' || status === 'DELAYED') layersSucceeded.push('maritime');
      else if (status === 'STALE' || status === 'PARTIAL') layersPartial.push('maritime');
      else layersUnavailable.push('maritime');
      layerHealth.push({ layerId: 'maritime', status, lastSuccessAt: result.health?.lastSuccessAt, lastAttemptAt: result.health?.lastAttemptAt, recordCount: result.health?.recordCount, acceptedCount: result.health?.acceptedCount, rejectedCount: result.health?.rejectedCount, reason: result.health?.lastErrorMessage });
      if (status === 'AUTH_REQUIRED') warnings.push('Maritime AIS provider credentials are not configured.');
    } catch (_) {
      layersUnavailable.push('maritime');
      warnings.push('maritime_layer_unavailable');
      uncertainty.push('Maritime AIS provider unavailable.');
      layerHealth.push({ layerId: 'maritime', status: 'UNAVAILABLE', reason: 'External maritime movement provider failed.' });
    }
  }

  if (layers.includes('traffic') && resolvedCenter) {
    const samplePoints = [resolvedCenter];
    if (routeInfo.route.length >= 2) {
      const sampleCount = Math.min(8, routeInfo.route.length);
      for (let i = 0; i < sampleCount; i++) {
        const p = routeInfo.route[Math.round((routeInfo.route.length - 1) * i / Math.max(1, sampleCount - 1))];
        samplePoints.push({ latitude: p.lat, longitude: p.lng });
      }
    }
    const pointMap = new Map();
    samplePoints.forEach(p => pointMap.set(Number(p.latitude).toFixed(4)+','+Number(p.longitude).toFixed(4), p));
    const sampled = Array.from(pointMap.values()).slice(0, 16);
    const trafficResults = await Promise.allSettled([
      spatialProviderManager.query('mapbox-traffic', { points: sampled, maxRecords: Number(input.maxEntitiesPerLayer) || 100, signal: input.signal }),
      spatialProviderManager.query('tomtom-traffic-flow', { points: sampled, maxRecords: Number(input.maxEntitiesPerLayer) || 100, signal: input.signal }),
      (externalBbox || bbox) ? spatialProviderManager.query('tomtom-traffic-incidents', { bbox: externalBbox || bbox, maxRecords: Number(input.maxEntitiesPerLayer) || 100, signal: input.signal }) : Promise.resolve({ observations: [], health: { status: 'UNAVAILABLE' } })
    ]);
    const flow = trafficResults[0], tomtomFlow = trafficResults[1], incident = trafficResults[2], statuses = [];
    if (flow.status === 'fulfilled') { traffic.push.apply(traffic, flow.value.observations || []); statuses.push(flow.value.health?.status || 'UNKNOWN'); }
    else { statuses.push('UNAVAILABLE'); uncertainty.push('Mapbox traffic feed unavailable.'); }
    if (tomtomFlow.status === 'fulfilled') { traffic.push.apply(traffic, tomtomFlow.value.observations || []); statuses.push(tomtomFlow.value.health?.status || 'UNKNOWN'); }
    else { statuses.push('UNAVAILABLE'); uncertainty.push('TomTom traffic flow feed unavailable.'); }
    if (incident.status === 'fulfilled') { traffic.push.apply(traffic, incident.value.observations || []); statuses.push(incident.value.health?.status || 'UNKNOWN'); }
    else { statuses.push('UNAVAILABLE'); uncertainty.push('TomTom traffic incident feed unavailable.'); }
    const status = statuses.includes('LIVE') ? 'LIVE' : statuses.includes('DELAYED') ? 'DELAYED' : statuses.includes('STALE') ? 'STALE' : statuses.includes('PARTIAL') ? 'PARTIAL' : statuses.includes('AUTH_REQUIRED') ? 'AUTH_REQUIRED' : 'UNAVAILABLE';
    if (status === 'LIVE' || status === 'DELAYED') layersSucceeded.push('traffic');
    else if (status === 'STALE' || status === 'PARTIAL') layersPartial.push('traffic');
    else layersUnavailable.push('traffic');
    if (!traffic.length && status === 'AUTH_REQUIRED') warnings.push('Traffic provider credentials are not configured.');
    layerHealth.push({ layerId: 'traffic', status, recordCount: traffic.length, reason: traffic.length ? undefined : 'No usable external traffic observation.' });
  }
  if (layers.includes('infrastructure')) {
    infrastructureRaw.checkpoints.forEach(function(cp) { infrastructure.push(checkpointObservation(cp, now)); });
    infrastructureRaw.geofences.forEach(function(g) {
      const obs = geofenceObservation(g, now);
      if (obs) infrastructure.push(obs);
    });
    (infrastructureRaw.cdsGeofences || []).forEach(function(g) {
      const obs = cdsFacilityObservation(g, now);
      if (obs) infrastructure.push(obs);
    });
    (infrastructureRaw.guardianDevices || []).forEach(function(g) {
      const obs = guardianDeviceObservation(g, now);
      if (obs) infrastructure.push(obs);
    });
    infrastructureRaw.shipments.forEach(function(s) {
      [
        ['origin', s.origin_lat, s.origin_lng, s.origin_address],
        ['destination', s.destination_lat, s.destination_lng, s.destination_address]
      ].forEach(function(p) {
        if (num(p[1]) == null || num(p[2]) == null) return;
        infrastructure.push(baseObservation({
          id: 'sonalit:shipment:' + s.id + ':' + p[0],
          entityType: 'shipment_location',
          source: 'sonalit-operations',
          sourceReference: s.id,
          latitude: p[1],
          longitude: p[2],
          observedAt: null,
          status: s.status,
          attributes: {
            tracking_number: s.tracking_number,
            customer_name: s.customer_name,
            status: s.status,
            kind: p[0],
            address: p[3],
            estimated_arrival: s.estimated_arrival
          },
          provenance: { sourceName: 'Sonalit Shipment Registry', sourceReference: s.id, observationType: 'shipment_location' },
          coverage: { complete: true, bounded: true, queryScope: 'convoy-linked shipments' },
          quality: { state: 'good', freshnessClass: 'UNKNOWN', reason: 'static shipment location metadata' }
        }, now, { interpretationConfidence: 1, operationalConfidence: 0.95 }));
      });
    });
    layersSucceeded.push('infrastructure');
    layerHealth.push({ layerId: 'infrastructure', status: 'LIVE', recordCount: infrastructure.length });
  }

  if (layers.includes('security') || layers.includes('incidents')) {
    securityRaw.riskZones.forEach(function(z) {
      const obs = securityObservation(z, now);
      if (obs) security.push(obs);
    });
    securityRaw.incidents.forEach(function(i) {
      const obs = incidentObservation(i, now);
      if (obs) security.push(obs);
    });
    securityRaw.intelAlerts.forEach(function(i) {
      const obs = intelAlertObservation(i, now);
      if (obs) security.push(obs);
    });
    if (layers.includes('security')) {
      layersSucceeded.push('security');
      layerHealth.push({
        layerId: 'security',
        status: 'LIVE',
        recordCount: securityRaw.riskZones.length + securityRaw.intelAlerts.length
      });
    }
    if (layers.includes('incidents')) {
      layersSucceeded.push('incidents');
      layerHealth.push({
        layerId: 'incidents',
        status: 'LIVE',
        recordCount: securityRaw.incidents.length
      });
    }
  }

  const alertObservations = alertRows.map(function(a) {
    return {
      id: 'sonalit:alert:' + a.id,
      entityType: 'alert',
      source: 'sonalit-alerts',
      sourceReference: a.id,
      observedAt: iso(a.created_at),
      status: a.severity,
      attributes: {
        type: a.type,
        severity: a.severity,
        message: a.message,
        vehicle_id: a.vehicle_id,
        convoy_id: a.convoy_id,
        acknowledged_at: a.acknowledged_at
      },
      provenance: { sourceName: 'Sonalit Alert System', sourceReference: a.id, observationType: 'operational_alert' },
      coverage: { complete: true, bounded: true, queryScope: 'organisation-scoped unresolved alerts' },
      quality: { state: 'good', freshnessClass: classifyOperationalFreshness(a.created_at, now), reason: 'alert state; coordinate fields are intentionally absent' }
    };
  });

  const relations = [];
  const routeTarget = mission ? 'sonalit:route:' + mission.convoyId : 'context:route';
  const corridorTarget = mission ? 'sonalit:corridor:' + mission.convoyId : 'context:corridor';

  operationalVehicles.forEach(function(v) {
    if (v.routeState && v.routeState.relation !== 'UNKNOWN') {
      relations.push({
        predicate: v.routeState.relation === 'OFF_ROUTE' ? 'OFF_ROUTE' : 'ON_ROUTE',
        fromId: v.id,
        toId: routeTarget,
        fromType: 'vehicle',
        toType: 'route',
        distanceM: v.routeState.crossTrackKm == null ? null : Math.round(v.routeState.crossTrackKm * 1000),
        confidence: v.observationConfidence || 0.8,
        operationalConfidence: v.routeState.relation === 'OFF_ROUTE' ? 0.95 : 0.9,
        observedAt: v.observedAt,
        derivedAt: new Date(now).toISOString(),
        evidence: [
          { metric: 'cross_track_km', value: v.routeState.crossTrackKm },
          { metric: 'route_progress_pct', value: v.routeState.routeProgressPct },
          { metric: 'schedule_delta_min', value: v.routeState.scheduleDeltaMin }
        ],
        sourceReferences: v.sourceReferences,
        uncertainty: v.uncertainty
      });
      if (v.routeState.relation !== 'OFF_ROUTE') {
        relations.push({
          predicate: 'WITHIN_CORRIDOR',
          fromId: v.id,
          toId: corridorTarget,
          fromType: 'vehicle',
          toType: 'corridor',
          distanceM: v.routeState.crossTrackKm == null ? null : Math.round(v.routeState.crossTrackKm * 1000),
          confidence: 0.9,
          operationalConfidence: 0.9,
          observedAt: v.observedAt,
          derivedAt: new Date(now).toISOString(),
          evidence: [{ metric: 'corridor_width_km', value: routeInfo.widthKm }],
          sourceReferences: v.sourceReferences,
          uncertainty: v.uncertainty
        });
      }
    }

    (v.nearbyCheckpoints || []).forEach(function(cp) {
      const predicate = cp.approaching ? 'APPROACHING' : cp.passed ? 'CHECKPOINT_PASSED' : 'NEAR_CHECKPOINT';
      relations.push({
        predicate,
        fromId: v.id,
        toId: 'sonalit:checkpoint:' + cp.id,
        fromType: 'vehicle',
        toType: 'checkpoint',
        distanceM: cp.distanceM,
        confidence: v.observationConfidence || 0.8,
        operationalConfidence: 0.85,
        observedAt: v.observedAt,
        derivedAt: new Date(now).toISOString(),
        evidence: [
          { metric: 'distance_m', value: cp.distanceM },
          { metric: 'approach_delta_m', value: cp.approachDeltaM },
          { metric: 'checkpoint_status', value: cp.status }
        ],
        sourceReferences: v.sourceReferences,
        uncertainty: cp.uncertainty
      });
    });

    securityRaw.riskZones.forEach(function(z) {
      const zr = circleRelation({ lat: v.latitude, lng: v.longitude }, z);
      if (zr.distanceM == null) return;

      const routeDistanceKm = routeInfo.route.length >= 2
        ? projectOntoRoute(routeInfo.route, Number(z.lat), Number(z.lng)).crossTrackKm
        : null;

      const routeNear = routeDistanceKm != null &&
        routeDistanceKm * 1000 <= (Number(z.radius_km) || 0) * 1000 + routeInfo.widthKm * 1000;

      if (!zr.inside && zr.distanceM > 25000 && !routeNear) return;

      const targetBearing = bearingDeg(v.latitude, v.longitude, Number(z.lat), Number(z.lng));
      const relative = relativeDirectionFromHeading(v.headingDeg, targetBearing);
      const relevance = contextRelevance({
        distanceM: zr.distanceM,
        severity: z.risk_level,
        freshnessClass: classifyOperationalFreshness(z.updated_at || z.valid_from, now),
        sourceQuality: num(z.confidence) == null ? 0.7 : (Number(z.confidence) > 1 ? Number(z.confidence) / 100 : Number(z.confidence)),
        routeDistanceM: routeDistanceKm == null ? undefined : routeDistanceKm * 1000,
        ahead: relative === 'ahead',
        missionActive: mission?.status === 'active'
      });

      relations.push({
        predicate: zr.inside ? 'WITHIN' : 'HAZARD_NEAR_ROUTE',
        fromId: v.id,
        toId: 'sonalit:risk_zone:' + z.id,
        fromType: 'vehicle',
        toType: 'risk_zone',
        distanceM: zr.distanceM,
        routeDistanceM: routeDistanceKm == null ? null : Math.round(routeDistanceKm * 1000),
        relativeDirection: relative,
        confidence: relevance.score,
        operationalConfidence: relevance.score * 0.9,
        observedAt: iso(z.updated_at || z.valid_from),
        derivedAt: new Date(now).toISOString(),
        evidence: [
          { metric: 'distance_m', value: zr.distanceM },
          { metric: 'route_distance_m', value: routeDistanceKm == null ? null : Math.round(routeDistanceKm * 1000) },
          { metric: 'risk_level', value: z.risk_level }
        ],
        sourceReferences: [String(z.id)],
        uncertainty: ['Risk geometry is centre/radius where no polygon is available.'],
        relevance
      });
    });
  });

  if (resolvedCenter && movement.some(e => e.entityType === 'aircraft')) {
    movement.filter(e => e.entityType === 'aircraft').slice(0, 50).forEach(function(ac) {
      const d = distanceM(resolvedCenter.latitude, resolvedCenter.longitude, ac.latitude, ac.longitude);
      if (d > boundedRadiusM) return;
      const bearing = bearingDeg(resolvedCenter.latitude, resolvedCenter.longitude, ac.latitude, ac.longitude);
      relations.push({
        predicate: 'NEAR',
        fromId: mission ? 'sonalit:convoy:' + mission.convoyId : 'context:center',
        toId: ac.id,
        fromType: mission ? 'convoy' : 'location',
        toType: 'aircraft',
        distanceM: Math.round(d),
        relativeDirection: relativeDirectionFromHeading(operationalVehicles[0]?.headingDeg ?? null, bearing),
        confidence: ac.observationConfidence ?? ac.confidence ?? 0.7,
        operationalConfidence: (ac.observationConfidence ?? ac.confidence ?? 0.7) * 0.75,
        observedAt: ac.observedAt,
        derivedAt: new Date(now).toISOString(),
        evidence: [{ metric: 'distance_m', value: Math.round(d) }],
        sourceReferences: ac.sourceReference ? [ac.sourceReference] : [],
        uncertainty: ['External aircraft coverage is bounded.'],
        relevance: contextRelevance({
          distanceM: d,
          severity: 'low',
          freshnessClass: ac.quality.freshnessClass,
          sourceQuality: ac.observationConfidence ?? 0.7,
          routeDistanceM: routeInfo.route.length >= 2
            ? projectOntoRoute(routeInfo.route, ac.latitude, ac.longitude).crossTrackKm * 1000
            : undefined,
          ahead: true,
          missionActive: mission?.status === 'active'
        })
      });
    });
  }

  securityRaw.intelAlerts.forEach(function(alert) {
    const lat = num(alert.latitude);
    const lng = num(alert.longitude);
    if (lat == null || lng == null) return;

    operationalVehicles.forEach(function(v) {
      const distance = distanceM(v.latitude, v.longitude, lat, lng);
      const routeDistanceKm = routeInfo.route.length >= 2
        ? projectOntoRoute(routeInfo.route, lat, lng).crossTrackKm
        : null;
      if (distance > 30000 && !(routeDistanceKm != null && routeDistanceKm * 1000 <= 30000)) return;

      const targetBearing = bearingDeg(v.latitude, v.longitude, lat, lng);
      const relative = relativeDirectionFromHeading(v.headingDeg, targetBearing);
      const sourceConfidence = num(alert.confidence);
      const confidence = sourceConfidence == null
        ? 0.35
        : Math.max(0, Math.min(1, sourceConfidence > 1 ? sourceConfidence / 100 : sourceConfidence));
      const verified = String(alert.verification_state || '').toLowerCase() === 'verified';
      const corroborated = Number(alert.corroboration_count || 0) >= 2;
      const relevance = contextRelevance({
        distanceM: distance,
        severity: alert.severity,
        freshnessClass: classifyOperationalFreshness(alert.last_seen_at || alert.first_seen_at, now),
        sourceQuality: confidence,
        routeDistanceM: routeDistanceKm == null ? undefined : routeDistanceKm * 1000,
        ahead: relative === 'ahead',
        missionActive: mission?.status === 'active'
      });

      relations.push({
        predicate: verified || corroborated ? 'NEAR_INCIDENT' : 'NEAR',
        fromId: v.id,
        toId: 'sonalit:intel_alert:' + alert.id,
        fromType: 'vehicle',
        toType: 'intelligence_alert',
        distanceM: Math.round(distance),
        routeDistanceM: routeDistanceKm == null ? null : Math.round(routeDistanceKm * 1000),
        relativeDirection: relative,
        confidence: relevance.score * confidence,
        operationalConfidence: (verified || corroborated ? relevance.score : relevance.score * 0.65),
        observedAt: iso(alert.last_seen_at || alert.first_seen_at),
        derivedAt: new Date(now).toISOString(),
        evidence: [
          { metric: 'distance_m', value: Math.round(distance) },
          { metric: 'alert_confidence', value: confidence },
          { metric: 'verification_state', value: alert.verification_state || 'unknown' },
          { metric: 'corroboration_count', value: Number(alert.corroboration_count || 0) },
          { metric: 'source_count', value: Number(alert.source_count || 0) }
        ],
        sourceReferences: [String(alert.id)],
        uncertainty: verified || corroborated
          ? ['Intelligence relevance is derived from source confidence, freshness and mission geometry.']
          : ['Intelligence alert is not verified/corroborated enough for autonomous operational alerting.'],
        relevance,
        actionable: verified || corroborated
      });
    });
  });

  const guardianEntities = infrastructure.filter(function(entity) { return entity.entityType === 'guardian_device'; });
  for (const guardian of guardianEntities) {
    for (const vehicle of operationalVehicles) {
      const distance = distanceM(vehicle.latitude, vehicle.longitude, guardian.latitude, guardian.longitude);
      if (distance > 10000) continue;
      relations.push({
        predicate: 'NEAR',
        fromId: guardian.id,
        toId: vehicle.id,
        fromType: 'guardian_device',
        toType: 'vehicle',
        distanceM: Math.round(distance),
        confidence: guardian.observationConfidence || 0.8,
        operationalConfidence: guardian.operationalConfidence || 0.9,
        observedAt: guardian.observedAt,
        derivedAt: new Date(now).toISOString(),
        evidence: [
          { metric: 'distance_m', value: Math.round(distance), source: 'sonalit-geometry' },
          { metric: 'panic_active', value: Boolean(guardian.attributes?.panic_active), source: 'sonalit-guardian' }
        ],
        sourceReferences: [guardian.sourceReference],
        uncertainty: guardian.uncertainty || [],
        actionable: Boolean(guardian.attributes?.panic_active)
      });
    }
  }

  securityRaw.incidents.forEach(function(incident) {
    if (!mission || !incident.convoy_id || String(incident.convoy_id) !== String(mission.convoyId)) return;
    relations.push({
      predicate: 'NEAR_INCIDENT',
      fromId: 'sonalit:convoy:' + mission.convoyId,
      toId: 'sonalit:incident:' + incident.id,
      fromType: 'convoy',
      toType: 'incident',
      distanceM: null,
      confidence: 0.98,
      operationalConfidence: 0.92,
      observedAt: iso(incident.updated_at || incident.created_at),
      derivedAt: new Date(now).toISOString(),
      evidence: [{ metric: 'incident_convoy_link', value: true }],
      sourceReferences: [String(incident.id)],
      uncertainty: ['Incident is linked to the convoy; coordinate proximity is unavailable for records without lat/lng.']
    });
  });


  const externalRelations = [];
  const routeObservation = routeInfo.route.length >= 2 ? routeInfo.route : [];
  const trafficEntities = traffic || [];
  const hazardEntities = hazards || [];
  for (const entity of movement.concat(trafficEntities, hazardEntities)) {
    if (!Number.isFinite(Number(entity.latitude)) || !Number.isFinite(Number(entity.longitude))) continue;
    const isTraffic = entity.entityType === 'traffic_segment' || entity.entityType === 'traffic_incident' || entity.entityType === 'traffic_hazard';
    const isMaritime = entity.entityType === 'vessel';
    const isHazard = entity.entityType === 'natural_hazard';
    if (!isTraffic && !isMaritime && !isHazard) continue;
    for (const vehicle of operationalVehicles) {
      const distance = distanceM(vehicle.latitude, vehicle.longitude, entity.latitude, entity.longitude);
      const routeDistanceKm = routeObservation.length >= 2 ? projectOntoRoute(routeObservation, Number(entity.latitude), Number(entity.longitude)).crossTrackKm : null;
      const relBearing = vehicle.headingDeg == null ? null : bearingDeg(vehicle.latitude, vehicle.longitude, Number(entity.latitude), Number(entity.longitude));
      const relative = relBearing == null ? null : relativeDirectionFromHeading(vehicle.headingDeg, relBearing);
      const routeNear = routeDistanceKm != null && routeDistanceKm * 1000 <= Math.max(5000, routeInfo.widthKm * 1000 + 5000);
      const close = distance <= 25000;
      if (!close && !routeNear) continue;
      const predicate = isHazard
        ? 'NATURAL_HAZARD_NEAR_ROUTE'
        : isTraffic
          ? (entity.entityType === 'traffic_hazard' ? 'EXTERNAL_HAZARD_NEAR_ROUTE' : entity.attributes?.closed ? 'TRAFFIC_CLOSURE' : entity.attributes?.congestion ? 'TRAFFIC_CONGESTION' : entity.entityType === 'traffic_incident' ? 'EXTERNAL_INCIDENT_NEAR_ROUTE' : 'NEAR_TRAFFIC')
          : 'NEAR_MARITIME';
      const relevance = contextRelevance({
        distanceM: distance,
        severity: entity.attributes?.magnitudeOfDelay === 'major' || entity.attributes?.closed ? 'high' : entity.attributes?.severity,
        freshnessClass: entity.quality?.freshnessClass || 'UNKNOWN',
        sourceQuality: entity.observationConfidence || 0.5,
        routeDistanceM: routeDistanceKm == null ? undefined : routeDistanceKm * 1000,
        ahead: relative === 'ahead',
        missionActive: Boolean(mission && mission.status === 'active')
      });
      externalRelations.push({
        predicate,
        fromId: vehicle.id,
        toId: entity.id,
        fromType: 'vehicle',
        toType: entity.entityType,
        distanceM: Math.round(distance),
        routeDistanceM: routeDistanceKm == null ? null : Math.round(routeDistanceKm * 1000),
        relativeDirection: relative || undefined,
        confidence: Number(entity.observationConfidence || 0.5),
        operationalConfidence: Number(entity.operationalConfidence || entity.observationConfidence || 0.5) * Number(relevance.score || 1),
        observedAt: entity.observedAt || null,
        derivedAt: new Date(now).toISOString(),
        evidence: [
          { metric: 'distance_m', value: Math.round(distance), source: entity.source },
          { metric: 'route_distance_m', value: routeDistanceKm == null ? null : Math.round(routeDistanceKm * 1000), source: 'sonalit-corridor' },
          { metric: 'relative_direction', value: relative || 'unknown', source: 'sonalit-geometry' }
        ],
        sourceReferences: [String(entity.sourceReference || entity.id)],
        uncertainty: entity.quality?.reason ? [entity.quality.reason] : [],
        relevance,
        actionable: Number(entity.operationalConfidence || 0.5) >= 0.65
      });
    }
  }
  if (routeObservation.length >= 2) {
    const destinationPoints = infrastructure.filter(e => e.entityType === 'shipment_location' && e.attributes?.kind === 'destination');
    for (const vessel of movement.filter(e => e.entityType === 'vessel')) {
      for (const destination of destinationPoints) {
        const distance = distanceM(vessel.latitude, vessel.longitude, destination.latitude, destination.longitude);
        if (distance > 50000) continue;
        const speed = Number(vessel.speedMps || 0);
        const confidence = Number(vessel.observationConfidence || 0.5);
        externalRelations.push({
          predicate: speed > 1 ? 'VESSEL_APPROACHING_DESTINATION' : 'NEAR_MARITIME',
          fromId: vessel.id,
          toId: destination.id,
          fromType: 'vessel',
          toType: 'shipment_location',
          distanceM: Math.round(distance),
          routeDistanceM: null,
          confidence,
          operationalConfidence: Number(vessel.operationalConfidence || confidence) * (speed > 1 ? 0.9 : 0.75),
          observedAt: vessel.observedAt || null,
          derivedAt: new Date(now).toISOString(),
          evidence: [{ metric: 'destination_distance_m', value: Math.round(distance), source: vessel.source }, { metric: 'vessel_speed_mps', value: speed, source: vessel.source }],
          sourceReferences: [String(vessel.sourceReference || vessel.id), String(destination.sourceReference || destination.id)],
          uncertainty: speed > 1 ? [] : ['Vessel movement speed is not sufficient to establish approach direction.'],
          actionable: confidence >= 0.65 && speed > 1
        });
      }
    }
  }
  if (mission && routeObservation.length >= 2) {
    for (const entity of trafficEntities.concat(hazardEntities)) {
      if (!Number.isFinite(Number(entity.latitude)) || !Number.isFinite(Number(entity.longitude))) continue;
      const routeDistanceKm = projectOntoRoute(routeObservation, Number(entity.latitude), Number(entity.longitude)).crossTrackKm;
      if (!Number.isFinite(routeDistanceKm) || routeDistanceKm * 1000 > Math.max(5000, routeInfo.widthKm * 1000 + 10000)) continue;
      const predicate = entity.entityType === 'natural_hazard'
        ? 'NATURAL_HAZARD_NEAR_ROUTE'
        : entity.entityType === 'traffic_hazard'
          ? 'EXTERNAL_HAZARD_NEAR_ROUTE'
          : entity.attributes?.closed
            ? 'TRAFFIC_CLOSURE'
            : entity.attributes?.congestion
              ? 'TRAFFIC_CONGESTION'
              : entity.entityType === 'traffic_incident'
                ? 'EXTERNAL_INCIDENT_NEAR_ROUTE'
                : 'NEAR_TRAFFIC';
      const opConf = Number(entity.operationalConfidence || entity.observationConfidence || 0.5);
      externalRelations.push({
        predicate,
        fromId: 'sonalit:convoy:' + mission.convoyId,
        toId: entity.id,
        fromType: 'convoy',
        toType: entity.entityType,
        distanceM: null,
        routeDistanceM: Math.round(routeDistanceKm * 1000),
        confidence: Number(entity.observationConfidence || 0.5),
        operationalConfidence: opConf * (entity.quality?.freshnessClass === 'UNKNOWN' ? 0.9 : 1),
        observedAt: entity.observedAt || null,
        derivedAt: new Date(now).toISOString(),
        evidence: [
          { metric: 'route_distance_m', value: Math.round(routeDistanceKm * 1000), source: 'sonalit-corridor' },
          { metric: 'source_observation', value: entity.id, source: entity.source }
        ],
        sourceReferences: [String(entity.sourceReference || entity.id)],
        uncertainty: entity.quality?.reason ? [entity.quality.reason] : [],
        relevance: contextRelevance({
          distanceM: routeDistanceKm * 1000,
          routeDistanceM: routeDistanceKm * 1000,
          severity: entity.attributes?.magnitudeOfDelay === 'major' || entity.attributes?.closed ? 'high' : entity.attributes?.severity,
          freshnessClass: entity.quality?.freshnessClass || 'UNKNOWN',
          sourceQuality: entity.observationConfidence || 0.5,
          missionActive: true
        }),
        actionable: opConf >= 0.65
      });
    }

    for (const entity of movement.filter(e => e.entityType === 'vessel')) {
      if (!Number.isFinite(Number(entity.latitude)) || !Number.isFinite(Number(entity.longitude))) continue;
      const routeDistanceKm = projectOntoRoute(routeObservation, Number(entity.latitude), Number(entity.longitude)).crossTrackKm;
      if (!Number.isFinite(routeDistanceKm) || routeDistanceKm * 1000 > Math.max(5000, routeInfo.widthKm * 1000 + 10000)) continue;
      externalRelations.push({
        predicate: 'NEAR_MARITIME',
        fromId: 'sonalit:convoy:' + mission.convoyId,
        toId: entity.id,
        fromType: 'convoy',
        toType: entity.entityType,
        distanceM: null,
        routeDistanceM: Math.round(routeDistanceKm * 1000),
        confidence: Number(entity.observationConfidence || 0.5),
        operationalConfidence: Number(entity.operationalConfidence || entity.observationConfidence || 0.5),
        observedAt: entity.observedAt || null,
        derivedAt: new Date(now).toISOString(),
        evidence: [{ metric: 'route_distance_m', value: Math.round(routeDistanceKm * 1000), source: 'sonalit-corridor' }],
        sourceReferences: [String(entity.sourceReference || entity.id)],
        uncertainty: entity.quality?.reason ? [entity.quality.reason] : [],
        relevance: contextRelevance({
          distanceM: routeDistanceKm * 1000,
          routeDistanceM: routeDistanceKm * 1000,
          freshnessClass: entity.quality?.freshnessClass || 'UNKNOWN',
          sourceQuality: entity.observationConfidence || 0.5,
          missionActive: true
        }),
        actionable: Number(entity.operationalConfidence || entity.observationConfidence || 0.5) >= 0.65
      });
    }
  }

  relations.push.apply(relations, externalRelations);
  const allEntities = operationalVehicles.concat(movement, environment, traffic, hazards, infrastructure, security);
  const missionRouteCoords = routeInfo.route.map(function(p) { return [p.lng, p.lat]; });

  const context = {
    subject: Object.assign({}, subject, {
      id: String(subject.id || 'context'),
      orgId: orgId,
      label: subject.label || mission?.name || null
    }),
    generatedAt: new Date(now).toISOString(),
    spatialContext: {
      center: resolvedCenter || undefined,
      radiusM: boundedRadiusM,
      queryScope: bbox ? 'bbox:' + bbox.join(',') : 'operational-mission-context',
      corridorKm: mission ? routeInfo.widthKm : undefined
    },
    mission: mission ? Object.assign(mission, {
      route: { coordinates: missionRouteCoords, lengthKm: routeInfo.lengthKm },
      corridor: { widthKm: routeInfo.widthKm, active: routeInfo.active }
    }) : undefined,
    operational: {
      vehicles: operationalVehicles,
      alerts: alertObservations
    },
    entities: allEntities,
    relations,
    environment,
    movement,
    traffic,
    hazards,
    infrastructure,
    security,
    coverage: {
      layersRequested: layers,
      layersSucceeded: Array.from(new Set(layersSucceeded)),
      layersPartial: Array.from(new Set(layersPartial)),
      layersUnavailable: Array.from(new Set(layersUnavailable))
    },
    layerHealth,
    provenance: [
      { sourceName: 'Sonalit Tracking', attribution: 'Organisation-scoped operational telemetry' },
      ...(movement.some(e => e.source === 'opensky') ? [{ sourceName: 'OpenSky Network', attribution: 'OpenSky Network', license: 'OpenSky Network terms' }] : []),
      ...(environment.length ? [{ sourceName: 'Open-Meteo', attribution: 'Open-Meteo', license: 'Open-Meteo terms' }] : []),
      ...(movement.some(e => e.source === 'kpler-ais') ? [{ sourceName: 'Kpler AIS', attribution: 'Kpler AIS' }] : []),
      ...(traffic.some(e => e.source === 'mapbox-traffic') ? [{ sourceName: 'Mapbox Traffic', attribution: 'Mapbox Traffic' }] : []),
      ...(traffic.some(e => e.source === 'tomtom-traffic') ? [{ sourceName: 'TomTom Traffic', attribution: 'TomTom Traffic' }] : []),
      ...(hazards.length ? [{ sourceName: 'NASA EONET', attribution: 'NASA EONET' }] : []),
      ...(security.length ? [{ sourceName: 'Sonalit Risk/Incident Systems', attribution: 'Organisation-scoped internal records' }] : [])
    ],
    freshness: {
      oldestObservedAt: allEntities.map(function(e) { return e.observedAt; }).filter(Boolean).map(Date.parse).filter(Number.isFinite).length
        ? new Date(Math.min.apply(Math, allEntities.map(function(e) { return e.observedAt; }).filter(Boolean).map(Date.parse).filter(Number.isFinite))).toISOString()
        : undefined,
      newestObservedAt: allEntities.map(function(e) { return e.observedAt; }).filter(Boolean).map(Date.parse).filter(Number.isFinite).length
        ? new Date(Math.max.apply(Math, allEntities.map(function(e) { return e.observedAt; }).filter(Boolean).map(Date.parse).filter(Number.isFinite))).toISOString()
        : undefined
    },
    uncertainty,
    warnings
  };

  const events = detectSpatialEvents(context, { now: now });
  if (input.persistEvents) {
    try {
      const persisted = await persistSpatialEvents(db, events, {
        orgId: orgId,
        userId: input.userId || null,
        publish: input.publish || null
      });
      context.events = (persisted.created || []).map(function(row) {
        return {
          id: row.id,
          eventKey: row.event_key,
          eventType: row.event_type,
          subjectType: row.subject_type,
          subjectId: row.subject_id,
          convoyId: row.convoy_id,
          relatedEntities: parseJson(row.related_entities) || [],
          previousState: row.previous_state,
          newState: row.new_state,
          observedAt: row.observed_at,
          detectedAt: row.detected_at,
          severity: row.severity,
          confidence: Number(row.confidence),
          operationalConfidence: row.operational_confidence == null ? null : Number(row.operational_confidence),
          evidence: parseJson(row.evidence) || [],
          sourceReferences: parseJson(row.source_references) || [],
          uncertainty: parseJson(row.uncertainty) || [],
          ruleVersion: row.rule_version,
          status: row.status
        };
      });
    } catch (_) {
      warnings.push('Spatial event persistence failed; context remains available.');
      context.events = events;
    }
  } else {
    context.events = events;
  }

  return context;
}

async function getSpatialProviderHealth() {
  const snapshot = spatialProviderManager.getHealthSnapshot();
  // Preserve the legacy traffic health grouping while exposing the canonical
  // manager registry as first-class provider keys. Existing consumers keep
  // working while new consumers can inspect every registered provider.
  return {
    ...snapshot,
    traffic: {
      mapbox: snapshot['mapbox-traffic'],
      tomtom: {
        incidents: snapshot['tomtom-traffic-incidents'],
        flow: snapshot['tomtom-traffic-flow'],
      },
    },
  };
}

module.exports = {
  buildWorldContext,
  classifyOperationalFreshness,
  bboxFromCenterRadius,
  bboxFromRoute,
  normaliseRoute,
  distanceM,
  getSpatialProviderHealth
};
