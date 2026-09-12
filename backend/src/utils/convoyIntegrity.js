// Convoy integrity assessment — the analytical layer that turns a pile of
// photos, seals, and GPS pings into a security verdict a client reads first.
//
// Pure and deterministic: no I/O, no clock (a `now` can be injected for tests).
// Both the PDF generator and the web detail endpoint call this so the on-screen
// report and the client PDF always show the same verdict, score, and findings.
//
// Output:
//   verdict   'cleared' | 'review' | 'exceptions'
//   score     0–100 integrity score
//   coverage  { received, required, pct }
//   findings  ranked [{ severity: 'critical'|'warning'|'info', code, title, detail }]
//   route     { hasTrack, distanceKm, durationMin, avgSpeedKmh, maxSpeedKmh,
//               stops, maxStopMin, overspeedCount, deviationKm|null, gpsPoints }
//   seals     { total, anomalies }
//   gpsMismatches
//   evidenceDigest  short SHA-256 fingerprint of the underlying evidence (tamper-evidence)

const crypto = require('crypto');

// Thresholds — deliberately conservative so a "cleared" verdict means it.
const OVERSPEED_KMH = 90;      // logged speed above this is flagged
const STOP_RADIUS_KM = 0.15;   // consecutive pings within this = stationary
const STOP_MIN = 20;           // dwell longer than this = a stop
const LONG_STOP_MIN = 60;      // a stop longer than this is worth a finding
const DEVIATION_KM = 8;        // GPS this far from the planned corridor is a deviation

const SEV_RANK = { critical: 0, warning: 1, info: 2 };

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : null; }

// ── Route analytics from the day's GPS track ────────────────────────────────
function analyzeRoute(waypoints, namedWaypoints) {
  const wps = (waypoints || [])
    .map(w => ({ lat: num(w.lat), lng: num(w.lng), spd: num(w.speed_kmh), at: w.recorded_at ? new Date(w.recorded_at).getTime() : null }))
    .filter(w => w.lat != null && w.lng != null);

  if (wps.length < 2) {
    return { hasTrack: false, distanceKm: 0, durationMin: 0, avgSpeedKmh: null, maxSpeedKmh: null,
      stops: 0, maxStopMin: 0, overspeedCount: 0, deviationKm: null, gpsPoints: wps.length };
  }

  let distanceKm = 0, stops = 0, maxStopMin = 0;
  for (let i = 1; i < wps.length; i++) {
    const step = haversineKm(wps[i - 1].lat, wps[i - 1].lng, wps[i].lat, wps[i].lng);
    distanceKm += step;
    // A stop = little movement across a meaningful time gap.
    if (wps[i].at != null && wps[i - 1].at != null) {
      const gapMin = (wps[i].at - wps[i - 1].at) / 60000;
      if (step <= STOP_RADIUS_KM && gapMin >= STOP_MIN) { stops++; if (gapMin > maxStopMin) maxStopMin = gapMin; }
    }
  }

  const speeds = wps.map(w => w.spd).filter(v => v != null);
  const maxSpeedKmh = speeds.length ? Math.max(...speeds) : null;
  const avgSpeedKmh = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : null;
  const overspeedCount = speeds.filter(s => s > OVERSPEED_KMH).length;

  const times = wps.map(w => w.at).filter(v => v != null);
  const durationMin = times.length >= 2 ? Math.max(0, (Math.max(...times) - Math.min(...times)) / 60000) : 0;

  // Deviation: farthest any GPS point strayed from the nearest planned stop.
  const planned = (namedWaypoints || []).map(w => ({ lat: num(w.lat), lng: num(w.lng) })).filter(w => w.lat != null && w.lng != null);
  let deviationKm = null;
  if (planned.length) {
    deviationKm = 0;
    for (const w of wps) {
      let nearest = Infinity;
      for (const p of planned) nearest = Math.min(nearest, haversineKm(w.lat, w.lng, p.lat, p.lng));
      if (nearest > deviationKm) deviationKm = nearest;
    }
  }

  return {
    hasTrack: true,
    distanceKm: Math.round(distanceKm * 10) / 10,
    durationMin: Math.round(durationMin),
    avgSpeedKmh: avgSpeedKmh != null ? Math.round(avgSpeedKmh) : null,
    maxSpeedKmh: maxSpeedKmh != null ? Math.round(maxSpeedKmh) : null,
    stops, maxStopMin: Math.round(maxStopMin), overspeedCount,
    deviationKm: deviationKm != null ? Math.round(deviationKm * 10) / 10 : null,
    gpsPoints: wps.length,
  };
}

// ── Photo-coverage gaps, per truck + session ────────────────────────────────
function coverageFindings(trucks, photos, sealCountPerTruck) {
  const findings = [];
  const byTruck = new Map();
  for (const p of photos || []) {
    if (!byTruck.has(p.convoy_truck_id)) byTruck.set(p.convoy_truck_id, []);
    byTruck.get(p.convoy_truck_id).push(p);
  }
  for (const truck of trucks || []) {
    const tp = byTruck.get(truck.id) || [];
    const plate = truck.plate_number || truck.registration || `T${truck.position ?? '?'}`;
    const gaps = [];
    let anyPhoto = false;
    for (const session of ['sod', 'eod']) {
      const sp = tp.filter(p => p.session === session);
      if (sp.length) anyPhoto = true;
      const miss = [];
      if (!sp.some(p => p.photo_type === 'front')) miss.push('front');
      if (!sp.some(p => p.photo_type === 'rear')) miss.push('rear');
      const seals = new Set(sp.filter(p => p.photo_type === 'seal').map(p => String(p.seal_position)));
      const sealGap = Math.max(0, (sealCountPerTruck || 0) - seals.size);
      if (sealGap > 0) miss.push(`${sealGap} seal${sealGap === 1 ? '' : 's'}`);
      if (miss.length) gaps.push(`${session.toUpperCase()}: ${miss.join(', ')}`);
    }
    if (!anyPhoto) {
      findings.push({ severity: 'critical', code: 'truck_no_photos',
        title: `No evidence for ${plate}`, detail: 'This assigned vehicle has no photos for either session.' });
    } else if (gaps.length) {
      findings.push({ severity: 'warning', code: 'coverage_gap',
        title: `Incomplete coverage — ${plate}`, detail: gaps.join('  ·  ') });
    }
  }
  return findings;
}

// ── Evidence fingerprint (tamper-evidence) ──────────────────────────────────
// Canonical digest over the underlying evidence, independent of PDF bytes, so a
// stored/printed fingerprint can be recomputed to prove the evidence set is
// unchanged.
function evidenceDigest({ convoy, report, photos, seals, waypoints }) {
  const canon = JSON.stringify({
    convoy: convoy?.id ?? null,
    date: report?.report_date ?? null,
    counts: { r: report?.required_photo_count ?? null, g: report?.received_photo_count ?? null },
    photos: (photos || []).map(p => `${p.id ?? p.photo_url ?? ''}|${p.session ?? ''}|${p.photo_type ?? ''}|${p.taken_at ?? ''}`).sort(),
    seals: (seals || []).map(s => `${s.rfid_code ?? ''}|${s.seal_position ?? ''}|${s.status ?? ''}`).sort(),
    track: (waypoints || []).length ? `${waypoints.length}|${waypoints[0]?.recorded_at ?? ''}|${waypoints[waypoints.length - 1]?.recorded_at ?? ''}` : '',
  });
  return crypto.createHash('sha256').update(canon).digest('hex');
}

function assessConvoy(input) {
  const {
    convoy = {}, trucks = [], photos = [], seals = [], waypoints = [], namedWaypoints = [],
    report = {}, sealCountPerTruck = convoy.seal_count_per_truck ?? 0,
  } = input || {};

  const findings = [];

  // Coverage
  const required = num(report.required_photo_count) ?? 0;
  const received = Math.min(num(report.received_photo_count) ?? 0, required || Infinity);
  const pct = required > 0 ? Math.min(100, Math.round((received / required) * 100)) : (photos.length ? 100 : 0);
  findings.push(...coverageFindings(trucks, photos, sealCountPerTruck));
  if (required > 0 && received < required) {
    findings.push({ severity: 'info', code: 'coverage_incomplete',
      title: `Photo coverage at ${pct}%`, detail: `${received} of ${required} required photos received.` });
  }

  // Seal anomalies
  const sealAnoms = (seals || []).filter(s => s.status && !['intact', 'present', 'ok'].includes(String(s.status).toLowerCase()));
  for (const s of sealAnoms) {
    const st = String(s.status).toLowerCase();
    const sev = (st === 'broken' || st === 'missing' || st === 'tampered') ? 'critical' : 'warning';
    findings.push({ severity: sev, code: 'seal_anomaly',
      title: `Seal ${st} — ${s.rfid_code || `pos ${s.seal_position}`}`,
      detail: s.notes || `Seal at position ${s.seal_position ?? '—'} reported ${st}.` });
  }

  // GPS location mismatches (photo captured away from expected position)
  const gpsMismatches = (photos || []).filter(p => p.location_mismatch).length;
  if (gpsMismatches > 0) {
    findings.push({ severity: 'warning', code: 'gps_mismatch',
      title: `${gpsMismatches} GPS location mismatch${gpsMismatches === 1 ? '' : 'es'}`,
      detail: 'One or more photos were captured away from the expected vehicle position.' });
  }

  // Route analytics + route findings
  const route = analyzeRoute(waypoints, namedWaypoints);
  if (route.overspeedCount > 0) {
    findings.push({ severity: 'warning', code: 'overspeed',
      title: `Overspeed — ${route.overspeedCount} event${route.overspeedCount === 1 ? '' : 's'}`,
      detail: `Logged speed exceeded ${OVERSPEED_KMH} km/h${route.maxSpeedKmh != null ? `, peaking at ${route.maxSpeedKmh} km/h` : ''}.` });
  }
  if (route.deviationKm != null && route.deviationKm > DEVIATION_KM) {
    findings.push({ severity: 'warning', code: 'route_deviation',
      title: `Route deviation — ${route.deviationKm} km`,
      detail: `The track strayed up to ${route.deviationKm} km from the planned corridor.` });
  }
  if (route.maxStopMin > LONG_STOP_MIN) {
    findings.push({ severity: 'info', code: 'long_stop',
      title: `Extended stop — ${route.maxStopMin} min`,
      detail: `${route.stops} stop${route.stops === 1 ? '' : 's'} logged; longest ${route.maxStopMin} min.` });
  }
  if (!route.hasTrack && String(convoy.status).toLowerCase() === 'active') {
    findings.push({ severity: 'info', code: 'no_track',
      title: 'No GPS track logged', detail: 'No live position data was recorded for this date.' });
  }

  // Rank findings (critical → warning → info; stable within a tier)
  findings.sort((a, b) => (SEV_RANK[a.severity] ?? 3) - (SEV_RANK[b.severity] ?? 3));

  const crit = findings.filter(f => f.severity === 'critical').length;
  const warn = findings.filter(f => f.severity === 'warning').length;
  const info = findings.filter(f => f.severity === 'info').length;

  const verdict = crit > 0 ? 'exceptions' : (warn > 0 || pct < 100) ? 'review' : 'cleared';
  const penalty = crit * 22 + warn * 7 + info * 2 + (100 - pct) * 0.3;
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));

  return {
    verdict, score,
    coverage: { received, required, pct },
    findings,
    counts: { critical: crit, warning: warn, info },
    route,
    seals: { total: (seals || []).length, anomalies: sealAnoms.length },
    gpsMismatches,
    evidenceDigest: evidenceDigest({ convoy, report: { ...report, report_date: report.report_date ?? input?.reportDate }, photos, seals, waypoints }),
  };
}

module.exports = { assessConvoy, analyzeRoute, haversineKm,
  OVERSPEED_KMH, STOP_MIN, LONG_STOP_MIN, DEVIATION_KM };
