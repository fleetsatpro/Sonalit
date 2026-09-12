// Top-down liveried vehicles: airliner with gold Sonalit tailfin/cheatline,
// container ship with white bridge + multi-colour container stacks, semi-truck
// with gold trailer. Ported byte-for-byte from docs/sonalit-login.html.
// All drawing happens in the ctx's currently-translated/rotated frame — caller
// handles ctx.save/translate/rotate/restore.

// TUNABLE — relative vehicle size (fraction of R). See engine.js.
export const VSIZE = { air: 0.048, sea: 0.058, road: 0.044 };

export function drawPlane(ctx, s) {
  // wings (under fuselage)
  ctx.fillStyle = '#93A5BD';
  ctx.beginPath();
  ctx.moveTo( 0.30 * s,  0.05 * s);
  ctx.lineTo(-0.18 * s,  0.98 * s);
  ctx.lineTo(-0.44 * s,  0.98 * s);
  ctx.lineTo(-0.04 * s,  0.03 * s);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo( 0.30 * s, -0.05 * s);
  ctx.lineTo(-0.18 * s, -0.98 * s);
  ctx.lineTo(-0.44 * s, -0.98 * s);
  ctx.lineTo(-0.04 * s, -0.03 * s);
  ctx.closePath(); ctx.fill();
  // tailplane
  ctx.beginPath();
  ctx.moveTo(-0.62 * s,  0.03 * s);
  ctx.lineTo(-0.86 * s,  0.34 * s);
  ctx.lineTo(-1.00 * s,  0.34 * s);
  ctx.lineTo(-0.80 * s,  0.02 * s);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-0.62 * s, -0.03 * s);
  ctx.lineTo(-0.86 * s, -0.34 * s);
  ctx.lineTo(-1.00 * s, -0.34 * s);
  ctx.lineTo(-0.80 * s, -0.02 * s);
  ctx.closePath(); ctx.fill();
  // engine nacelles
  ctx.fillStyle = '#39485A';
  ctx.fillRect(-0.04 * s,  0.30 * s, 0.20 * s, 0.12 * s);
  ctx.fillRect(-0.04 * s, -0.42 * s, 0.20 * s, 0.12 * s);
  // fuselage (silver livery)
  ctx.fillStyle = '#DCE5F0';
  ctx.beginPath();
  ctx.moveTo(1.02 * s, 0);
  ctx.quadraticCurveTo(0.55 * s,  0.135 * s, -0.5 * s,  0.11 * s);
  ctx.lineTo(-1.00 * s,  0.055 * s);
  ctx.lineTo(-1.00 * s, -0.055 * s);
  ctx.lineTo(-0.5 * s, -0.11 * s);
  ctx.quadraticCurveTo(0.55 * s, -0.135 * s, 1.02 * s, 0);
  ctx.closePath(); ctx.fill();
  // vertical fin (gold Sonalit livery)
  ctx.fillStyle = '#F0B429';
  ctx.beginPath();
  ctx.moveTo(-0.55 * s,  0.055 * s);
  ctx.lineTo(-1.06 * s, 0);
  ctx.lineTo(-0.55 * s, -0.055 * s);
  ctx.closePath(); ctx.fill();
  // gold cheatline + cockpit
  ctx.strokeStyle = '#E0A82E';
  ctx.lineWidth = Math.max(0.5, 0.045 * s);
  ctx.beginPath();
  ctx.moveTo( 0.9 * s, 0);
  ctx.lineTo(-0.55 * s, 0);
  ctx.stroke();
  ctx.fillStyle = '#141C2A';
  ctx.beginPath(); ctx.arc(0.82 * s, 0, 0.07 * s, 0, 7); ctx.fill();
}

export function drawShip(ctx, s) {
  // hull
  ctx.fillStyle = '#22323F';
  ctx.beginPath();
  ctx.moveTo( 1.0 * s, 0);
  ctx.lineTo( 0.5 * s,  0.30 * s);
  ctx.lineTo(-1.0 * s,  0.30 * s);
  ctx.lineTo(-1.0 * s, -0.30 * s);
  ctx.lineTo( 0.5 * s, -0.30 * s);
  ctx.closePath(); ctx.fill();
  // deck
  ctx.fillStyle = '#2E4150';
  ctx.beginPath();
  ctx.moveTo( 0.78 * s, 0);
  ctx.lineTo( 0.44 * s,  0.22 * s);
  ctx.lineTo(-0.92 * s,  0.22 * s);
  ctx.lineTo(-0.92 * s, -0.22 * s);
  ctx.lineTo( 0.44 * s, -0.22 * s);
  ctx.closePath(); ctx.fill();
  // container stacks (varied livery)
  const pal = ['#C0453B', '#2E6FA8', '#3B9A6B', '#C9962E', '#8892A0', '#B54F86', '#4A7FB0'];
  const cols = 6, rows = 3;
  const x0 = -0.86 * s, x1 = 0.36 * s, y0 = -0.20 * s, y1 = 0.20 * s;
  const cw = (x1 - x0) / cols, ch = (y1 - y0) / rows;
  const g = Math.max(0.3, 0.035 * s);
  for (let ci = 0; ci < cols; ci++) {
    for (let ri = 0; ri < rows; ri++) {
      ctx.fillStyle = pal[(ci * 2 + ri * 3) % pal.length];
      ctx.fillRect(x0 + ci * cw + g, y0 + ri * ch + g, cw - 2 * g, ch - 2 * g);
    }
  }
  // bridge / superstructure (white) at stern
  ctx.fillStyle = '#E6ECF3';
  ctx.fillRect(-0.99 * s, -0.17 * s, 0.15 * s, 0.34 * s);
  // bow gold accent
  ctx.strokeStyle = '#F0B429';
  ctx.lineWidth = Math.max(0.5, 0.04 * s);
  ctx.beginPath();
  ctx.moveTo(1.0 * s, 0); ctx.lineTo(0.5 * s,  0.30 * s);
  ctx.moveTo(1.0 * s, 0); ctx.lineTo(0.5 * s, -0.30 * s);
  ctx.stroke();
}

export function drawTruck(ctx, s) {
  // trailer (gold Sonalit livery)
  ctx.fillStyle = '#E0A82E';
  ctx.fillRect(-0.95 * s, -0.26 * s, 1.24 * s, 0.52 * s);
  ctx.strokeStyle = '#A9801F';
  ctx.lineWidth = Math.max(0.4, 0.028 * s);
  ctx.strokeRect(-0.95 * s, -0.26 * s, 1.24 * s, 0.52 * s);
  ctx.strokeStyle = '#B98A22';
  ctx.beginPath(); ctx.moveTo(-0.9 * s, 0); ctx.lineTo(0.24 * s, 0); ctx.stroke();
  // cab (graphite)
  ctx.fillStyle = '#2A3648';
  ctx.fillRect(0.35 * s, -0.22 * s, 0.6 * s, 0.44 * s);
  ctx.fillStyle = '#111A26';
  ctx.fillRect(0.79 * s, -0.16 * s, 0.12 * s, 0.32 * s); // windshield
  // wheels
  ctx.fillStyle = '#0E1219';
  [-0.72, -0.34, 0.06].forEach((wx) => {
    ctx.fillRect(wx * s,  0.24 * s, 0.13 * s, 0.09 * s);
    ctx.fillRect(wx * s, -0.33 * s, 0.13 * s, 0.09 * s);
  });
  ctx.fillRect(0.52 * s,  0.20 * s, 0.12 * s, 0.08 * s);
  ctx.fillRect(0.52 * s, -0.28 * s, 0.12 * s, 0.08 * s);
}

export function drawVehicle(ctx, mode, s) {
  if (mode === 'air') drawPlane(ctx, s);
  else if (mode === 'sea') drawShip(ctx, s);
  else drawTruck(ctx, s);
}
