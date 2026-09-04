// Fleet, convoy, alert and risk-zone read tools (spec §10).
//
// Ported from the dispatch loop in backend/src/routes/ai.js, with one
// substantive change: every query there ran through the global `query()`
// helper, which bypasses row-level security, so each of these tools
// returned rows for EVERY tenant. Here the handler is given an
// already-org-scoped client and cannot reach an unscoped one, so the
// isolation holds by construction rather than by remembering a filter.
//
// The SQL is otherwise kept close to the original: same columns, same
// ordering, same limits. Row caps matter — an unbounded result set becomes
// model context, and blowing the context window is both a cost and a
// correctness problem.

import { z } from 'zod';

import { registerTool } from '../registry.js';

const Region = z
  .string()
  .max(80)
  .describe('Filter by region, e.g. Kenya, DRC, Tanzania, Uganda, Mali');

registerTool({
  name: 'query_vehicles',
  description:
    'Query the live vehicle fleet. Returns matching vehicles with registration, type, ' +
    'status, region, speed (km/h), fuel level (%), coordinates, driver, and last ping.',
  action_level: 'read',
  required_role: 'analyst',
  source: 'database',
  input_schema: z.object({
    status: z
      .enum(['active', 'idle', 'maintenance', 'offline'])
      .optional()
      .describe('Filter by vehicle status'),
    region: Region.optional(),
    low_fuel: z.boolean().optional().describe('Only vehicles with fuel level below 25%'),
    moving: z.boolean().optional().describe('Only vehicles currently moving (speed > 2 km/h)'),
  }),
  handler: async (args, _ctx, client) => {
    const filters = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    if (args.status) {
      params.push(args.status);
      filters.push(`status = $${String(params.length)}`);
    }
    if (args.region) {
      params.push(args.region);
      filters.push(`region = $${String(params.length)}`);
    }
    if (args.low_fuel) filters.push('COALESCE(fuel_level, 85) < 25');
    if (args.moving) filters.push('COALESCE(speed, 0) > 2');

    const res = await client.query(
      `SELECT registration, type, status, region,
              COALESCE(fuel_level, 85) AS fuel_level, COALESCE(speed, 0) AS speed,
              latitude, longitude, driver_name, last_ping
         FROM vehicles WHERE ${filters.join(' AND ')}
        ORDER BY registration LIMIT 60`,
      params,
    );
    return { count: res.rows.length, vehicles: res.rows };
  },
});

registerTool({
  name: 'query_convoys',
  description:
    'Query convoy missions. Returns convoys with name, status, region, priority, ' +
    'route origin/destination, and timing.',
  action_level: 'read',
  required_role: 'analyst',
  source: 'database',
  input_schema: z.object({
    status: z.enum(['planned', 'active', 'completed', 'aborted']).optional(),
    region: Region.optional(),
    priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  }),
  handler: async (args, _ctx, client) => {
    const filters = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    for (const [column, value] of [
      ['status', args.status],
      ['region', args.region],
      ['priority', args.priority],
    ] as const) {
      if (value) {
        params.push(value);
        filters.push(`${column} = $${String(params.length)}`);
      }
    }

    const res = await client.query(
      `SELECT name, status, region, priority, route_origin, route_destination,
              departure_time, estimated_arrival, arrival_time
         FROM convoys WHERE ${filters.join(' AND ')}
        ORDER BY created_at DESC LIMIT 40`,
      params,
    );
    return { count: res.rows.length, convoys: res.rows };
  },
});

registerTool({
  name: 'query_alerts',
  description:
    'Query operational alerts. Returns alerts with type, severity, message, affected ' +
    'vehicle, and timestamps. By default returns only unresolved alerts.',
  action_level: 'read',
  required_role: 'analyst',
  source: 'database',
  input_schema: z.object({
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    type: z
      .string()
      .max(60)
      .optional()
      .describe('Alert type, e.g. speed, geofence, mechanical, security, communication'),
    include_resolved: z.boolean().optional().describe('Also include already-resolved alerts'),
  }),
  handler: async (args, _ctx, client) => {
    const filters = ['a.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (!args.include_resolved) filters.push('a.resolved_at IS NULL');
    if (args.severity) {
      params.push(args.severity);
      filters.push(`a.severity = $${String(params.length)}`);
    }
    if (args.type) {
      params.push(args.type);
      filters.push(`a.type = $${String(params.length)}`);
    }

    const res = await client.query(
      `SELECT a.type, a.severity, a.message, a.created_at, a.acknowledged_at, a.resolved_at,
              v.registration AS vehicle
         FROM alerts a LEFT JOIN vehicles v ON v.id = a.vehicle_id
        WHERE ${filters.join(' AND ')}
        ORDER BY a.created_at DESC LIMIT 40`,
      params,
    );
    return { count: res.rows.length, alerts: res.rows };
  },
});

registerTool({
  name: 'query_risk_zones',
  description:
    'Query the internal database of known high-risk zones — conflict areas, theft ' +
    'hotspots, flooding, road closures, customs posts and checkpoints. Always check ' +
    'this before advising on route safety.',
  action_level: 'read',
  required_role: 'analyst',
  source: 'database',
  input_schema: z.object({
    // Matches the legacy tool: risk_zones has no region column, so a place
    // filter searches the name and description text instead.
    search: z
      .string()
      .max(120)
      .optional()
      .describe('Match against zone name or description, e.g. a place or corridor name'),
    risk_level: z
      .enum(['low', 'medium', 'high', 'critical', 'no_go'])
      .optional()
      .describe('Minimum risk level'),
    // These are exactly the values risk_zones.zone_type permits; a value
    // outside the table's CHECK constraint could never match a row.
    zone_type: z
      .enum([
        'conflict',
        'theft_hotspot',
        'flood',
        'road_closed',
        'customs',
        'checkpoint',
        'restricted',
        'no_go',
      ])
      .optional(),
  }),
  handler: async (args, _ctx, client) => {
    const filters = ['active = true'];
    const params: unknown[] = [];
    if (args.search) {
      params.push(`%${args.search}%`);
      const p = `$${String(params.length)}`;
      filters.push(`(name ILIKE ${p} OR description ILIKE ${p})`);
    }
    if (args.zone_type) {
      params.push(args.zone_type);
      filters.push(`zone_type = $${String(params.length)}`);
    }
    if (args.risk_level) {
      // "Minimum risk level" is an ordering over an enum, so it is ranked
      // explicitly — 'critical' > 'high' is false under lexical ordering.
      const ranks = ['low', 'medium', 'high', 'critical', 'no_go'];
      params.push(ranks.slice(ranks.indexOf(args.risk_level)));
      filters.push(`risk_level = ANY($${String(params.length)})`);
    }

    const res = await client.query(
      `SELECT name, description, risk_level, zone_type, lat, lng, radius_km, created_at
         FROM risk_zones WHERE ${filters.join(' AND ')}
        ORDER BY CASE risk_level
                   WHEN 'no_go' THEN 1 WHEN 'critical' THEN 2
                   WHEN 'high' THEN 3 WHEN 'medium' THEN 4 ELSE 5 END
        LIMIT 30`,
      params,
    );
    return { count: res.rows.length, risk_zones: res.rows };
  },
});
