'use strict';

/**
 * First-class, tenant-safe resolution of spatial subjects.
 *
 * This is deliberately limited to identity/ownership/anchor resolution.
 * Spatial enrichment (route geometry, providers, relations, events) remains
 * in worldContextService so there is one canonical enrichment pipeline.
 */

function failNotFound(kind, id) {
  const error = new Error(String(kind).charAt(0).toUpperCase() + String(kind).slice(1) + ' not found in organisation context');
  error.statusCode = 404;
  error.subjectKind = kind;
  error.subjectId = id;
  return error;
}

function asPoint(lat, lng) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

async function rows(db, sql, params) {
  const result = await db(sql, params || []);
  return result.rows || [];
}

async function resolveConvoy(db, orgId, id) {
  const result = await rows(
    db,
    'SELECT id::text AS id,name,status,priority,region,route_origin,route_destination,departure_time,estimated_arrival FROM convoys WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL LIMIT 1',
    [id, orgId],
  );
  return result[0] || null;
}

async function resolveVehicle(db, orgId, id) {
  const result = await rows(
    db,
    'SELECT id::text AS id,registration,latitude,longitude,assigned_convoy_id::text AS assigned_convoy_id FROM vehicles WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL LIMIT 1',
    [id, orgId],
  );
  return result[0] || null;
}

async function resolveCorridorById(db, orgId, id) {
  const result = await rows(
    db,
    'SELECT crc.id::text AS id,crc.convoy_id::text AS convoy_id,crc.route_line,crc.width_km,crc.active FROM convoy_route_corridors crc JOIN convoys c ON c.id=crc.convoy_id WHERE crc.id=$1 AND c.org_id=$2 AND c.deleted_at IS NULL LIMIT 1',
    [id, orgId],
  );
  return result[0] || null;
}

async function resolveCheckpoint(db, orgId, id) {
  const result = await rows(
    db,
    'SELECT cp.id::text AS id,cp.convoy_id::text AS convoy_id,cp.name,cp.location_name,cp.lat,cp.lng,cp.sequence_order,cp.status,cp.expected_at,cp.reached_at FROM checkpoints cp JOIN convoys c ON c.id=cp.convoy_id WHERE cp.id=$1 AND c.org_id=$2 AND c.deleted_at IS NULL LIMIT 1',
    [id, orgId],
  );
  return result[0] || null;
}

async function resolveIncident(db, orgId, id) {
  const result = await rows(
    db,
    'SELECT i.id::text AS id,i.convoy_id::text AS convoy_id,i.title,i.description,i.severity,i.status,i.lat,i.lng,i.created_at,i.updated_at FROM incidents i WHERE i.id=$1 AND i.org_id=$2 AND i.deleted_at IS NULL LIMIT 1',
    [id, orgId],
  );
  return result[0] || null;
}

async function resolvePort(db, orgId, id) {
  const result = await rows(
    db,
    "SELECT id::text AS id,name,type,category,center_lat,center_lng,radius_m,active,updated_at FROM cds_geofences WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL AND active=true LIMIT 1",
    [id, orgId],
  );
  return result[0] || null;
}

async function resolveRouteLike(db, orgId, id) {
  const corridor = await resolveCorridorById(db, orgId, id);
  if (corridor) return corridor;

  const convoy = await resolveConvoy(db, orgId, id);
  if (!convoy) return null;

  const route = await rows(
    db,
    'SELECT id::text AS id,convoy_id::text AS convoy_id,route_line,width_km,active FROM convoy_route_corridors WHERE convoy_id=$1 AND org_id=$2 ORDER BY active DESC,id DESC LIMIT 1',
    [id, orgId],
  );
  return {
    id: route[0]?.id || String(id),
    convoy_id: String(id),
    route_line: route[0]?.route_line || null,
    width_km: route[0]?.width_km || null,
    active: Boolean(route[0]?.active),
    convoy,
  };
}

async function resolveSpatialSubject({ db, orgId, subject }) {
  if (!db || !orgId) {
    const error = new Error('Organisation context and database are required');
    error.statusCode = 403;
    throw error;
  }

  const input = subject || { kind: 'none', id: 'context' };
  const kind = String(input.kind || 'none');
  const id = input.id == null ? 'context' : String(input.id);
  const resolved = {
    requested: { kind, id, label: input.label || undefined },
    missionRow: null,
    vehicleRows: [],
    center: null,
    routeHint: null,
    source: null,
  };

  if (kind === 'none') {
    return resolved;
  }

  if (kind === 'location') {
    return resolved;
  }

  if (kind === 'convoy') {
    const convoy = await resolveConvoy(db, orgId, id);
    if (!convoy) throw failNotFound('convoy', id);
    resolved.missionRow = convoy;
    resolved.source = 'sonalit:convoy:' + id;
    return resolved;
  }

  if (kind === 'vehicle') {
    const vehicle = await resolveVehicle(db, orgId, id);
    if (!vehicle) throw failNotFound('vehicle', id);
    resolved.vehicleRows = [vehicle];
    resolved.center = asPoint(vehicle.latitude, vehicle.longitude);
    resolved.source = 'sonalit:vehicle:' + id;

    if (vehicle.assigned_convoy_id) {
      const convoy = await resolveConvoy(db, orgId, vehicle.assigned_convoy_id);
      if (convoy) resolved.missionRow = convoy;
    }
    return resolved;
  }

  if (kind === 'route') {
    const route = await resolveRouteLike(db, orgId, id);
    if (!route) throw failNotFound('route', id);
    resolved.missionRow = route.convoy || await resolveConvoy(db, orgId, route.convoy_id);
    resolved.routeHint = route;
    resolved.source = 'sonalit:route:' + route.id;
    return resolved;
  }

  if (kind === 'corridor') {
    const corridor = await resolveCorridorById(db, orgId, id);
    if (!corridor) {
      const fallback = await resolveRouteLike(db, orgId, id);
      if (!fallback) throw failNotFound('corridor', id);
      resolved.missionRow = fallback.convoy || await resolveConvoy(db, orgId, fallback.convoy_id);
      resolved.routeHint = fallback;
    } else {
      resolved.missionRow = await resolveConvoy(db, orgId, corridor.convoy_id);
      resolved.routeHint = corridor;
    }
    resolved.source = 'sonalit:corridor:' + id;
    return resolved;
  }

  if (kind === 'incident') {
    const incident = await resolveIncident(db, orgId, id);
    if (!incident) throw failNotFound('incident', id);
    resolved.center = asPoint(incident.lat, incident.lng);
    resolved.source = 'sonalit:incident:' + id;
    if (incident.convoy_id) resolved.missionRow = await resolveConvoy(db, orgId, incident.convoy_id);
    return resolved;
  }

  if (kind === 'checkpoint') {
    const checkpoint = await resolveCheckpoint(db, orgId, id);
    if (!checkpoint) throw failNotFound('checkpoint', id);
    resolved.center = asPoint(checkpoint.lat, checkpoint.lng);
    resolved.source = 'sonalit:checkpoint:' + id;
    if (checkpoint.convoy_id) resolved.missionRow = await resolveConvoy(db, orgId, checkpoint.convoy_id);
    return resolved;
  }

  if (kind === 'port') {
    const port = await resolvePort(db, orgId, id);
    if (!port) throw failNotFound('port', id);
    resolved.center = asPoint(port.center_lat, port.center_lng);
    resolved.source = 'sonalit:port:' + id;
    return resolved;
  }

  const error = new Error('Unsupported spatial subject kind');
  error.statusCode = 400;
  throw error;
}

module.exports = {
  resolveSpatialSubject,
  resolveConvoy,
  resolveVehicle,
  resolveCorridorById,
  resolveCheckpoint,
  resolveIncident,
  resolvePort,
  resolveRouteLike,
};
