/**
 * Center pane: message list, per-message actions, reactions, threads,
 * lightbox on photo click. Displays "Message deleted" placeholder for
 * soft-deleted rows returned by the API.
 */
import { useEffect, useMemo, useRef, useState, memo } from 'react';
import {
  MoreHorizontal, Trash2, Pin, MessageSquare, Reply, Plus, ArrowDown,
  Image as ImageIcon, Paperclip, FileText, Trash,
} from 'lucide-react';
import type { Message, Attachment } from '../types/comms.js';
import { getAttachmentUrl } from '../hooks/useComms.js';

interface Props {
  messages: Message[];
  selfId: string;
  isOrgAdmin: boolean;
  isChannelAdmin: boolean;
  typingName: string | null;
  onDelete:  (msgId: string) => void;
  onReact:   (msgId: string, emoji: string, add: boolean) => void;
  onPin:     (msgId: string, pin: boolean) => void;
  onOpenThread: (msgId: string) => void;
  filterQuery: string;
}

const QUICK_EMOJIS = ['🔥', '🎉', '🙌', '🥂', '✅', '🚨', '📍', '🛰️', '⚠️', '👍', '💪', '🚀', '🫡', '😄', '🤝', '📎'];

export function MessageStream(props: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showFab, setShowFab] = useState(false);
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);

  // Filter locally by header-search query (loaded messages only; older history
  // uses the /search endpoint which the parent decides when to call).
  const messages = useMemo(() => {
    const q = props.filterQuery.trim().toLowerCase();
    if (!q) return props.messages;
    return props.messages.filter(
      (m) => (m.body || '').toLowerCase().includes(q) || m.author_name.toLowerCase().includes(q),
    );
  }, [props.messages, props.filterQuery]);

  // Auto-scroll to bottom when the messages array grows AND we were already
  // near the bottom (don't yank the user out of scrollback).
  const prevCount = useRef(messages.length);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (messages.length > prevCount.current && nearBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
    prevCount.current = messages.length;
  }, [messages.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setShowFab(!atBottom);
  };

  const groups = useMemo(() => groupByDay(messages), [messages]);

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto px-6 py-4">
        {groups.length === 0 && (
          <div className="text-center py-16 text-gray-500 text-sm">
            No messages in this channel yet.
          </div>
        )}
        {groups.map((group) => (
          <div key={group.label}>
            <div className="flex items-center gap-3 my-4 text-[10.5px] font-mono tracking-wider text-gray-500">
              <span className="flex-1 h-px bg-white/[0.06]" />
              <span>{group.label}</span>
              <span className="flex-1 h-px bg-white/[0.06]" />
            </div>
            {group.rows.map((m) => (
              <MessageItem
                key={m.id}
                message={m}
                canDelete={m.author_id === props.selfId || props.isOrgAdmin || props.isChannelAdmin}
                canPin={props.isOrgAdmin || props.isChannelAdmin}
                onDelete={() => props.onDelete(m.id)}
                onReact={(emoji, add) => props.onReact(m.id, emoji, add)}
                onPin={() => props.onPin(m.id, true)}
                onOpenThread={() => props.onOpenThread(m.id)}
                onPhotoOpen={(a) => setLightbox({ url: `attachment://${a.id}`, name: a.file_name })}
              />
            ))}
          </div>
        ))}

        {props.typingName && (
          <div className="flex items-center gap-2 px-2 py-1 text-[11.5px] text-gray-500">
            <span className="inline-flex gap-0.5">
              <span className="w-1 h-1 rounded-full bg-amber-400 animate-bounce [animation-delay:0ms]" />
              <span className="w-1 h-1 rounded-full bg-amber-400 animate-bounce [animation-delay:100ms]" />
              <span className="w-1 h-1 rounded-full bg-amber-400 animate-bounce [animation-delay:200ms]" />
            </span>
            {props.typingName} is typing…
          </div>
        )}
      </div>

      {showFab && (
        <button
          onClick={() => {
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
          }}
          className="absolute right-6 bottom-6 w-10 h-10 rounded-full bg-[#131B2C] border border-white/[0.12] text-amber-400 shadow-2xl flex items-center justify-center hover:bg-[#1A2438]"
          aria-label="Scroll to bottom"
        >
          <ArrowDown size={16} />
        </button>
      )}

      {lightbox && <Lightbox {...lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

// ── One message row ────────────────────────────────────────────────────────

const MessageItem = memo(function MessageItem(props: {
  message: Message;
  canDelete: boolean;
  canPin: boolean;
  onDelete: () => void;
  onReact: (emoji: string, add: boolean) => void;
  onPin: () => void;
  onOpenThread: () => void;
  onPhotoOpen: (a: Attachment) => void;
}) {
  const m = props.message;
  const [menuOpen, setMenuOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);

  const initials = getInitials(m.author_name);
  const avatarColor = colorForName(m.author_name);
  const time = formatTime(m.created_at);

  if (m.deleted) {
    return (
      <div className="flex gap-3 py-1.5 px-2">
        <div className={`w-9 h-9 rounded-md flex items-center justify-center font-bold text-[13px] ${avatarColor}`}>
          {initials}
        </div>
        <div className="flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[13.5px] font-bold text-white">{m.author_name}</span>
            <span className="text-[10.5px] font-mono text-gray-500">{time}</span>
          </div>
          <div className="flex items-center gap-2 text-[12.5px] italic text-gray-500 mt-0.5">
            <Trash size={12} /> Message deleted
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex gap-3 py-1.5 px-2 rounded hover:bg-white/[0.02] relative">
      <div className={`w-9 h-9 rounded-md flex items-center justify-center font-bold text-[13px] shrink-0 ${avatarColor}`}>
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="text-[13.5px] font-bold text-white">{m.author_name}</span>
          {m.author_role && (
            <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
              m.author_role === 'admin' ? 'bg-amber-400/20 text-amber-400'
              : m.author_role === 'dispatcher' ? 'bg-blue-400/20 text-blue-300'
              : m.author_role === 'cfo' ? 'bg-emerald-400/20 text-emerald-300'
              : 'bg-white/[0.06] text-gray-400'
            }`}>
              {m.author_role.toUpperCase()}
            </span>
          )}
          <span className="text-[10.5px] font-mono text-gray-500">{time}</span>
          <div className="ml-auto opacity-0 group-hover:opacity-100 flex items-center gap-1">
            <button
              onClick={() => setEmojiOpen((v) => !v)}
              className="p-1 rounded hover:bg-white/[0.08] text-gray-500 hover:text-amber-400"
              title="Add reaction"
            >
              <Plus size={13} />
            </button>
            <button
              onClick={props.onOpenThread}
              className="p-1 rounded hover:bg-white/[0.08] text-gray-500 hover:text-blue-400"
              title="Reply in thread"
            >
              <Reply size={13} />
            </button>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="p-1 rounded hover:bg-white/[0.08] text-gray-500 hover:text-white"
              title="More"
            >
              <MoreHorizontal size={13} />
            </button>
            {menuOpen && (
              <div className="absolute right-2 top-8 z-30 min-w-[180px] bg-[#1A2438] border border-white/[0.12] rounded-lg shadow-2xl p-1">
                {props.canPin && (
                  <button
                    onClick={() => { setMenuOpen(false); props.onPin(); }}
                    className="w-full text-left flex items-center gap-2 px-3 py-2 text-[12.5px] text-gray-300 hover:bg-white/[0.06] rounded"
                  >
                    <Pin size={13} /> Pin message
                  </button>
                )}
                {props.canDelete && (
                  <button
                    onClick={() => { setMenuOpen(false); props.onDelete(); }}
                    className="w-full text-left flex items-center gap-2 px-3 py-2 text-[12.5px] text-red-300 hover:bg-red-500/10 rounded"
                  >
                    <Trash2 size={13} /> Delete message
                  </button>
                )}
                {!props.canDelete && !props.canPin && (
                  <div className="px-3 py-2 text-[11.5px] text-gray-500">No actions available.</div>
                )}
              </div>
            )}
          </div>
        </div>

        {m.body && (
          <div className="text-[13.5px] text-gray-200 leading-relaxed whitespace-pre-wrap break-words">
            {renderBody(m.body)}
          </div>
        )}

        {m.attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {m.attachments.map((a) =>
              a.kind === 'photo' ? (
                <PhotoAttachment key={a.id} attachment={a} onOpen={() => props.onPhotoOpen(a)} />
              ) : (
                <FileAttachment key={a.id} attachment={a} />
              ),
            )}
          </div>
        )}

        {m.reactions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {m.reactions.map((r) => (
              <button
                key={r.emoji}
                onClick={() => props.onReact(r.emoji, !r.mine)}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11.5px] transition-colors ${
                  r.mine
                    ? 'bg-amber-400/15 border-amber-400/40 text-amber-100'
                    : 'bg-[#131B2C] border-white/[0.08] text-gray-300 hover:border-white/[0.16]'
                }`}
              >
                <span>{r.emoji}</span>
                <span className="font-mono text-[10.5px]">{r.count}</span>
              </button>
            ))}
            <button
              onClick={() => setEmojiOpen((v) => !v)}
              className="w-6 h-6 rounded-full border border-white/[0.08] flex items-center justify-center text-gray-500 hover:text-amber-400 hover:border-amber-400/40"
              aria-label="Add reaction"
            >
              <Plus size={11} />
            </button>
          </div>
        )}

        {m.reply_count > 0 && (
          <button
            onClick={props.onOpenThread}
            className="mt-2 inline-flex items-center gap-2 text-[11.5px] font-semibold text-blue-300 hover:text-blue-200 bg-blue-500/[0.08] border border-blue-500/25 rounded-md px-2.5 py-1"
          >
            <MessageSquare size={12} />
            {m.reply_count} {m.reply_count === 1 ? 'reply' : 'replies'}
          </button>
        )}
      </div>

      {emojiOpen && (
        <EmojiQuickPicker
          onPick={(e) => { setEmojiOpen(false); props.onReact(e, true); }}
          onClose={() => setEmojiOpen(false)}
        />
      )}
    </div>
  );
});

function EmojiQuickPicker(props: { onPick: (e: string) => void; onClose: () => void }) {
  return (
    <div className="absolute right-4 top-12 z-40 grid grid-cols-8 gap-1 p-2 bg-[#131B2C] border border-white/[0.12] rounded-lg shadow-2xl">
      {QUICK_EMOJIS.map((e) => (
        <button
          key={e}
          onClick={() => props.onPick(e)}
          className="w-7 h-7 rounded hover:bg-white/[0.08] text-[16px]"
        >
          {e}
        </button>
      ))}
    </div>
  );
}

function PhotoAttachment({ attachment, onOpen }: { attachment: Attachment; onOpen: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getAttachmentUrl(attachment.id).then((r) => { if (!cancelled) setUrl(r.url); }).catch(() => {});
    return () => { cancelled = true; };
  }, [attachment.id]);
  return (
    <button
      onClick={onOpen}
      className="block max-w-[320px] rounded-lg overflow-hidden border border-white/[0.06] hover:border-amber-400/40"
    >
      {url ? (
        <img src={url} alt={attachment.file_name} className="block w-full h-auto" />
      ) : (
        <div className="w-40 h-40 flex items-center justify-center bg-[#131B2C] text-gray-500">
          <ImageIcon size={22} />
        </div>
      )}
    </button>
  );
}

function FileAttachment({ attachment }: { attachment: Attachment }) {
  const download = async () => {
    try {
      const r = await getAttachmentUrl(attachment.id);
      window.open(r.url, '_blank', 'noopener,noreferrer');
    } catch { /* noop */ }
  };
  return (
    <button
      onClick={download}
      className="flex items-center gap-2 px-3 py-2 bg-[#131B2C] border border-white/[0.06] rounded-lg hover:border-white/[0.16] text-left"
    >
      <FileText size={16} className="text-amber-400" />
      <div className="flex flex-col">
        <span className="text-[12px] font-semibold text-white truncate max-w-[220px]">{attachment.file_name}</span>
        <span className="text-[10px] font-mono text-gray-500">{formatBytes(attachment.size_bytes)} · {attachment.mime_type.split('/')[1]?.toUpperCase()}</span>
      </div>
      <Paperclip size={12} className="text-gray-500 ml-2" />
    </button>
  );
}

// ── Lightbox ───────────────────────────────────────────────────────────────

function Lightbox({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  const [resolved, setResolved] = useState<string | null>(null);
  useEffect(() => {
    if (!url.startsWith('attachment://')) { setResolved(url); return; }
    const id = url.replace('attachment://', '');
    let cancelled = false;
    getAttachmentUrl(id).then((r) => { if (!cancelled) setResolved(r.url); }).catch(() => {});
    return () => { cancelled = true; };
  }, [url]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center" onClick={onClose}>
      <button
        onClick={onClose}
        className="absolute top-5 right-5 w-10 h-10 rounded-full bg-white/[0.08] text-white flex items-center justify-center hover:bg-white/[0.16]"
        aria-label="Close"
      >×</button>
      {resolved ? (
        <img src={resolved} alt={name} className="max-w-[88vw] max-h-[85vh] rounded-lg" onClick={(e) => e.stopPropagation()} />
      ) : (
        <div className="text-white">Loading…</div>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

function colorForName(name: string): string {
  const palette = [
    'bg-gradient-to-br from-amber-400 to-amber-600 text-black',
    'bg-gradient-to-br from-blue-400 to-blue-700 text-blue-950',
    'bg-gradient-to-br from-red-400 to-red-700 text-red-950',
    'bg-gradient-to-br from-emerald-400 to-emerald-700 text-emerald-950',
    'bg-gradient-to-br from-purple-400 to-purple-700 text-purple-950',
    'bg-gradient-to-br from-cyan-400 to-cyan-700 text-cyan-950',
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length]!;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function groupByDay(rows: Message[]): Array<{ label: string; rows: Message[] }> {
  const groups: Record<string, Message[]> = {};
  const order: string[] = [];
  for (const m of rows) {
    const d = new Date(m.created_at);
    const label = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
    if (!groups[label]) { groups[label] = []; order.push(label); }
    groups[label]!.push(m);
  }
  return order.map((label) => ({ label, rows: groups[label]! }));
}

// Basic mention/code highlighting — no dangerouslySetInnerHTML.
function renderBody(body: string) {
  const parts: Array<{ text: string; type: 'text' | 'mention' | 'code' }> = [];
  const re = /(@[A-Za-z][A-Za-z0-9_.-]*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    if (match.index > last) parts.push({ text: body.slice(last, match.index), type: 'text' });
    const raw = match[0]!;
    parts.push({
      text: raw.startsWith('`') ? raw.slice(1, -1) : raw,
      type: raw.startsWith('`') ? 'code' : 'mention',
    });
    last = match.index + raw.length;
  }
  if (last < body.length) parts.push({ text: body.slice(last), type: 'text' });
  return parts.map((p, i) => {
    if (p.type === 'mention')
      return <span key={i} className="text-amber-400 font-semibold bg-amber-400/10 px-1 rounded">{p.text}</span>;
    if (p.type === 'code')
      return <code key={i} className="font-mono text-[12.5px] text-blue-300 bg-white/[0.06] px-1.5 rounded">{p.text}</code>;
    return <span key={i}>{p.text}</span>;
  });
}
