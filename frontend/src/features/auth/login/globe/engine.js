// Live Operations Globe — pure canvas engine.
// Ported byte-for-byte from docs/sonalit-login.html. React shell in
// ../OperationsGlobe.jsx owns the canvas ref/rAF loop/resize/visibility;
// this module knows nothing about React.

import { LAND } from './landDots';
import {
  CITIES, ROUTES, MODE_COL, DOT_COL, DOT_R,
  DEG, LAT0, sinLat0, cosLat0,
  v3, slerp, vll,
} from './geo';
import { VSIZE, drawVehicle } from './vehicles';

// ─────────────────────────────────────────────────────────────────────────
// TUNABLE — one revolution per 90s.
// TUNABLE — starting longitude (Africa-centred at ~20°E).
// TUNABLE — framing: R = min(W,H)*0.43, cx = W*0.57, cy = H*0.46.
// TUNABLE — vehicle sizes live in vehicles.js:VSIZE.
// TUNABLE — per-mode arc-traversal durations (ms) below in routeGeo builder.
// ─────────────────────────────────────────────────────────────────────────
export const ROT_PER_MS = 360 / 90000;
export const BASE_LON = 20;

/**
 * Build a globe engine bound to a single <canvas>. Returns a controller with
 * start()/stop()/resize(); the caller (React shell) drives lifecycle.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{ reducedMotion?: boolean }} [opts]
 */
export function createGlobeEngine(canvas, opts = {}) {
  const reducedMotion = !!opts.reducedMotion;
  const ctx = canvas.getContext('2d');

  let W = 0, H = 0, DPR = 1, cx = 0, cy = 0, R = 0;
  let lon0 = BASE_LON;
  let startT = null;
  let rafId = null;
  let running = false;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = rect.width  || 700;
    H = rect.height || 700;
    canvas.width  = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    R  = Math.min(W, H) * 0.43;
    cx = W * 0.57;
    cy = H * 0.46;
    if (reducedMotion || !running) drawFrame(0);
  }

  // Projection is closed over locals so resize() updates it live.
  function project(lonDeg, latDeg) {
    const la = latDeg * DEG;
    const lo = (lonDeg - lon0) * DEG;
    const cosla = Math.cos(la);
    const sinla = Math.sin(la);
    const coslo = Math.cos(lo);
    const cosc  = sinLat0 * sinla + cosLat0 * cosla * coslo;
    const x = cosla * Math.sin(lo);
    const y = cosLat0 * sinla - sinLat0 * cosla * coslo;
    return { sx: cx + R * x, sy: cy - R * y, vis: cosc >= -0.02, depth: cosc };
  }

  const routeGeo = ROUTES.map((rt, i) => {
    const A = CITIES[rt.a], B = CITIES[rt.b];
    return {
      va: v3(A.lon, A.lat),
      vb: v3(B.lon, B.lat),
      mode: rt.mode,
      phase: (i * 0.137) % 1,
      // TUNABLE — arc traversal, ms: ships crawl at ~7.6× planes.
      dur: rt.mode === 'air' ? 5000 : rt.mode === 'road' ? 13000 : 38000,
    };
  });

  function drawSphere() {
    const g = ctx.createRadialGradient(cx - R * 0.32, cy - R * 0.34, R * 0.1, cx, cy, R);
    g.addColorStop(0, '#0D1728');
    g.addColorStop(0.7, '#080E1A');
    g.addColorStop(1, '#050810');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();
    const a = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.14);
    a.addColorStop(0,    'rgba(74,158,255,0)');
    a.addColorStop(0.5,  'rgba(74,158,255,0.05)');
    a.addColorStop(0.78, 'rgba(240,180,41,0.07)');
    a.addColorStop(1,    'rgba(240,180,41,0)');
    ctx.fillStyle = a;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.14, 0, 7); ctx.fill();
  }

  function drawGraticule() {
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(120,150,195,0.055)';
    for (let lon = -180; lon < 180; lon += 30) {
      ctx.beginPath();
      let on = false;
      for (let lat = -84; lat <= 84; lat += 3) {
        const p = project(lon, lat);
        if (p.vis) { on ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy); on = true; }
        else on = false;
      }
      ctx.stroke();
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      ctx.beginPath();
      let on = false;
      for (let lon = -180; lon <= 180; lon += 3) {
        const p = project(lon, lat);
        if (p.vis) { on ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy); on = true; }
        else on = false;
      }
      ctx.stroke();
    }
  }

  function drawLand() {
    const scale = R / 300;
    for (let i = 0; i < LAND.length; i++) {
      const L = LAND[i];
      const p = project(L[0], L[1]);
      if (!p.vis || p.depth < 0) continue;
      const d = p.depth;
      const cls = L[2];
      const r = DOT_R[cls] * (0.5 + 0.5 * d) * scale;
      ctx.globalAlpha = 0.32 + 0.68 * d;
      ctx.fillStyle = DOT_COL[cls];
      ctx.fillRect(p.sx - r, p.sy - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
  }

  function drawRoutes(now) {
    for (const g of routeGeo) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = MODE_COL[g.mode];
      ctx.globalAlpha = 0.20;
      ctx.beginPath();
      let on = false;
      for (let s = 0; s <= 40; s++) {
        const v = slerp(g.va, g.vb, s / 40);
        const ll = vll(v);
        const p = project(ll[0], ll[1]);
        if (p.vis) { on ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy); on = true; }
        else on = false;
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      const t  = reducedMotion ? g.phase : ((now / g.dur) + g.phase) % 1;
      const t2 = Math.min(1, t + 0.012);
      const va  = slerp(g.va, g.vb, t);
      const vb2 = slerp(g.va, g.vb, t2);
      const lla = vll(va);
      const llb = vll(vb2);
      const p  = project(lla[0], lla[1]);
      const p2 = project(llb[0], llb[1]);
      if (p.vis && p.depth > 0.05) {
        const ang = Math.atan2(p2.sy - p.sy, p2.sx - p.sx);
        const s = R * VSIZE[g.mode] * (0.72 + 0.28 * p.depth);
        ctx.save();
        ctx.translate(p.sx, p.sy);
        ctx.rotate(ang);
        ctx.globalAlpha = Math.max(0.42, Math.min(1, p.depth * 1.4));
        // soft shadow for lift
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath();
        ctx.ellipse(-0.06 * s, 0.10 * s, s * 0.7, s * 0.5, 0, 0, 7);
        ctx.fill();
        drawVehicle(ctx, g.mode, s);
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    }
  }

  // City check-in pings, triggered as rotation carries a city through centre.
  const relPrev = {};
  const pings = [];
  function drawCities(now) {
    Object.entries(CITIES).forEach(([k, c]) => {
      const rel = ((c.lon - lon0 + 540) % 360) - 180;
      if (!reducedMotion && relPrev[k] !== undefined && relPrev[k] < 0 && rel >= 0 && Math.abs(c.lat) < 70) {
        pings.push({ lon: c.lon, lat: c.lat, born: now });
      }
      relPrev[k] = rel;
      const p = project(c.lon, c.lat);
      if (!p.vis || p.depth < 0) return;
      const col = MODE_COL[c.mode];
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(p.sx, p.sy, 2.3, 0, 7); ctx.fill();
      ctx.fillStyle = '#FFF6DA';
      ctx.beginPath(); ctx.arc(p.sx, p.sy, 0.9, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
      if (c.label && p.depth > 0.34) {
        ctx.font = '500 9px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(150,163,186,' + (0.35 + 0.5 * p.depth).toFixed(2) + ')';
        ctx.textBaseline = 'middle';
        const right = p.sx > cx;
        ctx.textAlign = right ? 'left' : 'right';
        ctx.fillText(c.label, p.sx + (right ? 7 : -7), p.sy);
      }
    });
    for (let i = pings.length - 1; i >= 0; i--) {
      const pg = pings[i];
      const age = (now - pg.born) / 1400;
      if (age >= 1) { pings.splice(i, 1); continue; }
      const p = project(pg.lon, pg.lat);
      if (p.vis && p.depth > 0) {
        ctx.strokeStyle = 'rgba(240,180,41,' + ((1 - age) * 0.6).toFixed(2) + ')';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.sx, p.sy, 4 + age * 22, 0, 7); ctx.stroke();
      }
    }
  }

  function drawFrame(now) {
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    drawSphere();
    drawGraticule();
    drawLand();
    drawRoutes(now);
    drawCities(now);
  }

  function loop(now) {
    if (!running) return;
    if (startT === null) startT = now;
    lon0 = (BASE_LON + (now - startT) * ROT_PER_MS) % 360;
    drawFrame(now);
    rafId = requestAnimationFrame(loop);
  }

  function start() {
    if (running) return;
    running = true;
    // Reset the "wall clock" so a resumed loop doesn't teleport the globe.
    startT = null;
    if (reducedMotion) {
      lon0 = BASE_LON;
      drawFrame(0);
      running = false; // one frame is enough
      return;
    }
    rafId = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  return { start, stop, resize };
}
