import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('../db.js', () => ({ query: mocks.query }));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: async (req: { user?: { sub: string; org_id: string; role: string } }) => {
    req.user = { sub: 'analytics-test-user', org_id: '11111111-1111-4111-8111-111111111111', role: 'ops' };
  },
}));

import { analyticsErrorHandler } from '../lib/errorHandler.js';
import { analyticsRoutes } from './analytics.js';

describe('analytics data integrity', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify({ logger: false });
    app.setErrorHandler(analyticsErrorHandler);
    await app.register(analyticsRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 400 for invalid calendar dates, reversed dates, and oversized ranges', async () => {
    const invalidCalendarDate = await app.inject({ method: 'GET', url: '/v4/analytics/summary?from=2026-02-31&to=2026-03-01' });
    expect(invalidCalendarDate.statusCode).toBe(400);
    expect(invalidCalendarDate.json().code).toBe('VALIDATION_ERROR');

    const reversedRange = await app.inject({ method: 'GET', url: '/v4/analytics/summary?from=2026-10-08&to=2026-10-07' });
    expect(reversedRange.statusCode).toBe(400);
    expect(reversedRange.json().issues[0].message).toContain('on or after');

    const oversizedRange = await app.inject({ method: 'GET', url: '/v4/analytics/summary?from=2025-01-01&to=2026-01-02' });
    expect(oversizedRange.statusCode).toBe(400);
    expect(oversizedRange.json().issues[0].message).toContain('cannot exceed 366 days');
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('does not expose SQL or database exception details to API clients', async () => {
    mocks.query.mockRejectedValue(new Error('sensitive database connection detail'));
    const response = await app.inject({ method: 'GET', url: '/v4/analytics/summary?from=2026-10-01&to=2026-10-07' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ code: 'INTERNAL_ERROR', error: 'Internal server error' });
    expect(response.body).not.toContain('sensitive database connection detail');
  });

  it('calculates distance from actual consecutive GPS coordinates and marks unsupported summary metrics unavailable', async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT(*)::text AS total FROM gps_fixes')) return [{ total: '5' }];
      if (sql.includes('WITH windowed_fixes AS')) {
        return [{
          km: '12.34',
          valid_segments: '4',
          rejected_speed_segments: '1',
          gap_excluded_segments: '2',
        }];
      }
      return [];
    });

    const response = await app.inject({ method: 'GET', url: '/v4/analytics/summary?from=2026-10-01&to=2026-10-07' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total_gps_events).toBe(5);
    expect(body.total_distance_km).toBe(12.3);
    expect(body.distance_method).toBe('gps_coordinate_segments');
    expect(body.distance_valid_segments).toBe(4);
    expect(body.distance_rejected_speed_segments).toBe(1);
    expect(body.distance_gap_excluded_segments).toBe(2);
    expect(body.active_hours).toBeNull();
    expect(body.fuel_events).toBeNull();
    expect(body.geofence_violations).toBeNull();
    expect(body.metric_status).toMatchObject({
      total_distance_km: 'measured',
      active_hours: 'unavailable',
      fuel_events: 'unavailable',
      geofence_violations: 'unavailable',
    });

    const distanceSql = mocks.query.mock.calls.find(([sql]) => String(sql).includes('WITH windowed_fixes AS'))?.[0];
    expect(distanceSql).toContain('LAG(time)');
    expect(distanceSql).toContain('LAG(lat)');
    expect(distanceSql).toContain('LAG(lon)');
    expect(distanceSql).not.toContain('speed_kmh * 0.00833');
  });

  it('does not report zero kilometres as a measured result when no valid GPS segments exist', async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT(*)::text AS total FROM gps_fixes')) return [{ total: '0' }];
      if (sql.includes('WITH windowed_fixes AS')) {
        return [{
          km: null,
          valid_segments: '0',
          rejected_speed_segments: '0',
          gap_excluded_segments: '0',
        }];
      }
      return [];
    });

    const response = await app.inject({ method: 'GET', url: '/v4/analytics/summary?from=2026-10-01&to=2026-10-07' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total_gps_events).toBe(0);
    expect(body.total_distance_km).toBeNull();
    expect(body.metric_status.total_distance_km).toBe('unavailable');
  });

  it('derives executive KPIs from tenant-scoped records and leaves undefined safety scoring unavailable', async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT(DISTINCT v.id)::text AS total_vehicles')) {
        return [{ total_vehicles: '10', utilized_vehicles: '7' }];
      }
      if (sql.includes('eligible_deliveries')) {
        return [{ eligible_deliveries: '10', on_time_deliveries: '8' }];
      }
      if (sql.includes('FROM incidents')) return [{ active_incidents: '3' }];
      if (sql.includes('DATE_TRUNC')) return [{ week: '2026-10-12T00:00:00.000Z', gps_events: '120' }];
      return [];
    });

    const response = await app.inject({ method: 'GET', url: '/v4/analytics/executive-summary' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.fleet_utilization_pct).toBe(70);
    expect(body.on_time_delivery_pct).toBe(80);
    expect(body.safety_score).toBeNull();
    expect(body.active_incidents).toBe(3);
    expect(body.weekly_trends).toHaveLength(1);
    const fleetQueryCall = mocks.query.mock.calls.find(([sql]) => String(sql).includes('COUNT(DISTINCT v.id)::text AS total_vehicles'));
    expect(fleetQueryCall?.[1]?.[1]).toEqual([
      'created', 'vehicle_assigned', 'driver_assigned', 'awaiting_lock', 'locked',
      'dispatched', 'checkpoint', 'delayed', 'at_port',
    ]);
    expect(body.metric_definitions.fleet_utilization_pct).toContain('awaiting-lock');

    expect(body.metric_status).toMatchObject({
      fleet_utilization_pct: 'measured',
      on_time_delivery_pct: 'measured',
      safety_score: 'unavailable',
      active_incidents: 'measured',
    });
    expect(mocks.query.mock.calls.every(([sql, params]) => {
      return String(sql).includes('org_id = $1') && Array.isArray(params) && params[0] === '11111111-1111-4111-8111-111111111111';
    })).toBe(true);
  });

  it('does not synthesize executive KPIs when no metric source rows are available', async () => {
    mocks.query.mockResolvedValue([]);

    const response = await app.inject({ method: 'GET', url: '/v4/analytics/executive-summary' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.fleet_utilization_pct).toBeNull();
    expect(body.on_time_delivery_pct).toBeNull();
    expect(body.safety_score).toBeNull();
    expect(body.active_incidents).toBeNull();
    expect(Object.values(body.metric_status)).toEqual(['unavailable', 'unavailable', 'unavailable', 'unavailable']);
  });
});
