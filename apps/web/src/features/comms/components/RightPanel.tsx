/**
 * Right slide-in panel: three modes.
 *   - members: list, add, remove, promote/demote (channel/org admin only)
 *   - pinned:  list of pinned messages
 *   - thread:  parent + replies + reply composer
 */
import { useMemo, useState } from 'react';
import {
  X, Shield, Trash2, Search as SearchIcon, Send, Check,
} from 'lucide-react';
import type { ChannelMember, PinnedMessage, Message, OrgUser } from '../types/comms.js';
import {
  useAddMembers, useRemoveMember, useSetMemberAdmin, useSendMessage,
} from '../hooks/useComms.js';

export type PanelMode = 'members' | 'pinned' | 'thread' | null;

interface Props {
  mode: PanelMode;
  channelId: string;
  selfId: string;
  isOrgAdmin: boolean;
  isChannelAdmin: boolean;
  members: ChannelMember[];
  pinned: PinnedMessage[];
  thread: Message[];
  threadParentId: string | null;
  orgUsers: OrgUser[];
  onClose: () => void;
}

export function RightPanel(props: Props) {
  return (
    <aside
      className={`fixed top-0 right-0 bottom-0 w-[320px] max-w-full bg-[#0D1420] border-l border-white/[0.14] shadow-2xl z-40 transition-transform duration-200 flex flex-col ${
        props.mode ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      <div className="h-[60px] shrink-0 border-b border-white/[0.06] flex items-center px-4 gap-2">
        <div className="text-white font-bold text-[17px]">
          {props.mode === 'members' && `Members — ${props.members.length}`}
          {props.mode === 'pinned'  && 'Pinned messages'}
          {props.mode === 'thread'  && `Thread — ${Math.max(0, props.thread.length - 1)} ${props.thread.length - 1 === 1 ? 'reply' : 'replies'}`}
        </div>
        <button
          onClick={props.onClose}
          className="ml-auto w-7 h-7 rounded flex items-center justify-center text-gray-400 hover:bg-white/[0.06] hover:text-white"
          aria-label="Close"
        >
          <X size={15} />
        </button>
      </div>

      {props.mode === 'members' && (
        <MembersPanel {...props} />
      )}
      {props.mode === 'pinned' && (
        <PinnedPanel pinned={props.pinned} />
      )}
      {props.mode === 'thread' && props.threadParentId && (
        <ThreadPanel
          channelId={props.channelId}
          messages={props.thread}
          parentId={props.threadParentId}
          selfId={props.selfId}
        />
      )}
    </aside>
  );
}

// ── Members panel ──────────────────────────────────────────────────────────

function MembersPanel(props: Props) {
  const canManage = props.isOrgAdmin || props.isChannelAdmin;
  const [addOpen, setAddOpen] = useState(false);
  const addMembers = useAddMembers(props.channelId);
  const removeMember = useRemoveMember(props.channelId);
  const setAdmin = useSetMemberAdmin(props.channelId);
  const [error, setError] = useState<string | null>(null);

  const activeAdmins = useMemo(
    () => props.members.filter((m) => m.is_channel_admin).length,
    [props.members],
  );

  const nonMembers = useMemo(() => {
    const inSet = new Set(props.members.map((m) => m.user_id));
    return props.orgUsers.filter((u) => !inSet.has(u.id));
  }, [props.orgUsers, props.members]);

  const promote = (userId: string, current: boolean) => {
    setError(null);
    // Client-side guardrail (server also enforces).
    if (current && activeAdmins <= 1) {
      setError('Promote another member to channel admin before demoting the last admin');
      return;
    }
    setAdmin.mutate({ userId, isChannelAdmin: !current }, {
      onError: (err) => setError(extractError(err)),
    });
  };

  const remove = (userId: string) => {
    setError(null);
    const target = props.members.find((m) => m.user_id === userId);
    if (target?.is_channel_admin && activeAdmins <= 1) {
      setError('Promote another member to channel admin before removing the last admin');
      return;
    }
    if (!window.confirm(`Remove ${target?.name} from this channel?`)) return;
    removeMember.mutate(userId, { onError: (err) => setError(extractError(err)) });
  };

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {canManage && (
        <button
          onClick={() => setAddOpen(true)}
          className="w-full mb-3 bg-amber-400 text-black text-[12.5px] font-bold py-2 rounded-lg hover:bg-amber-300"
        >
          + Add people
        </button>
      )}
      {error && <div className="mb-2 text-[11px] text-red-300">{error}</div>}

      {props.members.map((m) => (
        <div key={m.user_id} className="group flex items-center gap-3 py-2 px-1 rounded hover:bg-white/[0.03]">
          <div className="relative w-8 h-8 rounded flex items-center justify-center bg-[#1A2438] font-bold text-[12px] text-gray-300">
            {initials(m.name)}
            <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#0D1420] ${m.status === 'active' ? 'bg-emerald-400' : 'bg-gray-500'}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-white truncate">
              {m.name}
              {m.is_channel_admin && (
                <Shield size={11} className="text-amber-400 shrink-0" aria-label="Channel admin" />
              )}
            </div>
            <div className="font-mono text-[9.5px] text-gray-500 uppercase truncate">
              {m.role}{m.is_channel_admin ? ' · CHANNEL ADMIN' : ''}
            </div>
          </div>
          {canManage && m.user_id !== props.selfId && (
            <div className="opacity-0 group-hover:opacity-100 flex gap-1">
              <button
                onClick={() => promote(m.user_id, m.is_channel_admin)}
                title={m.is_channel_admin ? 'Remove admin' : 'Make admin'}
                className={`p-1 rounded hover:bg-white/[0.08] ${
                  m.is_channel_admin ? 'text-amber-400' : 'text-gray-500 hover:text-amber-400'
                }`}
              >
                <Shield size={13} />
              </button>
              <button
                onClick={() => remove(m.user_id)}
                title="Remove from channel"
                className="p-1 rounded hover:bg-red-500/10 text-gray-500 hover:text-red-300"
              >
                <Trash2 size={13} />
              </button>
            </div>
          )}
        </div>
      ))}

      {addOpen && (
        <AddPeopleModal
          nonMembers={nonMembers}
          onClose={() => setAddOpen(false)}
          onConfirm={(ids) => {
            if (ids.length === 0) { setAddOpen(false); return; }
            addMembers.mutate(ids, {
              onSuccess: () => setAddOpen(false),
              onError: (err) => { setError(extractError(err)); setAddOpen(false); },
            });
          }}
        />
      )}
    </div>
  );
}

function AddPeopleModal({
  nonMembers,
  onClose,
  onConfirm,
}: { nonMembers: OrgUser[]; onClose: () => void; onConfirm: (ids: string[]) => void }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return nonMembers;
    return nonMembers.filter((u) => u.name.toLowerCase().includes(ql) || u.email.toLowerCase().includes(ql));
  }, [q, nonMembers]);
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="w-[380px] max-w-[92vw] max-h-[80vh] bg-[#0D1420] border border-white/[0.14] rounded-xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center">
          <div className="font-bold text-white text-[17px]">Add people</div>
          <button onClick={onClose} className="ml-auto p-1 text-gray-400 hover:text-white" aria-label="Close"><X size={15} /></button>
        </div>
        <div className="px-5 pt-4 pb-2">
          <div className="flex items-center gap-2 bg-[#131B2C] border border-white/[0.06] rounded-lg px-3 py-2">
            <SearchIcon size={13} className="text-gray-500" />
            <input
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search people…"
              className="w-full bg-transparent outline-none text-[13px] text-gray-100"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-2">
          {filtered.length === 0 && (
            <div className="text-center py-10 text-gray-500 text-[12.5px]">
              Everyone else is already in this channel.
            </div>
          )}
          {filtered.map((u) => {
            const on = picked.has(u.id);
            return (
              <button
                key={u.id}
                onClick={() => setPicked((p) => {
                  const next = new Set(p);
                  if (next.has(u.id)) next.delete(u.id); else next.add(u.id);
                  return next;
                })}
                className="w-full flex items-center gap-2 px-2 py-2 rounded hover:bg-white/[0.04] text-left"
              >
                <div className="w-7 h-7 rounded flex items-center justify-center bg-[#1A2438] font-mono text-[10px] text-gray-300">
                  {initials(u.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-semibold text-white truncate">{u.name}</div>
                  <div className="font-mono text-[10px] text-gray-500 uppercase truncate">{u.role}</div>
                </div>
                <div className={`w-4 h-4 rounded flex items-center justify-center border ${
                  on ? 'bg-amber-400 border-amber-400' : 'border-white/[0.14]'
                }`}>
                  {on && <Check size={11} className="text-black" />}
                </div>
              </button>
            );
          })}
        </div>
        <div className="p-4 border-t border-white/[0.06] flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-white/[0.14] text-[12.5px] text-gray-300 hover:bg-white/[0.06]">Cancel</button>
          <button
            onClick={() => onConfirm([...picked])}
            disabled={picked.size === 0}
            className={`px-4 py-2 rounded-lg text-[12.5px] font-bold ${
              picked.size > 0 ? 'bg-amber-400 text-black hover:bg-amber-300' : 'bg-[#131B2C] text-gray-600'
            }`}
          >Add selected</button>
        </div>
      </div>
    </div>
  );
}

// ── Pinned panel ───────────────────────────────────────────────────────────

function PinnedPanel({ pinned }: { pinned: PinnedMessage[] }) {
  return (
    <div className="flex-1 overflow-y-auto p-4">
      {pinned.length === 0 && (
        <div className="text-center text-gray-500 text-[12.5px] py-10">No pinned messages.</div>
      )}
      {pinned.map((p) => (
        <div key={p.message_id} className="mb-3 p-3 border border-white/[0.06] rounded-lg">
          <div className="text-[12px] font-bold text-white">{p.author_name}</div>
          <div className="text-[12px] text-gray-300 mt-1 whitespace-pre-wrap leading-relaxed">
            {p.body || <span className="italic text-gray-500">(deleted)</span>}
          </div>
          <div className="font-mono text-[9.5px] text-gray-500 mt-1.5">
            pinned {new Date(p.pinned_at).toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Thread panel ───────────────────────────────────────────────────────────

function ThreadPanel({
  channelId,
  messages,
  parentId,
}: { channelId: string; messages: Message[]; parentId: string; selfId: string }) {
  const [text, setText] = useState('');
  const send = useSendMessage(channelId);
  const doSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || send.isPending) return;
    await send.mutateAsync({ text: trimmed, replyToId: parentId, attachmentIds: [] });
    setText('');
  };
  return (
    <>
      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 text-[12.5px] py-6">Loading thread…</div>
        )}
        {messages.map((m) => (
          <div key={m.id} className="mb-3 flex gap-2">
            <div className="w-7 h-7 rounded flex items-center justify-center bg-[#1A2438] font-mono text-[10px] text-gray-300">
              {initials(m.author_name)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-bold text-white">
                {m.author_name}
                <span className="font-mono text-[9.5px] text-gray-500 ml-2 font-normal">
                  {new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </span>
              </div>
              <div className="text-[12.5px] text-gray-200 mt-0.5 whitespace-pre-wrap leading-relaxed">
                {m.deleted ? <span className="italic text-gray-500">Message deleted</span> : m.body}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="p-3 border-t border-white/[0.06] flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doSend(); } }}
          placeholder="Reply in thread…"
          className="flex-1 bg-[#131B2C] border border-white/[0.06] rounded-lg px-3 py-2 text-[12px] text-gray-100 outline-none focus:border-amber-400/40"
        />
        <button
          onClick={doSend}
          disabled={!text.trim() || send.isPending}
          className={`w-8 h-8 rounded-lg flex items-center justify-center ${
            text.trim() ? 'bg-amber-400 text-black hover:bg-amber-300' : 'bg-[#131B2C] text-gray-600'
          }`}
          aria-label="Send reply"
        >
          <Send size={14} />
        </button>
      </div>
    </>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name.split(/\s+/).map((p) => p[0]).join('').toUpperCase().slice(0, 2) || '?';
}

function extractError(err: unknown): string {
  if (typeof err === 'object' && err && 'response' in err) {
    const r = (err as { response?: { data?: { error?: string } } }).response;
    if (r?.data?.error) return r.data.error;
  }
  return err instanceof Error ? err.message : 'Something went wrong';
}
