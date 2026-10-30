export type SjmAirspaceImageryProvider = 'openstreetmap' | 'custom';

export type SjmAirspaceImagery = {
  provider: SjmAirspaceImageryProvider;
  template: string;
  attribution: string;
  attributionUrl: string | null;
  maximumLevel: number;
  fallbackReason: 'not_configured' | 'invalid_tile_url' | 'missing_attribution' | 'invalid_attribution_url' | null;
};

export const DEFAULT_SJM_AIRSPACE_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const DEFAULT_ATTRIBUTION = '© OpenStreetMap contributors';
const DEFAULT_ATTRIBUTION_URL = 'https://www.openstreetmap.org/copyright';

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function validHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function validTileTemplate(value: string): boolean {
  if (!value || value.length > 2048 || /\s/.test(value)) return false;
  if (!['{z}', '{x}', '{y}'].every(token => value.includes(token))) return false;
  const probe = value.replaceAll('{z}', '1').replaceAll('{x}', '1').replaceAll('{y}', '1');
  return validHttpsUrl(probe) !== null;
}

function fallback(reason: NonNullable<SjmAirspaceImagery['fallbackReason']>): SjmAirspaceImagery {
  return {
    provider: 'openstreetmap',
    template: DEFAULT_SJM_AIRSPACE_TILE_URL,
    attribution: DEFAULT_ATTRIBUTION,
    attributionUrl: DEFAULT_ATTRIBUTION_URL,
    maximumLevel: 19,
    fallbackReason: reason,
  };
}

/**
 * Resolve a public XYZ raster tile source for the Cesium airspace globe.
 *
 * VITE_* values are embedded in the browser bundle. Never put a private tile
 * credential here; use a provider-issued public, origin-restricted token only.
 * OpenFreeMap style URLs are vector styles for MapLibre, not XYZ raster tiles
 * and therefore cannot be passed to Cesium's UrlTemplateImageryProvider.
 */
export function resolveSjmAirspaceImagery(env: Record<string, unknown> = {}): SjmAirspaceImagery {
  const template = textValue(env['VITE_SJM_AIRSPACE_TILE_URL']);
  if (!template) return fallback('not_configured');
  if (!validTileTemplate(template)) return fallback('invalid_tile_url');

  const attribution = textValue(env['VITE_SJM_AIRSPACE_TILE_ATTRIBUTION']);
  if (!attribution || attribution.length > 240) return fallback('missing_attribution');

  const rawAttributionUrl = textValue(env['VITE_SJM_AIRSPACE_TILE_ATTRIBUTION_URL']);
  const attributionUrl = rawAttributionUrl ? validHttpsUrl(rawAttributionUrl) : null;
  if (rawAttributionUrl && !attributionUrl) return fallback('invalid_attribution_url');

  const requestedMaximumLevel = Number(env['VITE_SJM_AIRSPACE_TILE_MAX_ZOOM']);
  const maximumLevel = Number.isInteger(requestedMaximumLevel) && requestedMaximumLevel >= 0 && requestedMaximumLevel <= 22
    ? requestedMaximumLevel
    : 19;

  return {
    provider: 'custom',
    template,
    attribution,
    attributionUrl,
    maximumLevel,
    fallbackReason: null,
  };
}
