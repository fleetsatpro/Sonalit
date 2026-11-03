'use strict';

const R = 6371008.8;
const MIN_BUFFER_M = 10;
const MAX_BUFFER_M = 5000;
const MAX_PATH_POINTS = 10000;
const MAX_RING_VALIDATION_COMPARISONS = 5000000;
const MAX_MITER_RATIO = 2.5;

function distanceM(a, b) {
  const p1 = Number(a[0]) * Math.PI / 180;
  const p2 = Number(b[0]) * Math.PI / 180;
  const dp = p2 - p1;
  const dl = (Number(b[1]) - Number(a[1])) * Math.PI / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
const MAX_INPUT_PATH_POINTS = 50000;
const MAX_SIMPLIFICATION_COMPARISONS = 5000000;
const MAX_SIMPLIFICATION_TOTAL_COMPARISONS = 25000000;
// This is an accuracy guard, not a vertex-count substitute. Long routes retain
// up to 10,000 centreline points before metre-bounded simplification is needed.
const MAX_SIMPLIFICATION_TOLERANCE_M = 100;

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
 * Keep routed centreline geometry bounded without truncating vertices or
 * replacing a road route with a straight line. Start at the requested error
 * tolerance, then widen it adaptively (never beyond 100 m) only when the
 * vertex/computation budget requires it. The actual tolerance and any
 * escalation are returned for operational provenance.
 */
function simplifyRawPath(raw, toleranceM, comparisonBudget) {
  const keep = new Uint8Array(raw.length);
  keep[0] = 1;
  keep[raw.length - 1] = 1;
  const stack = [[0, raw.length - 1]];
  let comparisons = 0;
  while (stack.length) {
    const [first, last] = stack.pop();
    if (last <= first + 1) continue;
    let farthest = -1;
    let farthestDistance = toleranceM;
    for (let i = first + 1; i < last; i++) {
      comparisons++;
      comparisonBudget.total++;
      if (comparisons > MAX_SIMPLIFICATION_COMPARISONS || comparisonBudget.total > MAX_SIMPLIFICATION_TOTAL_COMPARISONS) {
        const error = new RangeError('Route geometry is too complex to simplify within the safe computation budget.');
        error.code = 'SIMPLIFICATION_BUDGET_EXCEEDED';
        throw error;
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
  return raw.filter((_, index) => keep[index]);
}

function simplifyPath(path, toleranceM = 10, maxToleranceM = MAX_SIMPLIFICATION_TOLERANCE_M, options = {}) {
  if (!Array.isArray(path) || path.length < 2) throw new TypeError('A corridor needs at least two route points.');
  if (path.length > MAX_INPUT_PATH_POINTS) throw new RangeError('Route geometry exceeds the safe input vertex limit.');
  const simplifyOptions = options && typeof options === 'object' ? options : {};
  const forceSimplification = simplifyOptions.force === true;
  const requestedToleranceM = Number(toleranceM);
  const toleranceCeilingM = Number(maxToleranceM);
  if (!Number.isFinite(toleranceCeilingM) || toleranceCeilingM < 1 || toleranceCeilingM > MAX_SIMPLIFICATION_TOLERANCE_M) {
    throw new RangeError('Geometry simplification ceiling must be between 1 and ' + MAX_SIMPLIFICATION_TOLERANCE_M + ' metres.');
  }
  if (!Number.isFinite(requestedToleranceM) || requestedToleranceM < 1 || requestedToleranceM > toleranceCeilingM) {
    throw new RangeError('Requested geometry simplification tolerance must be between 1 and the configured ' + toleranceCeilingM + ' m ceiling.');
  }

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
  if (raw.length <= MAX_PATH_POINTS && !forceSimplification) {
    const normalized = normalizePath(raw);
    return {
      path: normalized,
      originalPointCount: raw.length,
      finalPointCount: normalized.length,
      toleranceM: 0,
      requestedToleranceM,
      toleranceEscalated: false,
      method: 'none',
    };
  }

  // Exponential search reaches the documented ceiling in at most eight
  // passes, even when callers choose the minimum 1 m requested tolerance.
  const candidates = [requestedToleranceM];
  while (candidates.length < 8 && candidates[candidates.length - 1] < toleranceCeilingM) {
    const previous = candidates[candidates.length - 1];
    const next = Math.min(toleranceCeilingM, previous * 2);
    if (next <= previous) break;
    candidates.push(next);
  }

  const comparisonBudget = simplifyOptions.comparisonBudget && Number.isFinite(simplifyOptions.comparisonBudget.total)
    ? simplifyOptions.comparisonBudget
    : { total: 0 };
  let lastUnsuccessfulToleranceM = requestedToleranceM;
  let lastFailure = 'vertex limit';
  for (const candidateToleranceM of candidates) {
    let reduced;
    try {
      reduced = simplifyRawPath(raw, candidateToleranceM, comparisonBudget);
    } catch (error) {
      if (error && error.code === 'SIMPLIFICATION_BUDGET_EXCEEDED') {
        lastUnsuccessfulToleranceM = candidateToleranceM;
        lastFailure = 'computation budget';
        continue;
      }
      throw error;
    }

    if (reduced.length > MAX_PATH_POINTS) {
      lastUnsuccessfulToleranceM = candidateToleranceM;
      lastFailure = 'vertex limit';
      continue;
    }

    // Refine the first passing tolerance twice. This avoids jumping straight
    // from (for example) 40 m to 80 m when a smaller bounded tolerance works.
    let chosenToleranceM = candidateToleranceM;
    let chosenPath = reduced;
    if (candidateToleranceM > requestedToleranceM) {
      let low = lastUnsuccessfulToleranceM;
      let high = candidateToleranceM;
      for (let attempt = 0; attempt < 2 && high - low > 1; attempt++) {
        const middle = (low + high) / 2;
        let trial;
        try {
          trial = simplifyRawPath(raw, middle, comparisonBudget);
        } catch (error) {
          if (error && error.code === 'SIMPLIFICATION_BUDGET_EXCEEDED') {
            low = middle;
            continue;
          }
          throw error;
        }
        if (trial.length <= MAX_PATH_POINTS) {
          high = middle;
          chosenToleranceM = middle;
          chosenPath = trial;
        } else {
          low = middle;
        }
      }
    }

    const normalized = normalizePath(chosenPath);
    const toleranceEscalated = chosenToleranceM > requestedToleranceM;
    return {
      path: normalized,
      originalPointCount: raw.length,
      finalPointCount: normalized.length,
      toleranceM: normalized.length < raw.length ? chosenToleranceM : 0,
      requestedToleranceM,
      toleranceEscalated,
      method: toleranceEscalated ? 'douglas-peucker-adaptive' : 'douglas-peucker',
    };
  }

  throw new RangeError(
    'Route geometry could not be reduced to ' + MAX_PATH_POINTS + ' or fewer vertices within the '
    + toleranceCeilingM + ' m configured simplification ceiling and safe computation budget '
    + '(' + lastFailure + '); no geofence was created.'
  );
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
/**
 * Validate the PostGIS-free route-centreline model. Segments are bounded to
 * 500 km because the operational point-to-segment distance uses an
 * equirectangular local projection that is not reliable for continent-scale
 * single segments. Road-routed OSRM paths naturally satisfy this bound; an
 * unexpectedly sparse or malformed route fails closed instead of creating a
 * false operational geofence.
 */
function validateCorridorPath(path, bufferM) {
  try {
    const buffer = Number(bufferM);
    if (!Number.isFinite(buffer) || buffer < MIN_BUFFER_M || buffer > MAX_BUFFER_M) {
      return { valid: false, reason: 'Invalid metre buffer.' };
    }
    if (!Array.isArray(path) || path.length < 2) {
      return { valid: false, reason: 'A corridor needs at least two route points.' };
    }
    const route = normalizePath(path);
    if (route.length !== path.length) {
      return { valid: false, reason: 'Route contains duplicate or collapsed segments.' };
    }
    for (let i = 0; i < route.length - 1; i++) {
      const lengthM = distanceM(route[i], route[i + 1]);
      if (!Number.isFinite(lengthM) || lengthM < 0.05) {
        return { valid: false, reason: 'Route contains an unmeasurable segment.' };
      }
      if (lengthM > 500000) {
        return { valid: false, reason: 'Route segment exceeds the 500 km safe distance-calculation limit.' };
      }
    }
    return { valid: true, pathPoints: route.length, bufferM: buffer, method: 'route-centreline-distance-v1' };
  } catch (error) {
    return { valid: false, reason: String(error && error.message || 'Invalid corridor centreline.') };
  }
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
  const boxEpsilon = 1e-6;
  // Reject disjoint segment bounds before orientation math. This also makes
  // sparse/large rings much cheaper to verify.
  if (Math.max(a[0], b[0]) < Math.min(c[0], d[0]) - boxEpsilon ||
      Math.max(c[0], d[0]) < Math.min(a[0], b[0]) - boxEpsilon ||
      Math.max(a[1], b[1]) < Math.min(c[1], d[1]) - boxEpsilon ||
      Math.max(c[1], d[1]) < Math.min(a[1], b[1]) - boxEpsilon) return false;
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
  // Sweep along the ring's longer bounding-box axis. The previous all-pairs
  // scan was O(n²), effectively forcing the corridor cap to ~800 vertices.
  // A bounded sweep only compares edges whose bounds overlap in both axes.
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  const segments=[];
  for(let i=0;i<count;i++) {
    const a=points[i], b=points[i+1];
    const segment={
      index:i, a, b,
      minX:Math.min(a[0],b[0]), maxX:Math.max(a[0],b[0]),
      minY:Math.min(a[1],b[1]), maxY:Math.max(a[1],b[1]),
    };
    minX=Math.min(minX,segment.minX); maxX=Math.max(maxX,segment.maxX);
    minY=Math.min(minY,segment.minY); maxY=Math.max(maxY,segment.maxY);
    segments.push(segment);
  }
  const sweepX=(maxX-minX)>=(maxY-minY);
  for(const segment of segments) {
    segment.sweepMin=sweepX?segment.minX:segment.minY;
    segment.sweepMax=sweepX?segment.maxX:segment.maxY;
    segment.crossMin=sweepX?segment.minY:segment.minX;
    segment.crossMax=sweepX?segment.maxY:segment.maxX;
  }
  segments.sort((a,b)=>a.sweepMin-b.sweepMin||a.sweepMax-b.sweepMax);
  let active=[], comparisons=0;
  const epsilon=1e-6;
  for(const segment of segments) {
    // Count active-set scans as work too, not only true candidate intersections.
    // This keeps pathological overlapping bounds from bypassing the CPU budget.
    const retained=[];
    for(const other of active) {
      if(++comparisons>MAX_RING_VALIDATION_COMPARISONS) {
        return {valid:false,reason:'Polygon exceeds the safe edge-intersection validation budget.'};
      }
      if(other.sweepMax>=segment.sweepMin-epsilon) retained.push(other);
    }
    active=retained;
    for(const other of active) {
      if(other.crossMax<segment.crossMin-epsilon||segment.crossMax<other.crossMin-epsilon) continue;
      const i=Math.min(segment.index,other.index), j=Math.max(segment.index,other.index);
      if(j===i+1||(i===0&&j===count-1)) continue;
      if(++comparisons>MAX_RING_VALIDATION_COMPARISONS) {
        return {valid:false,reason:'Polygon exceeds the safe edge-intersection validation budget.'};
      }
      if(intersects(segment.a,segment.b,other.a,other.b)) {
        return {valid:false,reason:'Polygon ring self-intersects.'};
      }
    }
    active.push(segment);
  }
  return {valid:true};
}
function pointInRingXY(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    const crosses = ((a[1] > point[1]) !== (b[1] > point[1])) &&
      (point[0] < (b[0] - a[0]) * (point[1] - a[1]) / ((b[1] - a[1]) || Number.EPSILON) + a[0]);
    if (crosses) inside = !inside;
  }
  return inside;
}

function validateCorridorGeometry(path, polygon, bufferM, options = {}) {
  try {
    const route=normalizePath(path), buffer=Number(bufferM);
    if(!Number.isFinite(buffer)||buffer<MIN_BUFFER_M||buffer>MAX_BUFFER_M) return {valid:false,reason:'Invalid metre buffer.'};
    const arbitraryBufferRing = options && typeof options.method === 'string' && options.method.startsWith('postgis-');
    if(!Array.isArray(polygon)||polygon.length<4||(!arbitraryBufferRing&&polygon.length!==2*route.length+1)) return {valid:false,reason:'Polygon vertex count does not match the centreline.'};
    const ring=polygon.map((p,i)=>{
      if(!Array.isArray(p)||p.length<2||!Number.isFinite(Number(p[0]))||!Number.isFinite(Number(p[1]))||Math.abs(Number(p[0]))>90||Math.abs(Number(p[1]))>180) throw new RangeError('Invalid polygon coordinate at index '+i+'.');
      return [Number(p[0]),Number(p[1])];
    });
    if(distanceM(ring[0],ring[ring.length-1])>1) return {valid:false,reason:'Polygon ring is not closed within one metre.'};
    const proj=projection(ring);
    proj.xy[proj.xy.length-1]=[...proj.xy[0]];
    if (arbitraryBufferRing) {
      // The database builder has already run ST_IsValid/GEOS against the full
      // geographic buffer. Do not run the local miter validator's single
      // equirectangular projection over a continent-scale exterior ring: that
      // projection can fold distant edges together and report a false
      // self-intersection. Recheck coordinate finiteness/closure above and
      // verify route coverage here; the SQL independently uses ST_Covers on
      // the complete, unsampled route before accepting the polygon.
      const unwrappedRing = unwrap(ring.slice(0, -1).map(point => [...point]));
      const meanLng = unwrappedRing.reduce((sum, point) => sum + point[1], 0) / unwrappedRing.length;
      const routeProjected = route.map(point => {
        let lng = point[1];
        lng += 360 * Math.round((meanLng - lng) / 360);
        return proj.toXY([point[0], lng]);
      });
      const stride = Math.max(1, Math.ceil(routeProjected.length / 512));
      for (let i = 0; i < routeProjected.length; i += stride) {
        if (!pointInRingXY(routeProjected[i], proj.xy)) {
          return {valid:false,reason:'Buffered polygon does not contain a sampled centreline point.'};
        }
      }
      if (!pointInRingXY(routeProjected[routeProjected.length - 1], proj.xy)) {
        return {valid:false,reason:'Buffered polygon does not contain the route endpoint.'};
      }
      return {valid:true,pathPoints:route.length,polygonPoints:ring.length,containsCenterline:true};
    }
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

// Recover from a mitered offset ring that crosses itself on tight bends or
// closely spaced road segments. Never drop route endpoints or exceed the
// buffer-relative deviation ceiling. Each retry is measured against the
// original routed centreline, not against a previously simplified derivative.
function buildCorridorGeometry(path, bufferM, requestedToleranceM = 10, maxToleranceM = MAX_SIMPLIFICATION_TOLERANCE_M) {
  const buffer = Number(bufferM);
  if (!Number.isFinite(buffer) || buffer < MIN_BUFFER_M || buffer > MAX_BUFFER_M) {
    throw new RangeError('Corridor buffer must be between 10 and 5000 metres.');
  }
  const ceiling = Math.min(Number(maxToleranceM), buffer / 3);
  const requested = Math.min(Number(requestedToleranceM), ceiling);
  if (!Number.isFinite(requested) || requested < 1 || !Number.isFinite(ceiling) || ceiling < requested) {
    throw new RangeError('Corridor recovery tolerance must be between 1 m and the buffer-relative ceiling.');
  }

  const initial = simplifyPath(path, requested, ceiling);
  let initialError;
  try {
    return {
      path: initial.path,
      polygon: buildCorridorPolygon(initial.path, buffer),
      simplification: initial,
      recoveryUsed: false,
      recoveryReason: null,
      bufferPolygonMethod: 'validated-miter-offset',
    };
  } catch (error) {
    if (!isRecoverableOffsetError(error)) throw error;
    initialError = error;
  }

  const candidates = [requested];
  while (candidates.length < 8 && candidates[candidates.length - 1] < ceiling) {
    const previous = candidates[candidates.length - 1];
    const next = Math.min(ceiling, previous * 2);
    if (next <= previous) break;
    candidates.push(next);
  }
  const comparisonBudget = { total: 0 };
  let lastError = initialError;
  let lastTriedToleranceM = initial.toleranceM || 0;

  for (const candidateToleranceM of candidates) {
    // The initial geometry already tried this tolerance (or a higher one).
    if (initial.toleranceM > 0 && candidateToleranceM <= initial.toleranceM) continue;
    let trial;
    try {
      trial = simplifyPath(path, candidateToleranceM, ceiling, {
        force: true,
        comparisonBudget,
      });
    } catch (error) {
      lastError = error;
      if (/computation budget/i.test(String(error.message || ''))) break;
      continue;
    }
    lastTriedToleranceM = Math.max(lastTriedToleranceM, trial.toleranceM || candidateToleranceM);
    if (trial.path.length >= initial.path.length &&
        trial.path.every((point, index) => point[0] === initial.path[index]?.[0] && point[1] === initial.path[index]?.[1])) {
      continue;
    }

    try {
      const polygon = buildCorridorPolygon(trial.path, buffer);
      const actualToleranceM = trial.toleranceM || 0;
      const recoveredSimplification = {
        ...trial,
        requestedToleranceM: requested,
        toleranceEscalated: actualToleranceM > requested,
        method: actualToleranceM > requested
          ? 'douglas-peucker-adaptive-corridor-recovery'
          : actualToleranceM > 0
            ? 'douglas-peucker-corridor-recovery'
            : 'none',
      };
      return {
        path: trial.path,
        polygon,
        simplification: recoveredSimplification,
        recoveryUsed: true,
        recoveryReason: initialError.message,
        bufferPolygonMethod: 'validated-miter-offset-recovered',
      };
    } catch (error) {
      lastError = error;
      if (!isRecoverableOffsetError(error)) throw error;
    }
  }

  throw new RangeError(
    'Corridor polygon remains invalid after bounded route simplification up to '
    + Math.min(ceiling, Math.max(lastTriedToleranceM, requested)).toFixed(1)
    + ' m; no geofence was created. Last geometry error: '
    + String(lastError && lastError.message || initialError.message)
  );
}

function isRecoverableOffsetError(error) {
  return /polygon ring self-intersects|route reverses direction too sharply|corridor miter is numerically unstable|polygon offset is inconsistent/i
    .test(String(error && error.message || ''));
}

module.exports={MAX_PATH_POINTS,MAX_SIMPLIFICATION_TOLERANCE_M,MAX_BUFFER_M,MIN_BUFFER_M,buildCorridorGeometry,buildCorridorPolygon,distanceM,midpointOnPath,normalizePath,simplifyPath,validateCorridorGeometry,validateCorridorPath};
