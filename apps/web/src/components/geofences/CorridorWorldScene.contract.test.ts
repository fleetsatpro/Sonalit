import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./CorridorWorldScene.tsx', import.meta.url), 'utf8');

describe('GEV 3D render resilience contract', () => {
  it('uses a real 3D provider hierarchy before falling back to raster imagery', () => {
    expect(source).toContain("const GOOGLE_KEY = (import.meta.env['VITE_GOOGLE_MAPS_API_KEY'] as string | undefined)?.trim() ?? ''");
    expect(source).toContain('createGooglePhotorealistic3DTileset');
    expect(source).toContain("Cesium.RequestScheduler.requestsByServer['tile.googleapis.com:443'] = 18");
    expect(source).toContain('showCreditsOnScreen: true');
    expect(source).toContain('viewer.scene.globe.show = false');
    expect(source).toContain('createWorldImageryAsync');
    expect(source).toContain('IonWorldImageryStyle.AERIAL');
    expect(source).toContain('createWorldTerrainAsync({ requestVertexNormals: true, requestWaterMask: true })');
    expect(source).toContain('createOsmBuildingsAsync');
    expect(source).toContain("ESRI 3D FALLBACK · NO HIGH-FIDELITY TOKEN");
  });

  it('keeps a non-Ion Esri surface and recovers Cesium after render exceptions', () => {
    expect(source).toContain("const STREET_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'");
    expect(source).toContain("const SATELLITE_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'");
    expect(source).toContain('failIfMajorPerformanceCaveat: false');
    expect(source).toContain('viewer.scene.renderError.addEventListener(renderErrorHandler)');
    expect(source).toContain('viewer.useDefaultRenderLoop = true');
    expect(source).toContain('viewer.scene.renderError.removeEventListener(renderErrorHandler)');
  });
});
