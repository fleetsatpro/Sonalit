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

  it('normalizes current USGS elevated-volcano alert levels separately from bulletin report dates', () => {
    const volcano = {
      volcanoNumber: '311120',
      name: 'Great Sitkin',
      latitude: 52.076,
      longitude: -176.13,
      country: 'United States',
      region: 'Aleutian Ridge',
    };
    const receivedAt = new Date().toISOString();
    const entity = __testables.usgsElevatedVolcanoEntity({
      vnum: '311120',
      volcano_name: 'Great Sitkin',
      alert_level: 'WATCH',
      color_code: 'ORANGE',
      sent_utc: '2026-10-14 08:00:00',
      notice_identifier: 'DOI-USGS-AVO-2026-10-14T08:00:00+00:00',
      notice_url: 'https://volcanoes.usgs.gov/hans-public/notice/example',
      notice_data: 'https://volcanoes.usgs.gov/hans-public/api/notice/getNotice/example',
      obs_fullname: 'Alaska Volcano Observatory',
    }, volcano, receivedAt, false);

    expect(entity).toMatchObject({
      id: 'usgs:volcano-alert:311120',
      entityType: 'volcano',
      source: 'USGS Volcano Hazards Program',
      latitude: 52.076,
      longitude: -176.13,
      status: 'USGS_ELEVATED_ALERT_WATCH',
      attributes: {
        reportType: 'USGS_ELEVATED_ALERT',
        reportingCadence: 'elevated_status_feed',
        usgsCurrentAlert: {
          alertLevel: 'WATCH',
          colorCode: 'ORANGE',
          sourceStatus: 'CURRENT_ELEVATED_STATUS_FEED',
          observatory: 'Alaska Volcano Observatory',
        },
      },
      provenance: { observationType: 'current_elevated_volcano_alert' },
      quality: { freshnessClass: 'LIVE' },
    });
    expect(entity.attributes.usgsCurrentAlert.noticeIssuedAt).toBe('2026-10-14T08:00:00.000Z');
  });

  it('normalizes open NASA EONET natural events and preserves geometry semantics and source links', () => {
    const now = new Date().toISOString();
    const entity = __testables.nasaEonetEntity({
      id: 'EONET_12345',
      properties: {
        id: 'EONET_12345',
        title: 'Wildfire activity near Test Reserve',
        description: 'Curated open event metadata.',
        link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_12345',
        closed: null,
        date: now,
        categories: [{ id: 'wildfires', title: 'Wildfires' }],
        sources: [{ id: 'MODIS', title: 'NASA MODIS', url: 'https://earthdata.nasa.gov/' }],
        geometryDates: [now],
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [36.7, -1.2], [36.9, -1.2], [36.9, -1.4], [36.7, -1.4], [36.7, -1.2],
        ]],
      },
    }, now);

    expect(entity).toMatchObject({
      id: 'nasa-eonet:EONET_12345',
      entityType: 'natural_event',
      source: 'NASA EONET',
      attributes: {
        title: 'Wildfire activity near Test Reserve',
        categoryId: 'wildfires',
        categoryTitle: 'Wildfires',
        eventOpen: true,
        sourceGeometryType: 'Polygon',
        locationSemantics: 'centroid_of_source_event_geometry_not_a_rendered_hazard_perimeter',
      },
      provenance: {
        observationType: 'open_curated_natural_event_metadata',
        sourceName: 'NASA Earth Observatory Natural Event Tracker (EONET)',
      },
      quality: { freshnessClass: 'LIVE' },
    });
    expect(entity.latitude).toBeCloseTo(-1.3, 2);
    expect(entity.longitude).toBeCloseTo(36.8, 2);
    expect(entity.attributes.sourceLinks[0]).toMatchObject({
      title: 'NASA MODIS',
      url: 'https://earthdata.nasa.gov/',
    });
  });

  it('maps MET Norway global forecast symbols and hourly values into modelled weather grid points', () => {
    expect(__testables.metNoWeatherCode('clearsky_day')).toBe(0);
    expect(__testables.metNoWeatherCode('lightrain')).toBe(61);
    expect(__testables.metNoWeatherCode('lightrainandthunder')).toBe(95);
    expect(__testables.metNoWeatherCode('heavysnow')).toBe(75);

    const receivedAt = new Date().toISOString();
    const entity = __testables.makeMetNoWeatherSimulationEntity({
      key: '36.8000,-1.3000',
      latitude: -1.3,
      longitude: 36.8,
    }, {
      geometry: { type: 'Point', coordinates: [36.8, -1.3, 1500] },
      properties: {
        timeseries: [
          {
            time: '2026-10-14T12:00:00Z',
            data: {
              instant: { details: {
                air_temperature: 24.5,
                relative_humidity: 81,
                wind_speed: 3.2,
                wind_from_direction: 248,
                cloud_area_fraction: 90,
              } },
              next_1_hours: {
                summary: { symbol_code: 'lightrainandthunder' },
                details: { precipitation_amount: 8.4 },
              },
            },
          },
          {
            time: '2026-10-14T13:00:00Z',
            data: {
              instant: { details: { air_temperature: 24, wind_speed: 2.5 } },
              next_1_hours: {
                summary: { symbol_code: 'clearsky_day' },
                details: { precipitation_amount: 0 },
              },
            },
          },
        ],
      },
    }, receivedAt);

    expect(entity).toMatchObject({
      entityType: 'weather',
      source: 'MET Norway',
      latitude: -1.3,
      longitude: 36.8,
      status: 'MODELLED_FORECAST',
      attributes: {
        simulationMode: 'hourly_forecast',
        simulationSemantics: 'met_no_global_numerical_forecast_not_live_radar',
        forecastStepCount: 2,
        weatherCode: 95,
        conditions: 'thunderstorm',
        temperatureC: 24.5,
        precipitationMm: 8.4,
        humidityPct: 81,
        windDirectionDeg: 248,
        cloudCoverPct: 90,
      },
      provenance: {
        sourceName: 'MET Norway Locationforecast',
        observationType: 'global_numerical_weather_forecast_grid_point',
      },
      quality: {
        freshnessClass: 'MODELLED',
      },
    });
    expect(entity.attributes.forecastSteps[1]).toMatchObject({
      validAt: '2026-10-14T13:00:00.000Z',
      weatherCode: 0,
      conditions: 'clear',
      temperatureC: 24,
    });
  });

  it('respects the MET Norway cache headers when setting forecast expiry', () => {
    const now = Date.parse('2026-10-14T10:00:00.000Z');
    const response = {
      headers: {
        get: name => name.toLowerCase() === 'cache-control' ? 'public, max-age=900' : null,
      },
    };
    expect(__testables.metNoCacheExpiry(response, now)).toBe(now + 15 * 60 * 1000);
  });

  it('handles a missing or unmatched volcano report without inventing coordinates', () => {
    const matched = __testables.matchVolcanoReport({
      volcanoNumber: null,
      normalisedName: 'unlisted volcano',
    }, []);
    expect(matched).toBeNull();
  });
});
