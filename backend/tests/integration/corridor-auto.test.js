/**
 * 4D geofence corridor — end-to-end integration.
 *
 * Unlike tests/corridor-routes.test.js, nothing here is stubbed: this runs
 * against a live PostgreSQL with the real migrations applied, and calls the
 * real routing engine over the network. It is the only test that can prove the
 * feature actually works rather than that its mocks agree with each other.
 *
 * What it exercises for real:
 *   - convoy_route_corridors round-trip through the real schema + RLS role
 *   - the real risk_zones table, including the globally seeded intel rows
 *   - live OSRM/Mapbox alternatives for a real 800 km road
 *   - the safest-route choice made against genuine road geometry
 *
 * Skips (does not fail) without DATABASE_URL, matching the other integration
 * tests, so the unit suite stays runnable on a laptop with no database.
 */
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { Pool } = require('pg');

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

// Kisumu -> Mombasa: a real ~800 km trunk route with genuine alternatives.
const ORIGIN = 'Kisumu, Kenya';
const DESTINATION = 'Mombasa, Kenya';

const ORG = 'cccccccc-0000-0000-0000-00000000c0de';
const CONVOY = 'cccccccc-0000-0000-0001-00000000c0de';
// Real hazard areas on that corridor, inserted as fixtures because the shipped
// seed only carries zones outside East Africa.
const TSAVO = 'cccccccc-0000-0000-0002-00000000c0de';
const SALGAA = 'cccccccc-0000-0000-0003-00000000c0de';

let pool;
let planRouteAlternatives, rankRoutes, geocode, geoEnv;

beforeAll(async () => {
  if (!HAS_DB) return;
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  ({ planRouteAlternatives } = require('../../src/services/geo/routePlan'));
  ({ rankRoutes } = require('../../src/services/geo/routeRisk'));
  ({ geocode } = require('../../src/services/geo/geocode'));
  geoEnv = require('../../src/services/geo/providerEnv');

  await pool.query(
    `INSERT INTO convoys (id, name, region, status, org_id, route_origin, route_destination, departure_time)
     VALUES ($1, 'ITEST Kisumu-Mombasa', 'East Africa', 'planned', $2, $3, $4, now() - interval '5 hours')
     ON CONFLICT (id) DO UPDATE
       SET route_origin = EXCLUDED.route_origin, route_destination = EXCLUDED.route_destination`,
    [CONVOY, ORG, ORIGIN, DESTINATION],
  );
});

afterAll(async () => {
  if (!pool) return;
  await pool.query('DELETE FROM convoy_route_corridors WHERE convoy_id = $1', [CONVOY]);
  await pool.query('DELETE FROM risk_zones WHERE id = ANY($1)', [[TSAVO, SALGAA]]);
  await pool.query('DELETE FROM convoys WHERE id = $1', [CONVOY]);
  await pool.end();
});

d('the real database', () => {
  test('convoy_route_corridors round-trips a real routed line through the live schema', async () => {
    const line = [
      { lat: -0.0917, lng: 34.768 }, { lat: -1.2921, lng: 36.8219 }, { lat: -4.0435, lng: 39.6682 },
    ];
    await pool.query(
      `INSERT INTO convoy_route_corridors (org_id, convoy_id, route_line, width_km)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (convoy_id) DO UPDATE
         SET route_line = EXCLUDED.route_line, width_km = EXCLUDED.width_km, active = true`,
      [ORG, CONVOY, JSON.stringify(line), 2.5],
    );

    const { rows } = await pool.query(
      'SELECT route_line, width_km, active FROM convoy_route_corridors WHERE convoy_id = $1', [CONVOY],
    );
    expect(rows).toHaveLength(1);
    // jsonb comes back parsed, and NUMERIC(4,1) comes back as a string — both
    // assumptions the route handlers rely on.
    expect(Array.isArray(rows[0].route_line)).toBe(true);
    expect(rows[0].route_line).toHaveLength(3);
    expect(Number(rows[0].width_km)).toBe(2.5);
    expect(rows[0].active).toBe(true);
  });

  test('the ON CONFLICT upsert replaces rather than duplicating a corridor', async () => {
    for (const w of [1.0, 3.0]) {
      await pool.query(
        `INSERT INTO convoy_route_corridors (org_id, convoy_id, route_line, width_km)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (convoy_id) DO UPDATE
           SET route_line = EXCLUDED.route_line, width_km = EXCLUDED.width_km, active = true`,
        [ORG, CONVOY, JSON.stringify([{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }]), w],
      );
    }
    const { rows } = await pool.query(
      'SELECT width_km FROM convoy_route_corridors WHERE convoy_id = $1', [CONVOY],
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].width_km)).toBe(3.0);
  });

  test('the shipped risk-zone intel is readable by the corridor query', async () => {
    // Exactly the query routes/convoys.js runs for the live overlay.
    const { rows } = await pool.query(
      `SELECT id, name, risk_level, zone_type, lat, lng, radius_km
         FROM risk_zones
        WHERE active = true
          AND (org_id = $1 OR org_id IS NULL)
          AND (valid_from  IS NULL OR valid_from  <= now())
          AND (valid_until IS NULL OR valid_until >= now())`,
      [ORG],
    );
    // The shipped seed is global conflict intel; it must at least parse.
    for (const z of rows) {
      expect(Number.isFinite(Number(z.lat))).toBe(true);
      expect(Number.isFinite(Number(z.lng))).toBe(true);
      expect(Number(z.radius_km)).toBeGreaterThan(0);
    }
  });
});

d('the real routing engine', () => {
  // A live network call to a public router; give it room.
  jest.setTimeout(90_000);

  let candidates;

  test('returns real road alternatives for Kisumu -> Mombasa', async () => {
    candidates = await planRouteAlternatives(
      [{ lat: -0.0917, lng: 34.768 }, { lat: -4.0435, lng: 39.6682 }],
      { osrmUrl: geoEnv.osrmUrl(), mapboxToken: geoEnv.mapboxToken() },
    );

    expect(candidates.length).toBeGreaterThanOrEqual(1);
    for (const c of candidates) {
      // A real road, not the straight line between the endpoints (~735 km).
      expect(c.distance_km).toBeGreaterThan(750);
      expect(c.distance_km).toBeLessThan(1400);
      expect(c.duration_min).toBeGreaterThan(300);
      // capPoints must have honoured its cap on a route with >10k vertices.
      expect(c.route.length).toBeGreaterThan(50);
      expect(c.route.length).toBeLessThanOrEqual(300);
      expect(['osrm', 'mapbox']).toContain(c.provider);
    }
  });

  test('the geometry follows the road rather than cutting across country', async () => {
    const route = candidates[0].route;
    // Nairobi sits on this corridor; a straight Kisumu->Mombasa line passes
    // well south of it. Real road geometry must come close.
    const nairobi = { lat: -1.2921, lng: 36.8219 };
    const nearest = Math.min(...route.map(p =>
      Math.hypot((p.lat - nairobi.lat) * 111.32, (p.lng - nairobi.lng) * 111.32 * Math.cos(nairobi.lat * Math.PI / 180))));
    expect(nearest).toBeLessThan(40);
  });

  test('scoring a real route against the real zone table runs clean', async () => {
    const { rows: zones } = await pool.query(
      `SELECT id, name, risk_level, zone_type, lat, lng, radius_km
         FROM risk_zones WHERE active = true AND (org_id = $1 OR org_id IS NULL)`,
      [ORG],
    );
    const { best, ranked } = rankRoutes(candidates, zones);
    expect(ranked).toHaveLength(candidates.length);
    expect(best).not.toBeNull();
    expect(Number.isFinite(best.score)).toBe(true);
    // The shipped intel covers Somalia, the Sahel, Afghanistan — none of which
    // a Kenyan trunk route touches.
    expect(best.exposed_km).toBe(0);
    expect(best.blocked).toBe(false);
  });

  test('a hazard planted on the real road is detected, and the safer road wins', async () => {
    // Tsavo, on the Nairobi-Mombasa leg that every candidate uses.
    await pool.query(
      `INSERT INTO risk_zones (id, name, risk_level, zone_type, lat, lng, radius_km, active, org_id)
       VALUES ($1, 'ITEST Tsavo ambush stretch', 'critical', 'theft_hotspot', -3.35, 38.55, 45, true, $2)
       ON CONFLICT (id) DO UPDATE SET radius_km = EXCLUDED.radius_km, risk_level = EXCLUDED.risk_level`,
      [TSAVO, ORG],
    );
    const { rows: zones } = await pool.query(
      `SELECT id, name, risk_level, zone_type, lat, lng, radius_km
         FROM risk_zones WHERE active = true AND (org_id = $1 OR org_id IS NULL)`,
      [ORG],
    );

    const { best, ranked } = rankRoutes(candidates, zones);

    // Real geometry really does pass through it.
    expect(best.exposed_km).toBeGreaterThan(5);
    expect(best.worst).toBe('critical');
    expect(best.exposures[0].name).toBe('ITEST Tsavo ambush stretch');
    // And of the real alternatives, the least-exposed one is chosen.
    const minExposure = Math.min(...ranked.map(r => r.exposed_km));
    expect(best.exposed_km).toBe(minExposure);
  });

  test('a no-go closure on the shorter road makes the system take the longer one', async () => {
    // The two real OSRM alternatives diverge west of Nakuru. Closing that leg
    // is the sharpest possible test of the product rule: the blocked road here
    // is the SHORTER one, so distance alone would have picked it.
    await pool.query(
      `INSERT INTO risk_zones (id, name, risk_level, zone_type, lat, lng, radius_km, active, org_id)
       VALUES ($1, 'ITEST Salgaa closure', 'no_go', 'road_closed', -0.40, 36.10, 60, true, $2)
       ON CONFLICT (id) DO UPDATE SET risk_level = 'no_go', radius_km = 60`,
      [SALGAA, ORG],
    );
    const { rows: zones } = await pool.query(
      `SELECT id, name, risk_level, zone_type, lat, lng, radius_km
         FROM risk_zones WHERE active = true AND (org_id = $1 OR org_id IS NULL)`,
      [ORG],
    );

    const { best, ranked } = rankRoutes(candidates, zones);
    const blocked = ranked.filter(r => r.blocked);

    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked.some(r => r.exposures.some(e => e.risk_level === 'no_go'))).toBe(true);

    // The chosen road is not blocked...
    expect(best.blocked).toBe(false);
    // ...even though a blocked one was shorter.
    expect(Math.min(...blocked.map(r => r.distance_km))).toBeLessThan(best.distance_km);
  });
});

d('the real geocoder', () => {
  jest.setTimeout(60_000);

  test('resolves the convoy\'s own endpoints with whatever provider is configured', async () => {
    const { rows } = await pool.query(
      'SELECT route_origin, route_destination FROM convoys WHERE id = $1', [CONVOY],
    );
    expect(rows[0].route_origin).toBe(ORIGIN);

    // No Mapbox token needed: the keyless fallback must carry this on its own,
    // which is the whole point of adding it.
    const o = await geocode(rows[0].route_origin, { mapboxToken: geoEnv.mapboxToken(), limit: 1 });
    expect(['mapbox', 'nominatim']).toContain(o.provider);
    expect(o.results.length).toBeGreaterThan(0);
    expect(Math.abs(o.results[0].lat - -0.0917)).toBeLessThan(1);
    expect(Math.abs(o.results[0].lng - 34.768)).toBeLessThan(1);

    const dst = await geocode(rows[0].route_destination, { mapboxToken: geoEnv.mapboxToken(), limit: 1 });
    expect(dst.results.length).toBeGreaterThan(0);
    expect(Math.abs(dst.results[0].lat - -4.0435)).toBeLessThan(1);
    expect(Math.abs(dst.results[0].lng - 39.6682)).toBeLessThan(1);
  });

  test('an unresolvable place name yields nothing rather than a wrong pin', async () => {
    const r = await geocode('zzzqqqx nonexistent place 99999', { mapboxToken: geoEnv.mapboxToken() });
    expect(r.results).toEqual([]);
    expect(r.provider).toBeNull();
  });
});
