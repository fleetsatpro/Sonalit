'use strict';

/**
 * Route risk scoring — "which of these roads should the convoy actually take?"
 *
 * A routing engine optimises for time. A convoy operator optimises for getting
 * there intact: twenty minutes saved is worthless if the shortcut runs through
 * a banditry hotspot. This scores each candidate route against the org's known
 * risk zones so the system can pick the safest viable road rather than just the
 * fastest one.
 *
 * The score is exposure-weighted, not a simple hit count: clipping the edge of
 * a hotspot for 200 m is not the same as driving 40 km down its middle. A
 * `no_go` zone is categorical rather than weighted — a route through one is
 * disqualified outright, whatever it saves.
 *
 * Pure and planar-approximated (equirectangular, same as the corridor
 * evaluator), so it is deterministic and unit-testable with no DB or network.
 */

const R_KM = 6371;
const RAD = Math.PI / 180;

// Penalty per kilometre travelled inside a zone of each severity. The gaps are
// deliberately wide: no amount of time saved should let a 'critical' route
// out-score a clean one.
const SEVERITY_WEIGHT = {
  no_go: 1000,
  critical: 60,
  high: 20,
  medium: 6,
  low: 1.5,
};

// Entering a zone at all costs this much on top of the per-km exposure, so a
// route that merely clips three hotspots still ranks below one that clips none.
const ENTRY_PENALTY = { no_go: 1000, critical: 25, high: 8, medium: 2.5, low: 0.5 };

// Time is still worth something — one point per hour of driving, so among
// equally safe routes the quicker one wins.
const HOURS_WEIGHT = 1;

function toXY(lat, lng, lat0, lng0) {
  return { x: (lng - lng0) * Math.cos(lat0 * RAD) * RAD * R_KM, y: (lat - lat0) * RAD * R_KM };
}

/** Strict numeric coercion: null/''/undefined are absent, not zero. */
function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function weightOf(table, level) {
  const w = table[String(level || 'medium').toLowerCase()];
  return w == null ? table.medium : w;
}

/**
 * Kilometres of `route` that fall inside a circular zone, plus the closest the
 * route ever gets to the zone centre.
 *
 * Walks each segment and samples it: a segment can enter and leave a zone
 * between its endpoints, so endpoint-only tests miss short crossings entirely.
 * Sampling at ~250 m is far finer than any zone radius we store and keeps the
 * whole scoring pass well inside a millisecond for a 300-point route.
 */
function exposureKm(route, zone) {
  if (!route || route.length < 2) return { insideKm: 0, nearestKm: Infinity };
  const lat0 = route[0].lat, lng0 = route[0].lng;
  const zLat = num(zone.lat), zLng = num(zone.lng);
  if (zLat == null || zLng == null) return { insideKm: 0, nearestKm: Infinity };
  const Z = toXY(zLat, zLng, lat0, lng0);
  const radius = Math.max(0, num(zone.radius_km) ?? 0);

  let insideKm = 0;
  let nearestKm = Infinity;

  for (let i = 0; i < route.length - 1; i++) {
    const A = toXY(route[i].lat, route[i].lng, lat0, lng0);
    const B = toXY(route[i + 1].lat, route[i + 1].lng, lat0, lng0);
    const segLen = Math.hypot(B.x - A.x, B.y - A.y);
    if (segLen === 0) continue;

    const steps = Math.max(1, Math.ceil(segLen / 0.25));
    const stepKm = segLen / steps;
    for (let s = 0; s < steps; s++) {
      // Sample the midpoint of each step, so a step counts as inside only when
      // most of it is.
      const t = (s + 0.5) / steps;
      const d = Math.hypot(A.x + (B.x - A.x) * t - Z.x, A.y + (B.y - A.y) * t - Z.y);
      if (d < nearestKm) nearestKm = d;
      if (d <= radius) insideKm += stepKm;
    }
  }
  return { insideKm, nearestKm };
}

/**
 * Score one candidate route.
 * @param {Array<{lat:number,lng:number}>} route
 * @param {Array<object>} zones risk_zones rows (lat, lng, radius_km, risk_level, …)
 * @param {{durationMin?:number}} [opts]
 * @returns {{score:number, blocked:boolean, exposures:Array, worst:string|null, exposed_km:number}}
 *   Lower score is better. `blocked` marks a route through a no-go zone.
 */
function scoreRoute(route, zones, opts = {}) {
  const exposures = [];
  let score = 0;
  let blocked = false;

  for (const zone of zones || []) {
    if (zone == null) continue;
    // Number(null) is 0 — a finite, perfectly plausible coordinate — so a zone
    // with a missing lat would otherwise land on the equator and poison the
    // score of any route passing near it. Reject blanks before converting.
    const lat = num(zone.lat), lng = num(zone.lng);
    if (lat == null || lng == null) continue;

    const { insideKm, nearestKm } = exposureKm(route, zone);
    if (insideKm <= 0) continue;

    const level = String(zone.risk_level || 'medium').toLowerCase();
    const penalty = insideKm * weightOf(SEVERITY_WEIGHT, level) + weightOf(ENTRY_PENALTY, level);
    score += penalty;
    if (level === 'no_go') blocked = true;

    exposures.push({
      zone_id: zone.id ?? null,
      name: zone.name ?? null,
      risk_level: level,
      zone_type: zone.zone_type ?? null,
      km_inside: Math.round(insideKm * 100) / 100,
      nearest_km: Number.isFinite(nearestKm) ? Math.round(nearestKm * 100) / 100 : null,
    });
  }

  exposures.sort((a, b) =>
    weightOf(SEVERITY_WEIGHT, b.risk_level) - weightOf(SEVERITY_WEIGHT, a.risk_level) ||
    b.km_inside - a.km_inside);

  const hours = Math.max(0, Number(opts.durationMin) || 0) / 60;
  score += hours * HOURS_WEIGHT;

  return {
    score: Math.round(score * 100) / 100,
    blocked,
    exposures,
    worst: exposures.length ? exposures[0].risk_level : null,
    exposed_km: Math.round(exposures.reduce((a, e) => a + e.km_inside, 0) * 100) / 100,
  };
}

/**
 * Rank candidate routes safest-first and say which one to use.
 *
 * A no-go route is never chosen while any alternative exists; if every option
 * is blocked the least-bad one is still returned, flagged, rather than leaving
 * the convoy with no corridor at all — the operator needs to see the problem,
 * not an empty screen.
 *
 * @param {Array<{route:Array, distance_km?:number, duration_min?:number, provider?:string}>} candidates
 * @param {Array<object>} zones
 */
function rankRoutes(candidates, zones) {
  const scored = (candidates || []).map((c, i) => ({
    ...c,
    index: i,
    ...scoreRoute(c.route, zones, { durationMin: c.duration_min }),
  }));

  const order = [...scored].sort((a, b) =>
    Number(a.blocked) - Number(b.blocked) || a.score - b.score);

  const best = order[0] ?? null;
  return {
    ranked: order,
    best,
    all_blocked: scored.length > 0 && scored.every(c => c.blocked),
  };
}

module.exports = { scoreRoute, rankRoutes, exposureKm, SEVERITY_WEIGHT };
