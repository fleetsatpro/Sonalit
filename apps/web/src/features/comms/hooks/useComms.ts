/**
 * TanStack Query hooks for Ops Comms.
 *
 * All calls go through `api` (Bearer + CSRF handled by the interceptors).
 * The realtime layer (useCommsRealtime) invalidates these queries in place —
 * the REST endpoints stay the source of truth (spec §4).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api.js';
import type {
  Channel, ChannelMember, Message, PinnedMessage, OrgUser,
} from '../types/comms.js';

// ── Query keys ─────────────────────────────────────────────────────────────
export const commsKeys = {
  channels:       ['comms', 'channels'] as const,
  members:        (channelId: string) => ['comms', 'channels', channelId, 'members'] as const,
  messages:       (channelId: string) => ['comms', 'channels', channelId, 'messages'] as const,
  pinned:         (channelId: string) => ['comms', 'channels', channelId, 'pinned'] as const,
  thread:         (channelId: string, msgId: string) =>
    ['comms', 'channels', channelId, 'thread', msgId] as const,
  orgUsers:       ['comms', 'org-users'] as const,
};

// ── Queries ────────────────────────────────────────────────────────────────

export function useChannels() {
  return useQuery({
    queryKey: commsKeys.channels,
    queryFn: async (): Promise<Channel[]> => {
      const r = await api.get<{ data: Channel[] }>('/messages/channels');
      return r.data.data ?? [];
    },
    staleTime: 30_000,
  });
}

export function useMessages(channelId: string | null) {
  return useQuery({
    queryKey: commsKeys.messages(channelId ?? ''),
    queryFn: async (): Promise<{ data: Message[]; next_cursor: string | null }> => {
      const r = await api.get<{ data: Message[]; next_cursor: string | null }>(
        `/messages/channels/${channelId}/messages?limit=100`,
      );
      return { data: r.data.data ?? [], next_cursor: r.data.next_cursor ?? null };
    },
    enabled: !!channelId,
    staleTime: 15_000,
  });
}

export function useChannelMembers(channelId: string | null) {
  return useQuery({
    queryKey: commsKeys.members(channelId ?? ''),
    queryFn: async (): Promise<ChannelMember[]> => {
      const r = await api.get<{ data: ChannelMember[] }>(`/messages/channels/${channelId}/members`);
      return r.data.data ?? [];
    },
    enabled: !!channelId,
    staleTime: 30_000,
  });
}

export function usePinned(channelId: string | null) {
  return useQuery({
    queryKey: commsKeys.pinned(channelId ?? ''),
    queryFn: async (): Promise<PinnedMessage[]> => {
      const r = await api.get<{ data: PinnedMessage[] }>(`/messages/channels/${channelId}/pinned`);
      return r.data.data ?? [];
    },
    enabled: !!channelId,
    staleTime: 60_000,
  });
}

export function useThread(channelId: string | null, msgId: string | null) {
  return useQuery({
    queryKey: commsKeys.thread(channelId ?? '', msgId ?? ''),
    queryFn: async (): Promise<Message[]> => {
      const r = await api.get<{ data: Message[] }>(
        `/messages/channels/${channelId}/messages/${msgId}/thread`,
      );
      return r.data.data ?? [];
    },
    enabled: !!channelId && !!msgId,
  });
}

/**
 * Populates the "add people" picker and mention popover with every active
 * user in the caller's org (GET /messages/org-users — any authenticated
 * member can call this, it's not admin-gated).
 */
export function useOrgUsers() {
  return useQuery({
    queryKey: commsKeys.orgUsers,
    queryFn: async (): Promise<OrgUser[]> => {
      const r = await api.get<{ data: OrgUser[] }>('/messages/org-users');
      return r.data.data ?? [];
    },
    staleTime: 5 * 60_000,
  });
}

// ── Mutations ──────────────────────────────────────────────────────────────

export function useCreateChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string; type: 'public' | 'private'; category: string | null; memberIds: string[];
    }) => {
      const r = await api.post<{ data: Channel }>('/messages/channels', input);
      return r.data.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: commsKeys.channels }),
  });
}

export function useDeleteChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channelId: string) => api.delete(`/messages/channels/${channelId}`),
    onSuccess: (_res, channelId) => {
      qc.invalidateQueries({ queryKey: commsKeys.channels });
      qc.removeQueries({ queryKey: commsKeys.messages(channelId) });
    },
  });
}

export function useSendMessage(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { text?: string; replyToId?: string | null; attachmentIds?: string[] }) => {
      const r = await api.post<{ data: Message }>(`/messages/channels/${channelId}/messages`, input);
      return r.data.data;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: commsKeys.messages(channelId) });
      if (variables.replyToId) {
        qc.invalidateQueries({ queryKey: commsKeys.thread(channelId, variables.replyToId) });
      }
    },
  });
}

export function useDeleteMessage(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (msgId: string) =>
      api.delete(`/messages/channels/${channelId}/messages/${msgId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: commsKeys.messages(channelId) }),
  });
}

export function useReact(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { msgId: string; emoji: string; add: boolean }) => {
      if (input.add)
        return api.post(`/messages/channels/${channelId}/messages/${input.msgId}/reactions`, {
          emoji: input.emoji,
        });
      return api.delete(
        `/messages/channels/${channelId}/messages/${input.msgId}/reactions/${encodeURIComponent(input.emoji)}`,
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: commsKeys.messages(channelId) }),
  });
}

export function useToggleMute(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (muted: boolean) => api.patch(`/messages/channels/${channelId}/mute`, { muted }),
    onSuccess: () => qc.invalidateQueries({ queryKey: commsKeys.channels }),
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channelId: string) => api.patch(`/messages/channels/${channelId}/read`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: commsKeys.channels }),
  });
}

export function useAddMembers(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userIds: string[]) =>
      api.post(`/messages/channels/${channelId}/members`, { userIds }),
    onSuccess: () => qc.invalidateQueries({ queryKey: commsKeys.members(channelId) }),
  });
}

export function useRemoveMember(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      api.delete(`/messages/channels/${channelId}/members/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: commsKeys.members(channelId) }),
  });
}

export function useSetMemberAdmin(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; isChannelAdmin: boolean }) =>
      api.patch(`/messages/channels/${channelId}/members/${input.userId}`, {
        isChannelAdmin: input.isChannelAdmin,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: commsKeys.members(channelId) }),
  });
}

export function usePin(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { messageId: string; pin: boolean }) => {
      if (input.pin)
        return api.post(`/messages/channels/${channelId}/pinned`, { messageId: input.messageId });
      return api.delete(`/messages/channels/${channelId}/pinned/${input.messageId}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: commsKeys.pinned(channelId) }),
  });
}

// ── Attachments ────────────────────────────────────────────────────────────

export interface PresignResult {
  upload_url: string; storage_key: string; attachment_id: string; expires_in: number;
}
export interface AttachmentUrl { url: string; expires_in: number; mime_type: string; file_name: string; kind: 'photo' | 'file'; }

export async function presignAttachment(input: {
  fileName: string; mimeType: string; sizeBytes: number; kind: 'photo' | 'file';
}): Promise<PresignResult> {
  const r = await api.post<PresignResult>('/messages/attachments/presign', input);
  return r.data;
}

export async function finalizeAttachment(
  id: string,
  meta?: { width?: number; height?: number },
): Promise<void> {
  await api.post(`/messages/attachments/${id}/finalize`, meta ?? {});
}

export async function getAttachmentUrl(id: string): Promise<AttachmentUrl> {
  const r = await api.get<AttachmentUrl>(`/messages/attachments/${id}/url`);
  return r.data;
}

// ── Typing indicator (fire-and-forget) ─────────────────────────────────────

export function postTyping(channelId: string): void {
  api.post(`/messages/channels/${channelId}/typing`, {}).catch(() => {});
}
