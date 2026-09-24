'use strict';

const { query } = require('../../config/database');
const logger = require('../../utils/logger');
const { buildWorldContext } = require('./worldContextService');

/**
 * Copilot tool: get_world_context
 * Returns summarized spatial context with honest freshness.
 * geocodeFn must match the dispatch geocode helper (Open-Meteo).
 */
async function toolGetWorldContext(input, orgId, geocodeFn) {
  if (!orgId) return { error: 'Organisation context is required' };
  try {
    let center = null;
    if (Number.isFinite(input.latitude) && Number.isFinite(input.longitude)) {
      center = { latitude: Number(input.latitude), longitude: Number(input.longitude) };
    } else if (input.location && String(input.location).trim()) {
      if (typeof geocodeFn !== 'function') {
        return { error: 'Geocoder unavailable; pass latitude/longitude' };
      }
      const g = await geocodeFn(String(input.location).trim());
      center = { latitude: g.latitude, longitude: g.longitude };
    }
    let radiusM = Number(input.radius_km);
    if (!Number.isFinite(radiusM) || radiusM <= 0) radiusM = 25;
    radiusM = Math.min(Math.max(radiusM, 1), 250) * 1000;

    const layers = Array.isArray(input.layers) && input.layers.length
      ? input.layers.filter((l) => typeof l === 'string').slice(0, 5)
      : ['aircraft'];
    const maxEntities = Math.min(Math.max(Number(input.max_entities) || 50, 1), 100);

    const dbFn = async (sql, params) => query(sql, params);
    const ctx = await buildWorldContext({
      orgId,
      db: dbFn,
      subject: null,
      center,
      radiusM,
      bbox: null,
      layers,
      maxEntitiesPerLayer: maxEntities,
      requestId: `copilot-wc-${Date.now()}`,
    });

    const summarizeEntity = (e) => ({
      id: e.id,
      type: e.entityType || e.type || null,
      source: e.source,
      lat: e.latitude,
      lng: e.longitude,
      observed_at: e.observedAt,
      freshness: e.quality?.freshnessClass || e.quality?.state || 'UNKNOWN',
      label: e.attributes?.registration || e.attributes?.callsign || e.id,
      heading_deg: e.headingDeg ?? null,
      altitude_m: e.altitudeM ?? e.attributes?.baro_altitude ?? null,
    });

    const vehicles = (ctx.entities || []).slice(0, 40).map(summarizeEntity);
    const aircraft = (ctx.movement || []).slice(0, maxEntities).map(summarizeEntity);
    const near = (ctx.relations || [])
      .filter((r) => r.predicate === 'NEAR')
      .slice(0, 25)
      .map((r) => ({ to: r.toId, distance_m: r.distanceM, confidence: r.confidence }));

    return {
      generated_at: ctx.generatedAt,
      center: ctx.spatialContext?.center || center,
      radius_km: radiusM / 1000,
      query_scope: ctx.spatialContext?.queryScope,
      operational_vehicles: { count: vehicles.length, items: vehicles },
      aircraft: { count: aircraft.length, items: aircraft },
      near_relations: near,
      coverage: ctx.coverage,
      layer_health: ctx.layerHealth,
      freshness: ctx.freshness,
      warnings: ctx.warnings || [],
      provenance: (ctx.provenance || []).map((p) => p.sourceName),
      note: 'Positions are observations with explicit freshness. STALE/UNKNOWN must not be treated as live truth.',
    };
  } catch (e) {
    logger.warn('get_world_context failed: ' + e.message);
    return { error: `World context unavailable: ${e.message}` };
  }
}

const GET_WORLD_CONTEXT_TOOL_DEF = {
  name: 'get_world_context',
  description: 'Spatial world context around a location or coordinates. Returns nearby Sonalit operational vehicles (with honest freshness) and external aircraft from OpenSky when available. Use for airspace awareness, proximity questions, or "what is around X". Prefer this over guessing positions.',
  input_schema: {
    type: 'object',
    properties: {
      location: { type: 'string', description: 'Place name to centre the query (geocoded). Prefer this when the user names a city/corridor.' },
      latitude: { type: 'number', description: 'Center latitude if coordinates are known' },
      longitude: { type: 'number', description: 'Center longitude if coordinates are known' },
      radius_km: { type: 'number', description: 'Search radius in km (default 25, max 250)' },
      layers: {
        type: 'array',
        items: { type: 'string', enum: ['aircraft'] },
        description: 'External layers to include (default: aircraft). Operational vehicles are always included.',
      },
      max_entities: { type: 'number', description: 'Max external entities per layer (default 50, max 100)' },
    },
  },
};

module.exports = { toolGetWorldContext, GET_WORLD_CONTEXT_TOOL_DEF };
