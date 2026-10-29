import { afterEach, describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { commsKeys } from './useComms.js';
import { clearRevokedSjmChannelCache } from './useCommsRealtime.js';

describe('clearRevokedSjmChannelCache', () => {
  let queryClient: QueryClient;

  afterEach(() => {
    queryClient?.clear();
  });

  const seedSensitiveCache = (client: QueryClient, channelId: string) => {
    client.setQueryData(commsKeys.channels, [{ id: channelId, name: 'Mission team' }]);
    client.setQueryData(commsKeys.messages(channelId), { data: [{ id: 'm-1', body: 'SECRET MESSAGE' }], next_cursor: null });
    client.setQueryData(commsKeys.members(channelId), [{ user_id: 'officer-1', name: 'Secret Officer' }]);
    client.setQueryData(commsKeys.pinned(channelId), [{ message_id: 'm-1', body: 'SECRET PIN' }]);
    client.setQueryData(commsKeys.thread(channelId, 'm-1'), [{ id: 'm-2', body: 'SECRET THREAD REPLY' }]);
    client.setQueryData(commsKeys.thread('another-channel', 'm-9'), [{ id: 'm-10', body: 'OTHER CHANNEL' }]);
  };

  it('removes private data and blanks the visible channel list when the active mission rotates', async () => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const channelId = 'mission-channel-private';
    seedSensitiveCache(queryClient, channelId);

    await clearRevokedSjmChannelCache(queryClient, channelId, true);

    expect(queryClient.getQueryData(commsKeys.channels)).toEqual([]);
    expect(queryClient.getQueryData(commsKeys.messages(channelId))).toBeUndefined();
    expect(queryClient.getQueryData(commsKeys.members(channelId))).toBeUndefined();
    expect(queryClient.getQueryData(commsKeys.pinned(channelId))).toBeUndefined();
    expect(queryClient.getQueryData(commsKeys.thread(channelId, 'm-1'))).toBeUndefined();
    expect(queryClient.getQueryData(commsKeys.thread('another-channel', 'm-9'))).toEqual([{ id: 'm-10', body: 'OTHER CHANNEL' }]);
  });

  it('fences an in-flight channel list when revocation arrives before the first snapshot', async () => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const channelId = 'revoked-before-first-snapshot';
    let resolveList!: (value: Array<{ id: string; name: string; last_message?: { body: string } }>) => void;
    const inFlightList = new Promise<Array<{ id: string; name: string; last_message?: { body: string } }>>((resolve) => {
      resolveList = resolve;
    });
    const pendingQuery = queryClient.fetchQuery({
      queryKey: commsKeys.channels,
      queryFn: () => inFlightList,
    }).catch(() => undefined);

    expect(queryClient.getQueryData(commsKeys.channels)).toBeUndefined();
    expect(queryClient.getQueryState(commsKeys.channels)?.fetchStatus).toBe('fetching');

    const revocation = clearRevokedSjmChannelCache(queryClient, channelId, false);
    // An unknown snapshot is fenced as an empty list rather than left to race the
    // original request; the previous request deliberately ignores AbortSignal here.
    expect(queryClient.getQueryData(commsKeys.channels)).toEqual([]);
    resolveList([{ id: channelId, name: 'Revoked mission', last_message: { body: 'SECRET PREVIEW' } }]);

    await pendingQuery;
    await revocation;
    expect(queryClient.getQueryData(commsKeys.channels)).toEqual([]);
    expect(queryClient.getQueryData(commsKeys.channels)).not.toContainEqual(
      expect.objectContaining({ id: channelId }),
    );
  });

  it('removes an inactive mission cache without disrupting the currently visible channel list', async () => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const channelId = 'inactive-mission-channel';
    queryClient.setQueryData(commsKeys.channels, [{ id: channelId, name: 'Old mission' }, { id: 'still-authorised', name: 'Open channel' }]);
    seedSensitiveCache(queryClient, channelId);
    queryClient.setQueryData(commsKeys.channels, [
      { id: channelId, name: 'Old mission', last_message: { body: 'SECRET PREVIEW' } },
      { id: 'still-authorised', name: 'Open channel', last_message: { body: 'AUTHORISED CHANNEL' } },
    ]);

    await clearRevokedSjmChannelCache(queryClient, channelId, false);

    expect(queryClient.getQueryData(commsKeys.channels)).toEqual([
      { id: 'still-authorised', name: 'Open channel', last_message: { body: 'AUTHORISED CHANNEL' } },
    ]);
    expect(queryClient.getQueryData(commsKeys.messages(channelId))).toBeUndefined();
    expect(queryClient.getQueryData(commsKeys.pinned(channelId))).toBeUndefined();
    expect(queryClient.getQueryData(commsKeys.thread(channelId, 'm-1'))).toBeUndefined();
    expect(queryClient.getQueryData(commsKeys.thread('another-channel', 'm-9'))).toEqual([{ id: 'm-10', body: 'OTHER CHANNEL' }]);
  });
});
