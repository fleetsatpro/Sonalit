'use strict';

function inferGeofenceTask(command) {
  const raw = String(command || '').trim();
  if (!/\b(draw|sketch|outline|create|make|build|set up|define|establish|mark)\b[\s\S]{0,100}\b(geo[- ]?fence|corridor|geofence|polygon|boundary|zone|area)\b/i.test(raw)) return null;

  const quote = value => String(value || '').replace(/^["']|["']$/g, '').trim();
  const nameMatch = raw.match(/\b(?:named|called|name(?:d)?\s+as)\s+["']?([^"']+?)["']?(?:\s*$|\s+(?:around|from|between|at|near|within|in|for)\b)/i);
  const name = nameMatch ? quote(nameMatch[1]) : null;

  const measureToM = match => {
    if (!match) return undefined;
    const amount = Number(match[1]);
    return Number.isFinite(amount) ? amount * (/km/i.test(match[2]) ? 1000 : 1) : undefined;
  };

  const buffer_m = measureToM(
    raw.match(/(?:with\s+(?:a\s+)?)?(\d+(?:\.\d+)?)\s*(km|m|meters|metres)\s*(?:buffer|corridor|deviation(?:\s+limit)?)/i)
    || raw.match(/(?:buffer|corridor|deviation(?:\s+limit)?)\s*(?:of|=|:)??\s*(\d+(?:\.\d+)?)\s*(km|m|meters|metres)\b/i)
  );
  const radius_m = measureToM(
    raw.match(/(?:with\s+(?:a\s+)?)?(\d+(?:\.\d+)?)\s*(km|m|meters|metres)\s*radius\b/i)
    || raw.match(/radius\s*(?:of|=|:)??\s*(\d+(?:\.\d+)?)\s*(km|m|meters|metres)\b/i)
    || raw.match(/\b(\d+(?:\.\d+)?)\s*(km|m|meters|metres)\s*(?:polygon|geofence|zone)\b/i)
  );

  const asksOfficialBoundary = /\b(?:official|administrative|municipal|county|city|town|district)\s+boundary\b|\b(?:city|county|municipal)\s+limits\b/i.test(raw);
  const shape = asksOfficialBoundary ? 'boundary'
    : /\b(polygon|polygonal|boundary|area|custom\s+shape)\b/i.test(raw) ? 'polygon'
      : 'circle';

  const route = raw.match(/\b(?:from|between)\s+(.+?)\s+(?:to|and)\s+(.+?)(?:\s+(?:with|using)\s+(?:a\s+)?\d+(?:\.\d+)?\s*(?:km|m|meters|metres)\s*(?:buffer|corridor|deviation)|\s+named\b|[.;]|$)/i)
    || raw.match(/\balong\s+(.+?)\s+to\s+(.+?)(?:\s+with\b|\s+named\b|[.;]|$)/i);

  if (route) {
    const start = quote(route[1]);
    const end = quote(route[2]);
    if (!start || !end) return null;
    return {
      task: 'create_geofence',
      name: name || 'Sonalit Corridor — ' + start + ' → ' + end,
      location: start,
      route_end: end,
      buffer_m: Number.isFinite(buffer_m) ? Math.max(10, Math.min(buffer_m, 5000)) : 300,
      precision: 'maximum',
    };
  }

  const coordinateMatch = raw.match(/(?:around|at|near|in|within)\s+(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/i);
  if (coordinateMatch) {
    const location = coordinateMatch[1] + ',' + coordinateMatch[2];
    return {
      task: 'create_geofence',
      name: name || 'Sonalit Geofence — ' + location,
      radius_m: Number.isFinite(radius_m) ? Math.max(10, Math.min(radius_m, 100000)) : 3000,
      location,
      shape,
      precision: 'maximum',
    };
  }

  const point = raw.match(/\b(?:around|near|at|in|for|within)\s+(.+?)(?=\s+(?:as|with|using)\b|\s+radius\b|\s+buffer\b|[.;]|$)/i);
  if (!point) return null;
  const location = quote(point[1]).replace(/[.,;!?]+$/, '');
  if (!location) return null;

  return {
    task: 'create_geofence',
    name: name || 'Sonalit Geofence — ' + location,
    location,
    radius_m: Number.isFinite(radius_m) ? Math.max(10, Math.min(radius_m, 100000)) : 3000,
    shape,
    precision: 'maximum',
  };
}

module.exports = { inferGeofenceTask };
