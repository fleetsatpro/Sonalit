/**
 * Bottom composer: bold/italic/code toolbar, mention picker (@name),
 * emoji picker, file attach, photo attach, send. Uploads go through
 * presign → PUT-to-R2 → finalize. Typing indicator ping is debounced.
 */
import { useEffect, useRef, useState } from 'react';
import { Bold, Italic, Code, Paperclip, AtSign, Smile, Image as ImageIcon, Send, X, FileText } from 'lucide-react';
import { presignAttachment, finalizeAttachment, postTyping } from '../hooks/useComms.js';
import type { OrgUser } from '../types/comms.js';

const QUICK_EMOJIS = ['🔥', '🎉', '🙌', '🥂', '✅', '🚨', '📍', '🛰️', '⚠️', '👍', '💪', '🚀', '🫡', '😄', '🤝', '📎'];

interface PendingAttachment {
  attachmentId: string;
  fileName: string;
  sizeBytes: number;
  kind: 'photo' | 'file';
  previewUrl?: string;
}

interface Props {
  channelId: string;
  channelName: string;
  orgUsers: OrgUser[];
  onSend: (input: { text: string; attachmentIds: string[] }) => Promise<void>;
}

export function Composer({ channelId, channelName, orgUsers, onSend }: Props) {
  const [text, setText] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const typingCooldown = useRef(0);

  const canSend = (text.trim().length > 0 || attachments.length > 0) && !sending && !uploading;

  // Auto-grow textarea (capped at 120px like the mockup).
  useEffect(() => {
    const el = textAreaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  // Reset composer on channel switch.
  useEffect(() => {
    setText('');
    setAttachments([]);
    setError(null);
  }, [channelId]);

  const pingTyping = () => {
    const now = Date.now();
    if (now < typingCooldown.current) return;
    typingCooldown.current = now + 2000;
    postTyping(channelId);
  };

  const wrap = (marker: string) => {
    const el = textAreaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const selected = text.slice(start, end) || 'text';
    const next = text.slice(0, start) + marker + selected + marker + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = start + marker.length;
      el.selectionEnd = start + marker.length + selected.length;
    });
  };

  const insertAtCursor = (frag: string) => {
    const el = textAreaRef.current;
    const start = el?.selectionStart ?? text.length;
    const next = text.slice(0, start) + frag + text.slice(start);
    setText(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = start + frag.length;
    });
  };

  const handleFilePick = async (file: File, kind: 'photo' | 'file') => {
    if (file.size > 25 * 1024 * 1024) { setError('File too large (max 25 MB)'); return; }
    setError(null);
    setUploading(true);
    try {
      const presigned = await presignAttachment({
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        kind,
      });
      // Direct PUT to R2 — bypasses the API for the raw bytes.
      const put = await fetch(presigned.upload_url, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      // Photos: measure dimensions client-side so the finalize call carries them.
      let dimsMeta: { width?: number; height?: number } = {};
      let previewUrl: string | undefined;
      if (kind === 'photo') {
        previewUrl = URL.createObjectURL(file);
        const dims = await new Promise<{ w: number; h: number } | null>((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = () => resolve(null);
          img.src = previewUrl!;
        });
        if (dims) dimsMeta = { width: dims.w, height: dims.h };
      }
      await finalizeAttachment(presigned.attachment_id, dimsMeta);
      const entry: PendingAttachment = {
        attachmentId: presigned.attachment_id,
        fileName: file.name,
        sizeBytes: file.size,
        kind,
      };
      if (previewUrl) entry.previewUrl = previewUrl;
      setAttachments((prev) => [...prev, entry]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const gone = prev.find((a) => a.attachmentId === id);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((a) => a.attachmentId !== id);
    });
  };

  const doSend = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      await onSend({
        text: text.trim(),
        attachmentIds: attachments.map((a) => a.attachmentId),
      });
      // Revoke object URLs so the browser can collect them.
      for (const a of attachments) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      setText('');
      setAttachments([]);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="px-5 pb-4 shrink-0">
      <div className="bg-[#0D1420] border border-white/[0.14] rounded-xl overflow-hidden focus-within:border-amber-400/40">
        <div className="relative flex items-center gap-0.5 px-2 py-1.5 border-b border-white/[0.06]">
          <ToolbarBtn onClick={() => wrap('**')} title="Bold"><Bold size={14} /></ToolbarBtn>
          <ToolbarBtn onClick={() => wrap('_')}  title="Italic"><Italic size={14} /></ToolbarBtn>
          <ToolbarBtn onClick={() => wrap('`')}  title="Code"><Code size={14} /></ToolbarBtn>
          <div className="w-px h-4 bg-white/[0.08] mx-1" />
          <ToolbarBtn onClick={() => fileInputRef.current?.click()} title="Attach file"><Paperclip size={14} /></ToolbarBtn>
          <ToolbarBtn onClick={() => setMentionOpen((v) => !v)} title="Mention"><AtSign size={14} /></ToolbarBtn>
          <ToolbarBtn onClick={() => setEmojiOpen((v) => !v)} title="Emoji"><Smile size={14} /></ToolbarBtn>
          <ToolbarBtn onClick={() => photoInputRef.current?.click()} title="Share photo"><ImageIcon size={14} /></ToolbarBtn>
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFilePick(e.target.files[0], 'file').then(() => { if (fileInputRef.current) fileInputRef.current.value = ''; })}
          />
          <input
            type="file"
            accept="image/*"
            ref={photoInputRef}
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFilePick(e.target.files[0], 'photo').then(() => { if (photoInputRef.current) photoInputRef.current.value = ''; })}
          />

          {emojiOpen && (
            <div className="absolute left-1 bottom-10 z-30 grid grid-cols-8 gap-1 p-2 bg-[#131B2C] border border-white/[0.12] rounded-lg shadow-2xl">
              {QUICK_EMOJIS.map((e) => (
                <button
                  key={e}
                  onClick={() => { insertAtCursor(e); setEmojiOpen(false); }}
                  className="w-7 h-7 rounded hover:bg-white/[0.08] text-[16px]"
                >{e}</button>
              ))}
            </div>
          )}
          {mentionOpen && orgUsers.length > 0 && (
            <div className="absolute left-1 bottom-10 z-30 p-1 min-w-[230px] max-h-[250px] overflow-y-auto bg-[#131B2C] border border-white/[0.12] rounded-lg shadow-2xl">
              {orgUsers.map((u) => (
                <button
                  key={u.id}
                  onClick={() => {
                    insertAtCursor('@' + u.name.split(' ')[0] + ' ');
                    setMentionOpen(false);
                  }}
                  className="w-full text-left flex items-center gap-2 px-2.5 py-2 rounded hover:bg-white/[0.06]"
                >
                  <div className="w-6 h-6 rounded flex items-center justify-center bg-[#1A2438] font-mono text-[9px] text-gray-300">
                    {u.name.split(/\s+/).map((p) => p[0]).join('').toUpperCase().slice(0, 2)}
                  </div>
                  <div className="text-[12px] font-semibold text-white">{u.name}</div>
                  <div className="ml-auto text-[9px] font-mono text-gray-500 uppercase">{u.role}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pt-3">
            {attachments.map((a) => (
              <div key={a.attachmentId} className="flex items-center gap-2 p-1.5 pr-2 bg-[#131B2C] border border-white/[0.08] rounded-lg">
                {a.kind === 'photo' && a.previewUrl ? (
                  <div className="relative w-14 h-14 rounded overflow-hidden border border-white/[0.06]">
                    <img src={a.previewUrl} alt={a.fileName} className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <FileText size={16} className="text-amber-400" />
                )}
                {a.kind !== 'photo' && (
                  <span className="text-[11.5px] font-semibold text-white truncate max-w-[180px]">{a.fileName}</span>
                )}
                <button
                  onClick={() => removeAttachment(a.attachmentId)}
                  className="p-1 rounded hover:bg-white/[0.06] text-gray-500 hover:text-red-300"
                  aria-label="Remove attachment"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-3 px-4 py-3">
          <textarea
            ref={textAreaRef}
            value={text}
            onChange={(e) => { setText(e.target.value); pingTyping(); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
            }}
            rows={1}
            placeholder={`Message #${channelName}…`}
            className="flex-1 bg-transparent border-none outline-none resize-none text-[13.5px] text-gray-100 placeholder:text-gray-500 leading-relaxed"
            style={{ maxHeight: 120 }}
          />
          <button
            onClick={doSend}
            disabled={!canSend}
            className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center transition-transform active:scale-95 ${
              canSend ? 'bg-amber-400 text-black hover:bg-amber-300' : 'bg-[#131B2C] text-gray-600'
            }`}
            aria-label="Send"
          >
            <Send size={15} />
          </button>
        </div>

        {error && <div className="px-4 pb-2 text-[11px] text-red-300">{error}</div>}
        {uploading && !error && <div className="px-4 pb-2 text-[11px] text-gray-500 font-mono">Uploading…</div>}
      </div>
      <div className="mt-1.5 text-[10px] font-mono text-gray-500">
        <kbd className="px-1 rounded bg-[#1A2438] border border-white/[0.12]">Enter</kbd> to send
        {' · '}
        <kbd className="px-1 rounded bg-[#1A2438] border border-white/[0.12]">Shift+Enter</kbd> for new line
      </div>
    </div>
  );
}

function ToolbarBtn({ children, onClick, title }: React.PropsWithChildren<{ onClick: () => void; title: string }>) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-7 h-7 rounded flex items-center justify-center text-gray-500 hover:bg-white/[0.06] hover:text-white"
    >
      {children}
    </button>
  );
}

function extractError(err: unknown): string {
  if (typeof err === 'object' && err && 'response' in err) {
    const r = (err as { response?: { data?: { error?: string } } }).response;
    if (r?.data?.error) return r.data.error;
  }
  return err instanceof Error ? err.message : 'Send failed';
}
