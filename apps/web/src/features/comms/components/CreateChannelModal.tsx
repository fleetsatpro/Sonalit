/**
 * "Create channel" modal: name, type (public/private), initial members.
 */
import { useMemo, useState } from 'react';
import { X, Check, Hash, Lock, Search as SearchIcon } from 'lucide-react';
import type { OrgUser } from '../types/comms.js';

interface Props {
  category: 'priority' | 'regional' | 'operations';
  orgUsers: OrgUser[];
  selfId: string;
  onClose: () => void;
  onCreate: (input: { name: string; type: 'public' | 'private'; memberIds: string[] }) => Promise<void>;
}

export function CreateChannelModal({ category, orgUsers, selfId, onClose, onCreate }: Props) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'public' | 'private'>('public');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const eligible = orgUsers.filter((u) => u.id !== selfId);
    if (!ql) return eligible;
    return eligible.filter((u) => u.name.toLowerCase().includes(ql));
  }, [q, orgUsers, selfId]);

  const submit = async () => {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) { setError('Name required'); return; }
    setSubmitting(true);
    try {
      await onCreate({ name: trimmed, type, memberIds: [...picked] });
      onClose();
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="w-[400px] max-w-[92vw] max-h-[85vh] bg-[#0D1420] border border-white/[0.14] rounded-xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center">
          <div className="font-bold text-white text-[17px]">
            Create channel — <span className="text-amber-400 text-[14px] font-normal">{category}</span>
          </div>
          <button onClick={onClose} className="ml-auto p-1 text-gray-400 hover:text-white" aria-label="Close">
            <X size={15} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto">
          <label className="block font-mono text-[11.5px] text-gray-500 tracking-wide">Channel name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. tanzania-convoy"
            className="w-full mt-1.5 bg-[#131B2C] border border-white/[0.14] rounded-lg px-3 py-2.5 text-[13px] text-white outline-none focus:border-amber-400/40"
            autoFocus
          />

          <label className="block font-mono text-[11.5px] text-gray-500 tracking-wide mt-4">Type</label>
          <div className="flex gap-2 mt-1.5">
            <TypeOption
              selected={type === 'public'}
              onClick={() => setType('public')}
              icon={<Hash size={16} />}
              label="Public channel"
            />
            <TypeOption
              selected={type === 'private'}
              onClick={() => setType('private')}
              icon={<Lock size={16} />}
              label="Private group"
            />
          </div>

          <label className="block font-mono text-[11.5px] text-gray-500 tracking-wide mt-4">Add members</label>
          <div className="mt-1.5 flex items-center gap-2 bg-[#131B2C] border border-white/[0.06] rounded-lg px-3 py-2">
            <SearchIcon size={13} className="text-gray-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search people…"
              className="w-full bg-transparent outline-none text-[12.5px] text-gray-100"
            />
          </div>
          <div className="mt-2 max-h-[220px] overflow-y-auto">
            {filtered.length === 0 && (
              <div className="text-center text-gray-500 text-[12px] py-6">No matching users.</div>
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
                  className="w-full flex items-center gap-2 py-2 px-2 rounded hover:bg-white/[0.04] text-left"
                >
                  <div className="w-7 h-7 rounded flex items-center justify-center bg-[#1A2438] font-mono text-[10px] text-gray-300">
                    {u.name.split(/\s+/).map((p) => p[0]).join('').toUpperCase().slice(0, 2)}
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
          {error && <div className="mt-3 text-[11.5px] text-red-300">{error}</div>}
        </div>

        <div className="px-5 py-4 border-t border-white/[0.06] flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-white/[0.14] text-[12.5px] text-gray-300 hover:bg-white/[0.06]"
          >Cancel</button>
          <button
            onClick={submit}
            disabled={submitting || !name.trim()}
            className={`px-4 py-2 rounded-lg text-[12.5px] font-bold ${
              submitting || !name.trim() ? 'bg-[#131B2C] text-gray-600' : 'bg-amber-400 text-black hover:bg-amber-300'
            }`}
          >{submitting ? 'Creating…' : 'Create channel'}</button>
        </div>
      </div>
    </div>
  );
}

function TypeOption({ selected, onClick, icon, label }: {
  selected: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 border rounded-lg p-3 text-center transition-colors ${
        selected
          ? 'border-amber-400 bg-amber-400/10 text-amber-400'
          : 'border-white/[0.14] text-gray-300 hover:bg-white/[0.04]'
      }`}
    >
      <div className="flex justify-center mb-1">{icon}</div>
      <div className="text-[12px] font-bold">{label}</div>
    </button>
  );
}

function extractError(err: unknown): string {
  if (typeof err === 'object' && err && 'response' in err) {
    const r = (err as { response?: { data?: { error?: string } } }).response;
    if (r?.data?.error) return r.data.error;
  }
  return err instanceof Error ? err.message : 'Failed to create channel';
}
