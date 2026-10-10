import { describe, expect, it } from 'vitest';
import { shouldOpenManualPolygonDrawing } from './geofenceIntent.js';

describe('Copilot geofence intent routing', () => {
  it('opens the manual editor for bare drawing requests that have no location', () => {
    expect(shouldOpenManualPolygonDrawing('Draw a geofence')).toBe(true);
    expect(shouldOpenManualPolygonDrawing('Create a zone')).toBe(true);
    expect(shouldOpenManualPolygonDrawing('Sketch a boundary on the map')).toBe(true);
  });

  it('routes named-place and route requests to the deterministic executor', () => {
    expect(shouldOpenManualPolygonDrawing('Draw a high-precision geofence around Nairobi')).toBe(false);
    expect(shouldOpenManualPolygonDrawing('Create a corridor geofence from Nairobi to Mombasa with 500m buffer')).toBe(false);
    expect(shouldOpenManualPolygonDrawing('Create a 2km geofence at -1.2864, 36.8172')).toBe(false);
  });

  it('opens the editor for explicitly custom polygon requests even when a place is named', () => {
    expect(shouldOpenManualPolygonDrawing('Draw a polygon boundary around Nairobi')).toBe(true);
    expect(shouldOpenManualPolygonDrawing('Create a custom area around the depot')).toBe(true);
  });

  it('does not trigger on normal questions', () => {
    expect(shouldOpenManualPolygonDrawing('Show me the geofences near Nairobi')).toBe(false);
    expect(shouldOpenManualPolygonDrawing('Which zone has the most alerts?')).toBe(false);
  });
});
