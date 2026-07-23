'use strict';

/**
 * Incident reconstruction — fuses the per-device evidence that already lands in
 * separate tables (SOS panics, covert captures, dispatch commands, two-way
 * voice, and the GPS trail) into one chronological dossier for a single Guardian
 * device over a time window. Nothing here is new telemetry; it's the join that
 * turns scattered rows into a replayable story of what happened.
 *
 * The GPS trail is condensed to its security-relevant moments — unscheduled
 * STOPS — rather than dumped point by point: a truck sitting still off-route is
 * the classic pre-theft signature, and one "stopped 14 min" entry says more in a
 * timeline than 400 near-identical coordinates.
 *
 * `query` (the raw pooled helper) is injected so this is unit-testable with a
 * fake, and so the mixed RLS/non-RLS source tables are read the same way the
 * rest of the app reads them (owner role + explicit filters). The caller MUST
 * have already verified the device belongs to the requesting org before calling
 * this — every query here scopes by device_id only.
 */

function haversineM(aLat, aLng, bLat, bLng) {
  const R = 6371000, toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Collapses an ordered GPS trail into stop events. A point counts as stationary
 * when its speed is under `moveKmh` (or, if speed is missing, when it's within
 * `moveM` of the previous point). A run of stationary points that lasts at least
 * `minStopMs` becomes one stop.
 * @param {Array<{lat:number,lng:number,speed_kmh:?number,ts:number}>} points ordered ascending by ts (ms)
 */
function detectStops(points, { minStopMs = 180000, moveKmh = 3, moveM = 60 } = {}) {
  const stops = [];
  let start = null, last = null;
  const stationary = (p, prev) => p.speed_kmh != null
    ? p.speed_kmh < moveKmh
    : (prev ? haversineM(prev.lat, prev.lng, p.lat, p.lng) < moveM : true);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (stationary(p, points[i - 1])) {
      if (!start) start = p;
      last = p;
    } else {
      if (start && last && last.ts - start.ts >= minStopMs) {
        stops.push({ ts: start.ts, lat: start.lat, lng: start.lng, durationMs: last.ts - start.ts });
      }
      start = null; last = null;
    }
  }
  if (start && last && last.ts - start.ts >= minStopMs) {
    stops.push({ ts: start.ts, lat: start.lat, lng: start.lng, durationMs: last.ts - start.ts });
  }
  return stops;
}

const iso = v => (v instanceof Date ? v : new Date(v)).toISOString();
const num = v => (v == null ? null : Number(v));

function fmtDuration(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

async function buildIncidentTimeline({ query, deviceId, from, to }) {
  const win = [deviceId, from, to];
  const [panics, captures, voices, commands, waypoints] = await Promise.all([
    query(`SELECT id, mode, lat, lng, message, created_at, resolved_at
             FROM panic_events
            WHERE device_id = $1 AND created_at BETWEEN $2 AND $3`, win),
    query(`SELECT id, url, lat, lng, camera, created_at, ai_summary, ai_threat_level, ai_has_weapon
             FROM guardian_captures
            WHERE device_id = $1 AND created_at BETWEEN $2 AND $3`, win),
    query(`SELECT id, direction, duration_ms, created_at
             FROM guardian_voice_messages
            WHERE device_id = $1 AND created_at BETWEEN $2 AND $3`, win),
    query(`SELECT id, command_type, status, issued_at
             FROM device_commands
            WHERE device_id = $1 AND issued_at BETWEEN $2 AND $3`, win),
    query(`SELECT lat, lng, speed, "timestamp"
             FROM device_locations
            WHERE device_id = $1 AND "timestamp" BETWEEN $2 AND $3
            ORDER BY "timestamp" ASC`, win),
  ]);

  const events = [];

  for (const p of panics.rows) {
    events.push({
      id: `panic:${p.id}`, ts: iso(p.created_at), type: 'panic', severity: 'critical',
      title: `SOS triggered${p.mode ? ` (${p.mode})` : ''}`,
      detail: p.message || (p.resolved_at ? 'Resolved' : 'Unresolved'),
      lat: num(p.lat), lng: num(p.lng),
    });
  }

  for (const c of captures.rows) {
    const severity = c.ai_has_weapon ? 'critical'
      : (c.ai_threat_level === 'high' ? 'high' : 'info');
    events.push({
      id: `capture:${c.id}`, ts: iso(c.created_at), type: 'capture', severity,
      title: `Covert photo${c.camera ? ` (${c.camera === 'front' ? 'front' : 'rear'})` : ''}`,
      detail: c.ai_summary || null, lat: num(c.lat), lng: num(c.lng), media_url: c.url,
    });
  }

  for (const v of voices.rows) {
    const up = v.direction === 'from_device';
    events.push({
      id: `voice:${v.id}`, ts: iso(v.created_at), type: 'voice', severity: 'info',
      title: up ? 'Voice note from officer' : 'Voice message to device',
      detail: v.duration_ms ? `${Math.round(v.duration_ms / 1000)}s` : null,
      lat: null, lng: null,
    });
  }

  for (const cmd of commands.rows) {
    events.push({
      id: `command:${cmd.id}`, ts: iso(cmd.issued_at), type: 'command', severity: 'info',
      title: `Dispatch command: ${cmd.command_type}`,
      detail: cmd.status || null, lat: null, lng: null,
    });
  }

  const stops = detectStops(waypoints.rows.map(w => ({
    lat: Number(w.lat), lng: Number(w.lng),
    speed_kmh: w.speed == null ? null : Number(w.speed),
    ts: new Date(w.timestamp).getTime(),
  })));
  for (const s of stops) {
    const long = s.durationMs >= 900000; // 15 min+
    events.push({
      id: `stop:${s.ts}`, ts: iso(s.ts), type: 'stop', severity: long ? 'warning' : 'info',
      title: `Unscheduled stop — ${fmtDuration(s.durationMs)}`,
      detail: long ? 'Prolonged stop' : null, lat: s.lat, lng: s.lng,
    });
  }

  // Chronological, with a stable tiebreak so equal timestamps seal deterministically.
  events.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : (a.id < b.id ? -1 : 1)));
  return events;
}

module.exports = { buildIncidentTimeline, detectStops, haversineM, fmtDuration };
