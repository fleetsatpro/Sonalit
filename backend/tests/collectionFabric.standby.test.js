'use strict';

describe('Collection Fabric regional scheduler standby boundary', () => {
  const originalStandby = process.env.SONALIT_STANDBY;
  const originalEnvironment = process.env.NODE_ENV;
  const originalOpenApi = process.env.GENERATE_OPENAPI;
  const originalSchedulerFlag = global.__sonalitRegionalIncidentScheduler;

  function loadCollectionFabric() {
    jest.resetModules();
    jest.doMock('../src/config/database', () => ({
      query: jest.fn(),
      pool: { connect: jest.fn() },
    }));
    jest.doMock('../src/utils/tenantContext', () => ({
      runWithOrgContext: jest.fn(),
    }));
    jest.doMock('../src/utils/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }));
    jest.doMock('../src/utils/intelligenceGeography', () => ({
      normalizeCountryCode: jest.fn(),
      inferCountryCodeFromItem: jest.fn(),
      inferCountryCodeFromText: jest.fn(),
    }));
    jest.doMock('../src/utils/publicResearchFetch', () => ({
      safeFetchPublicResearch: jest.fn(),
      MAX_RESPONSE_BYTES: 1024,
    }));
    jest.isolateModules(() => {
      require('../src/utils/collectionFabric');
    });
  }

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    delete process.env.GENERATE_OPENAPI;
    delete global.__sonalitRegionalIncidentScheduler;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
    if (originalStandby === undefined) delete process.env.SONALIT_STANDBY;
    else process.env.SONALIT_STANDBY = originalStandby;
    if (originalEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnvironment;
    if (originalOpenApi === undefined) delete process.env.GENERATE_OPENAPI;
    else process.env.GENERATE_OPENAPI = originalOpenApi;
    if (originalSchedulerFlag === undefined) delete global.__sonalitRegionalIncidentScheduler;
    else global.__sonalitRegionalIncidentScheduler = originalSchedulerFlag;
    jest.dontMock('../src/config/database');
    jest.dontMock('../src/utils/tenantContext');
    jest.dontMock('../src/utils/logger');
    jest.dontMock('../src/utils/intelligenceGeography');
    jest.dontMock('../src/utils/publicResearchFetch');
  });

  test('does not register startup or recurring regional sweeps on a standby replica', () => {
    process.env.SONALIT_STANDBY = 'true';
    const timeout = jest.spyOn(global, 'setTimeout');
    const interval = jest.spyOn(global, 'setInterval');

    loadCollectionFabric();

    expect(timeout).not.toHaveBeenCalledWith(expect.any(Function), 20_000);
    expect(interval).not.toHaveBeenCalledWith(expect.any(Function), 300_000);
    expect(global.__sonalitRegionalIncidentScheduler).toBeUndefined();
  });

  test('retains regional sweep scheduling on the active runtime', () => {
    process.env.SONALIT_STANDBY = 'false';
    const timeout = jest.spyOn(global, 'setTimeout');
    const interval = jest.spyOn(global, 'setInterval');

    loadCollectionFabric();

    expect(timeout).toHaveBeenCalledWith(expect.any(Function), 20_000);
    expect(interval).toHaveBeenCalledWith(expect.any(Function), 300_000);
    expect(global.__sonalitRegionalIncidentScheduler).toBe(true);
  });
});
