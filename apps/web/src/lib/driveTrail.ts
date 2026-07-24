// Client-side trail processing for the 3D drive replay.
//
// The backend already snaps/de-sprays the trail, but this is the last line of
// defence before the renderer AND the source of the replay's richer visuals:
// a hard spike clamp, per-point speed, a speed colour ramp for the route,
// stop detection, headings for the chase cam, and trip stats for the HUD.
// Pure and unit-tested — no Cesium here.

export interface TP { lat: number; lng: number; speed: number | null; heading: number | null; ts: string }

const R = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Initial bearing a→b, degrees clockwise from north (0–360).
export function bearingDeg(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const p1 = toRad(aLat), p2 = toRad(bLat), dl = toRad(bLng - aLng);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const ms = (ts: string) => new Date(ts).getTime();

/** Ground speed km/h per point: reported when sane, else derived from the previous fix. */
export function speedsKmh(points: TP[]): number[] {
  return points.map((p, i) => {
    if (p.speed != null && p.speed >= 0) return p.speed;
    if (i === 0) return 0;
    const prev = points[i - 1]!;
    const dt = (ms(p.ts) - ms(prev.ts)) / 1000;
    if (dt <= 0) return 0;
    return (haversineM(prev.lat, prev.lng, p.lat, p.lng) / dt) * 3.6;
  });
}

/**
 * Final spike guard: drop any fix that would require an impossible ground speed
 * from the last kept point. Belt-and-suspenders over the backend, so a lone
 * teleport can never reach the renderer and draw a phantom spike. Keeps the
 * first point; a trailing spike is dropped rather than kept.
 */
export function clampSpikes(points: TP[], maxKmh = 200): TP[] {
  if (points.length <= 2) return points.slice();
  const out: TP[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1]!, cur = points[i]!;
    const dt = (ms(cur.ts) - ms(prev.ts)) / 1000;
    const kmh = dt > 0 ? (haversineM(prev.lat, prev.lng, cur.lat, cur.lng) / dt) * 3.6 : Infinity;
    if (kmh <= maxKmh) out.push(cur);
  }
  return out;
}

/** Cumulative distance (metres) at each point. */
export function cumulativeMeters(points: TP[]): number[] {
  const out = new Array(points.length).fill(0);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    out[i] = out[i - 1] + haversineM(a.lat, a.lng, b.lat, b.lng);
  }
  return out;
}

export interface TrailStats { distanceKm: number; avgMovingKmh: number; maxKmh: number; durationMs: number }

export function trailStats(points: TP[]): TrailStats {
  if (points.length < 2) return { distanceKm: 0, avgMovingKmh: 0, maxKmh: 0, durationMs: 0 };
  const cum = cumulativeMeters(points);
  const sp = speedsKmh(points);
  const moving = sp.filter(s => s >= 3);
  const durationMs = ms(points[points.length - 1]!.ts) - ms(points[0]!.ts);
  return {
    distanceKm: cum[cum.length - 1]! / 1000,
    avgMovingKmh: moving.length ? moving.reduce((a, b) => a + b, 0) / moving.length : 0,
    maxKmh: sp.reduce((a, b) => Math.max(a, b), 0),
    durationMs,
  };
}

// Speed → colour bucket for the route ribbon. Index is stable so contiguous runs
// of the same bucket can be drawn as one segment.
const RAMP = [
  { max: 2, hex: '#ef4444', label: 'stopped' },   // red
  { max: 25, hex: '#f59e0b', label: 'slow' },      // amber
  { max: 60, hex: '#84cc16', label: 'cruising' },  // lime
  { max: Infinity, hex: '#10b981', label: 'fast' },// emerald
];
export const SPEED_LEGEND = RAMP.map(r => ({ hex: r.hex, label: r.label }));
export function speedBucket(kmh: number): number {
  for (let i = 0; i < RAMP.length; i++) if (kmh < RAMP[i]!.max) return i;
  return RAMP.length - 1;
}
export function speedColor(kmh: number): string { return RAMP[speedBucket(kmh)]!.hex; }

export interface Stop { lat: number; lng: number; startTs: string; endTs: string; durationMs: number }

/**
 * Stops: runs where the device reports it's barely moving for at least
 * `minStopMs`. Anchored to the run's median position so jitter doesn't smear
 * the pin. Used to drop labelled markers along the route.
 */
export function detectStops(points: TP[], { stoppedKmh = 3, minStopMs = 120000 } = {}): Stop[] {
  const sp = speedsKmh(points);
  const stops: Stop[] = [];
  let i = 0;
  while (i < points.length) {
    if (sp[i]! >= stoppedKmh) { i++; continue; }
    let j = i;
    while (j + 1 < points.length && sp[j + 1]! < stoppedKmh) j++;
    const span = ms(points[j]!.ts) - ms(points[i]!.ts);
    if (span >= minStopMs) {
      const run = points.slice(i, j + 1);
      const lats = run.map(p => p.lat).sort((a, b) => a - b);
      const lngs = run.map(p => p.lng).sort((a, b) => a - b);
      const mid = run.length >> 1;
      stops.push({
        lat: lats[mid]!, lng: lngs[mid]!,
        startTs: points[i]!.ts, endTs: points[j]!.ts, durationMs: span,
      });
    }
    i = j + 1;
  }
  return stops;
}

/** Per-point travel heading (deg) — bearing to the next point; last repeats. */
export function headingsDeg(points: TP[]): number[] {
  if (points.length < 2) return points.map(() => 0);
  const out = points.map((p, i) =>
    i < points.length - 1 ? bearingDeg(p.lat, p.lng, points[i + 1]!.lat, points[i + 1]!.lng) : 0);
  out[out.length - 1] = out[out.length - 2] ?? 0;
  return out;
}

/** Human "1h 04m" / "12m 30s" for HUD durations. */
export function fmtDuration(millis: number): string {
  const s = Math.max(0, Math.round(millis / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}
