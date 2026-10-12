import { describe, expect, it } from 'vitest';
import { shouldOpenManualPolygonDrawing } from './geofenceIntent.js';

describe('Copilot geofence intent routing', () => {
  it('opens the manual editor when a drawing request lacks a geographic anchor', () => {
    expect(shouldOpenManualPolygonDrawing('Draw a geofence')).toBe(true);
    expect(shouldOpenManualPolygonDrawing('Create a zone')).toBe(true);
    expect(shouldOpenManualPolygonDrawing('Sketch a boundary on the map')).toBe(true);
    expect(shouldOpenManualPolygonDrawing('Draw a polygon')).toBe(true);
  });

  it('routes anchored named-place and route requests to autonomous execution', () => {
    expect(shouldOpenManualPolygonDrawing('Draw a high-precision geofence around Nairobi')).toBe(false);
    expect(shouldOpenManualPolygonDrawing('Create a corridor geofence from Nairobi to Mombasa with 500m buffer')).toBe(false);
    expect(shouldOpenManualPolygonDrawing('Create a 2km geofence at -1.2864, 36.8172')).toBe(false);
    expect(shouldOpenManualPolygonDrawing('Draw a polygon boundary around Nairobi')).toBe(false);
    expect(shouldOpenManualPolygonDrawing('Create a custom area around the depot')).toBe(false);
    expect(shouldOpenManualPolygonDrawing('Create an administrative boundary geofence around Nairobi')).toBe(false);
  });

  it('keeps explicit manual drawing requests on the interactive editor', () => {
    expect(shouldOpenManualPolygonDrawing('Manually draw a polygon around Nairobi')).toBe(true);
    expect(shouldOpenManualPolygonDrawing('Open the drawing editor so I can place the vertices')).toBe(true);
    expect(shouldOpenManualPolygonDrawing('Click the map to sketch the boundary')).toBe(true);
  });

  it('does not trigger on normal questions', () => {
    expect(shouldOpenManualPolygonDrawing('Show me the geofences near Nairobi')).toBe(false);
    expect(shouldOpenManualPolygonDrawing('Which zone has the most alerts?')).toBe(false);
  });
});
