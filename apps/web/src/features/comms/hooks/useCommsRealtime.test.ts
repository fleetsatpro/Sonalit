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

  it('removes private data and blanks the visible channel list when the active mission rotates', () => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const channelId = 'mission-channel-private';
    seedSensitiveCache(queryClient, channelId);

    clearRevokedSjmChannelCache(queryClient, channelId, true);

    expect(queryClient.getQueryData(commsKeys.channels)).toEqual([]);
    expect(queryClient.getQueryData(commsKeys.messages(channelId))).toBeUndefined();
    expect(queryClient.getQueryData(commsKeys.members(channelId))).toBeUndefined();
    expect(queryClient.getQueryData(commsKeys.pinned(channelId))).toBeUndefined();
    expect(queryClient.getQueryData(commsKeys.thread(channelId, 'm-1'))).toBeUndefined();
    expect(queryClient.getQueryData(commsKeys.thread('another-channel', 'm-9'))).toEqual([{ id: 'm-10', body: 'OTHER CHANNEL' }]);
  });

  it('removes an inactive mission cache without disrupting the currently visible channel list', () => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const channelId = 'inactive-mission-channel';
    queryClient.setQueryData(commsKeys.channels, [{ id: channelId, name: 'Old mission' }, { id: 'still-authorised', name: 'Open channel' }]);
    seedSensitiveCache(queryClient, channelId);
    queryClient.setQueryData(commsKeys.channels, [{ id: channelId, name: 'Old mission' }, { id: 'still-authorised', name: 'Open channel' }]);

    clearRevokedSjmChannelCache(queryClient, channelId, false);

    expect(queryClient.getQueryData(commsKeys.channels)).toEqual([
      { id: channelId, name: 'Old mission' },
      { id: 'still-authorised', name: 'Open channel' },
    ]);
    expect(queryClient.getQueryData(commsKeys.messages(channelId))).toBeUndefined();
    expect(queryClient.getQueryData(commsKeys.pinned(channelId))).toBeUndefined();
    expect(queryClient.getQueryData(commsKeys.thread(channelId, 'm-1'))).toBeUndefined();
    expect(queryClient.getQueryData(commsKeys.thread('another-channel', 'm-9'))).toEqual([{ id: 'm-10', body: 'OTHER CHANNEL' }]);
  });
});
