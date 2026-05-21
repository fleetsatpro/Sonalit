import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { subscribe } from '../lib/centrifuge.js';
import { useAuthStore } from '../stores/auth.js';
import { MessageSquare, Send } from 'lucide-react';

interface Thread {
  id: string;
  subject: string;
  last_message: string;
  updated_at: string;
  participant_count: number;
}

interface Message {
  id: string;
  thread_id: string;
  sender_name: string;
  sender_id: string;
  content: string;
  created_at: string;
}

interface SendMessagePayload {
  thread_id: string;
  content: string;
}

interface NewMessageEvent {
  thread_id: string;
  message: Message;
}

export default function Messages() {
  const user = useAuthStore((s) => s.user);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: threads, isLoading: threadsLoading } = useQuery<Thread[]>({
    queryKey: ['message-threads'],
    queryFn: async () => {
      const res = await api.get<Thread[]>('/messages/threads');
      return res.data;
    },
  });

  const { data: messages, isLoading: messagesLoading } = useQuery<Message[]>({
    queryKey: ['messages', selectedThreadId],
    queryFn: async () => {
      const res = await api.get<Message[]>('/messages', {
        params: { thread_id: selectedThreadId },
      });
      return res.data;
    },
    enabled: !!selectedThreadId,
  });

  useEffect(() => {
    if (!user) return;
    const unsub = subscribe<NewMessageEvent>(
      `user#${user.id}`,
      (evt) => {
        if (!evt?.message) return;
        queryClient.invalidateQueries({ queryKey: ['message-threads'] });
        queryClient.setQueryData<Message[]>(
          ['messages', evt.thread_id],
          (prev) => (prev ? [...prev, evt.message] : [evt.message]),
        );
      },
    );
    return unsub;
  }, [user, queryClient]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMutation = useMutation({
    mutationFn: (payload: SendMessagePayload) =>
      api.post<Message>('/messages', payload),
    onSuccess: (res) => {
      queryClient.setQueryData<Message[]>(
        ['messages', selectedThreadId],
        (prev) => (prev ? [...prev, res.data] : [res.data]),
      );
      queryClient.invalidateQueries({ queryKey: ['message-threads'] });
      setDraft('');
    },
  });

  const handleSend = () => {
    if (!draft.trim() || !selectedThreadId) return;
    sendMutation.mutate({ thread_id: selectedThreadId, content: draft.trim() });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col md:flex-row h-full -m-4 md:-m-6 bg-slate-950">
      {/* Thread sidebar */}
      <div className="w-full md:w-72 shrink-0 bg-slate-900 border-b md:border-b-0 md:border-r border-slate-700 flex flex-col max-h-48 md:max-h-none">
        <div className="p-4 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <MessageSquare size={18} className="text-blue-400" />
            <h2 className="font-bold">Messages</h2>
          </div>
        </div>
        {threadsLoading && (
          <div className="p-4 text-slate-400 text-sm">Loading threads…</div>
        )}
        <div className="flex-1 overflow-y-auto">
          {threads?.map((thread) => (
            <button
              key={thread.id}
              onClick={() => setSelectedThreadId(thread.id)}
              className={`w-full text-left px-4 py-3 border-b border-slate-800 hover:bg-slate-800 transition-colors ${
                selectedThreadId === thread.id ? 'bg-slate-800 border-l-2 border-l-blue-500' : ''
              }`}
            >
              <p className="text-sm font-medium truncate">{thread.subject}</p>
              <p className="text-xs text-slate-500 truncate mt-0.5">{thread.last_message}</p>
              <p className="text-xs text-slate-600 mt-0.5">
                {new Date(thread.updated_at).toLocaleString()}
              </p>
            </button>
          ))}
          {threads?.length === 0 && (
            <div className="p-6 text-center text-slate-500 text-sm">No threads.</div>
          )}
        </div>
      </div>

      {/* Message area */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selectedThreadId ? (
          <div className="flex-1 flex items-center justify-center text-slate-500">
            <div className="text-center">
              <MessageSquare size={48} className="mx-auto mb-3 opacity-30" />
              <p>Select a thread to read messages</p>
            </div>
          </div>
        ) : (
          <>
            {/* Messages list */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messagesLoading && (
                <p className="text-slate-400 text-sm text-center">Loading messages…</p>
              )}
              {messages?.map((msg) => {
                const isMe = msg.sender_id === user?.id;
                return (
                  <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-md rounded-lg px-4 py-2 ${
                        isMe
                          ? 'bg-blue-700 text-white rounded-br-none'
                          : 'bg-slate-700 text-slate-100 rounded-bl-none'
                      }`}
                    >
                      {!isMe && (
                        <p className="text-xs font-medium text-slate-400 mb-1">
                          {msg.sender_name}
                        </p>
                      )}
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      <p className={`text-xs mt-1 ${isMe ? 'text-blue-300' : 'text-slate-500'}`}>
                        {new Date(msg.created_at).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {/* Send area */}
            <div className="p-4 border-t border-slate-700 bg-slate-900">
              <div className="flex gap-2">
                <textarea
                  className="flex-1 bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 resize-none focus:outline-none focus:border-blue-500"
                  rows={2}
                  placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
                <button
                  onClick={handleSend}
                  disabled={!draft.trim() || sendMutation.isPending}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded flex items-center gap-2 text-sm font-medium"
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
