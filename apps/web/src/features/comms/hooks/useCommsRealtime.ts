/**
 * Subscribes to the per-channel Centrifugo channel (rich payload) while a
 * channel is open, plus the org-wide badge channel for unread counts.
 *
 * One `useEffect` per Centrifuge subscription — Centrifuge rejects duplicate
 * subscriptions on the same channel, and the typing indicator needs to piggy-
 * back on the same per-channel subscription rather than open a second one.
 *
 * Every event just invalidates the relevant TanStack Query key — the REST
 * endpoints are the source of truth (spec §4). A reconnect gap self-heals on
 * the next fetch.
 */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { subscribe } from '../../../lib/centrifuge.js';
import { commsKeys } from './useComms.js';

/**
 * Clear all cached private data associated with an SJM channel when its
 * assignment roster rotates. The channel list is blanked until an authorised
 * REST refresh returns, preventing stale membership from reselecting the
 * channel while the server denies access.
 */
export function clearRevokedSjmChannelCache(
  qc: ReturnType<typeof useQueryClient>,
  channelId: string,
  blankChannelList = true,
): void {
  qc.removeQueries({ queryKey: commsKeys.messages(channelId), exact: true });
  qc.removeQueries({ queryKey: commsKeys.members(channelId), exact: true });
  qc.removeQueries({ queryKey: commsKeys.pinned(channelId), exact: true });
  qc.removeQueries({ queryKey: ['comms', 'channels', channelId, 'thread'] });
  if (blankChannelList) {
    // The active channel's old membership snapshot is no longer trustworthy.
    // Keep the visible list empty until the server returns a fresh authorised list.
    qc.setQueryData(commsKeys.channels, []);
  }
  void qc.invalidateQueries({ queryKey: commsKeys.channels, exact: true });
}
import type { CommsEvent } from '../types/comms.js';

export interface TypingState { name: string; expiresAt: number }

/**
 * Handles invalidation of comms queries when realtime events fire, and
 * returns the current typing indicator (if any) for the active channel.
 * Combines what used to be two hooks so only one Centrifuge subscription is
 * opened per per-channel channel.
 */
export function useCommsRealtime(
  orgId: string | undefined,
  activeChannelId: string | null,
  selfId: string | undefined,
  realtimeChannelName?: string | null,
  missionQueryId?: string | null,
  onSjmRosterChanged?: (channelId: string) => void,
): TypingState | null {
  const qc = useQueryClient();
  const [typing, setTyping] = useState<TypingState | null>(null);

  // Org-wide badge channel — cheap invalidate on any comms.* signal so unread
  // counts stay fresh across the whole channel list.
  useEffect(() => {
    if (!orgId) return;
    return subscribe<{ type?: string; channel_id?: string }>(`org#${orgId}`, (raw) => {
      if (!raw?.type || !raw.type.startsWith('comms.')) return;

      if (raw.type === 'comms.sjm.roster_changed' && raw.channel_id) {
        // Roster changes invalidate cached content for the affected mission even
        // when it is not the open channel. If it is open, also blank the channel
        // list and immediately leave the workspace until access is re-authorised.
        const isActiveChannel = raw.channel_id === activeChannelId;
        clearRevokedSjmChannelCache(qc, raw.channel_id, isActiveChannel);
        if (isActiveChannel) {
          onSjmRosterChanged?.(raw.channel_id);
          if (missionQueryId) {
            void qc.invalidateQueries({ queryKey: ['sjm-mission-channel', missionQueryId] });
          }
        }
        return;
      }

      qc.invalidateQueries({ queryKey: commsKeys.channels });
      // SJM chat publishes only a tenant-scoped invalidation signal, never a rich
      // message payload to a private realtime channel. Refetch authorised REST data
      // under the server's current assignment check.
      if (raw.channel_id && raw.channel_id === activeChannelId) {
        qc.invalidateQueries({ queryKey: commsKeys.messages(activeChannelId) });
        qc.invalidateQueries({ queryKey: commsKeys.members(activeChannelId) });
        qc.invalidateQueries({ queryKey: commsKeys.pinned(activeChannelId) });
        qc.invalidateQueries({ queryKey: ['comms', 'channels', activeChannelId, 'thread'] });
      }
    });
  }, [orgId, activeChannelId, missionQueryId, onSjmRosterChanged, qc]);

  // Per-channel channel — handles both cache invalidation AND typing events.
  useEffect(() => {
    if (!orgId || !activeChannelId) { setTyping(null); return; }
    const channelName = realtimeChannelName || `org#${orgId}#comms#${activeChannelId}`;
    return subscribe<CommsEvent>(channelName, (event) => {
      switch (event.type) {
        case 'message.created':
        case 'message.deleted':
        case 'reaction.added':
        case 'reaction.removed':
          qc.invalidateQueries({ queryKey: commsKeys.messages(activeChannelId) });
          if (event.message?.reply_to_id) {
            qc.invalidateQueries({
              queryKey: commsKeys.thread(activeChannelId, event.message.reply_to_id),
            });
          }
          break;
        case 'member.added':
        case 'member.removed':
        case 'member.updated':
          qc.invalidateQueries({ queryKey: commsKeys.members(activeChannelId) });
          break;
        case 'pin.added':
        case 'pin.removed':
          qc.invalidateQueries({ queryKey: commsKeys.pinned(activeChannelId) });
          break;
        case 'channel.deleted':
          qc.invalidateQueries({ queryKey: commsKeys.channels });
          break;
        case 'typing':
          if (event.user_id === selfId) break;
          setTyping({ name: event.user_name || 'Someone', expiresAt: Date.now() + 5000 });
          break;
      }
    });
  }, [orgId, activeChannelId, selfId, realtimeChannelName, qc]);

  // Auto-clear the typing indicator when its TTL expires.
  useEffect(() => {
    if (!typing) return;
    const remaining = typing.expiresAt - Date.now();
    if (remaining <= 0) { setTyping(null); return; }
    const t = setTimeout(() => setTyping(null), remaining);
    return () => clearTimeout(t);
  }, [typing]);

  return typing;
}
