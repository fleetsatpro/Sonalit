import { describe, expect, it } from 'vitest';

import { scopeBufferedFixesForTenant } from './gpsBuffer.js';
import type { BufferedFix } from './types.js';

const fix = (
  id: string,
  ownerUserId: string,
  ownerOrgId: string,
  sequence: number,
): BufferedFix => ({
  id,
  vehicleId: 'vehicle-1',
  tripId: 'trip-1',
  lat: 1,
  lng: 2,
  accuracy: 5,
  speed: 10,
  heading: 90,
  altitude: null,
  deviceTime: '2026-10-09T12:00:00.000Z',
  sequence,
  ownerUserId,
  ownerOrgId,
});

describe('buffered GPS tenant boundary', () => {
  const activeUser = 'user-a';
  const activeOrg = 'org-a';

  it('includes only fixes owned by the current user and current organisation', () => {
    const rows = [
      fix('current-late', activeUser, activeOrg, 9),
      fix('old-org', activeUser, 'org-old', 1),
      fix('other-user', 'user-b', activeOrg, 2),
      fix('current-early', activeUser, activeOrg, 3),
    ];

    expect(scopeBufferedFixesForTenant(rows, activeUser, activeOrg).map(row => row.id))
      .toEqual(['current-early', 'current-late']);
  });

  it('does not re-label old-tenant GPS fixes when a user returns to a different organisation', () => {
    const staleRows = [
      fix('tenant-a-fix', activeUser, 'org-a', 1),
      fix('tenant-b-fix', activeUser, 'org-b', 2),
    ];

    expect(scopeBufferedFixesForTenant(staleRows, activeUser, 'org-b').map(row => row.id))
      .toEqual(['tenant-b-fix']);
  });

  it('returns no fixes when no buffered row is owned by the active tenant', () => {
    expect(scopeBufferedFixesForTenant(
      [fix('foreign', activeUser, 'org-other', 1)],
      activeUser,
      activeOrg,
    )).toEqual([]);
  });

  it('orders the selected tenant fixes by their original device sequence without mutating storage rows', () => {
    const rows = [
      fix('second', activeUser, activeOrg, 2),
      fix('foreign', activeUser, 'org-other', 1),
      fix('first', activeUser, activeOrg, 1),
    ];
    const orderBefore = rows.map(row => row.id);

    const result = scopeBufferedFixesForTenant(rows, activeUser, activeOrg);

    expect(result.map(row => row.id)).toEqual(['first', 'second']);
    expect(rows.map(row => row.id)).toEqual(orderBefore);
  });
});
