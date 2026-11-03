export type LatLngPoint = [number, number];
function orientation(a: LatLngPoint, b: LatLngPoint, c: LatLngPoint): number {
  return (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
}
function onSegment(a: LatLngPoint, b: LatLngPoint, p: LatLngPoint, eps = 1e-10): boolean {
  return Math.abs(orientation(a, b, p)) <= eps
    && p[1] >= Math.min(a[1], b[1]) - eps && p[1] <= Math.max(a[1], b[1]) + eps
    && p[0] >= Math.min(a[0], b[0]) - eps && p[0] <= Math.max(a[0], b[0]) + eps;
}
function intersects(a: LatLngPoint, b: LatLngPoint, c: LatLngPoint, d: LatLngPoint): boolean {
  const o1=orientation(a,b,c),o2=orientation(a,b,d),o3=orientation(c,d,a),o4=orientation(c,d,b);
  if (((o1>1e-10&&o2< -1e-10)||(o1< -1e-10&&o2>1e-10))&&((o3>1e-10&&o4< -1e-10)||(o3< -1e-10&&o4>1e-10))) return true;
  return onSegment(a,b,c)||onSegment(a,b,d)||onSegment(c,d,a)||onSegment(c,d,b);
}
function openVertices(points: readonly LatLngPoint[]): LatLngPoint[] {
  const copy=points.map(([lat,lng])=>[lat,lng] as LatLngPoint);
  if(copy.length>1&&copy[0]![0]===copy[copy.length-1]![0]&&copy[0]![1]===copy[copy.length-1]![1])copy.pop();
  return copy;
}
export function polygonValidationError(points: readonly LatLngPoint[]): string | null {
  const vertices=openVertices(points);
  if(vertices.length<3)return 'Add at least 3 vertices to define an area.';
  if(vertices.length>500)return 'An area can contain at most 500 vertices.';
  if(vertices.some(([lat,lng])=>!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>85||Math.abs(lng)>180))return 'One or more vertices are outside the supported map bounds.';
  if(new Set(vertices.map(([lat,lng])=>lat.toFixed(8)+','+lng.toFixed(8))).size<3)return 'Place 3 distinct vertices.';
  for(let i=0;i<vertices.length;i++){const a=vertices[i]!,b=vertices[(i+1)%vertices.length]!;for(let j=i+1;j<vertices.length;j++){if(j===i+1||(i===0&&j===vertices.length-1))continue;if(intersects(a,b,vertices[j]!,vertices[(j+1)%vertices.length]!))return 'The boundary crosses itself. Move the vertices so edges do not intersect.';}}
  let twiceArea=0;for(let i=0;i<vertices.length;i++){const a=vertices[i]!,b=vertices[(i+1)%vertices.length]!;twiceArea+=a[1]*b[0]-b[1]*a[0];}
  if(Math.abs(twiceArea)<1e-10)return 'The area is too small or its vertices are collinear.';
  return null;
}
export function closedLatLngRing(points: readonly LatLngPoint[]): LatLngPoint[] {
  const ring=openVertices(points);if(ring.length)ring.push([ring[0]![0],ring[0]![1]]);return ring;
}
export function toGeoJsonPolygon(points: readonly LatLngPoint[]): {type:'Polygon';coordinates:number[][][]} {
  return {type:'Polygon',coordinates:[closedLatLngRing(points).map(([lat,lng])=>[lng,lat])]};
}
export function polygonAreaM2(points: readonly LatLngPoint[]): number {
  const vertices=openVertices(points);if(vertices.length<3)return 0;const radius=6371008.8;
  const meanLat=vertices.reduce((sum,p)=>sum+p[0],0)/vertices.length*Math.PI/180;
  const xy=vertices.map(([lat,lng])=>[radius*lng*Math.PI/180*Math.cos(meanLat),radius*lat*Math.PI/180] as const);
  let twiceArea=0;for(let i=0;i<xy.length;i++){const a=xy[i]!,b=xy[(i+1)%xy.length]!;twiceArea+=a[0]*b[1]-b[0]*a[1];}
  return Math.abs(twiceArea)/2;
}
export function formatArea(areaM2:number):string {
  if(!Number.isFinite(areaM2)||areaM2<=0)return '—';
  if(areaM2>=1_000_000)return (areaM2/1_000_000).toFixed(2)+' km²';
  if(areaM2>=10_000)return (areaM2/10_000).toFixed(1)+' ha';
  return Math.round(areaM2).toLocaleString()+' m²';
}
