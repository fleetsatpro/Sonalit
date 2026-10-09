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
module.exports={MAX_PATH_POINTS,MAX_BUFFER_M,MIN_BUFFER_M,buildCorridorPolygon,distanceM,normalizePath,validateCorridorGeometry};
