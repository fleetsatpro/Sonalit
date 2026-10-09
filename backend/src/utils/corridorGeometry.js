'use strict';

const R = 6371008.8;
const MIN_BUFFER_M = 10;
const MAX_BUFFER_M = 5000;
const MAX_PATH_POINTS = 800;
const MAX_MITER_RATIO = 2.5;

function distanceM(a, b) {
  const p1 = Number(a[0]) * Math.PI / 180;
  const p2 = Number(b[0]) * Math.PI / 180;
  const dp = p2 - p1;
  const dl = (Number(b[1]) - Number(a[1])) * Math.PI / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
const MAX_INPUT_PATH_POINTS = 20000;
const MAX_SIMPLIFICATION_COMPARISONS = 2000000;

function wrappedDeltaDegrees(delta) {
  return ((delta + 540) % 360) - 180;
}

function pointToSegmentDistanceM(point, start, end) {
  const latScale = Math.cos(((start[0] + end[0]) / 2) * Math.PI / 180);
  const scale = R * Math.PI / 180;
  const dx = wrappedDeltaDegrees(end[1] - start[1]) * scale * latScale;
  const dy = (end[0] - start[0]) * scale;
  const px = wrappedDeltaDegrees(point[1] - start[1]) * scale * latScale;
  const py = (point[0] - start[0]) * scale;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared)) : 0;
  return Math.hypot(px - t * dx, py - t * dy);
}

/**
 * Bound route geometry cost without arbitrary truncation. Douglas–Peucker keeps
 * both endpoints and guarantees each removed vertex is within tolerance of its
 * retained segment in a local metric projection. If the route cannot be
 * represented inside the vertex/computation budget at this tolerance, fail
 * closed instead of pretending a coarse line is the requested road corridor.
 */
function simplifyPath(path, toleranceM = 10) {
  if (!Array.isArray(path) || path.length < 2) throw new TypeError('A corridor needs at least two route points.');
  if (path.length > MAX_INPUT_PATH_POINTS) throw new RangeError('Route geometry exceeds the safe input vertex limit.');
  const tolerance = Number(toleranceM);
  if (!Number.isFinite(tolerance) || tolerance < 1 || tolerance > 100) throw new RangeError('Geometry simplification tolerance must be between 1 and 100 metres.');

  const raw = [];
  for (let i = 0; i < path.length; i++) {
    const point = path[i];
    if (!Array.isArray(point) || point.length < 2) throw new TypeError('Invalid coordinate at centreline index ' + i + '.');
    const lat = Number(point[0]), lng = Number(point[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180) {
      throw new RangeError('Invalid coordinate at centreline index ' + i + '.');
    }
    const normalized = [lat, lng];
    if (!raw.length || distanceM(raw[raw.length - 1], normalized) >= 0.05) raw.push(normalized);
  }
  if (raw.length < 2) throw new RangeError('The route has no measurable length.');
  if (raw.length <= MAX_PATH_POINTS) {
    const normalized = normalizePath(raw);
    return { path: normalized, originalPointCount: raw.length, finalPointCount: normalized.length, toleranceM: 0 };
  }

  const keep = new Uint8Array(raw.length);
  keep[0] = 1;
  keep[raw.length - 1] = 1;
  const stack = [[0, raw.length - 1]];
  let comparisons = 0;
  while (stack.length) {
    const [first, last] = stack.pop();
    if (last <= first + 1) continue;
    let farthest = -1;
    let farthestDistance = tolerance;
    for (let i = first + 1; i < last; i++) {
      if (++comparisons > MAX_SIMPLIFICATION_COMPARISONS) {
        throw new RangeError('Route geometry is too complex to simplify within the safe computation budget.');
      }
      const distance = pointToSegmentDistanceM(raw[i], raw[first], raw[last]);
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthest = i;
      }
    }
    if (farthest >= 0) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }

  const reduced = raw.filter((_, index) => keep[index]);
  if (reduced.length > MAX_PATH_POINTS) {
    throw new RangeError('Route still exceeds the safe vertex limit at the requested geometry tolerance; no coarse substitute was created.');
  }
  const normalized = normalizePath(reduced);
  return {
    path: normalized,
    originalPointCount: raw.length,
    finalPointCount: normalized.length,
    toleranceM: normalized.length < raw.length ? tolerance : 0,
  };
}

function normalizePath(path) {
  if (!Array.isArray(path) || path.length < 2) throw new TypeError('A corridor needs at least two [latitude, longitude] points.');
  if (path.length > MAX_PATH_POINTS) throw new RangeError('Routed centreline exceeds the safe vertex limit; geometry was not truncated.');
  const out = [];
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (!Array.isArray(p) || p.length < 2) throw new TypeError('Invalid coordinate at centreline index ' + i + '.');
    const lat = Number(p[0]), lng = Number(p[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180) {
      throw new RangeError('Invalid coordinate at centreline index ' + i + '.');
    }
    const point = [lat, lng];
    if (!out.length || distanceM(out[out.length - 1], point) >= 0.05) out.push(point);
  }
  if (out.length < 2) throw new RangeError('The route has no measurable length.');
  return out;
}
function wrapLongitude(lng) {
  return ((lng + 180) % 360 + 360) % 360 - 180;
}

// Return the point halfway along the route's measured geodesic length. The
// overview polyline can have highly non-uniform vertex spacing, so the middle
// array element is not a reliable geographic or distance midpoint.
function midpointOnPath(path) {
  const route = normalizePath(path);
  const lengths = [];
  let total = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const length = distanceM(route[i], route[i + 1]);
    if (!Number.isFinite(length) || length <= 0) throw new RangeError('Route segment has no measurable length.');
    lengths.push(length);
    total += length;
  }
  if (!Number.isFinite(total) || total <= 0) throw new RangeError('Route has no measurable length.');

  const target = total / 2;
  let traversed = 0;
  for (let i = 0; i < lengths.length; i++) {
    const segmentLength = lengths[i];
    if (traversed + segmentLength >= target) {
      const fraction = Math.max(0, Math.min(1, (target - traversed) / segmentLength));
      const [lat1, lng1] = route[i].map(Number);
      const [lat2, lng2] = route[i + 1].map(Number);
      const phi1 = lat1 * Math.PI / 180;
      const phi2 = lat2 * Math.PI / 180;
      const lambda1 = lng1 * Math.PI / 180;
      const lambda2 = lng2 * Math.PI / 180;
      const centralAngle = distanceM(route[i], route[i + 1]) / R;
      const sinAngle = Math.sin(centralAngle);

      // Spherical linear interpolation avoids a longitude jump across the
      // antimeridian and is more stable than averaging lat/lng coordinates.
      if (centralAngle > 1e-10 && Math.abs(sinAngle) > 1e-10) {
        const a = Math.sin((1 - fraction) * centralAngle) / sinAngle;
        const b = Math.sin(fraction * centralAngle) / sinAngle;
        const x = a * Math.cos(phi1) * Math.cos(lambda1) + b * Math.cos(phi2) * Math.cos(lambda2);
        const y = a * Math.cos(phi1) * Math.sin(lambda1) + b * Math.cos(phi2) * Math.sin(lambda2);
        const z = a * Math.sin(phi1) + b * Math.sin(phi2);
        return [
          Math.atan2(z, Math.hypot(x, y)) * 180 / Math.PI,
          wrapLongitude(Math.atan2(y, x) * 180 / Math.PI),
        ];
      }

      const lngDelta = ((lng2 - lng1 + 540) % 360) - 180;
      return [lat1 + (lat2 - lat1) * fraction, wrapLongitude(lng1 + lngDelta * fraction)];
    }
    traversed += segmentLength;
  }
  return [...route[route.length - 1]];
}

function unwrap(points) {
  return points.map((p, i) => {
    let lng = p[1];
    if (i) {
      const previous = points[i - 1][1];
      while (lng - previous > 180) lng -= 360;
      while (lng - previous < -180) lng += 360;
    }
    if (i) points[i][1] = lng;
    return [p[0], lng];
  });
}
function projection(path) {
  const meanLat = path.reduce((s, p) => s + p[0], 0) / path.length;
  const cosLat = Math.cos(meanLat * Math.PI / 180);
  const unwrapped = unwrap(path.map(p => [...p]));
  const toXY = ([lat, lng]) => [R * cosLat * lng * Math.PI / 180, R * lat * Math.PI / 180];
  const toLL = ([x, y]) => {
    let lng = x / (R * cosLat) * 180 / Math.PI;
    lng = ((lng + 180) % 360 + 360) % 360 - 180;
    return [y / R * 180 / Math.PI, lng];
  };
  return { xy: unwrapped.map(toXY), toXY, toLL };
}
function cross(a,b,c) { return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]); }
function onSegment(a,b,p) {
  const e=1e-6;
  return p[0]>=Math.min(a[0],b[0])-e && p[0]<=Math.max(a[0],b[0])+e &&
    p[1]>=Math.min(a[1],b[1])-e && p[1]<=Math.max(a[1],b[1])+e;
}
function intersects(a,b,c,d) {
  const e=1e-7, o1=cross(a,b,c), o2=cross(a,b,d), o3=cross(c,d,a), o4=cross(c,d,b);
  if (((o1>e&&o2< -e)||(o1< -e&&o2>e)) && ((o3>e&&o4< -e)||(o3< -e&&o4>e))) return true;
  return (Math.abs(o1)<=e&&onSegment(a,b,c)) || (Math.abs(o2)<=e&&onSegment(a,b,d)) ||
    (Math.abs(o3)<=e&&onSegment(c,d,a)) || (Math.abs(o4)<=e&&onSegment(c,d,b));
}
function validateRingXY(points) {
  if (!Array.isArray(points) || points.length < 4) return {valid:false,reason:'Polygon ring is too short.'};
  if (Math.hypot(points[0][0]-points[points.length-1][0],points[0][1]-points[points.length-1][1])>1) {
    return {valid:false,reason:'Polygon ring is not closed within one metre.'};
  }
  let area=0;
  for(let i=0;i<points.length-1;i++) {
    const a=points[i], b=points[i+1];
    if(!a.every(Number.isFinite)||!b.every(Number.isFinite)) return {valid:false,reason:'Polygon contains non-finite coordinates.'};
    area += a[0]*b[1]-b[0]*a[1];
  }
  if(Math.abs(area)<0.01) return {valid:false,reason:'Polygon area is negligible.'};
  const count=points.length-1;
  for(let i=0;i<count;i++) for(let j=i+1;j<count;j++) {
    if(j===i+1||(i===0&&j===count-1)) continue;
    if(intersects(points[i],points[i+1],points[j],points[j+1])) return {valid:false,reason:'Polygon ring self-intersects.'};
  }
  return {valid:true};
}
function validateCorridorGeometry(path, polygon, bufferM) {
  try {
    const route=normalizePath(path), buffer=Number(bufferM);
    if(!Number.isFinite(buffer)||buffer<MIN_BUFFER_M||buffer>MAX_BUFFER_M) return {valid:false,reason:'Invalid metre buffer.'};
    if(!Array.isArray(polygon)||polygon.length!==2*route.length+1) return {valid:false,reason:'Polygon vertex count does not match the centreline.'};
    const ring=polygon.map((p,i)=>{
      if(!Array.isArray(p)||p.length<2||!Number.isFinite(Number(p[0]))||!Number.isFinite(Number(p[1]))||Math.abs(Number(p[0]))>90||Math.abs(Number(p[1]))>180) throw new RangeError('Invalid polygon coordinate at index '+i+'.');
      return [Number(p[0]),Number(p[1])];
    });
    if(distanceM(ring[0],ring[ring.length-1])>1) return {valid:false,reason:'Polygon ring is not closed within one metre.'};
    const proj=projection(ring);
    proj.xy[proj.xy.length-1]=[...proj.xy[0]];
    const valid=validateRingXY(proj.xy);
    if(!valid.valid) return valid;
    const offsets=[], n=route.length;
    for(let i=0;i<n;i++) {
      const left=distanceM(route[i],ring[i]), right=distanceM(route[i],ring[2*n-1-i]);
      offsets.push(left,right);
      if(!Number.isFinite(left)||!Number.isFinite(right)||left<buffer*.9||right<buffer*.9||
         left>buffer*MAX_MITER_RATIO+2||right>buffer*MAX_MITER_RATIO+2) {
        return {valid:false,reason:'Polygon offset is inconsistent with the requested metre buffer.'};
      }
    }
    return {valid:true,pathPoints:n,polygonPoints:ring.length,minOffsetM:Math.min(...offsets),maxOffsetM:Math.max(...offsets)};
  } catch(e) { return {valid:false,reason:String(e.message||'Invalid corridor geometry.')}; }
}
function buildCorridorPolygon(path, bufferM) {
  const route=normalizePath(path), buffer=Number(bufferM);
  if(!Number.isFinite(buffer)||buffer<MIN_BUFFER_M||buffer>MAX_BUFFER_M) throw new RangeError('Corridor buffer must be between 10 and 5000 metres.');
  const {xy,toLL}=projection(route), left=[], right=[];
  const unit=(a,b)=>{
    const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
    if(len<.05) throw new RangeError('Route contains a duplicate segment.');
    return [dx/len,dy/len];
  };
  for(let i=0;i<xy.length;i++) {
    const prev=i?unit(xy[i-1],xy[i]):unit(xy[i],xy[i+1]);
    const next=i<xy.length-1?unit(xy[i],xy[i+1]):prev;
    const pn=[-prev[1],prev[0]], nn=[-next[1],next[0]];
    let nx=pn[0]+nn[0], ny=pn[1]+nn[1], length=Math.hypot(nx,ny);
    if(length<1e-6) throw new RangeError('Route reverses direction too sharply for a safe corridor.');
    nx/=length; ny/=length;
    // Correct miter math: projection onto the outgoing normal, not tangent.
    // A straight route therefore has denominator 1 and exact buffer width.
    const denominator=Math.abs(nx*nn[0]+ny*nn[1]);
    if(!Number.isFinite(denominator)||denominator<1e-6) throw new RangeError('Corridor miter is numerically unstable.');
    const distance=Math.min(buffer*MAX_MITER_RATIO,buffer/denominator);
    left.push([xy[i][0]+nx*distance,xy[i][1]+ny*distance]);
    right.push([xy[i][0]-nx*distance,xy[i][1]-ny*distance]);
  }
  const ringXY=[...left,...right.reverse()];
  ringXY.push([...ringXY[0]]);
  const ringCheck=validateRingXY(ringXY);
  if(!ringCheck.valid) throw new RangeError(ringCheck.reason);
  const polygon=ringXY.map(toLL);
  const verified=validateCorridorGeometry(route,polygon,buffer);
  if(!verified.valid) throw new RangeError(verified.reason);
  return polygon;
}
module.exports={MAX_PATH_POINTS,MAX_BUFFER_M,MIN_BUFFER_M,buildCorridorPolygon,distanceM,midpointOnPath,normalizePath,simplifyPath,validateCorridorGeometry};
