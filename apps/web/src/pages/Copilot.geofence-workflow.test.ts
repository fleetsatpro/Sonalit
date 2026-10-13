import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const copilot = readFileSync(new URL('./Copilot.tsx', import.meta.url), 'utf8');
const geofenceIntent = readFileSync(new URL('../lib/geofenceIntent.ts', import.meta.url), 'utf8');
const geofencesPage = readFileSync(new URL('./Geofences.tsx', import.meta.url), 'utf8');
const mapRenderer = readFileSync(new URL('../components/geofences/useGeofenceMap.ts', import.meta.url), 'utf8');
const fleetMap = readFileSync(new URL('../features/live-fleet/components/FleetMap.tsx', import.meta.url), 'utf8');
const tacticalMap = readFileSync(new URL('../components/dashboard/TacticalMap.tsx', import.meta.url), 'utf8');
const serverCreate = readFileSync(new URL('../../../../backend/src/routes/geofences.js', import.meta.url), 'utf8');
const aiRoutes = readFileSync(new URL('../../../../backend/src/routes/ai.js', import.meta.url), 'utf8');
const autoGeometry = readFileSync(new URL('../../../../backend/src/utils/geofenceAutoGeometry.js', import.meta.url), 'utf8');
const mapResponse = readFileSync(new URL('../../../../backend/src/routes/dashboard.js', import.meta.url), 'utf8');

describe('Copilot geofence end-to-end geometry contract', () => {
  it('creates canonical GeoJSON polygons rather than the legacy raw-array/both shape', () => {
    expect(copilot).toContain("type: 'polygon'");
    expect(copilot).toContain('coordinates: toGeoJsonPolygon(points)');
    expect(copilot).not.toContain("type: 'both'");
    expect(copilot).toContain('polygonValidationError(points)');
    expect(copilot).toContain('setMapReady(true)');
    expect(copilot).toContain('shouldOpenManualPolygonDrawing(text)');
    expect(copilot).toContain("queryClient.invalidateQueries({ queryKey: ['geofence-map-data'] })");
    expect(copilot).not.toContain("if (/draw.*(geofence|zone|area)|create.*(geofence|zone)/i.test(input)) setShowDraw(true)");
    expect(geofenceIntent).toContain('export function shouldOpenManualPolygonDrawing');
    expect(geofenceIntent).toContain('if (explicitlyManual) return true');
    expect(copilot).toContain("api.post<DecisionResponse>('/ai/dispatch'");
    expect(copilot).toContain('request_id: crypto.randomUUID()');
    expect(copilot).not.toContain('const isAction =');
    expect(aiRoutes).toContain('inferGeofenceTask(command)');
    expect(aiRoutes).toContain('shape === \'polygon\' || shape === \'boundary\'');
    expect(aiRoutes).toContain('normalizePolygonGeometry(persisted)');
    expect(autoGeometry).toContain('createRadiusPolygon');
    expect(autoGeometry).toContain('normalizeBoundaryGeometry');
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
  it('keeps corridor overlays visible after satellite style reload and attaches evidence-derived signal bands', () => {
    expect(mapRenderer).toContain("map.on('style.load', redrawAfterStyleLoad)");
    expect(mapRenderer).toContain('gf-corridor-signal-glow');
    expect(mapRenderer).toContain("['max', 7");
    expect(mapRenderer).toContain('renderRef.current?.()');
    expect(geofencesPage).toContain('buildCorridorSignalOverlay');
    expect(geofencesPage).toContain("layers: ['weather', 'traffic', 'hazards', 'security', 'incidents', 'alerts']");
    expect(geofencesPage).toContain('Signal bands show proximity to sourced observations');
    expect(geofencesPage).toContain('coverage is not proof of clear roads');
    expect(fleetMap).toContain('gf-signal-glow');
    expect(fleetMap).toContain('worldContextEntities(worldContext)');
    expect(tacticalMap).toContain('sv-geofence-signal-glow');
    expect(tacticalMap).toContain("layers: ['weather', 'traffic', 'hazards', 'security', 'incidents', 'alerts']");
    expect(tacticalMap).toContain('setCorridorSignalData(map, corridorSignalOverlayRef.current)');
  });

});
