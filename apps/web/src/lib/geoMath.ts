export function geoCircle(lat: number, lng: number, radiusKm: number, steps = 48): [number, number][] {
  const R = 6371;
  const pts: [number, number][] = [];
  const cosLat = Math.cos(lat * Math.PI / 180);
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    pts.push([
      lng + (radiusKm / R) * (180 / Math.PI) * Math.sin(angle) / cosLat,
      lat + (radiusKm / R) * (180 / Math.PI) * Math.cos(angle),
    ]);
  }
  return pts;
}

export function fmtAge(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (d < 1) return 'just now';
  if (d < 60) return `${d}m ago`;
  if (d < 1440) return `${Math.floor(d / 60)}h ago`;
  return `${Math.floor(d / 1440)}d ago`;
}

// Equirectangular approximation — fine at the regional scale this page operates at.
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distanceToSegmentKm(lat: number, lng: number, aLat: number, aLng: number, bLat: number, bLng: number): number {
  // Project onto the segment in a locally-flat lat/lng space, then measure with haversine.
  const dLat = bLat - aLat, dLng = bLng - aLng;
  const lenSq = dLat * dLat + dLng * dLng;
  let t = lenSq > 0 ? ((lat - aLat) * dLat + (lng - aLng) * dLng) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  return haversineKm(lat, lng, aLat + t * dLat, aLng + t * dLng);
}

export function distanceToPolylineKm(lat: number, lng: number, path: [number, number][]): number {
  if (path.length < 2) return path.length === 1 ? haversineKm(lat, lng, path[0]![0], path[0]![1]) : Infinity;
  let min = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const [aLat, aLng] = path[i]!;
    const [bLat, bLng] = path[i + 1]!;
    min = Math.min(min, distanceToSegmentKm(lat, lng, aLat, aLng, bLat, bLng));
  }
  return min;
}
