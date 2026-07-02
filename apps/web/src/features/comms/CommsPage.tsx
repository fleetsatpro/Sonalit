/**
 * Orchestrates the full comms experience: layout, live data, modal state.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Hash, Radio, Users, Search as SearchIcon, Pin, Menu, X, Star,
} from 'lucide-react';
import { useAuthStore } from '../../stores/auth.js';
import {
  useChannels, useMessages, useChannelMembers, usePinned, useThread, useOrgUsers,
  useCreateChannel, useDeleteChannel, useSendMessage, useDeleteMessage,
  useReact, useToggleMute, useMarkRead, usePin,
} from './hooks/useComms.js';
import { useCommsRealtime, useTypingIndicator } from './hooks/useCommsRealtime.js';
import { ChannelList } from './components/ChannelList.js';
import { MessageStream } from './components/MessageStream.js';
import { Composer } from './components/Composer.js';
import { RightPanel, type PanelMode } from './components/RightPanel.js';
import { CreateChannelModal } from './components/CreateChannelModal.js';

export default function CommsPage() {
  const user = useAuthStore((s) => s.user);
  const isOrgAdmin = user?.role === 'admin';

  // ── Server state (auto-refreshed by realtime layer) ─────────────────────
  const channelsQ = useChannels();
  const orgUsersQ = useOrgUsers();

  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);

  // Auto-select first channel once list loads, or when the active channel
  // has been deleted out from under us.
  useEffect(() => {
    const list = channelsQ.data ?? [];
    if (list.length === 0) return;
    if (!activeChannelId || !list.some((c) => c.id === activeChannelId)) {
      setActiveChannelId(list[0]!.id);
    }
  }, [channelsQ.data, activeChannelId]);

  const activeChannel = useMemo(
    () => channelsQ.data?.find((c) => c.id === activeChannelId) ?? null,
    [channelsQ.data, activeChannelId],
  );
  const isChannelAdmin = !!activeChannel?.is_channel_admin;

  const messagesQ = useMessages(activeChannelId);
  const membersQ  = useChannelMembers(activeChannelId);
  const pinnedQ   = usePinned(activeChannelId);

  useCommsRealtime(user?.org_id, activeChannelId);
  const typing = useTypingIndicator(user?.org_id, activeChannelId, user?.id);

  // Mark-read whenever we open a channel + when new messages arrive.
  const markRead = useMarkRead();
  useEffect(() => {
    if (activeChannelId) markRead.mutate(activeChannelId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChannelId, messagesQ.data?.data.length]);

  // ── Mutations ───────────────────────────────────────────────────────────
  const createChannel = useCreateChannel();
  const deleteChannel = useDeleteChannel();
  const sendMessage   = useSendMessage(activeChannelId ?? '');
  const deleteMessage = useDeleteMessage(activeChannelId ?? '');
  const react         = useReact(activeChannelId ?? '');
  const toggleMute    = useToggleMute(activeChannelId ?? '');
  const pin           = usePin(activeChannelId ?? '');

  // ── UI state ────────────────────────────────────────────────────────────
  const [panelMode, setPanelMode]   = useState<PanelMode>(null);
  const [threadParentId, setThreadParentId] = useState<string | null>(null);
  const threadQ = useThread(activeChannelId, threadParentId);
  const [createOpen, setCreateOpen] = useState<null | 'priority' | 'regional' | 'operations'>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ,    setSearchQ]    = useState('');

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleSelect = (id: string) => { setActiveChannelId(id); setPanelMode(null); setDrawerOpen(false); };
  const handleCreate = (category: 'priority' | 'regional' | 'operations') => setCreateOpen(category);

  const handleDeleteChannel = (id: string) => {
    const target = channelsQ.data?.find((c) => c.id === id);
    if (!target) return;
    if (!window.confirm(
      `Delete #${target.name}? This removes the channel and its message history for all members. This cannot be undone.`,
    )) return;
    deleteChannel.mutate(id);
  };

  const handleDeleteMessage = (msgId: string) => {
    if (!window.confirm('Delete this message for everyone?')) return;
    deleteMessage.mutate(msgId);
  };

  const handleReact = (msgId: string, emoji: string, add: boolean) =>
    react.mutate({ msgId, emoji, add });

  const handlePin = (msgId: string, doPin: boolean) => pin.mutate({ messageId: msgId, pin: doPin });

  const handleOpenThread = (msgId: string) => {
    setThreadParentId(msgId);
    setPanelMode('thread');
  };

  const handleSend = async (input: { text: string; attachmentIds: string[] }) => {
    if (!activeChannelId) return;
    await sendMessage.mutateAsync({
      text: input.text,
      attachmentIds: input.attachmentIds,
      replyToId: null,
    });
  };

  if (!user) return null;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] -m-4 md:-m-6 bg-[#080C14] text-gray-100 overflow-hidden">
      {/* Sidebar (mobile: overlay drawer) */}
      <div
        className={`fixed inset-0 z-30 bg-black/50 md:hidden transition-opacity ${
          drawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setDrawerOpen(false)}
      />
      <div className={`md:relative fixed z-30 top-0 bottom-0 md:z-auto md:translate-x-0 transition-transform ${
        drawerOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      }`}>
        <ChannelList
          channels={channelsQ.data ?? []}
          activeChannelId={activeChannelId}
          isOrgAdmin={isOrgAdmin}
          onSelect={handleSelect}
          onCreate={handleCreate}
          onDelete={handleDeleteChannel}
          onToggleMute={(_id, muted) => toggleMute.mutate(muted)}
        />
      </div>

      {/* Main pane */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-[60px] shrink-0 flex items-center px-4 md:px-5 gap-3 border-b border-white/[0.06]">
          <button
            onClick={() => setDrawerOpen(true)}
            className="md:hidden w-9 h-9 rounded flex items-center justify-center text-gray-400 hover:bg-white/[0.06] hover:text-white"
            aria-label="Open channels"
          >
            <Menu size={19} />
          </button>

          {activeChannel ? (
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-white font-bold text-[17px]">
                <span className={activeChannel.category === 'priority' ? 'text-red-400 font-mono' : 'text-gray-500 font-mono'}>#</span>
                <span className="truncate">{activeChannel.name}</span>
              </div>
              <div className="text-[11px] text-gray-500 flex items-center gap-1.5">
                {activeChannel.category === 'priority' && <Radio size={10} className="text-red-400" />}
                <span className="truncate">
                  {activeChannel.type === 'private' ? 'Private group' : 'Public channel'} · {activeChannel.member_count} members
                </span>
              </div>
            </div>
          ) : (
            <div className="text-gray-500 font-mono text-[12px]">
              {channelsQ.isLoading ? 'Loading channels…' : 'Select a channel'}
            </div>
          )}

          <div className="ml-auto flex items-center gap-1">
            {searchOpen && (
              <div className="flex items-center gap-2 bg-[#131B2C] border border-white/[0.14] rounded-lg px-3 py-1.5">
                <SearchIcon size={13} className="text-gray-500" />
                <input
                  autoFocus
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  placeholder={activeChannel ? `Search in #${activeChannel.name}…` : 'Search…'}
                  className="w-[180px] bg-transparent outline-none text-[12px] text-gray-100"
                />
                <button onClick={() => { setSearchOpen(false); setSearchQ(''); }} className="text-gray-500 hover:text-white" aria-label="Close search">
                  <X size={12} />
                </button>
              </div>
            )}
            <IconBtn title="Pinned" onClick={() => setPanelMode(panelMode === 'pinned' ? null : 'pinned')}><Pin size={16} /></IconBtn>
            <IconBtn title="Search" onClick={() => setSearchOpen((v) => !v)}><SearchIcon size={16} /></IconBtn>
            <IconBtn title="Members" onClick={() => setPanelMode(panelMode === 'members' ? null : 'members')}><Users size={16} /></IconBtn>
          </div>
        </header>

        {pinnedQ.data && pinnedQ.data.length > 0 && (
          <button
            onClick={() => setPanelMode('pinned')}
            className="flex items-center gap-2 text-left px-5 py-2 bg-gradient-to-r from-red-500/10 to-transparent border-b border-white/[0.06] text-[12px] hover:from-red-500/15"
          >
            <Star size={12} className="text-red-400" />
            <span className="text-red-200 font-bold">Pinned</span>
            <span className="text-gray-400 truncate flex-1">{pinnedQ.data[0]!.body || '(deleted)'}</span>
            <span className="font-mono text-[10px] text-gray-500 shrink-0">by {pinnedQ.data[0]!.author_name}</span>
          </button>
        )}

        {activeChannelId ? (
          <>
            <MessageStream
              messages={messagesQ.data?.data ?? []}
              selfId={user.id}
              isOrgAdmin={isOrgAdmin}
              isChannelAdmin={isChannelAdmin}
              typingName={typing?.name ?? null}
              onDelete={handleDeleteMessage}
              onReact={handleReact}
              onPin={handlePin}
              onOpenThread={handleOpenThread}
              filterQuery={searchQ}
            />
            <Composer
              channelId={activeChannelId}
              channelName={activeChannel?.name ?? ''}
              orgUsers={orgUsersQ.data ?? []}
              onSend={handleSend}
            />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <Hash size={40} className="mx-auto mb-2 opacity-30" />
              <p className="text-[13px]">Pick a channel from the sidebar to get started.</p>
            </div>
          </div>
        )}
      </main>

      {activeChannelId && (
        <RightPanel
          mode={panelMode}
          channelId={activeChannelId}
          selfId={user.id}
          isOrgAdmin={isOrgAdmin}
          isChannelAdmin={isChannelAdmin}
          members={membersQ.data ?? []}
          pinned={pinnedQ.data ?? []}
          thread={threadQ.data ?? []}
          threadParentId={threadParentId}
          orgUsers={orgUsersQ.data ?? []}
          onClose={() => { setPanelMode(null); setThreadParentId(null); }}
        />
      )}

      {createOpen && (
        <CreateChannelModal
          category={createOpen}
          orgUsers={orgUsersQ.data ?? []}
          selfId={user.id}
          onClose={() => setCreateOpen(null)}
          onCreate={async (input) => {
            const created = await createChannel.mutateAsync({
              name: input.name,
              type: input.type,
              category: createOpen,
              memberIds: input.memberIds,
            });
            setActiveChannelId(created.id);
          }}
        />
      )}
    </div>
  );
}

function IconBtn({ children, onClick, title }: React.PropsWithChildren<{ onClick: () => void; title: string }>) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-9 h-9 rounded flex items-center justify-center text-gray-400 hover:bg-white/[0.06] hover:text-white"
    >{children}</button>
  );
}
