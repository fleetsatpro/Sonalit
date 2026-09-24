'use strict';

/**
 * Canonical spatial provider fabric.
 *
 * Gateways own provider-specific protocols and normalization. This manager
 * owns the cross-provider runtime contract: registration, capabilities,
 * bounded budgets/concurrency, failure classification, and health aggregation.
 */

const { RequestBudget, CircuitBreaker, clampInt } = require('./externalProviderUtils');

const FAILURE_CLASSES = new Set([
  'timeout', 'cancelled', 'rate_limited', 'auth_required', 'http_error',
  'malformed', 'invalid_data', 'circuit_open', 'budget_exhausted',
  'unavailable', 'unknown',
]);

function envInt(name, fallback, min, max) {
  const raw = name ? process.env[name] : undefined;
  return clampInt(raw, min, max, fallback);
}

function classifyFailure(error) {
  const value = String(error?.failureClass || error?.class || '').trim().toLowerCase();
  return FAILURE_CLASSES.has(value) ? value : 'unknown';
}

function tenantIdFromArgs(args) {
  if (!args || typeof args !== 'object') return null;
  const value = args.orgId ?? args.tenantId ?? args.tenant?.orgId;
  return value == null || value === '' ? null : String(value);
}

class SpatialProviderManager {
  constructor() {
    this.providers = new Map();
    this.quotaFamilies = new Map();
  }

  register(name, descriptor) {
    if (!name || typeof name !== 'string') throw new TypeError('Provider name is required');
    if (!descriptor || typeof descriptor.query !== 'function') {
      throw new TypeError('Provider query function is required');
    }
    if (this.providers.has(name)) throw new Error('Spatial provider already registered: ' + name);

    const quotaKey = String(descriptor.quotaKey || name);
    const maxPerMinute = envInt(descriptor.budgetEnv?.maxPerMinute, descriptor.maxPerMinute ?? 120, 1, 10_000);
    const maxConcurrent = envInt(descriptor.budgetEnv?.maxConcurrent, descriptor.maxConcurrent ?? 8, 1, 256);
    const tenantMaxPerMinute = envInt(
      descriptor.budgetEnv?.tenantMaxPerMinute,
      descriptor.tenantMaxPerMinute ?? Math.max(1, Math.floor((descriptor.maxPerMinute ?? 120) / 4)),
      1,
      10_000,
    );
    const tenantMaxConcurrent = envInt(
      descriptor.budgetEnv?.tenantMaxConcurrent,
      descriptor.tenantMaxConcurrent ?? Math.max(1, Math.min(descriptor.maxConcurrent ?? 8, 2)),
      1,
      256,
    );
    let quota = this.quotaFamilies.get(quotaKey);
    if (!quota) {
      quota = {
        budget: new RequestBudget(maxPerMinute, maxConcurrent),
        maxPerMinute,
        maxConcurrent,
        tenantMaxPerMinute,
        tenantMaxConcurrent,
        tenantBudgets: new Map(),
        tenantBudgetLastUsedAt: new Map(),
      };
      this.quotaFamilies.set(quotaKey, quota);
    } else if (
      quota.maxPerMinute !== maxPerMinute ||
      quota.maxConcurrent !== maxConcurrent ||
      quota.tenantMaxPerMinute !== tenantMaxPerMinute ||
      quota.tenantMaxConcurrent !== tenantMaxConcurrent
    ) {
      throw new Error('Spatial provider quota family configuration mismatch: ' + quotaKey);
    }
    const circuit = new CircuitBreaker(
      envInt(descriptor.budgetEnv?.failureThreshold, descriptor.failureThreshold ?? 6, 1, 100),
      envInt(descriptor.budgetEnv?.cooldownMs, descriptor.cooldownMs ?? 30_000, 1_000, 600_000),
    );

    this.providers.set(name, {
      name,
      query: descriptor.query,
      tenantMaxPerMinute,
      quotaKey,
      tenantMaxConcurrent,
      quota,
      tenantBudgets: quota.tenantBudgets,
      tenantBudgetLastUsedAt: quota.tenantBudgetLastUsedAt,
      health: typeof descriptor.health === 'function' ? descriptor.health : () => ({ status: 'UNKNOWN' }),
      capabilities: Array.isArray(descriptor.capabilities) ? [...new Set(descriptor.capabilities)] : [],
      circuit,
      requestCount: 0,
      successCount: 0,
      failureCount: 0,
      lastFailure: null,
      lastFailureAt: null,
      lastSuccessAt: null,
    });
    return this;
  }

  has(name) {
    return this.providers.has(name);
  }

  names() {
    return [...this.providers.keys()];
  }

  async query(name, args = {}) {
    const provider = this.providers.get(name);
    if (!provider) {
      const error = new Error('Unknown spatial provider: ' + name);
      error.failureClass = 'unavailable';
      throw error;
    }

    const now = Date.now();
    const tenantId = tenantIdFromArgs(args);
    let tenantBudget = null;
    if (tenantId) {
      tenantBudget = provider.tenantBudgets.get(tenantId);
      if (!tenantBudget) {
        if (provider.tenantBudgets.size >= Number(process.env.SPATIAL_PROVIDER_MAX_TENANT_BUCKETS || 10_000)) {
          let oldestId = null;
          let oldestAt = Infinity;
          for (const [id, at] of provider.tenantBudgetLastUsedAt.entries()) {
            if (at < oldestAt) { oldestAt = at; oldestId = id; }
          }
          if (oldestId) {
            provider.tenantBudgets.delete(oldestId);
            provider.tenantBudgetLastUsedAt.delete(oldestId);
          }
        }
        tenantBudget = new RequestBudget(provider.quota.tenantMaxPerMinute, provider.quota.tenantMaxConcurrent);
        provider.tenantBudgets.set(tenantId, tenantBudget);
      }
      provider.tenantBudgetLastUsedAt.set(tenantId, now);
      if (!tenantBudget.canRequest(now)) {
        const error = new Error('Spatial provider tenant budget exhausted: ' + name);
        error.failureClass = 'rate_limited';
        error.code = 'TENANT_BUDGET_EXHAUSTED';
        throw error;
      }
    }

    if (!provider.circuit.canRequest(now)) {
      const error = new Error('Spatial provider circuit is open: ' + name);
      error.failureClass = 'circuit_open';
      provider.lastFailure = 'circuit_open';
      provider.lastFailureAt = new Date(now).toISOString();
      provider.failureCount += 1;
      throw error;
    }

    if (!provider.quota.budget.canRequest(now)) {
      const error = new Error('Spatial provider budget exhausted: ' + name);
      error.failureClass = 'rate_limited';
      provider.lastFailure = 'budget_exhausted';
      provider.lastFailureAt = new Date(now).toISOString();
      provider.failureCount += 1;
      throw error;
    }

    provider.quota.budget.begin(now);
    if (tenantBudget) tenantBudget.begin(now);
    provider.requestCount += 1;

    try {
      const result = await provider.query(args);
      provider.circuit.success();
      provider.successCount += 1;
      provider.lastSuccessAt = new Date().toISOString();
      provider.lastFailure = null;
      provider.lastFailureAt = null;
      return result;
    } catch (error) {
      const failureClass = classifyFailure(error);
      provider.circuit.failure(now);
      provider.failureCount += 1;
      provider.lastFailure = failureClass;
      provider.lastFailureAt = new Date().toISOString();
      if (!error.failureClass) error.failureClass = failureClass;
      throw error;
    } finally {
      provider.quota.budget.end();
      if (tenantBudget) tenantBudget.end();
    }
  }

  async querySettled(requests) {
    return Promise.all((Array.isArray(requests) ? requests : []).map(async request => {
      try {
        return {
          provider: request.provider,
          status: 'fulfilled',
          value: await this.query(request.provider, request.args || {}),
        };
      } catch (reason) {
        return { provider: request.provider, status: 'rejected', reason };
      }
    }));
  }

  getHealthSnapshot() {
    const out = {};
    for (const provider of this.providers.values()) {
      let upstream;
      try {
        upstream = provider.health() || {};
      } catch (error) {
        upstream = { status: 'UNAVAILABLE', reason: error?.message || 'health check failed' };
      }
      const effectiveStatus = provider.circuit.state === 'OPEN'
        ? 'UNAVAILABLE'
        : provider.quota.budget.remaining() === 0
          ? 'RATE_LIMITED'
          : upstream.status || 'UNKNOWN';
      const effectiveReason = provider.circuit.state === 'OPEN'
        ? 'Provider circuit is open after repeated failures.'
        : provider.quota.budget.remaining() === 0
          ? 'Provider request budget is exhausted.'
          : upstream.reason;
      out[provider.name] = {
        provider: provider.name,
        capabilities: provider.capabilities,
        ...upstream,
        status: effectiveStatus,
        ...(effectiveReason ? { reason: effectiveReason } : {}),
        manager: {
          activeRequests: provider.quota.budget.active,
          rateLimitRemaining: provider.quota.budget.remaining(),
          tenantBucketCount: provider.tenantBudgets.size,
          tenantMaxPerMinute: provider.quota.tenantMaxPerMinute,
          tenantMaxConcurrent: provider.quota.tenantMaxConcurrent,
          requestCount: provider.requestCount,
          successCount: provider.successCount,
          failureCount: provider.failureCount,
          circuitState: provider.circuit.state,
          circuitFailures: provider.circuit.failures,
          lastFailureClass: provider.lastFailure,
          lastFailureAt: provider.lastFailureAt,
          lastSuccessAt: provider.lastSuccessAt,
        },
      };
    }
    return out;
  }

  reset() {
    for (const provider of this.providers.values()) {
      provider.quota.budget.timestamps.length = 0;
      provider.quota.budget.active = 0;
      provider.circuit.success();
      provider.requestCount = 0;
      provider.successCount = 0;
      provider.failureCount = 0;
      provider.lastFailure = null;
      provider.lastFailureAt = null;
      provider.lastSuccessAt = null;
      provider.tenantBudgets.clear();
      provider.tenantBudgetLastUsedAt.clear();
    }
    for (const quota of this.quotaFamilies.values()) {
      quota.budget.timestamps.length = 0;
      quota.budget.active = 0;
      quota.tenantBudgets.clear();
      quota.tenantBudgetLastUsedAt.clear();

    }
  }
}

function createDefaultSpatialProviderManager() {
  const manager = new SpatialProviderManager();

  const { getAircraftInBbox, getProviderHealth: openSkyHealth } = require('./openskyGateway');
  const { getCurrentWeather, getProviderHealth: weatherHealth } = require('./weatherGateway');
  const { getVesselsInBbox, getProviderHealth: aisHealth } = require('./kplerAisGateway');
  const {
    getTrafficAtPoints,
    getProviderHealth: mapboxHealth,
  } = require('./mapboxTrafficGateway');
  const {
    getTrafficIncidents,
    getTrafficFlowAtPoints,
    getProviderHealth: tomtomHealth,
  } = require('./tomtomTrafficGateway');
  const { getNaturalHazards, getProviderHealth: eonetHealth } = require('./nasaEonetGateway');

  const queryOrUnavailable = (module, key, providerName) => {
    if (typeof module[key] === 'function') return module[key];
    const unavailable = async () => {
      const error = new Error(providerName + ' provider capability is unavailable');
      error.failureClass = 'unavailable';
      throw error;
    };
    return unavailable;
  };

  const healthOrUnknown = (module, key) => {
    if (typeof module[key] === 'function') return module[key];
    return () => ({ status: 'UNKNOWN', reason: 'Provider health capability is unavailable' });
  };

  const budgets = (prefix, fallbackMinute, fallbackConcurrent) => ({
    maxPerMinute: fallbackMinute,
    maxConcurrent: fallbackConcurrent,
    budgetEnv: {
      maxPerMinute: prefix + '_MAX_PER_MINUTE',
      maxConcurrent: prefix + '_MAX_CONCURRENT',
    },
  });

  manager.register('opensky', {
    query: queryOrUnavailable({ getAircraftInBbox }, 'getAircraftInBbox', 'OpenSky'),
    health: healthOrUnknown({ getProviderHealth: openSkyHealth }, 'getProviderHealth'),
    capabilities: ['aircraft', 'movement', 'bbox', 'live'],
    ...budgets('SPATIAL_PROVIDER_OPENSKY', 60, 4),
  });

  manager.register('weather', {
    query: queryOrUnavailable({ getCurrentWeather }, 'getCurrentWeather', 'Weather'),
    health: healthOrUnknown({ getProviderHealth: weatherHealth }, 'getProviderHealth'),
    capabilities: ['weather', 'point', 'live'],
    ...budgets('SPATIAL_PROVIDER_WEATHER', 120, 8),
  });

  manager.register('kpler-ais', {
    query: queryOrUnavailable({ getVesselsInBbox }, 'getVesselsInBbox', 'AIS'),
    health: healthOrUnknown({ getProviderHealth: aisHealth }, 'getProviderHealth'),
    capabilities: ['vessel', 'maritime', 'bbox', 'live'],
    ...budgets('SPATIAL_PROVIDER_AIS', 60, 4),
  });

  manager.register('mapbox-traffic', {
    query: queryOrUnavailable({ getTrafficAtPoints }, 'getTrafficAtPoints', 'Mapbox Traffic'),
    health: healthOrUnknown({ getProviderHealth: mapboxHealth }, 'getProviderHealth'),
    capabilities: ['traffic', 'point', 'flow'],
    ...budgets('SPATIAL_PROVIDER_MAPBOX_TRAFFIC', 60, 6),
  });

  manager.register('tomtom-traffic-incidents', {
    query: queryOrUnavailable({ getTrafficIncidents }, 'getTrafficIncidents', 'TomTom Traffic'),
    health: healthOrUnknown({ getProviderHealth: tomtomHealth }, 'getProviderHealth'),
    capabilities: ['traffic', 'incident', 'bbox'],
    quotaKey: 'tomtom-traffic',
    ...budgets('SPATIAL_PROVIDER_TOMTOM', 60, 6),
  });

  manager.register('tomtom-traffic-flow', {
    query: queryOrUnavailable({ getTrafficFlowAtPoints }, 'getTrafficFlowAtPoints', 'TomTom Traffic Flow'),
    health: healthOrUnknown({ getProviderHealth: tomtomHealth }, 'getProviderHealth'),
    capabilities: ['traffic', 'flow', 'point'],
    quotaKey: 'tomtom-traffic',
    ...budgets('SPATIAL_PROVIDER_TOMTOM', 60, 6),
  });

  manager.register('nasa-eonet', {
    query: queryOrUnavailable({ getNaturalHazards }, 'getNaturalHazards', 'NASA EONET'),
    health: healthOrUnknown({ getProviderHealth: eonetHealth }, 'getProviderHealth'),
    capabilities: ['natural_hazard', 'earth_observation', 'bbox'],
    ...budgets('SPATIAL_PROVIDER_NASA_EONET', 30, 4),
  });

  return manager;
}

const spatialProviderManager = createDefaultSpatialProviderManager();

module.exports = {
  FAILURE_CLASSES,
  SpatialProviderManager,
  createDefaultSpatialProviderManager,
  spatialProviderManager,
  classifyFailure,
};
