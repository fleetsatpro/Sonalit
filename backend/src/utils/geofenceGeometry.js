'use strict';
function orientation(a,b,c){return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);}
function onSegment(a,b,p,eps=1e-10){return Math.abs(orientation(a,b,p))<=eps&&p[0]>=Math.min(a[0],b[0])-eps&&p[0]<=Math.max(a[0],b[0])+eps&&p[1]>=Math.min(a[1],b[1])-eps&&p[1]<=Math.max(a[1],b[1])+eps;}
function intersects(a,b,c,d){const o1=orientation(a,b,c),o2=orientation(a,b,d),o3=orientation(c,d,a),o4=orientation(c,d,b);if(((o1>1e-10&&o2< -1e-10)||(o1< -1e-10&&o2>1e-10))&&((o3>1e-10&&o4< -1e-10)||(o3< -1e-10&&o4>1e-10)))return true;return onSegment(a,b,c)||onSegment(a,b,d)||onSegment(c,d,a)||onSegment(c,d,b);}
function normalizePolygonGeometry(input){
 const geometry=input?.type==='Feature'?input.geometry:input;
 if(!geometry||geometry.type!=='Polygon'||!Array.isArray(geometry.coordinates)||geometry.coordinates.length===0)throw new Error('Provide a GeoJSON Polygon with one outer boundary.');
 if(geometry.coordinates.length!==1)throw new Error('Polygon holes are not supported; draw one outer boundary.');
 const raw=geometry.coordinates[0];
 if(!Array.isArray(raw)||raw.length<3||raw.length>501)throw new Error('A polygon requires 3 to 500 vertices.');
 const vertices=raw.map((point,index)=>{
  if(!Array.isArray(point)||point.length<2||typeof point[0]!=='number'||typeof point[1]!=='number'||!Number.isFinite(point[0])||!Number.isFinite(point[1]))throw new Error('Invalid numeric polygon coordinate at vertex '+(index+1)+'.');
  const [lng,lat]=point;
  if(Math.abs(lng)>180||Math.abs(lat)>85)throw new Error('Polygon coordinates must be within longitude ±180° and latitude ±85°.');
  return [lng,lat];
 });
 if(vertices.length>1&&vertices[0][0]===vertices[vertices.length-1][0]&&vertices[0][1]===vertices[vertices.length-1][1])vertices.pop();
 if(vertices.length<3||vertices.length>500)throw new Error('A polygon requires 3 to 500 distinct boundary vertices.');
 if(new Set(vertices.map(([lng,lat])=>lng.toFixed(8)+','+lat.toFixed(8))).size<3)throw new Error('A polygon requires 3 distinct vertices.');
 for(let i=0;i<vertices.length;i++){const a=vertices[i],b=vertices[(i+1)%vertices.length];for(let j=i+1;j<vertices.length;j++){if(j===i+1||(i===0&&j===vertices.length-1))continue;if(intersects(a,b,vertices[j],vertices[(j+1)%vertices.length]))throw new Error('Polygon boundary self-intersects; no geofence was saved.');}}
 let twiceArea=0;for(let i=0;i<vertices.length;i++){const a=vertices[i],b=vertices[(i+1)%vertices.length];twiceArea+=a[0]*b[1]-b[0]*a[1];}
 if(Math.abs(twiceArea)<1e-10)throw new Error('Polygon area is zero or its vertices are collinear.');
 const ring=vertices.map(([lng,lat])=>[lng,lat]);ring.push([...ring[0]]);
 return {type:'Polygon',coordinates:[ring]};
}
module.exports={normalizePolygonGeometry};
