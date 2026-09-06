/**
 * Left sidebar: channel groups (priority / regional / operations / other),
 * unread badges, mute toggle, per-channel kebab (delete for admins),
 * "+" to create a channel, and channel filter search.
 */
import { useMemo, useState } from 'react';
import {
  Hash, Search as SearchIcon, Plus, MoreHorizontal, Trash2, BellOff, Shield,
} from 'lucide-react';
import type { Channel } from '../types/comms.js';

interface Props {
  channels: Channel[];
  activeChannelId: string | null;
  isOrgAdmin: boolean;
  onSelect: (channelId: string) => void;
  onCreate: (groupKey: 'priority' | 'regional' | 'operations') => void;
  onDelete: (channelId: string) => void;
  onToggleMute: (channelId: string, muted: boolean) => void;
}

const GROUPS: Array<{ key: 'priority' | 'regional' | 'operations'; label: string }> = [
  { key: 'priority',   label: 'Priority' },
  { key: 'regional',   label: 'Regional Convoy' },
  { key: 'operations', label: 'Operations' },
];

export function ChannelList(props: Props) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return props.channels;
    return props.channels.filter((c) => c.name.toLowerCase().includes(q));
  }, [query, props.channels]);

  const grouped = useMemo(() => {
    const g: Record<string, Channel[]> = { priority: [], regional: [], operations: [], other: [] };
    for (const c of filtered) g[c.category || 'other']!.push(c);
    return g;
  }, [filtered]);

  return (
    <aside className="w-72 shrink-0 flex flex-col bg-[#0D1420] border-r border-white/[0.06]">
      <div className="p-4">
        <div className="flex items-center gap-2 text-white font-bold text-lg">
          <Hash size={16} className="text-amber-400" /> Comms
        </div>
      </div>

      <div className="mx-4 mb-2 flex items-center gap-2 rounded-lg bg-[#131B2C] border border-white/[0.06] px-3 py-2">
        <SearchIcon size={13} className="text-gray-500 shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search channels…"
          className="w-full bg-transparent text-[12.5px] text-gray-100 placeholder:text-gray-500 outline-none"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {GROUPS.map((group) => {
          const rows = grouped[group.key] ?? [];
          if (rows.length === 0 && query) return null;
          return (
            <ChannelGroup
              key={group.key}
              label={group.label}
              rows={rows}
              activeChannelId={props.activeChannelId}
              isOrgAdmin={props.isOrgAdmin}
              onSelect={props.onSelect}
              onCreate={() => props.onCreate(group.key)}
              onDelete={props.onDelete}
              onToggleMute={props.onToggleMute}
            />
          );
        })}
        {grouped['other']!.length > 0 && (
          <ChannelGroup
            label="Other"
            rows={grouped['other']!}
            activeChannelId={props.activeChannelId}
            isOrgAdmin={props.isOrgAdmin}
            onSelect={props.onSelect}
            onCreate={null}
            onDelete={props.onDelete}
            onToggleMute={props.onToggleMute}
          />
        )}
      </div>
    </aside>
  );
}

function ChannelGroup(props: {
  label: string;
  rows: Channel[];
  activeChannelId: string | null;
  isOrgAdmin: boolean;
  onSelect: (channelId: string) => void;
  onCreate: (() => void) | null;
  onDelete: (channelId: string) => void;
  onToggleMute: (channelId: string, muted: boolean) => void;
}) {
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between px-2 pb-1">
        <div className="text-[10px] font-mono tracking-widest uppercase text-gray-500">
          {props.label}
        </div>
        {props.onCreate && (
          <button
            onClick={props.onCreate}
            className="p-1 rounded hover:bg-white/[0.06] text-gray-500 hover:text-amber-400 transition-colors"
            title={`Create ${props.label.toLowerCase()} channel`}
            aria-label={`Create ${props.label.toLowerCase()} channel`}
          >
            <Plus size={12} />
          </button>
        )}
      </div>
      {props.rows.length === 0 ? (
        <div className="px-2 py-2 text-[11px] text-gray-600">No channels yet.</div>
      ) : props.rows.map((c) => (
        <ChannelRow
          key={c.id}
          channel={c}
          active={props.activeChannelId === c.id}
          canManage={props.isOrgAdmin || c.is_channel_admin}
          onSelect={() => props.onSelect(c.id)}
          onDelete={() => props.onDelete(c.id)}
          onToggleMute={() => props.onToggleMute(c.id, !c.muted)}
        />
      ))}
    </div>
  );
}

function ChannelRow(props: {
  channel: Channel;
  active: boolean;
  canManage: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onToggleMute: () => void;
}) {
  const [kebabOpen, setKebabOpen] = useState(false);
  const emergency = props.channel.category === 'priority';
  const bg = props.active
    ? emergency ? 'bg-red-500/10 text-white' : 'bg-amber-400/10 text-white'
    : 'text-gray-400 hover:bg-white/[0.04]';
  const bar = props.active
    ? emergency ? 'before:bg-red-500' : 'before:bg-amber-400'
    : 'before:bg-transparent';

  return (
    <div
      className={`relative group flex items-center gap-2 px-2.5 py-1.5 rounded-md mb-0.5 cursor-pointer transition-colors ${bg}
        before:absolute before:-left-2 before:top-1/2 before:-translate-y-1/2 before:w-[3px] before:h-[18px] before:rounded-r ${bar}`}
      onClick={props.onSelect}
    >
      <span className={`font-mono text-sm ${
        emergency ? 'text-red-400' : props.active ? 'text-amber-400' : 'text-gray-500'
      }`}>#</span>
      <span className={`text-[13px] truncate flex-1 ${
        props.channel.unread_count > 0 || props.active ? 'font-semibold text-white' : ''
      }`}>{props.channel.name}</span>

      {props.channel.muted && (
        <button
          onClick={(e) => { e.stopPropagation(); props.onToggleMute(); }}
          className="text-amber-400 hover:text-white"
          title="Unmute"
        >
          <BellOff size={12} />
        </button>
      )}
      {!props.channel.muted && props.channel.unread_count > 0 && (
        <span className={`text-[10px] font-bold font-mono min-w-[18px] h-[18px] rounded-full px-1.5 flex items-center justify-center ${
          emergency ? 'bg-red-500 text-white' : 'bg-amber-400 text-black'
        }`}>
          {props.channel.unread_count > 99 ? '99+' : props.channel.unread_count}
        </span>
      )}

      <div className="relative">
        <button
          onClick={(e) => { e.stopPropagation(); setKebabOpen((v) => !v); }}
          className="ml-1 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-white/[0.08] text-gray-500 hover:text-white"
          aria-label="Channel actions"
        >
          <MoreHorizontal size={13} />
        </button>
        {kebabOpen && (
          <div
            className="absolute right-0 top-6 z-30 min-w-[180px] bg-[#1A2438] border border-white/[0.12] rounded-lg shadow-2xl p-1"
            onClick={(e) => e.stopPropagation()}
            role="menu"
          >
            <button
              onClick={() => { setKebabOpen(false); props.onToggleMute(); }}
              className="w-full text-left flex items-center gap-2 px-3 py-2 text-[12.5px] text-gray-300 hover:bg-white/[0.06] rounded"
            >
              <BellOff size={13} /> {props.channel.muted ? 'Unmute' : 'Mute'}
            </button>
            {props.canManage && (
              <>
                <div className="h-px bg-white/[0.06] my-1" />
                <button
                  onClick={() => { setKebabOpen(false); props.onDelete(); }}
                  className="w-full text-left flex items-center gap-2 px-3 py-2 text-[12.5px] text-red-300 hover:bg-red-500/10 rounded"
                >
                  <Trash2 size={13} /> Delete channel
                </button>
              </>
            )}
            {!props.canManage && (
              <div className="px-3 py-2 text-[11px] text-gray-500 flex items-center gap-2">
                <Shield size={12} /> Only channel admins can delete
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
