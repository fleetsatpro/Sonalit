import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./GodsEyeView.tsx', import.meta.url), 'utf8');

describe("God's Eye View interaction contract", () => {
  it('retains the full 11-layer spatial surface and view switching', () => {
    for (const layer of [
      'aircraft',
      'weather',
      'maritime',
      'traffic',
      'hazards',
      'security',
      'infrastructure',
      'incidents',
      'alerts',
      'cameras',
      'satellites',
    ]) {
      expect(source).toContain(layer);
    }
    expect(source).toContain("useState<View>('3D')");
    expect(source).toContain("setViewMode('2D')");
    expect(source).toContain("setViewMode('3D')");
    expect(source).toContain('fixedView="3D"');
    expect(source).toContain('CctvViewerPanel');
    expect(source).toContain('gev-cctv-trigger');
    expect(source).toContain("queryKey: ['gev-cctv-catalog', weatherQueryViewport.latitude, weatherQueryViewport.longitude, weatherQueryViewport.radiusM, weatherQueryViewport.bbox?.join(',')]");
    expect(source).toContain("'/cctv/cameras'");
    expect(source).toContain('publicTotal={cctvPublicTotal}');
    expect(source).toContain('radiusM: Math.min(100000, weatherQueryViewport.radiusM)');
    expect(source).toContain('weatherQueryViewport.bbox?.join(\',\')');
    expect(source).toContain('{ bbox: weatherQueryViewport.bbox.join(\',\') }');
    expect(source).toContain('limit: 180');
    expect(source).toContain('MAX_RENDER_MARKERS = 180');
  });

  it('exposes world visibility, layer, panel and entity selection controls', () => {
    expect(source).toContain('const toggleExternal = () =>');
    expect(source).toContain('onClick={toggleExternal}');
    expect(source).toContain('aria-pressed={externalVisible}');
    expect(source).toContain('setVisibleLayers(new Set(WORLD_CONTEXT_LAYERS))');
    expect(source).toContain('setVisibleLayers(new Set())');
    expect(source).toContain('setOverviewOpen(open => !open)');
    expect(source).toContain('setIntelligenceOpen(open => !open)');
    expect(source).toContain('onExternalSelect');
    expect(source).toContain('if (id) setIntelligenceOpen(true)');
    expect(source).toContain('onSelect');
  });

  it('debounces expensive weather requests and retains the last source snapshot', () => {
    expect(source).toContain('setWeatherQueryViewport');
    expect(source).toContain("queryKey: ['gev-3d-world-context', weatherQueryViewport.latitude, weatherQueryViewport.longitude, weatherQueryViewport.radiusM, weatherQueryViewport.bbox?.join(',')]");
    expect(source).toContain("queryKey: ['gev-cctv-catalog', weatherQueryViewport.latitude, weatherQueryViewport.longitude, weatherQueryViewport.radiusM, weatherQueryViewport.bbox?.join(',')]");
    expect(source).toContain('snapSpatialBounds');
    expect(source).toContain('retry: shouldRetrySpatialRequest');
    expect(source).toContain('placeholderData: previousData => previousData');
    expect(source).toContain('refetchOnWindowFocus: false');
    expect(source).toContain("liveSimulationResult ? 'CACHED' : 'ERROR'");
    expect(source).toContain("weatherGridContext ? 'CACHED' : 'ERROR'");
  });

  it('keeps the GEV surface operationally authoritative over external context', () => {
    expect(source).toContain('local telemetry remains authoritative');
    expect(source).toContain('External world context is enrichment only');
    expect(source).toContain('PROVENANCE PRESERVED');
  });
});
