import { describe, expect, it } from 'vitest';
import { closedLatLngRing, formatArea, polygonAreaM2, polygonValidationError, toGeoJsonPolygon } from './geofenceGeometry.js';
describe('geofence polygon authoring contract',()=>{
 const valid:[number,number][]=[[-1.3,36.7],[-1.3,36.9],[-1.45,36.9],[-1.45,36.7]];
 it('exports a closed GeoJSON ring in [longitude, latitude] order',()=>{
  expect(polygonValidationError(valid)).toBeNull();const polygon=toGeoJsonPolygon(valid);
  expect(polygon.type).toBe('Polygon');expect(polygon.coordinates[0]).toHaveLength(5);
  expect(polygon.coordinates[0][0]).toEqual([36.7,-1.3]);expect(polygon.coordinates[0][4]).toEqual([36.7,-1.3]);
 });
 it('rejects too few, out-of-bounds, degenerate and self-crossing polygons',()=>{
  expect(polygonValidationError([[0,0],[1,1]])).toContain('3 vertices');
  expect(polygonValidationError([[0,0],[0,1],[91,2]])).toContain('bounds');
  expect(polygonValidationError([[0,0],[0,1],[0,2]])).toContain('collinear');
  expect(polygonValidationError([[0,0],[1,1],[0,1],[1,0]])).toContain('crosses itself');
 });
 it('computes useful approximate area and formats it',()=>{
  expect(polygonAreaM2(valid)).toBeGreaterThan(100000);expect(formatArea(polygonAreaM2(valid))).toMatch(/ha|km²/);expect(closedLatLngRing(valid)).toHaveLength(5);
 });
});
