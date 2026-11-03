/**
 * Orchestrates the full comms experience: layout, live data, modal state.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Hash, Radio, Users, Search as SearchIcon, Pin, Menu, X, Star,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/auth.js';
import {
  commsKeys, useChannels, useMessages, useChannelMembers, usePinned, useThread, useOrgUsers,
  useCreateChannel, useDeleteChannel, useSendMessage, useDeleteMessage,
  useReact, useToggleMute, useMarkRead, usePin,
} from './hooks/useComms.js';
import { useCommsRealtime } from './hooks/useCommsRealtime.js';
import { ChannelList } from './components/ChannelList.js';
import { MessageStream } from './components/MessageStream.js';
import { Composer } from './components/Composer.js';
import { RightPanel, type PanelMode } from './components/RightPanel.js';
import { CreateChannelModal } from './components/CreateChannelModal.js';

export default function CommsPage() {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const isOrgAdmin = user?.role === 'admin';
  const identityKey = String(user?.org_id || '') + ':' + String(user?.id || '');
  const identityGenerationRef = useRef({ identityKey, generation: 0 });
  if (identityGenerationRef.current.identityKey !== identityKey) {
    identityGenerationRef.current = { identityKey, generation: identityGenerationRef.current.generation + 1 };
  }
  const identityGeneration = identityGenerationRef.current.generation;
  const [verifiedScope, setVerifiedScope] = useState<{ identityKey: string; generation: number } | null>(null);
  const verifiedScopeRef = useRef<{ identityKey: string; generation: number } | null>(null);
  const identityCleanupRef = useRef<{ identityKey: string; generation: number; promise: Promise<void> } | null>(null);
  const [scopeRetry, setScopeRetry] = useState(0);
  const identityReady = verifiedScope?.identityKey === identityKey && verifiedScope.generation === identityGeneration;

  // ── Server state (auto-refreshed by realtime layer) ─────────────────────
  const channelsQ = useChannels(Boolean(user?.org_id && user?.id));
  const orgUsersQ = useOrgUsers(Boolean(user?.org_id && user?.id));

  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [requestedChannelId, setRequestedChannelId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const requested = new URLSearchParams(window.location.search).get('channelId');
    return requested && /^[0-9a-f-]{36}$/i.test(requested) ? requested : null;
  });
  const [verifyingDeepLink, setVerifyingDeepLink] = useState(() => {
    if (typeof window === 'undefined') return false;
    const requested = new URLSearchParams(window.location.search).get('channelId');
    return Boolean(requested && /^[0-9a-f-]{36}$/i.test(requested));
  });
  const [panelMode, setPanelMode] = useState<PanelMode>(null);
  const [threadParentId, setThreadParentId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState<null | 'priority' | 'regional' | 'operations'>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');

  useEffect(() => {
    if (verifiedScopeRef.current?.identityKey === identityKey && verifiedScopeRef.current.generation === identityGeneration) return;
    // React StrictMode may replay this effect; share cleanup only for this exact
    // identity generation so an A → B → A transition always performs fresh work.
    if (identityCleanupRef.current?.identityKey === identityKey && identityCleanupRef.current.generation === identityGeneration) return;
    const cleanupScope = async () => {
      const isCurrentScope = () => identityGenerationRef.current.identityKey === identityKey && identityGenerationRef.current.generation === identityGeneration;
      const privateKeys = qc.getQueryCache()
        .findAll({ queryKey: commsKeys.channels })
        .map(query => query.queryKey)
        .filter(queryKey => queryKey.length > commsKeys.channels.length);
      await Promise.all([
        qc.cancelQueries({ queryKey: commsKeys.channels }),
        qc.cancelQueries({ queryKey: commsKeys.orgUsers, exact: true }),
      ]).catch(() => undefined);
      if (!isCurrentScope()) return;
      privateKeys.forEach(queryKey => qc.removeQueries({ queryKey, exact: true }));
      // Cancellation may restore the previous channel-list snapshot. Fence it
      // after cancellation and before the fresh authenticated list response.
      qc.setQueryData(commsKeys.channels, []);
      qc.setQueryData(commsKeys.orgUsers, []);
      setActiveChannelId(null);
      setPanelMode(null);
      setThreadParentId(null);
      setSearchOpen(false);
      setSearchQ('');
      setDrawerOpen(false);
      setCreateOpen(null);
      if (!user?.org_id || !user?.id) return;
      // Org-user labels are also private and cross-tenant; refresh them from an
      // empty cache. Channel list success is the gate for revealing channels.
      void orgUsersQ.refetch().catch(() => undefined);
      const channelsResult = await channelsQ.refetch().catch(() => null);
      if (!isCurrentScope() || !channelsResult?.isSuccess || channelsResult.isError) return;
      const verified = { identityKey, generation: identityGeneration };
      verifiedScopeRef.current = verified;
      setVerifiedScope(verified);
    };
    const promise = Promise.resolve().then(cleanupScope);
    identityCleanupRef.current = { identityKey, generation: identityGeneration, promise };
    const release = () => { if (identityCleanupRef.current?.promise === promise) identityCleanupRef.current = null; };
    void promise.then(release, release);
  }, [identityKey, identityGeneration, qc, user?.org_id, user?.id, channelsQ.refetch, orgUsersQ.refetch, scopeRetry]);

  useEffect(() => {
    if (!identityReady || !requestedChannelId) return;
    // The identity gate has already completed a fresh authenticated channel-list
    // request. Treat the URL value only as a hint and validate it against that
    // response; do not launch a redundant second fetch.
    if (channelsQ.isError) {
      setRequestedChannelId(null);
      setVerifyingDeepLink(false);
      return;
    }
    if (channelsQ.isSuccess && !channelsQ.isFetching) setVerifyingDeepLink(false);
  }, [identityReady, requestedChannelId, channelsQ.isError, channelsQ.isFetching, channelsQ.isSuccess]);

  // A requested channel remains unselected while its fresh authorisation fetch runs.
  useEffect(() => {
    if (!identityReady || verifyingDeepLink || channelsQ.isError) return;
    const list = channelsQ.data ?? [];
    if (requestedChannelId) {
      if (list.some((channel) => channel.id === requestedChannelId)) {
        if (activeChannelId !== requestedChannelId) setActiveChannelId(requestedChannelId);
        setRequestedChannelId(null);
        return;
      }
      if (channelsQ.isSuccess && !channelsQ.isFetching) setRequestedChannelId(null);
    }
    if (list.length === 0) {
      // A successfully refreshed empty channel list is an authorization result,
      // not permission to keep rendering the previously selected channel.
      if (channelsQ.isSuccess && activeChannelId) setActiveChannelId(null);
      return;
    }
    if (!activeChannelId || !list.some((channel) => channel.id === activeChannelId)) {
      setActiveChannelId(list[0]!.id);
    }
  }, [identityReady, channelsQ.data, channelsQ.isError, channelsQ.isFetching, channelsQ.isSuccess, activeChannelId, requestedChannelId, verifyingDeepLink]);

  const activeChannel = useMemo(
    () => identityReady && !verifyingDeepLink && !channelsQ.isError ? channelsQ.data?.find((c) => c.id === activeChannelId) ?? null : null,
    [identityReady, channelsQ.data, channelsQ.isError, activeChannelId, verifyingDeepLink],
  );
  const channelsForDisplay = !identityReady || verifyingDeepLink || channelsQ.isError ? [] : (channelsQ.data ?? []);
  const authorisedActiveChannelId = identityReady && !verifyingDeepLink && !channelsQ.isError ? activeChannelId : null;
  const isChannelAdmin = !!activeChannel?.is_channel_admin;

  const messagesQ = useMessages(authorisedActiveChannelId);
  const membersQ  = useChannelMembers(authorisedActiveChannelId);
  const pinnedQ   = usePinned(authorisedActiveChannelId);

  // Move away from the current mission immediately when its roster rotates.
  // The refreshed server channel list will select a still-authorised channel again.
  const handleSjmRosterChanged = useCallback((channelId: string) => {
    if (!identityReady || activeChannelId !== channelId) return;
    setActiveChannelId((current) => current === channelId ? null : current);
    setPanelMode(null);
    setThreadParentId(null);
    setSearchOpen(false);
    setSearchQ('');
  }, [activeChannelId, identityReady]);

  const typing = useCommsRealtime(
    identityReady ? user?.org_id : undefined,
    authorisedActiveChannelId,
    identityReady ? user?.id : undefined,
    activeChannel?.realtime_channel,
    undefined,
    handleSjmRosterChanged,
  );

  // Mark-read whenever we open a channel + when new messages arrive.
  const markRead = useMarkRead();
  useEffect(() => {
    // A stale channel ID is not enough to establish access: only mark-read while
    // the refreshed server channel list still contains the active channel.
    if (authorisedActiveChannelId && activeChannel?.id === authorisedActiveChannelId) markRead.mutate(authorisedActiveChannelId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorisedActiveChannelId, activeChannel?.id, messagesQ.data?.data.length]);

  // ── Mutations ───────────────────────────────────────────────────────────
  const createChannel = useCreateChannel();
  const deleteChannel = useDeleteChannel();
  const sendMessage   = useSendMessage(authorisedActiveChannelId ?? '');
  const deleteMessage = useDeleteMessage(authorisedActiveChannelId ?? '');
  const react         = useReact(authorisedActiveChannelId ?? '');
  const toggleMute    = useToggleMute(authorisedActiveChannelId ?? '');
  const pin           = usePin(authorisedActiveChannelId ?? '');

  // ── UI state ────────────────────────────────────────────────────────────
  const threadQ = useThread(authorisedActiveChannelId, threadParentId);

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleSelect = (id: string) => { if (!identityReady || !channelsQ.data?.some(channel => channel.id === id)) return; setActiveChannelId(id); setPanelMode(null); setThreadParentId(null); setDrawerOpen(false); };
  const handleCreate = (category: 'priority' | 'regional' | 'operations') => setCreateOpen(category);

  const handleDeleteChannel = (id: string) => {
    const target = channelsQ.data?.find((c) => c.id === id);
    if (!identityReady || !target) return;
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
    if (!authorisedActiveChannelId) return;
    await sendMessage.mutateAsync({
      text: input.text,
      attachmentIds: input.attachmentIds,
      replyToId: null,
    });
  };

  if (!user) return null;
  if (!identityReady) return (
    <main role="status" className="flex min-h-[60vh] items-center justify-center bg-[#080C14] p-6 text-gray-300">
      <section className="max-w-md rounded-md border border-white/[0.1] bg-[#0c121a] p-6">
        <h1 className="text-lg font-semibold text-white">Refreshing authorised communications scope</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">Private channel names, messages, members and pins remain hidden until the current account and organisation are verified against Sonalit.</p>
        {channelsQ.isError && <button type="button" className="mt-4 rounded-md border border-white/15 px-4 py-2 text-sm" onClick={() => setScopeRetry(value => value + 1)}>Retry access verification</button>}
      </section>
    </main>
  );

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
          channels={channelsForDisplay}
          activeChannelId={authorisedActiveChannelId}
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
            <div className="flex items-center gap-3 text-gray-500 font-mono text-[12px]">
              <span>{verifyingDeepLink || channelsQ.isFetching ? 'Verifying authorised channels…' : channelsQ.isError ? 'Unable to verify channel access' : channelsQ.isLoading ? 'Loading channels…' : 'Select a channel'}</span>
              {channelsQ.isError && <button type="button" className="rounded border border-white/15 px-2 py-1 font-sans text-[11px] text-slate-300" onClick={() => void channelsQ.refetch()}>Retry</button>}
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

        {activeChannel && pinnedQ.data && pinnedQ.data.length > 0 && (
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

        {authorisedActiveChannelId && activeChannel ? (
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
              channelId={authorisedActiveChannelId}
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

      {authorisedActiveChannelId && activeChannel && (
        <RightPanel
          mode={panelMode}
          channelId={authorisedActiveChannelId}
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

      {identityReady && createOpen && (
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
