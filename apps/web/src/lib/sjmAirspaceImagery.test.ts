import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SJM_AIRSPACE_TILE_URL,
  resolveSjmAirspaceImagery,
} from './sjmAirspaceImagery.js';

describe('SJM airspace imagery configuration', () => {
  it('uses the attributed public OSM raster fallback when no dedicated source is configured', () => {
    expect(resolveSjmAirspaceImagery({})).toMatchObject({
      provider: 'openstreetmap',
      template: DEFAULT_SJM_AIRSPACE_TILE_URL,
      attribution: '© OpenStreetMap contributors',
      attributionUrl: 'https://www.openstreetmap.org/copyright',
      fallbackReason: 'not_configured',
    });
  });

  it('accepts an HTTPS XYZ raster source with an explicit visible attribution', () => {
    expect(resolveSjmAirspaceImagery({
      VITE_SJM_AIRSPACE_TILE_URL: 'https://tiles.example.net/airspace/{z}/{x}/{y}.png',
      VITE_SJM_AIRSPACE_TILE_ATTRIBUTION: '© Example mapping data',
      VITE_SJM_AIRSPACE_TILE_ATTRIBUTION_URL: 'https://example.net/terms',
      VITE_SJM_AIRSPACE_TILE_MAX_ZOOM: '17',
    })).toMatchObject({
      provider: 'custom',
      template: 'https://tiles.example.net/airspace/{z}/{x}/{y}.png',
      attribution: '© Example mapping data',
      attributionUrl: 'https://example.net/terms',
      maximumLevel: 17,
      fallbackReason: null,
    });
  });

  it.each([
    [{ VITE_SJM_AIRSPACE_TILE_URL: 'http://tiles.example.net/{z}/{x}/{y}.png', VITE_SJM_AIRSPACE_TILE_ATTRIBUTION: '© Example' }, 'invalid_tile_url'],
    [{ VITE_SJM_AIRSPACE_TILE_URL: 'https://tiles.example.net/{z}/{x}.png', VITE_SJM_AIRSPACE_TILE_ATTRIBUTION: '© Example' }, 'invalid_tile_url'],
    [{ VITE_SJM_AIRSPACE_TILE_URL: 'https://tiles.example.net/{z}/{x}/{y}.png' }, 'missing_attribution'],
    [{ VITE_SJM_AIRSPACE_TILE_URL: 'https://user:secret@tiles.example.net/{z}/{x}/{y}.png', VITE_SJM_AIRSPACE_TILE_ATTRIBUTION: '© Example' }, 'invalid_tile_url'],
    [{ VITE_SJM_AIRSPACE_TILE_URL: 'https://tiles.example.net/{z}/{x}/{y}.png', VITE_SJM_AIRSPACE_TILE_ATTRIBUTION: '© Example', VITE_SJM_AIRSPACE_TILE_ATTRIBUTION_URL: 'javascript:alert(1)' }, 'invalid_attribution_url'],
  ] as const)('rejects unsafe or incomplete configuration and retains an explicit fallback', (env, reason) => {
    expect(resolveSjmAirspaceImagery(env)).toMatchObject({
      provider: 'openstreetmap',
      template: DEFAULT_SJM_AIRSPACE_TILE_URL,
      fallbackReason: reason,
    });
  });
});
