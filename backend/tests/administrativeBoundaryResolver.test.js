'use strict';

jest.mock('../src/config/redis', () => ({ getRedis: () => null }));

const {
  resolveAdministrativeBoundary,
  clearBoundaryResolverCache,
  candidateNameMatches,
  countryCodeFromPlace,
  normalizedCore,
  providerCircuitHealth,
} = require('../src/utils/administrativeBoundaryResolver');

function jsonResponse(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(value),
  };
}

const ring = [
  [36.70, -1.35],
  [36.95, -1.35],
  [36.95, -1.15],
  [36.70, -1.15],
  [36.70, -1.35],
];

const osmPlaceOnly = [{
  class: 'place',
  type: 'city',
  lat: '-1.2864',
  lon: '36.8172',
  display_name: 'Nairobi, Nairobi County, Kenya',
  address: { city: 'Nairobi', county: 'Nairobi County', country: 'Kenya', country_code: 'ke' },
}];

const geoBoundaryMetadata = {
  boundaryID: 'KEN-ADM1-32016919',
  boundaryName: 'Kenya',
  boundaryISO: 'KEN',
  boundaryYearRepresented: '2020',
  boundaryType: 'ADM1',
  boundarySource: 'RCMRD GeoPortal, Africa GeoPortal',
  boundaryLicense: 'Public Domain',
  simplifiedGeometryGeoJSON: 'https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/KEN/ADM1/geoBoundaries-KEN-ADM1_simplified.geojson',
};

const geoBoundaryCollection = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: { shapeName: 'Nairobi City County', shapeID: 'KEN-ADM1-NAIROBI' },
    geometry: { type: 'Polygon', coordinates: [ring] },
  }],
};

describe('redundant administrative-boundary resolver', () => {
  beforeEach(() => {
    clearBoundaryResolverCache();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('simplifies a high-vertex official boundary within a bounded metre-based error budget', async () => {
    const uniquePoints = Array.from({ length: 1200 }, (_, index) => {
      const angle = (Math.PI * 2 * index) / 1200;
      return [36.8172 + 0.1 * Math.cos(angle), -1.2864 + 0.1 * Math.sin(angle)];
    });
    const denseRing = [...uniquePoints, [...uniquePoints[0]]];
    const denseFeatureCollection = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { shapeName: 'Nairobi City County', shapeID: 'KEN-ADM1-NAIROBI-DENSE' },
        geometry: { type: 'Polygon', coordinates: [denseRing] },
      }],
    };
    global.fetch.mockImplementation(async (url) => {
      const value = String(url);
      if (value.startsWith('https://nominatim.openstreetmap.org/search?')) return jsonResponse(osmPlaceOnly);
      if (value === 'https://www.geoboundaries.org/api/current/gbOpen/KEN/ADM1/') return jsonResponse(geoBoundaryMetadata);
      if (value === geoBoundaryMetadata.simplifiedGeometryGeoJSON) return jsonResponse(denseFeatureCollection);
      throw new Error('Unexpected request: ' + value);
    });

    const resolved = await resolveAdministrativeBoundary('Nairobi');

    expect(resolved.source_original_vertex_count).toBe(1200);
    expect(resolved.simplification_tolerance_m).toBeGreaterThan(0);
    expect(resolved.simplification_tolerance_m).toBeLessThanOrEqual(250);
    expect(resolved.geometry.coordinates[0].length - 1).toBeLessThanOrEqual(500);
    expect(resolved.geometry.coordinates[0][0]).toEqual(resolved.geometry.coordinates[0].at(-1));
    expect(resolved.location.simplification_method).toContain('Douglas–Peucker');
  });

  test('does not accept a different, larger administrative boundary from Nominatim', async () => {
    const wrongBoundary = [{
      class: 'boundary',
      type: 'administrative',
      lat: '0',
      lon: '37',
      importance: 0.99,
      display_name: 'Kenya',
      address: { country: 'Kenya', country_code: 'ke' },
      geojson: { type: 'Polygon', coordinates: [ring] },
    }];
    global.fetch.mockImplementation(async (url) => {
      const value = String(url);
      if (value.startsWith('https://nominatim.openstreetmap.org/search?')) return jsonResponse(wrongBoundary);
      if (value === 'https://www.geoboundaries.org/api/current/gbOpen/KEN/ADM1/') return jsonResponse(geoBoundaryMetadata);
      if (value === geoBoundaryMetadata.simplifiedGeometryGeoJSON) return jsonResponse(geoBoundaryCollection);
      throw new Error('Unexpected request: ' + value);
    });

    const resolved = await resolveAdministrativeBoundary('Nairobi');

    expect(resolved.location.source).toContain('geoBoundaries');
    expect(resolved.location.source_id).toBe('KEN-ADM1-NAIROBI');
    expect(resolved.location.name).toContain('Nairobi City County');
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  test('uses geoBoundaries when Nominatim geocodes a place but returns no administrative geometry', async () => {
    global.fetch.mockImplementation(async (url) => {
      const value = String(url);
      if (value.startsWith('https://nominatim.openstreetmap.org/search?')) return jsonResponse(osmPlaceOnly);
      if (value === 'https://www.geoboundaries.org/api/current/gbOpen/KEN/ADM1/') return jsonResponse(geoBoundaryMetadata);
      if (value === geoBoundaryMetadata.simplifiedGeometryGeoJSON) return jsonResponse(geoBoundaryCollection);
      throw new Error('Unexpected request: ' + value);
    });

    const resolved = await resolveAdministrativeBoundary('Nairobi');

    expect(resolved.location).toMatchObject({
      source: 'geoBoundaries open administrative boundary dataset',
      source_year: '2020',
      license: 'Public Domain',
      country: 'Kenya',
      source_id: 'KEN-ADM1-NAIROBI',
      precision: 'source-backed-administrative-boundary',
    });
    expect(resolved.geometry.type).toBe('Polygon');
    expect(resolved.geometry.coordinates[0][0]).toEqual(resolved.geometry.coordinates[0].at(-1));
    expect(resolved.location.attribution).toContain('RCMRD');
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  test('uses the independent dataset when Nominatim is unavailable and the place-country fallback is known', async () => {
    global.fetch.mockImplementation(async (url) => {
      const value = String(url);
      if (value.startsWith('https://nominatim.openstreetmap.org/search?')) throw new Error('provider timeout');
      if (value === 'https://www.geoboundaries.org/api/current/gbOpen/KEN/ADM1/') return jsonResponse(geoBoundaryMetadata);
      if (value === geoBoundaryMetadata.simplifiedGeometryGeoJSON) return jsonResponse(geoBoundaryCollection);
      if (value.startsWith('https://www.geoboundaries.org/api/current/KEN/ADM')) {
        return jsonResponse({ ...geoBoundaryMetadata, boundaryType: value.includes('ADM2') ? 'ADM2' : 'ADM3' });
      }
      throw new Error('Unexpected request: ' + value);
    });

    const resolved = await resolveAdministrativeBoundary('Nairobi');

    expect(resolved.location.source).toContain('geoBoundaries');
    expect(resolved.location.source_year).toBe('2020');
    expect(countryCodeFromPlace('Nairobi')).toBe('KE');
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  test('caches a verified source-backed boundary across repeated requests', async () => {
    global.fetch.mockImplementation(async (url) => {
      if (!String(url).startsWith('https://nominatim.openstreetmap.org/search?')) {
        throw new Error('Unexpected request: ' + String(url));
      }
      return jsonResponse([{
        class: 'boundary',
        type: 'administrative',
        lat: '-1.2864',
        lon: '36.8172',
        display_name: 'Nairobi, Kenya',
        osm_type: 'relation',
        osm_id: 12345,
        address: { county: 'Nairobi County', country: 'Kenya', country_code: 'ke' },
        geojson: { type: 'Polygon', coordinates: [ring] },
      }]);
    });

    const first = await resolveAdministrativeBoundary('Nairobi');
    global.fetch.mockRejectedValue(new Error('all providers are currently down'));
    const second = await resolveAdministrativeBoundary('Nairobi');

    expect(first.location.source).toBe('OpenStreetMap Nominatim');
    expect(second.cache_hit).toBe(true);
    expect(second.cache_layer).toBe('process');
    expect(second.geometry).toEqual(first.geometry);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('matches county-name variants without fuzzy arbitrary matching', () => {
    expect(normalizedCore('Nairobi City County')).toBe('nairobi');
    expect(candidateNameMatches('Nairobi', geoBoundaryCollection.features[0])).toBe(true);
    expect(candidateNameMatches('Nairobi, Kenya', geoBoundaryCollection.features[0])).toBe(true);
    expect(candidateNameMatches('Mombasa', geoBoundaryCollection.features[0])).toBe(false);
  });

  test('fails closed when neither independent provider can give a supported official boundary', async () => {
    global.fetch.mockImplementation(async (url) => {
      const requested = String(url);
      if (requested.startsWith('https://nominatim.openstreetmap.org/search?')) return jsonResponse(osmPlaceOnly);
      if (requested.startsWith('https://www.geoboundaries.org/api/current/gbOpen/KEN/')) {
        const level = requested.split('/').slice(-2)[0];
        return jsonResponse({
          ...geoBoundaryMetadata,
          boundaryType: level,
          simplifiedGeometryGeoJSON: 'https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/KEN/' + level + '/geoBoundaries-KEN-' + level + '_simplified.geojson',
        });
      }
      if (requested.endsWith('geoBoundaries-KEN-ADM1_simplified.geojson')) {
        return jsonResponse({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: { shapeName: 'Nairobi City County', shapeID: 'unsupported-shape' },
            geometry: { type: 'MultiPolygon', coordinates: [] },
          }],
        });
      }
      if (requested.endsWith('geoBoundaries-KEN-ADM2_simplified.geojson') || requested.endsWith('geoBoundaries-KEN-ADM3_simplified.geojson')) {
        return jsonResponse({ type: 'FeatureCollection', features: [] });
      }
      throw new Error('Unexpected request: ' + requested);
    });

    await expect(resolveAdministrativeBoundary('Nairobi')).rejects.toThrow(/No geofence was created|geoBoundaries fallback did not resolve/);
  });
  test('opens provider circuit breakers after repeated transient failures and avoids hammering the source', async () => {
    global.fetch.mockImplementation(async (url) => {
      const requested = String(url);
      if (requested.startsWith('https://nominatim.openstreetmap.org/search?')) {
        throw new Error('Nominatim connection timeout');
      }
      if (requested.startsWith('https://www.geoboundaries.org/api/current/gbOpen/KEN/')) {
        return jsonResponse({ error: 'upstream unavailable' }, 503);
      }
      throw new Error('Unexpected request: ' + requested);
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(resolveAdministrativeBoundary('Nairobi')).rejects.toThrow(/No geofence was created|geoBoundaries fallback did not resolve/);
    }

    expect(providerCircuitHealth('nominatim')).toMatchObject({ state: 'open', failures: 0 });
    expect(providerCircuitHealth('geoBoundaries')).toMatchObject({ state: 'open', failures: 0 });
    const countAfterOpening = global.fetch.mock.calls.length;

    await expect(resolveAdministrativeBoundary('Nairobi')).rejects.toThrow(/circuit breaker is open/);
    expect(global.fetch).toHaveBeenCalledTimes(countAfterOpening);
  });

});
