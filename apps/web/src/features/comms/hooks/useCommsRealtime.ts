/**
 * Subscribes to the per-channel Centrifugo channel while a channel is open,
 * plus the org-wide badge channel for unread counts.
 *
 * Every event is treated as a hint: we invalidate the relevant TanStack Query
 * key rather than merging server-shaped data into the cache. That way, if we
 * miss an event during a reconnect gap, the next REST fetch produces the
 * correct end state (spec §4).
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { subscribe } from '../../../lib/centrifuge.js';
import { commsKeys } from './useComms.js';
import type { CommsEvent } from '../types/comms.js';

export function useCommsRealtime(orgId: string | undefined, activeChannelId: string | null) {
  const qc = useQueryClient();

  // Org-wide badge channel — cheap invalidate on any comms.* signal so unread
  // counts stay fresh across the whole channel list.
  useEffect(() => {
    if (!orgId) return;
    return subscribe<{ type?: string; channel_id?: string }>(`org#${orgId}`, (raw) => {
      if (!raw?.type || !raw.type.startsWith('comms.')) return;
      qc.invalidateQueries({ queryKey: commsKeys.channels });
    });
  }, [orgId, qc]);

  // Per-channel channel — rich payload, per-key invalidation.
  useEffect(() => {
    if (!orgId || !activeChannelId) return;
    return subscribe<CommsEvent>(`org#${orgId}#comms#${activeChannelId}`, (event) => {
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
          // Handled by the composer subscription; no cache impact.
          break;
      }
    });
  }, [orgId, activeChannelId, qc]);
}

/**
 * Standalone hook for the composer's typing indicator: subscribes to the
 * per-channel channel and reports the most recent typer other than the
 * current user. Times out after 5 s of silence.
 */
export function useTypingIndicator(
  orgId: string | undefined,
  activeChannelId: string | null,
  selfId: string | undefined,
): { name: string; expiresAt: number } | null {
  // Kept as module-scoped state so the caller can re-render on updates.
  const [state, setState] = useTypingState();
  useEffect(() => {
    if (!orgId || !activeChannelId) { setState(null); return; }
    return subscribe<CommsEvent>(`org#${orgId}#comms#${activeChannelId}`, (event) => {
      if (event.type !== 'typing') return;
      if (event.user_id === selfId) return;
      setState({ name: event.user_name || 'Someone', expiresAt: Date.now() + 5000 });
    });
  }, [orgId, activeChannelId, selfId, setState]);
  useEffect(() => {
    if (!state) return;
    const remaining = state.expiresAt - Date.now();
    if (remaining <= 0) { setState(null); return; }
    const t = setTimeout(() => setState(null), remaining);
    return () => clearTimeout(t);
  }, [state, setState]);
  return state;
}

// Simple useState wrapper isolated so useTypingIndicator stays tidy.
import { useState } from 'react';
function useTypingState() {
  return useState<{ name: string; expiresAt: number } | null>(null);
}
