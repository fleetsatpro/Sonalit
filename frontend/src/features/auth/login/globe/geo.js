// Cities, routes, projection, and great-circle helpers.
// Extracted byte-for-byte from docs/sonalit-login.html — the projection math
// (orthographic centred on 20°E, 15° tilt) and slerp are tuned; don't touch.

export const DEG = Math.PI / 180;

export const CITIES = {
  la:        { lon: -118.2, lat:  34.0,  label: 'LOS ANGELES', mode: 'sea' },
  ny:        { lon:  -74.0, lat:  40.7,  label: 'NEW YORK',    mode: 'sea' },
  santos:    { lon:  -46.3, lat: -24.0,  label: 'SANTOS',      mode: 'sea' },
  rotterdam: { lon:    4.5, lat:  51.9,  label: 'ROTTERDAM',   mode: 'sea' },
  frankfurt: { lon:    8.7, lat:  50.1,  label: 'FRANKFURT',   mode: 'air' },
  lagos:     { lon:    3.4, lat:   6.5,  label: 'LAGOS',       mode: 'road' },
  mombasa:   { lon:   39.7, lat:  -4.05, label: 'MOMBASA',     mode: 'road' },
  dubai:     { lon:   55.3, lat:  25.3,  label: 'DUBAI',       mode: 'air' },
  singapore: { lon:  103.8, lat:   1.35, label: 'SINGAPORE',   mode: 'sea' },
  shanghai:  { lon:  121.5, lat:  31.2,  label: 'SHANGHAI',    mode: 'sea' },
  tokyo:     { lon:  139.7, lat:  35.7,  label: 'TOKYO',       mode: 'air' },
  sydney:    { lon:  151.2, lat: -33.9,  label: 'SYDNEY',      mode: 'sea' },
  chicago:   { lon:  -87.6, lat:  41.9,  label: '',            mode: 'road' },
  kampala:   { lon:   32.6, lat:   0.35, label: '',            mode: 'road' },
};

export const ROUTES = [
  { a: 'shanghai',  b: 'la',        mode: 'sea'  },
  { a: 'rotterdam', b: 'ny',        mode: 'sea'  },
  { a: 'santos',    b: 'lagos',     mode: 'sea'  },
  { a: 'singapore', b: 'mombasa',   mode: 'sea'  },
  { a: 'singapore', b: 'sydney',    mode: 'sea'  },
  { a: 'frankfurt', b: 'dubai',     mode: 'air'  },
  { a: 'dubai',     b: 'singapore', mode: 'air'  },
  { a: 'tokyo',     b: 'la',        mode: 'air'  },
  { a: 'ny',        b: 'frankfurt', mode: 'air'  },
  { a: 'mombasa',   b: 'dubai',     mode: 'air'  },
  { a: 'mombasa',   b: 'kampala',   mode: 'road' },
  { a: 'rotterdam', b: 'frankfurt', mode: 'road' },
  { a: 'la',        b: 'chicago',   mode: 'road' },
  { a: 'shanghai',  b: 'singapore', mode: 'road' },
];

export const MODE_COL = { road: '#F0B429', air: '#4A9EFF', sea: '#35C4D7' };
export const PK_COL   = { road: '#FFE29A', air: '#BBDCFF', sea: '#BFF3FA' };
export const DOT_COL  = ['#243349', '#2B3D57', '#35496A', '#5C86B8', '#7A6222', '#BE922E'];
export const DOT_R    = [0.9, 1.0, 1.05, 1.2, 1.25, 1.45];

// Orthographic projection centred on (lon0, LAT0 tilt).
export const LAT0 = 15 * DEG;
export const sinLat0 = Math.sin(LAT0);
export const cosLat0 = Math.cos(LAT0);

export function makeProject(getLon0, getFrame) {
  return function project(lonDeg, latDeg) {
    const { cx, cy, R } = getFrame();
    const la = latDeg * DEG;
    const lo = (lonDeg - getLon0()) * DEG;
    const cosla = Math.cos(la);
    const sinla = Math.sin(la);
    const coslo = Math.cos(lo);
    const cosc  = sinLat0 * sinla + cosLat0 * cosla * coslo;
    const x = cosla * Math.sin(lo);
    const y = cosLat0 * sinla - sinLat0 * cosla * coslo;
    return { sx: cx + R * x, sy: cy - R * y, vis: cosc >= -0.02, depth: cosc };
  };
}

// Great-circle helpers.
export function v3(lonDeg, latDeg) {
  const la = latDeg * DEG;
  const lo = lonDeg * DEG;
  const cl = Math.cos(la);
  return [cl * Math.cos(lo), cl * Math.sin(lo), Math.sin(la)];
}

export function slerp(a, b, t) {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  dot = Math.max(-1, Math.min(1, dot));
  const om = Math.acos(dot);
  if (om < 1e-6) return a.slice();
  const so = Math.sin(om);
  const s0 = Math.sin((1 - t) * om) / so;
  const s1 = Math.sin(t * om) / so;
  return [a[0] * s0 + b[0] * s1, a[1] * s0 + b[1] * s1, a[2] * s0 + b[2] * s1];
}

export function vll(v) {
  return [
    Math.atan2(v[1], v[0]) / DEG,
    Math.asin(Math.max(-1, Math.min(1, v[2]))) / DEG,
  ];
}
