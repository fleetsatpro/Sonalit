import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useAuthStore } from '../stores/auth.js';
import { MessageSquare, Send, Hash } from 'lucide-react';

interface Channel {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

interface Message {
  id: string;
  channel_id: string;
  sender_id: string;
  sender_name: string;
  sender_role: string;
  content: string;
  created_at: string;
}

export default function Messages() {
  const user = useAuthStore((s) => s.user);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: channels, isLoading: channelsLoading } = useQuery<Channel[]>({
    queryKey: ['message-channels'],
    queryFn: async () => {
      const res = await api.get<{ data: Channel[] }>('/messages/channels');
      return res.data?.data ?? [];
    },
  });

  // Auto-select first channel
  useEffect(() => {
    if (!selectedChannelId && channels && channels.length > 0) {
      setSelectedChannelId(channels[0]!.id);
    }
  }, [channels, selectedChannelId]);

  const { data: messagesData, isLoading: messagesLoading } = useQuery<Message[]>({
    queryKey: ['messages', selectedChannelId],
    queryFn: async () => {
      const res = await api.get<{ data: Message[] }>(`/messages/channels/${selectedChannelId}`);
      return res.data?.data ?? [];
    },
    enabled: !!selectedChannelId,
    refetchInterval: 10_000,
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messagesData]);

  const sendMutation = useMutation({
    mutationFn: (content: string) =>
      api.post<{ data: Message }>(`/messages/channels/${selectedChannelId}`, { content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', selectedChannelId] });
      setDraft('');
    },
  });

  const handleSend = () => {
    if (!draft.trim() || !selectedChannelId) return;
    sendMutation.mutate(draft.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const selectedChannel = channels?.find((c) => c.id === selectedChannelId);

  return (
    <div className="flex flex-col md:flex-row h-[calc(100dvh-3.5rem)] -m-4 md:-m-6 bg-gray-950 overflow-hidden">
      {/* Channel sidebar */}
      <div className="w-full md:w-64 shrink-0 bg-gray-900 border-b md:border-b-0 md:border-r border-gray-800 flex flex-col h-48 md:h-auto">
        <div className="p-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <MessageSquare size={18} className="text-orange-400" />
            <h2 className="font-bold text-white">Messages</h2>
          </div>
        </div>
        {channelsLoading && (
          <div className="p-4 text-gray-400 text-sm">Loading channels…</div>
        )}
        <div className="flex-1 overflow-y-auto py-1">
          {channels?.map((channel) => (
            <button
              key={channel.id}
              onClick={() => setSelectedChannelId(channel.id)}
              className={`w-full text-left px-4 py-2.5 flex items-center gap-2 hover:bg-gray-800 transition-colors ${
                selectedChannelId === channel.id ? 'bg-indigo-900/30 border-l-2 border-l-indigo-500' : ''
              }`}
            >
              <Hash size={14} className="text-gray-500 flex-shrink-0" />
              <span className="text-sm font-medium text-white truncate">{channel.name}</span>
            </button>
          ))}
          {!channelsLoading && channels?.length === 0 && (
            <div className="p-4 text-center text-gray-500 text-sm">No channels.</div>
          )}
        </div>
      </div>

      {/* Message area */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedChannel && (
          <div className="px-4 py-3 border-b border-gray-800 bg-gray-900">
            <div className="flex items-center gap-2">
              <Hash size={16} className="text-gray-400" />
              <h3 className="font-semibold text-white">{selectedChannel.name}</h3>
              {selectedChannel.description && (
                <span className="text-gray-500 text-sm">— {selectedChannel.description}</span>
              )}
            </div>
          </div>
        )}

        {!selectedChannelId ? (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <MessageSquare size={48} className="mx-auto mb-3 opacity-30" />
              <p>Select a channel to read messages</p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messagesLoading && (
                <p className="text-gray-400 text-sm text-center">Loading messages…</p>
              )}
              {(messagesData ?? []).map((msg) => {
                const isMe = msg.sender_id === user?.id;
                return (
                  <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-sm rounded-xl px-4 py-2 ${
                        isMe
                          ? 'bg-indigo-700 text-white rounded-br-none'
                          : 'bg-gray-800 text-gray-100 rounded-bl-none'
                      }`}
                    >
                      {!isMe && (
                        <p className="text-xs font-medium text-gray-400 mb-1">{msg.sender_name}</p>
                      )}
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      <p className={`text-xs mt-1 ${isMe ? 'hover:text-orange-300' : 'text-gray-500'}`}>
                        {new Date(msg.created_at).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                );
              })}
              {!messagesLoading && (messagesData ?? []).length === 0 && (
                <p className="text-center text-gray-500 text-sm py-8">No messages yet. Say hello!</p>
              )}
              <div ref={bottomRef} />
            </div>

            <div className="p-4 border-t border-gray-800 bg-gray-900">
              <div className="flex gap-2">
                <textarea
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-indigo-500"
                  rows={2}
                  placeholder={`Message #${selectedChannel?.name ?? ''}… (Enter to send)`}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
                <button
                  onClick={handleSend}
                  disabled={!draft.trim() || sendMutation.isPending}
                  className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 rounded-lg flex items-center gap-2 text-sm font-medium text-white"
                >
                  <Send size={16} />
                </button>
              </div>
              {sendMutation.isError && (
                <p className="text-red-400 text-xs mt-1">Failed to send message.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
