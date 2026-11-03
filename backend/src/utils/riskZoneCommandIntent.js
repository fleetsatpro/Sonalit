'use strict';

const RISK_ZONE_PATTERN = /\b(risk\s+zone|high[- ]?risk\s+(?:zone|area|corridor)|hazard\s+(?:zone|area)|danger\s+(?:zone|area)|unsafe\s+area|risk\s+area|banditry\s+zone|conflict\s+zone|strike\s+(?:area|zone)|roadblock\s+zone|security\s+hotspot)\b/i;
const ACTION_PATTERN = /\b(create|mark|flag|designate|establish|add|register|set\s+up|define|place|make)\b/i;
const INSTRUCTIONAL_PATTERN = /^\s*(?:how\s+(?:do\s+i|can\s+i|to)|tell\s+me\s+how|explain|teach\s+me|what\s+(?:is|are|does)\b|should\s+(?:we|i)\b)/i;

function parseDistanceKm(raw) {
  const match = String(raw || '').match(/\bradius\s*(?:of|=|:)?\s*(\d+(?:\.\d+)?)\s*(km|kilomet(?:er|re)s?|m|meters?|metres?)\b/i)
    || String(raw || '').match(/\bwithin\s+(\d+(?:\.\d+)?)\s*(km|kilomet(?:er|re)s?|m|meters?|metres?)\b/i);
  if (!match) return 5;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return NaN;
  return /^m|meter|metre/i.test(match[2]) ? amount / 1000 : amount;
}

function parseCoordinateLocation(raw) {
  const match = String(raw || '').match(/(?:around|near|at|in|within|for)\s+(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/i);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return String(latitude) + ',' + String(longitude);
}

function inferRiskZoneTask(command) {
  const raw = String(command || '').trim();
  if (!raw || INSTRUCTIONAL_PATTERN.test(raw)) return null;
  if (!ACTION_PATTERN.test(raw) || !RISK_ZONE_PATTERN.test(raw)) return null;

  // Avoid interpreting a geofence request that happens to mention a risk zone.
  if (/\bgeo[- ]?fence\b|\bpolygon\b|\bcorridor\s+geofence\b/i.test(raw)) return null;

  const radius_km = parseDistanceKm(raw);
  if (!Number.isFinite(radius_km) || radius_km < 0.1 || radius_km > 100) return null;

  const coordinateCandidate = raw.match(/(?:around|near|at|in|within|for)\s+(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/i);
  const coordinateLocation = parseCoordinateLocation(raw);
  if (coordinateCandidate && !coordinateLocation) return null;
  const locationMatch = raw.match(/\b(?:around|near|at|in|within|for)\s+(.+?)(?=\s+(?:with|using|radius|named|called|as|because|due\s+to|description|notes?)\b|[.;!?]|$)/i);
  const location = coordinateLocation || (locationMatch ? locationMatch[1].replace(/^["']|["']$/g, '').trim().replace(/[.,;!?]+$/, '') : '');
  if (!location || location.length > 400) return null;

  const nameMatch = raw.match(/\b(?:named|called)\s+["']?([^"']+?)["']?(?=\s+(?:around|near|at|in|within|for)\b|[.;!?]|$)/i);
  const inferredName = nameMatch ? nameMatch[1].trim() : '';
  const risk_level = /\bcritical\b/i.test(raw) ? 'critical'
    : /\bhigh(?:[- ]risk)?\b/i.test(raw) ? 'high'
      : /\bmedium\b/i.test(raw) ? 'medium'
        : /\blow\b/i.test(raw) ? 'low' : 'high';
  const zone_type = /\bflood(?:ing)?\b/i.test(raw) ? 'flood'
    : /\bconstruction|roadworks?\b/i.test(raw) ? 'construction'
      : /\bbanditry|bandits?\b/i.test(raw) ? 'banditry'
        : /\bconflict|armed\s+(?:attack|clash)\b/i.test(raw) ? 'conflict'
          : /\bstrike|industrial\s+action\b/i.test(raw) ? 'strike'
            : /\bpolice\s+checkpoint\b/i.test(raw) ? 'police_checkpoint'
            : /\bcheckpoint|security\s+hotspot|armed\s+robbery\b/i.test(raw) ? 'security'
                : /\bsecurity|danger|unsafe|threat\b/i.test(raw) ? 'security' : 'general';

  const prefix = risk_level.charAt(0).toUpperCase() + risk_level.slice(1);
  return {
    task: 'create_risk_zone',
    name: inferredName || (prefix + ' Risk Zone — ' + location),
    location,
    risk_level,
    zone_type,
    description: '',
    radius_km,
  };
}

module.exports = { inferRiskZoneTask };
