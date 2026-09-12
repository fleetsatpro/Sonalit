/**
 * Types mirror the backend Ops Comms schema (migration 046) + the response
 * envelopes returned by src/controllers/messageController.js.
 */

export interface Channel {
  id: string;
  name: string;
  slug: string;
  type: 'public' | 'private';
  category: 'priority' | 'regional' | 'operations' | null;
  created_at: string;
  created_by: string | null;
  muted: boolean;
  is_channel_admin: boolean;
  last_read_at: string;
  unread_count: number;
  member_count: number;
  last_message: {
    id: string;
    body: string | null;
    created_at: string;
    author_id: string;
    author_name: string | null;
  } | null;
}

export interface ChannelMember {
  user_id: string;
  is_channel_admin: boolean;
  muted: boolean;
  joined_at: string;
  name: string;
  email: string;
  role: string;
  status: string;
}

export interface Attachment {
  id: string;
  kind: 'photo' | 'file';
  file_name: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
}

export interface Reaction {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface Message {
  id: string;
  channel_id: string;
  author_id: string;
  author_name: string;
  author_role: string;
  body: string | null;
  reply_to_id: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  deleted: boolean;
  attachments: Attachment[];
  reactions: Reaction[];
  reply_count: number;
}

export interface PinnedMessage {
  message_id: string;
  pinned_at: string;
  pinned_by: string;
  body: string | null;
  created_at: string;
  author_name: string;
  author_role: string;
}

export interface OrgUser {
  id: string;
  name: string;
  role: string;
  email: string;
}

/** Realtime payload published on org#<orgId>#comms#<channelId>. */
export interface CommsEvent {
  type:
    | 'channel.created'  | 'channel.deleted'
    | 'message.created'  | 'message.deleted'
    | 'reaction.added'   | 'reaction.removed'
    | 'member.added'     | 'member.removed' | 'member.updated'
    | 'pin.added'        | 'pin.removed'
    | 'typing';
  channel_id: string;
  message?: Message;
  message_id?: string;
  user_id?: string;
  user_name?: string;
  emoji?: string;
  is_channel_admin?: boolean;
  at?: number;
  channel?: Pick<Channel, 'id' | 'name' | 'slug' | 'type' | 'category'>;
}
