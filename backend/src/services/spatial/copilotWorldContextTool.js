'use strict';

/**
 * Copilot tool: get_world_context
 * Delegates to buildWorldContext. Sonalit operational data is source of truth.
 */
const { buildWorldContext } = require('./worldContextService');
const { query } = require('../../config/database');
const logger = require('../../utils/logger');

const TOOL_DEFINITION = {
  name: 'get_world_context',
  description:
    'Build a multi-layer spatial world context around a location or subject. Returns org-scoped operational vehicles (Sonalit source of truth) and external aircraft observations (OpenSky) with honest freshness classification (LIVE / DELAYED / STALE / UNKNOWN), layer health, relations (NEAR), and warnings. Use for "what is near X", air traffic near a convoy, or spatial situation reports. Does not invent data; external layers may be partial or unavailable.',
  input_schema: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: 'Place name to centre the query, e.g. Nairobi, Mombasa, Goma',
      },
      latitude: {
        type: 'number',
        description: 'Optional explicit center latitude (preferred over geocoding when known)',
      },
      longitude: {
        type: 'number',
        description: 'Optional explicit center longitude',
      },
      radius_km: {
        type: 'number',
        description: 'Search radius in km (default 25, max 250)',
      },
      layers: {
        type: 'array',
        items: { type: 'string', enum: ['aircraft', 'operational'] },
        description:
          'Layers to include (default: aircraft). Operational vehicles are always included from Sonalit.',
      },
      max_entities: {
        type: 'number',
        description: 'Max entities per external layer (default 100, max 250)',
      },
    },
  },
};

async function toolGetWorldContext(input, orgId, userId, geocodeFn) {
  if (!orgId) return { error: 'Organisation context is required' };

  let radiusM = Number(input.radius_km);
  if (!Number.isFinite(radiusM) || radiusM <= 0) radiusM = 25;
  radiusM = Math.min(Math.max(radiusM, 1), 250) * 1000;

  let center = null;
  if (Number.isFinite(input.latitude) && Number.isFinite(input.longitude)) {
    center = {
      latitude: Number(input.latitude),
      longitude: Number(input.longitude),
    };
  } else if ((input.location || '').trim()) {
    try {
      const g = await geocodeFn(String(input.location).trim());
      center = {
        latitude: g.latitude,
        longitude: g.longitude,
        label: [g.name, g.admin1, g.country].filter(Boolean).join(', '),
      };
    } catch (e) {
      return { error: `Could not resolve location: ${e.message}` };
    }
  }

  const layers =
    Array.isArray(input.layers) && input.layers.length
      ? input.layers.filter((l) => typeof l === 'string').slice(0, 10)
      : ['aircraft'];
  const maxEntities = Math.min(Math.max(Number(input.max_entities) || 100, 1), 250);

  const db = async (sql, params) => {
    const r = await query(sql, params);
    return { rows: r.rows };
  };

  try {
    const ctx = await buildWorldContext({
      orgId,
      userId: userId || null,
      db,
      subject: center?.label ? { kind: 'place', id: center.label } : null,
      center: center
        ? { latitude: center.latitude, longitude: center.longitude }
        : null,
      radiusM,
      bbox: null,
      layers,
      maxEntitiesPerLayer: maxEntities,
      requestId: `copilot-world-context-${Date.now()}`,
    });

    const vehicles = (ctx.entities || []).slice(0, 40).map((e) => ({
      id: e.id,
      label: e.label,
      lat: e.latitude,
      lng: e.longitude,
      freshness: e.freshnessClass || e.freshness,
      observed_at: e.observedAt,
    }));
    const aircraft = (ctx.movement || []).slice(0, 40).map((o) => ({
      id: o.id,
      callsign: o.callsign || o.label,
      lat: o.latitude,
      lng: o.longitude,
      altitude_m: o.altitude,
      freshness: o.quality?.freshnessClass || o.freshnessClass,
      observed_at: o.observedAt,
      source: o.source,
    }));

    return {
      generated_at: ctx.generatedAt,
      center: center
        ? {
            lat: center.latitude,
            lng: center.longitude,
            label: center.label || null,
          }
        : null,
      radius_km: radiusM / 1000,
      operational_vehicles: { count: vehicles.length, sample: vehicles },
      aircraft: { count: aircraft.length, sample: aircraft },
      near_relations: (ctx.relations || []).slice(0, 30),
      coverage: ctx.coverage,
      layer_health: ctx.layerHealth,
      freshness: ctx.freshness,
      warnings: ctx.warnings || [],
      provenance: ctx.provenance,
      note: 'Sonalit operational vehicles are the source of truth. Aircraft are external (OpenSky) with honest freshness; UNAVAILABLE/STALE means do not treat as live.',
    };
  } catch (e) {
    logger.error('get_world_context failed: ' + e.message);
    return { error: `World context unavailable: ${e.message}`, degraded: true };
  }
}

module.exports = { TOOL_DEFINITION, toolGetWorldContext };
