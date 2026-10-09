import { describe, expect, it, test } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./CorridorWorldScene.tsx', import.meta.url), 'utf8');

describe('GEV 3D render resilience contract', () => {
  it('uses a real 3D provider hierarchy before falling back to raster imagery', () => {
    expect(source).toContain("const GOOGLE_KEY = (import.meta.env['VITE_GOOGLE_MAPS_API_KEY'] as string | undefined)?.trim() ?? ''");
    expect(source).toContain('PHOTOREALISTIC_ION_ASSET_ID = 2275207');
    expect(source).toContain('Cesium.Cesium3DTileset.fromIonAssetId(PHOTOREALISTIC_ION_ASSET_ID');
    expect(source).toContain('applyPhotorealisticQuality(tileset, highFidelity)');
    expect(source).toContain("Cesium.RequestScheduler.requestsByServer['tile.googleapis.com:443'] = 18");
    expect(source).toContain('showCreditsOnScreen: true');
    expect(source).toContain('tileset.maximumScreenSpaceError = highFidelity ? 1.5 : 2.25');
    expect(source).toContain('tileset.cacheBytes = highFidelity ? 384 * 1024 * 1024 : 192 * 1024 * 1024');
    expect(source).toContain('tileset.foveatedScreenSpaceError = true');
    expect(source).toContain('tileset.enableCollision = true');
    expect(source).toContain('viewer.scene.globe.show = false');
    expect(source).toContain('createWorldImageryAsync');
    expect(source).toContain('IonWorldImageryStyle.AERIAL');
    expect(source).toContain('createWorldTerrainAsync({ requestVertexNormals: true, requestWaterMask: true })');
    expect(source).toContain('createOsmBuildingsAsync');
    expect(source).toContain("disabled={surfaceQuality === 'photorealistic'}");
    expect(source).toContain("ESRI RASTER FALLBACK · NO HIGH-FIDELITY CREDENTIAL");
    expect(source).toContain('baseLayer: false');
    expect(source).toContain('function createWorldViewer(container: HTMLDivElement, antialias: boolean, requestWebgl1 = false)');
    expect(source).toContain('requestWebgl1,');
    expect(source).toContain('webgl1CompatibilityMode = true');
    expect(source).toContain('createWorldViewer(boxRef.current, false, true)');
    expect(source).toContain('webgl1CompatibilityMode ? 2 : (contextSafeMode ? Math.min(4, msaaTarget) : msaaTarget)');
    expect(source).toContain("powerPreference: 'high-performance'");
    expect(source).toContain('const pixelBudget = compactSurface');
    expect(source).toContain('const resolutionScale = Math.min(1, Math.sqrt(pixelBudget / Math.max(1, nativePixels)))');
    expect(source).toContain('vehicleRenderPulseTimerRef');
    expect(source).toContain('startVehicleRenderPulseRef');
    expect(source).toContain('runAnimations: selected');
    expect(source).toContain('const isCamera');
    expect(source).toContain('cameraSvg(color, selected)');
    expect(source).toContain('Math.sqrt(pixelBudget / Math.max(1, nativePixels))');
    expect(source).toContain('viewer.resolutionScale = resolutionScale');
    expect(source).toContain("surfaceQualityRef.current === 'loading'");
    expect(source).toContain('let terrainLoaded = false');
    expect(source).toContain('let buildingsLoaded = false');
    expect(source).toContain('if (!imageryLoaded)');
    expect(source).toContain('CESIUM WORLD TERRAIN · ESRI AERIAL FALLBACK + 3D BUILDINGS');

    expect(source).toContain('tileset.cullRequestsWhileMoving = true');
    expect(source).toContain('tileset.preferLeaves = false');

    expect(source).toContain('contextSafeMode = true');
    expect(source).toContain('createWorldViewer(boxRef.current, false, false)');
    expect(source).toContain('tileset.preloadAncestors = true');
    expect(source).toContain('tileset.preloadSiblings = false');
    expect(source).toContain('tileset.preloadFlightDestinations = false');
    expect(source).toContain('tileset.skipLevelOfDetail = true');
    expect(source).toContain('tileset.skipScreenSpaceErrorFactor = 16');
  });

  it('keeps a non-Ion Esri surface and recovers Cesium after render exceptions', () => {
    expect(source).toContain("const STREET_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'");
    expect(source).toContain("const SATELLITE_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'");
    expect(source).toContain('failIfMajorPerformanceCaveat: false');
    expect(source).toContain('showRenderLoopErrors: false');
    expect(source).toContain('viewer.scene.renderError.addEventListener(renderErrorHandler)');
    expect(source).not.toContain('viewer.useDefaultRenderLoop = true');
    expect(source).toContain('viewer.scene.renderError.removeEventListener(renderErrorHandler)');
  });
});



test('exposes the visible camera bounding box for global CCTV coverage', () => {
  const source = fs.readFileSync(path.resolve(__dirname, 'CorridorWorldScene.tsx'), 'utf8');
  expect(source).toContain('function cameraViewport(viewer: Cesium.Viewer)');
  expect(source).toContain('bbox: [');
  expect(source).toContain('if (east <= west)');
});
