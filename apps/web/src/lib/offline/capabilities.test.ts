/**
 * The capability matrix is the security boundary of the offline layer: it
 * decides what Sonalit will let someone do without a server. These tests exist
 * to make sure a future edit cannot quietly widen it.
 */
import { describe, expect, it } from 'vitest';

import { allSpecs, checkEligibility, getSpec } from './capabilities.js';

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

describe('offline classification', () => {
  it('refuses an e-lock command offline', () => {
    // A queued lock command is indistinguishable, to the person standing at the
    // container, from a lock that actually opened.
    const r = checkEligibility('elock.command', { role: 'operator', online: false, now: NOW });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe('online_required');
  });

  it('refuses delivery completion offline but allows the observation that precedes it', () => {
    const complete = checkEligibility('cds_trip.complete_delivery', { role: 'operator', online: false, now: NOW });
    expect(complete.allowed).toBe(false);

    const observe = checkEligibility('cds_trip.observation', { role: 'operator', online: false, now: NOW });
    expect(observe.allowed).toBe(true);
  });

  it('allows the same online operation when there is a connection', () => {
    // Offline restrictions constrain only the offline path; online, the server
    // is the authority and answers for itself.
    const r = checkEligibility('elock.command', { role: 'operator', online: true, now: NOW });
    expect(r.allowed).toBe(true);
  });

  it('allows append-only field records offline', () => {
    expect(checkEligibility('cds_incident.create', { role: 'yard_agent', online: false, now: NOW }).allowed).toBe(true);
    expect(checkEligibility('gps.batch', { role: 'cfo', online: false, now: NOW }).allowed).toBe(true);
  });

  it('rejects an unknown operation rather than defaulting to permitted', () => {
    const r = checkEligibility('some.new.thing', { role: 'admin', online: false, now: NOW });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe('unknown_operation');
  });
});

describe('role gating', () => {
  it('blocks a yard agent from a port-only operation', () => {
    const r = checkEligibility('cds_container.unclamp', { role: 'yard_agent', online: true, now: NOW });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe('forbidden_role');
  });

  it('blocks an analyst from recording incidents', () => {
    // analyst is a read role; it is deliberately absent from FIELD_ROLES.
    const r = checkEligibility('cds_incident.create', { role: 'analyst', online: true, now: NOW });
    expect(r.allowed).toBe(false);
  });
});

describe('restricted state changes', () => {
  const base = { role: 'yard_agent' as const, online: false, now: NOW };

  it('refuses a status change on a record this device has never synced', () => {
    const r = checkEligibility('cds_container.status_change', base);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe('not_synced');
  });

  it('refuses a status change without a revision to concur against', () => {
    const r = checkEligibility('cds_container.status_change', {
      ...base,
      localEntity: { revision: null, lastSyncedAt: NOW - 60_000 },
    });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe('missing_revision');
  });

  it('refuses a status change on a stale copy', () => {
    // Beyond the staleness window the local status is a rumour, and acting on a
    // rumour is how a device silently reverts someone else's delivery.
    const r = checkEligibility('cds_container.status_change', {
      ...base,
      localEntity: { revision: 4, lastSyncedAt: NOW - 13 * HOUR },
    });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe('stale_data');
  });

  it('allows a status change on a fresh, versioned copy', () => {
    const r = checkEligibility('cds_container.status_change', {
      ...base,
      localEntity: { revision: 4, lastSyncedAt: NOW - 5 * 60_000 },
    });
    expect(r.allowed).toBe(true);
  });
});

describe('matrix integrity', () => {
  it('gives every ONLINE_REQUIRED operation a reason a person can read', () => {
    for (const spec of allSpecs()) {
      if (spec.capability === 'ONLINE_REQUIRED') {
        expect(spec.onlineReason, `${spec.type} needs an onlineReason`).toBeTruthy();
      }
    }
  });

  it('gives every restricted operation actual restrictions', () => {
    for (const spec of allSpecs()) {
      if (spec.capability === 'OFFLINE_ALLOWED_WITH_RESTRICTIONS') {
        expect(spec.restrictions, `${spec.type} is restricted but names no restriction`).toBeTruthy();
      }
    }
  });

  it('never grants an operation to an empty role list', () => {
    for (const spec of allSpecs()) {
      expect(spec.roles.length, `${spec.type} has no roles`).toBeGreaterThan(0);
    }
  });

  it('declares a transport and priority for every operation', () => {
    for (const spec of allSpecs()) {
      expect(getSpec(spec.type)).toBe(spec);
      expect(['http', 'sync']).toContain(spec.transport);
      expect(spec.priority).toBeGreaterThanOrEqual(0);
    }
  });
});
