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
    expect(source).toContain('onSelect');
  });

  it('keeps the GEV surface operationally authoritative over external context', () => {
    expect(source).toContain('local telemetry remains authoritative');
    expect(source).toContain('External world context is enrichment only');
    expect(source).toContain('PROVENANCE PRESERVED');
  });
});
