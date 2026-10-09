import { describe, expect, it } from 'vitest';

import { countActiveQueueEntries } from './outbox.js';

describe('tenant-scoped offline queue capacity', () => {
  const entry = (
    ownerUserId: string,
    ownerOrgId: string,
    status: 'PENDING' | 'FAILED_RETRYABLE' | 'SYNCING' | 'ACKNOWLEDGED' | 'FAILED_PERMANENT' | 'CONFLICT',
  ) => ({ ownerUserId, ownerOrgId, status });

  it('counts only unresolved entries belonging to the active user and organization', () => {
    const entries = [
      entry('user-a', 'org-a', 'PENDING'),
      entry('user-a', 'org-a', 'FAILED_RETRYABLE'),
      entry('user-a', 'org-a', 'SYNCING'),
      entry('user-a', 'org-a', 'ACKNOWLEDGED'),
      entry('user-a', 'org-a', 'FAILED_PERMANENT'),
      entry('user-a', 'org-a', 'CONFLICT'),
      entry('user-a', 'org-b', 'PENDING'),
      entry('user-b', 'org-a', 'PENDING'),
      entry('user-b', 'org-b', 'FAILED_RETRYABLE'),
    ];

    expect(countActiveQueueEntries(entries, 'user-a', 'org-a')).toBe(3);
    expect(countActiveQueueEntries(entries, 'user-a', 'org-b')).toBe(1);
    expect(countActiveQueueEntries(entries, 'user-b', 'org-a')).toBe(1);
    expect(countActiveQueueEntries(entries, 'user-c', 'org-c')).toBe(0);
  });

  it('does not let another tenant’s backlog consume the active tenant’s queue budget', () => {
    const priorTenantBacklog = Array.from({ length: 5_000 }, (_, index) =>
      entry('shared-device-user', 'previous-org', index % 2 ? 'PENDING' : 'FAILED_RETRYABLE'),
    );
    priorTenantBacklog.push(entry('shared-device-user', 'current-org', 'PENDING'));

    expect(countActiveQueueEntries(priorTenantBacklog, 'shared-device-user', 'current-org')).toBe(1);
  });

  it('returns zero for an empty queue and excludes terminal outcomes', () => {
    expect(countActiveQueueEntries([], 'user-a', 'org-a')).toBe(0);
    expect(countActiveQueueEntries([
      entry('user-a', 'org-a', 'ACKNOWLEDGED'),
      entry('user-a', 'org-a', 'FAILED_PERMANENT'),
      entry('user-a', 'org-a', 'CONFLICT'),
    ], 'user-a', 'org-a')).toBe(0);
  });
});
