// Travel-mode intelligence for the 3D drive replay.
//
// A single car marker lies when the trail is really someone on foot, on a bike,
// or a truck on a highway. This infers the mode from the trail's own speed
// profile — someone who touched highway speed can't be "walking" — and swaps to
// a person marker whenever the subject is stopped (out of the vehicle / indoors).
// The operator can also force a mode.

export type TravelMode = 'auto' | 'foot' | 'bicycle' | 'car' | 'truck';
export type PhysicalMode = Exclude<TravelMode, 'auto'>;

export interface SpeedPoint { lat: number; lng: number; speed: number | null; ts: string }

// km/h thresholds.
const STOPPED_KMH = 2;   // below this the subject is effectively standing still
const FOOT_MAX = 7;      // brisk walk / jog
const BIKE_MAX = 25;     // cycling tops out around here; above → motor vehicle

const R = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Per-point ground speed (km/h), aligned 1:1 with the input. Uses the
// device-reported speed when it's present and sane, otherwise derives it from
// the distance/time to the previous fix.
export function computeSpeeds(pts: SpeedPoint[]): number[] {
  return pts.map((p, i) => {
    if (p.speed != null && p.speed >= 0) return p.speed;
    if (i === 0) return 0;
    const prev = pts[i - 1]!;
    const dt = (new Date(p.ts).getTime() - new Date(prev.ts).getTime()) / 1000;
    if (dt <= 0) return 0;
    const m = haversineM(prev.lat, prev.lng, p.lat, p.lng);
    return (m / dt) * 3.6;
  });
}

// Classify a single moving speed into a physical travel mode.
export function classify(kmh: number): PhysicalMode {
  if (kmh < FOOT_MAX) return 'foot';
  if (kmh < BIKE_MAX) return 'bicycle';
  return 'car';
}

// Whole-trail mode: the fastest *sustained* speed decides (85th percentile of
// moving samples), so a car idling in traffic isn't mistaken for a pedestrian
// and one GPS spike doesn't promote a walk to a drive. Trucks look like cars by
// speed alone, so auto never guesses "truck" — that's a manual choice.
export function dominantMode(pts: SpeedPoint[]): PhysicalMode {
  const moving = computeSpeeds(pts).filter(s => s >= STOPPED_KMH).sort((a, b) => a - b);
  if (moving.length === 0) return 'foot';
  const p85 = moving[Math.min(moving.length - 1, Math.floor(moving.length * 0.85))]!;
  return classify(p85);
}

// Top-down markers, rendered pointing "up" (their front) so Cesium's
// velocity-aligned axis turns them to face the direction of travel. The person
// portrait is circular, so it reads the same at any heading.
const svg = (w: number, h: number, body: string) =>
  'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`);

export const ICONS: Record<PhysicalMode, string> = {
  // Person portrait — head + shoulders from above, rotation-invariant.
  foot: svg(44, 44,
    '<circle cx="22" cy="22" r="19" fill="#10b981" stroke="#ecfdf5" stroke-width="2.5"/>' +
    '<circle cx="22" cy="18" r="7" fill="#062e22"/>' +
    '<path d="M10 35 a12 9 0 0 1 24 0 Z" fill="#062e22"/>'),
  // Bicycle — two wheels + frame, seen from above.
  bicycle: svg(32, 64,
    '<rect x="4" y="2" width="24" height="60" rx="12" fill="#f97316" stroke="#fff7ed" stroke-width="2.5"/>' +
    '<circle cx="16" cy="13" r="6" fill="none" stroke="#1a0e02" stroke-width="3"/>' +
    '<circle cx="16" cy="51" r="6" fill="none" stroke="#1a0e02" stroke-width="3"/>' +
    '<rect x="14.5" y="17" width="3" height="30" fill="#1a0e02"/>'),
  // Car — the original amber saloon.
  car: svg(40, 76,
    '<rect x="6" y="4" width="28" height="68" rx="11" fill="#f59e0b" stroke="#fff7e6" stroke-width="2.5"/>' +
    '<rect x="10" y="11" width="20" height="15" rx="5" fill="#141109" opacity="0.9"/>' +
    '<rect x="10" y="45" width="20" height="13" rx="5" fill="#141109" opacity="0.7"/>' +
    '<circle cx="13" cy="7.5" r="2" fill="#fff"/><circle cx="27" cy="7.5" r="2" fill="#fff"/>'),
  // Truck — long cab + trailer.
  truck: svg(40, 96,
    '<rect x="7" y="2" width="26" height="26" rx="6" fill="#ef4444" stroke="#fee2e2" stroke-width="2.5"/>' +
    '<rect x="11" y="7" width="18" height="12" rx="3" fill="#2a0a0a" opacity="0.9"/>' +
    '<rect x="5" y="30" width="30" height="64" rx="4" fill="#e5e7eb" stroke="#9ca3af" stroke-width="2.5"/>' +
    '<line x1="20" y1="30" x2="20" y2="94" stroke="#9ca3af" stroke-width="1.5"/>'),
};

// The portrait shown whenever the subject is stopped, regardless of vehicle.
const PERSON = ICONS.foot;

// Which marker to draw at an instant, given the selected mode, the auto-inferred
// dominant mode, and the current speed. Stopped → person portrait (they're on
// foot / out of the vehicle); moving → the chosen or inferred vehicle.
export function iconAt(selected: TravelMode, dominant: PhysicalMode, kmh: number): string {
  const mode = selected === 'auto' ? dominant : selected;
  if (mode === 'foot') return PERSON;
  if (kmh < STOPPED_KMH) return PERSON;
  return ICONS[mode];
}
