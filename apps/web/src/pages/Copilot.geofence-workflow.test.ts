import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const copilot = readFileSync(new URL('./Copilot.tsx', import.meta.url), 'utf8');
const geofencesPage = readFileSync(new URL('./Geofences.tsx', import.meta.url), 'utf8');
const mapRenderer = readFileSync(new URL('../components/geofences/useGeofenceMap.ts', import.meta.url), 'utf8');
const serverCreate = readFileSync(new URL('../../../../backend/src/routes/geofences.js', import.meta.url), 'utf8');
const mapResponse = readFileSync(new URL('../../../../backend/src/routes/dashboard.js', import.meta.url), 'utf8');

describe('Copilot geofence end-to-end geometry contract', () => {
  it('creates canonical GeoJSON polygons rather than the legacy raw-array/both shape', () => {
    expect(copilot).toContain("type: 'polygon'");
    expect(copilot).toContain('coordinates: toGeoJsonPolygon(points)');
    expect(copilot).not.toContain("type: 'both'");
    expect(copilot).toContain('polygonValidationError(points)');
    expect(copilot).toContain('setMapReady(true)');
  });

  it('keeps polygon drawing preview and the persisted map rendering path aligned', () => {
    expect(geofencesPage).toContain("drawMode === 'polygon'");
    expect(geofencesPage).toContain('coordinates: toGeoJsonPolygon(drawPath)');
    expect(mapRenderer).toContain("g.type === 'polygon' || g.polygon");
    expect(mapRenderer).toContain("id: 'gf-polygon-fill'");
    expect(mapRenderer).toContain("id: 'gf-draw-vertices'");
  });

  it('validates before database write and returns the whole stored boundary', () => {
    expect(serverCreate).toContain('normalizePolygonGeometry(coordinates)');
    expect(serverCreate).toContain("error: 'invalid_polygon'");
    expect(mapResponse).toContain("type: 'polygon'");
    expect(mapResponse).toContain('polygon: ring');
  });
});
