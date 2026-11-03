'use strict';
const {normalizePolygonGeometry}=require('../src/utils/geofenceGeometry');
describe('canonical geofence polygon geometry',()=>{
 const valid={type:'Polygon',coordinates:[[[36.7,-1.3],[36.9,-1.3],[36.9,-1.45],[36.7,-1.45]]]};
 test('normalizes an open GeoJSON ring to a closed polygon',()=>{const g=normalizePolygonGeometry(valid);expect(g.type).toBe('Polygon');expect(g.coordinates[0]).toHaveLength(5);expect(g.coordinates[0][0]).toEqual(g.coordinates[0][4]);});
 test('accepts a GeoJSON Feature and rejects malformed or unsafe coordinates',()=>{
  expect(normalizePolygonGeometry({type:'Feature',geometry:valid}).coordinates[0]).toHaveLength(5);
  expect(()=>normalizePolygonGeometry({type:'Polygon',coordinates:[]})).toThrow(/GeoJSON Polygon/);
  expect(()=>normalizePolygonGeometry({type:'Polygon',coordinates:[[[181,0],[0,1],[0,0]]]})).toThrow(/longitude/);
  expect(()=>normalizePolygonGeometry({type:'Polygon',coordinates:[[[0,0],[1,1],[0,1],[1,0],[0,0]]]})).toThrow(/self-intersects/);
  expect(()=>normalizePolygonGeometry({type:'Polygon',coordinates:[[[0,0],[1,1],[2,2]]]})).toThrow(/collinear/);
 });
 test('rejects holes instead of silently ignoring them',()=>{expect(()=>normalizePolygonGeometry({type:'Polygon',coordinates:[valid.coordinates[0],[[36.75,-1.32],[36.8,-1.32],[36.8,-1.38],[36.75,-1.32]]]})).toThrow(/holes are not supported/);});
});
