'use strict';

describe('Open-Meteo commercial access policy', () => {
  const { getOpenMeteoAccess } = require('../../src/services/spatial/weatherProviderAccess');

  it('does not allow the free endpoint for a commercial product by default', () => {
    const access = getOpenMeteoAccess({});
    expect(access).toMatchObject({
      apiKey: '',
      allowFreeNonCommercial: false,
      allowed: false,
      apiBase: 'https://api.open-meteo.com/v1/forecast',
    });
  });

  it('selects the licensed customer endpoint when an API key is configured', () => {
    const access = getOpenMeteoAccess({ OPEN_METEO_API_KEY: 'test-key' });
    expect(access).toMatchObject({
      apiKey: 'test-key',
      allowFreeNonCommercial: false,
      allowed: true,
      apiBase: 'https://customer-api.open-meteo.com/v1/forecast',
    });
  });

  it('allows the free endpoint only when non-commercial use is explicitly enabled', () => {
    const access = getOpenMeteoAccess({ OPEN_METEO_ALLOW_FREE_NONCOMMERCIAL: 'true' });
    expect(access).toMatchObject({
      apiKey: '',
      allowFreeNonCommercial: true,
      allowed: true,
      apiBase: 'https://api.open-meteo.com/v1/forecast',
    });
  });

  it('does not treat arbitrary truthy values as a non-commercial opt-in', () => {
    const access = getOpenMeteoAccess({ OPEN_METEO_ALLOW_FREE_NONCOMMERCIAL: 'yes' });
    expect(access.allowed).toBe(false);
  });
});
