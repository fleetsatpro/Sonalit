'use strict';

/**
 * Replication scope is what stops a shared yard tablet from holding an offline
 * copy of the convoy roster. RLS already handles tenant isolation; what it
 * cannot express is "inside one org, this role sees a far narrower slice", and
 * that is decided here — server-side, from the authenticated role only.
 */

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DATABASE_URL = 'postgresql://localhost/test_placeholder';

jest.mock('../src/config/database', () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
  pool: { connect: jest.fn(), end: jest.fn() },
  healthCheck: jest.fn().mockResolvedValue(true),
}));

const { ENTITY_TYPES, resolveEntityTypes, scopeFor } = require('../src/sync/scope');

describe('scopeFor', () => {
  it('gives office roles the full replicated set', () => {
    for (const role of ['admin', 'dispatcher', 'operator']) {
      expect(scopeFor({ role }).sort()).toEqual([...ENTITY_TYPES].sort());
    }
  });

  it('narrows a yard agent to the clamp flow only', () => {
    // Their routes in cds.js are scoped to clamp/unclamp; the offline copy must
    // match that, not exceed it.
    expect(scopeFor({ role: 'yard_agent' }).sort())
      .toEqual(['cds_booking', 'cds_container', 'cds_trip']);
  });

  it('keeps convoy data away from yard and port agents', () => {
    expect(scopeFor({ role: 'yard_agent' })).not.toContain('convoy');
    expect(scopeFor({ role: 'port_agent' })).not.toContain('convoy');
  });

  it('gives an unknown role nothing rather than defaulting to something', () => {
    // A role added later must be granted offline access explicitly. Defaulting
    // to any non-empty set is how a new role silently inherits the fleet.
    expect(scopeFor({ role: 'some_future_role' })).toEqual([]);
    expect(scopeFor({})).toEqual([]);
    expect(scopeFor(null)).toEqual([]);
  });

  it('returns a fresh array each call, so a caller cannot mutate the table', () => {
    const a = scopeFor({ role: 'admin' });
    a.push('secrets');
    expect(scopeFor({ role: 'admin' })).not.toContain('secrets');
  });
});

describe('resolveEntityTypes', () => {
  const yard = { role: 'yard_agent' };

  it('defaults to everything the role is allowed', () => {
    expect(resolveEntityTypes(yard, undefined).sort())
      .toEqual(['cds_booking', 'cds_container', 'cds_trip']);
    expect(resolveEntityTypes(yard, []).length).toBe(3);
  });

  it('silently drops a requested type outside the role scope', () => {
    // A client asking for something it cannot have is usually a newer app
    // version, not an attack — but it must not be served either way.
    expect(resolveEntityTypes(yard, ['cds_container', 'convoy', 'vehicle']))
      .toEqual(['cds_container']);
  });

  it('cannot be widened by an unrecognised type name', () => {
    expect(resolveEntityTypes(yard, ['users', 'organizations', '*'])).toEqual([]);
  });

  it('honours a legitimate narrowing request', () => {
    // Bandwidth control: a screen that only needs containers says so.
    expect(resolveEntityTypes({ role: 'admin' }, ['cds_container'])).toEqual(['cds_container']);
  });
});
