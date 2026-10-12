'use strict';

function inferGeofenceTask(command) {
  const raw = String(command || '').trim();
  if (/^\s*(?:how\s+(?:do\s+i|can\s+i|to)|tell\s+me\s+how|explain|teach\s+me|what\s+(?:is|are|does)\b)/i.test(raw)) return null;
  const riskZoneRequest = /\b(?:risk\s+zone|high[- ]?risk\s+(?:zone|area)|hazard\s+zone|danger\s+zone|banditry\s+zone|conflict\s+zone|strike\s+(?:area|zone)|roadblock\s+zone|security\s+hotspot)\b/i.test(raw);
  const explicitlyGeofence = /\b(?:geo[- ]?fence|fence|polygon|corridor\s+geofence|administrative\s+boundary)\b/i.test(raw);
  if (riskZoneRequest && !explicitlyGeofence) return null;
  if (!/\b(draw|sketch|outline|create|make|build|set up|define|establish|mark)\b[\s\S]{0,100}\b(geo[- ]?fence|corridor|geofence|polygon|boundary|zone|area)\b/i.test(raw)) return null;

  const quote = value => String(value || '').replace(/^["']|["']$/g, '').trim();
  const nameMatch = raw.match(/\b(?:named|called|name(?:d)?\s+as)\s+["']?([^"']+?)["']?(?:\s*$|\s+(?:around|from|between|at|near|within|in|for)\b)/i);
  const name = nameMatch ? quote(nameMatch[1]) : null;

  const measureToM = match => {
    if (!match) return undefined;
    const amount = Number(match[1]);
    return Number.isFinite(amount) ? amount * (/^(?:km|kilometer|kilometre)/i.test(match[2]) ? 1000 : 1) : undefined;
  };

  const buffer_m = measureToM(
    raw.match(/(?:with\s+(?:a\s+)?)?(\d+(?:\.\d+)?)\s*(km|kilometers?|kilometres?|m|meters?|metres?)\s*(?:buffer|corridor|deviation(?:\s+limit)?)/i)
    || raw.match(/(?:buffer|corridor|deviation(?:\s+limit)?)\s*(?:of|=|:)??\s*(\d+(?:\.\d+)?)\s*(km|kilometers?|kilometres?|m|meters?|metres?)\b/i)
  );
  const radius_m = measureToM(
    raw.match(/(?:with\s+(?:a\s+)?)?(\d+(?:\.\d+)?)\s*(km|kilometers?|kilometres?|m|meters?|metres?)\s*radius\b/i)
    || raw.match(/radius\s*(?:of|=|:)??\s*(\d+(?:\.\d+)?)\s*(km|kilometers?|kilometres?|m|meters?|metres?)\b/i)
    || raw.match(/\b(\d+(?:\.\d+)?)\s*(km|kilometers?|kilometres?|m|meters?|metres?)\s*(?:polygon|geofence|zone)\b/i)
  );

  const radiusMentioned = /\bradius\b/i.test(raw)
    || /\b\d+(?:\.\d+)?\s*(?:km|kilometers?|kilometres?|m|meters?|metres?)\s*(?:polygon|geofence|zone)\b/i.test(raw);
  if ((radiusMentioned && !Number.isFinite(radius_m))
    || (Number.isFinite(radius_m) && (radius_m < 10 || radius_m > 100000))) return null;

  const bufferMentioned = /\b(?:buffer|deviation(?:\s+limit)?)\b/i.test(raw);
  if ((bufferMentioned && !Number.isFinite(buffer_m))
    || (Number.isFinite(buffer_m) && (buffer_m < 10 || buffer_m > 5000))) return null;

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
      buffer_m: Number.isFinite(buffer_m) ? buffer_m : 300,
      precision: 'maximum',
    };
  }

  // Natural phrasing used in the field: "match Nairobi's official boundary"
  // or "match the official administrative boundary of Nairobi". Resolve the
  // place name explicitly; never treat the whole sentence as a geocoding query.
  const possessiveBoundary = raw.match(/\b(?:matching|match|follow|following|use|using)\s+(?:the\s+)?(.+?)(?:['’]s)\s+(?:(?:official|administrative|municipal|county|city|town|district)\s+)*boundary\b/i);
  const boundaryOfPlace = raw.match(/\b(?:matching|match|follow|following|use|using)\s+(?:the\s+)?(?:(?:official|administrative|municipal|county|city|town|district)\s+)+boundary\s+of\s+(.+?)(?:[.;!?]|$)/i);
  const namedBoundary = raw.match(/\b(?:matching|match|follow|following|use|using)\s+(.+?)\s+(?:official|administrative|municipal|county|city|town|district)\s+boundary\b/i);
  const matchedBoundaryLocation = quote(
    possessiveBoundary ? possessiveBoundary[1] : boundaryOfPlace ? boundaryOfPlace[1] : namedBoundary ? namedBoundary[1] : ''
  ).replace(/^the\s+/i, '').replace(/[.,;!?]+$/, '').trim();
  if (matchedBoundaryLocation) {
    return {
      task: 'create_geofence',
      name: name || 'Sonalit Administrative Boundary — ' + matchedBoundaryLocation,
      location: matchedBoundaryLocation,
      shape: 'boundary',
      precision: 'maximum',
    };
  }

  const coordinateMatch = raw.match(/(?:around|at|near|in|within)\s+(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/i);
  if (coordinateMatch) {
    const latitude = Number(coordinateMatch[1]);
    const longitude = Number(coordinateMatch[2]);
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
    const location = latitude + ',' + longitude;
    return {
      task: 'create_geofence',
      name: name || 'Sonalit Geofence — ' + location,
      radius_m: Number.isFinite(radius_m) ? radius_m : 3000,
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
    radius_m: Number.isFinite(radius_m) ? radius_m : 3000,
    shape,
    precision: 'maximum',
  };
}

module.exports = { inferGeofenceTask };
