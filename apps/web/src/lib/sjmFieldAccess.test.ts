import { afterEach, describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { clearRevokedSjmFieldMissionCache } from './sjmFieldAccess.js';

describe('clearRevokedSjmFieldMissionCache', () => {
  let queryClient: QueryClient;

  afterEach(() => queryClient?.clear());

  it('removes revoked mission detail, events and channel data while preserving other assignments', async () => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const orgId = 'org-field-a';
    const userId = 'operator-a';
    const revokedId = 'mission-revoked';
    const otherId = 'mission-still-authorised';
    const assignmentKey = ['sjm-my-assignments', orgId, userId] as const;

    queryClient.setQueryData(assignmentKey, {
      data: [{ id: revokedId, title: 'Sensitive principal transfer' }, { id: otherId, title: 'Other task' }],
      generated_at: '2026-10-29T04:00:00.000Z',
    });
    queryClient.setQueryData(['sjm-field-detail', revokedId], { data: { principal_reference: 'SECRET-REF' } });
    queryClient.setQueryData(['sjm-field-events', revokedId], { data: [{ summary: 'SECRET FIELD REPORT' }] });
    queryClient.setQueryData(['sjm-mission-channel', revokedId], { data: { channel_id: 'SECRET-CHANNEL' } });
    queryClient.setQueryData(['sjm-field-detail', otherId], { data: { title: 'OTHER MISSION' } });

    await clearRevokedSjmFieldMissionCache(queryClient, orgId, userId, revokedId);

    expect(queryClient.getQueryData(assignmentKey)).toEqual({
      data: [{ id: otherId, title: 'Other task' }],
      generated_at: '2026-10-29T04:00:00.000Z',
    });
    expect(queryClient.getQueryData(['sjm-field-detail', revokedId])).toBeUndefined();
    expect(queryClient.getQueryData(['sjm-field-events', revokedId])).toBeUndefined();
    expect(queryClient.getQueryData(['sjm-mission-channel', revokedId])).toBeUndefined();
    expect(queryClient.getQueryData(['sjm-field-detail', otherId])).toEqual({ data: { title: 'OTHER MISSION' } });
  });

  it('cancels an in-flight assignment read before it can restore the revoked mission', async () => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const orgId = 'org-field-b';
    const userId = 'operator-b';
    const revokedId = 'mission-revoked';
    const assignmentKey = ['sjm-my-assignments', orgId, userId] as const;
    let releaseStaleResponse!: (value: { data: Array<{ id: string }> }) => void;
    const staleResponse = new Promise<{ data: Array<{ id: string }> }>(resolve => { releaseStaleResponse = resolve; });
    const pending = queryClient.fetchQuery({
      queryKey: assignmentKey,
      queryFn: () => staleResponse, // deliberately ignores AbortSignal
    }).catch(() => undefined);

    await clearRevokedSjmFieldMissionCache(queryClient, orgId, userId, revokedId);
    releaseStaleResponse({ data: [{ id: revokedId }] });
    await pending;
    await Promise.resolve();

    const current = queryClient.getQueryData<{ data: Array<{ id: string }> }>(assignmentKey);
    expect(current?.data.some(mission => mission.id === revokedId)).not.toBe(true);
  });
});
