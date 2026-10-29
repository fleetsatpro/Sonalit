import { afterEach, describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { commsKeys } from './useComms.js';
import { clearRevokedSjmChannelCache } from './useCommsRealtime.js';

describe('clearRevokedSjmChannelCache', () => {
  let queryClient: QueryClient;

  afterEach(() => {
    queryClient?.clear();
  });

  it('removes cached mission messages, pins, members and threads before refreshing channel access', () => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const channelId = 'mission-channel-private';
    queryClient.setQueryData(commsKeys.channels, [{ id: channelId, name: 'Mission team' }]);
    queryClient.setQueryData(commsKeys.messages(channelId), { data: [{ id: 'm-1', body: 'SECRET MESSAGE' }], next_cursor: null });
    queryClient.setQueryData(commsKeys.members(channelId), [{ user_id: 'officer-1', name: 'Secret Officer' }]);
    queryClient.setQueryData(commsKeys.pinned(channelId), [{ message_id: 'm-1', body: 'SECRET PIN' }]);
    queryClient.setQueryData(commsKeys.thread(channelId, 'm-1'), [{ id: 'm-2', body: 'SECRET THREAD REPLY' }]);
    queryClient.setQueryData(commsKeys.thread('another-channel', 'm-9'), [{ id: 'm-10', body: 'OTHER CHANNEL' }]);

    clearRevokedSjmChannelCache(queryClient, channelId);

    expect(queryClient.getQueryData(commsKeys.channels)).toEqual([]);
    expect(queryClient.getQueryData(commsKeys.messages(channelId))).toBeUndefined();
    expect(queryClient.getQueryData(commsKeys.members(channelId))).toBeUndefined();
    expect(queryClient.getQueryData(commsKeys.pinned(channelId))).toBeUndefined();
    expect(queryClient.getQueryData(commsKeys.thread(channelId, 'm-1'))).toBeUndefined();
    expect(queryClient.getQueryData(commsKeys.thread('another-channel', 'm-9'))).toEqual([{ id: 'm-10', body: 'OTHER CHANNEL' }]);
  });
});
