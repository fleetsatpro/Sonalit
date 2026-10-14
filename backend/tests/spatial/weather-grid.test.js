'use strict';

describe('Open-Meteo bounded weather grid sampling', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    global.fetch = jest.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  function providerPoint(latitude, longitude, code, minuteOffset = 1) {
    const time = new Date(Date.now() - minuteOffset * 60_000).toISOString().slice(0, 16);
    return {
      latitude,
      longitude,
      timezone: 'UTC',
      current: {
        time,
        temperature_2m: 24.5,
        relative_humidity_2m: 71,
        precipitation: code >= 95 ? 12.2 : 2.4,
        weather_code: code,
        wind_speed_10m: 32.1,
        visibility: 8200,
      },
    };
  }

  it('batches multiple viewport points into one request and places them at provider-returned grid coordinates', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => [
        providerPoint(-1.25, 36.75, 95),
        providerPoint(-1.75, 37.25, 61),
      ],
    });
    const { getCurrentWeather } = require('../../src/services/spatial/weatherGateway');
    const result = await getCurrentWeather({
      requestId: 'weather-grid-test',
      points: [
        { latitude: -1.251, longitude: 36.751 },
        { latitude: -1.751, longitude: 37.251 },
      ],
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const url = new URL(global.fetch.mock.calls[0][0]);
    expect(url.searchParams.get('latitude')).toBe('-1.251,-1.751');
    expect(url.searchParams.get('longitude')).toBe('36.751,37.251');
    expect(result.observations).toHaveLength(2);
    expect(result.coverage).toEqual({
      complete: true,
      sampleCount: 2,
      successfulSamples: 2,
      failedSamples: 0,
    });
    expect(result.observations[0]).toMatchObject({
      entityType: 'weather',
      latitude: -1.25,
      longitude: 36.75,
      accuracyM: expect.any(Number),
      attributes: {
        weatherCode: 95,
        conditions: 'thunderstorm',
        temperatureC: 24.5,
        humidityPct: 71,
        precipitationMm: 12.2,
        windSpeedKmh: 32.1,
        visibilityM: 8200,
        requestedLatitude: -1.251,
        requestedLongitude: 36.751,
        modelGridPoint: true,
      },
      provenance: {
        sourceName: 'Open-Meteo',
        observationType: 'current_weather_model_grid_point',
      },
    });
    expect(result.observations[0].attributes.gridCellDistanceM).toBe(result.observations[0].accuracyM);
    expect(result.observations[1].latitude).toBe(-1.75);
    expect(result.observations[1].attributes.conditions).toBe('light_rain');
  });

  it('reuses fresh grid point cache entries without another provider request', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => [providerPoint(-4.125, 32.875, 3)],
    });
    const { getCurrentWeather } = require('../../src/services/spatial/weatherGateway');
    const points = [{ latitude: -4.125, longitude: 32.875 }];
    const first = await getCurrentWeather({ points });
    const second = await getCurrentWeather({ points });

    expect(first.observations).toHaveLength(1);
    expect(second.observations).toHaveLength(1);
    expect(second.cache.hit).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('fails closed when no valid weather grid coordinates are supplied', async () => {
    const { getCurrentWeather } = require('../../src/services/spatial/weatherGateway');
    const result = await getCurrentWeather({ points: [{ latitude: 91, longitude: 10 }, { latitude: 0, longitude: 181 }] });

    expect(result.observations).toEqual([]);
    expect(result.error).toBe('invalid_weather_grid_points');
    expect(result.coverage.complete).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
