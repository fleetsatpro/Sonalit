import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./CorridorWorldScene.tsx', import.meta.url), 'utf8');

describe('GEV 3D render resilience contract', () => {
  it('keeps a non-Ion Esri surface and recovers Cesium after render exceptions', () => {
    expect(source).toContain("const STREET_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'");
    expect(source).toContain("const SATELLITE_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'");
    expect(source).toContain('failIfMajorPerformanceCaveat: false');
    expect(source).toContain('viewer.scene.renderError.addEventListener(renderErrorHandler)');
    expect(source).toContain('viewer.useDefaultRenderLoop = true');
    expect(source).toContain('viewer.scene.renderError.removeEventListener(renderErrorHandler)');
  });
});
