'use strict';

describe('GEV live event simulation data normalization', () => {
  const { __testables } = require('../../src/services/spatial/liveEventSimulationService');

  it('bounds the weather forecast grid and rejects invalid extents safely', () => {
    const plan = __testables.buildForecastGrid([-180, -80, 180, 80], { latitude: 0, longitude: 0 }, 100000, 36);
    expect(plan.points.length).toBeLessThanOrEqual(36);
    expect(plan.points.length).toBeGreaterThan(0);
    expect(plan.points.every(point => point.latitude >= -80 && point.latitude <= 80 && point.longitude >= -180 && point.longitude <= 180)).toBe(true);

    const fallback = __testables.buildForecastGrid([10, 10, 10, 10], { latitude: -1.2, longitude: 36.8 }, 50000, 36);
    expect(fallback.points.length).toBeGreaterThan(0);
    expect(fallback.points.every(point => point.latitude >= -2 && point.latitude <= 0 && point.longitude >= 36 && point.longitude <= 38)).toBe(true);
  });

  it('maps hourly model values into a labelled forecast time step', () => {
    const step = __testables.weatherStepFromHourly({
      time: ['2026-10-14T12:00'],
      weather_code: [95],
      temperature_2m: [24.5],
      precipitation: [12.4],
      rain: [12.4],
      showers: [2.1],
      snowfall: [0],
      wind_speed_10m: [31.2],
      wind_direction_10m: [248],
      cloud_cover: [100],
    }, 0);

    expect(step).toMatchObject({
      validAt: '2026-10-14T12:00:00.000Z',
      weatherCode: 95,
      conditions: 'thunderstorm',
      severity: 'THUNDERSTORM',
      temperatureC: 24.5,
      precipitationMm: 12.4,
      windSpeedKmh: 31.2,
      windDirectionDeg: 248,
      cloudCoverPct: 100,
    });
  });

  it('normalizes an earthquake feed feature without inventing a shaking footprint', () => {
    const entity = __testables.earthquakeEntity({
      id: 'us7000test',
      properties: {
        mag: 4.7,
        magType: 'mb',
        place: '20 km south of Test City',
        title: 'M 4.7 - 20 km south of Test City',
        time: Date.now() - 2 * 60 * 1000,
        updated: Date.now() - 60 * 1000,
        sig: 338,
        tsunami: 0,
        status: 'reviewed',
        url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000test',
        detail: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/detail/us7000test.geojson',
      },
      geometry: { type: 'Point', coordinates: [36.8, -1.3, 10.5] },
    }, new Date().toISOString());

    expect(entity).toMatchObject({
      id: 'usgs:earthquake:us7000test',
      entityType: 'earthquake',
      source: 'USGS ComCat',
      latitude: -1.3,
      longitude: 36.8,
      status: 'CATALOG_EVENT',
      attributes: {
        magnitude: 4.7,
        depthKm: 10.5,
        significance: 338,
        tsunami: false,
        visualizationSemantics: 'epicentre_and_symbolic_pulse_not_shakemap_or_predicted_damage',
      },
      provenance: { observationType: 'earthquake_event_catalogue' },
    });
  });

  it('parses the Smithsonian / USGS weekly feed and joins reports to the stable volcano number when possible', () => {
    const xml = '<?xml version="1.0"?><rss version="2.0"><channel>'
      + '<lastBuildDate>Wed, 14 Oct 2026 08:00:00 GMT</lastBuildDate><item>'
      + '<title>Etna (Italy) | 8 October-14 October 2026 | New Eruptive Activity</title>'
      + '<link>https://volcano.si.edu/volcano.cfm?vn=211060</link>'
      + '<pubDate>Wed, 14 Oct 2026 08:00:00 GMT</pubDate>'
      + '<description><![CDATA[Recent report &amp; ash emission observed.]]></description>'
      + '</item></channel></rss>';
    const report = __testables.parseVolcanoReportItems(xml);

    expect(report.feedDate).toBe('2026-10-14T08:00:00.000Z');
    expect(report.items).toHaveLength(1);
    expect(report.items[0]).toMatchObject({
      volcanoName: 'Etna',
      normalisedName: 'etna',
      volcanoNumber: '211060',
      reportType: 'ERUPTIVE_ACTIVITY_REPORTED',
      reportedAt: '2026-10-14T08:00:00.000Z',
    });

    const catalogue = [{
      volcanoNumber: '211060',
      name: 'Etna',
      latitude: 37.75,
      longitude: 14.99,
      country: 'Italy',
    }];
    expect(__testables.matchVolcanoReport(report.items[0], catalogue)).toBe(catalogue[0]);
  });

  it('handles a missing or unmatched volcano report without inventing coordinates', () => {
    const matched = __testables.matchVolcanoReport({
      volcanoNumber: null,
      normalisedName: 'unlisted volcano',
    }, []);
    expect(matched).toBeNull();
  });
});
