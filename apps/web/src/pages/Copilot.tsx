import { useState, useRef, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Bot, Send, User } from 'lucide-react';
import { api } from '../lib/api.js';

type Role = 'user' | 'assistant';

type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  timestamp: number;
};

type CopilotResponse = {
  message: string;
  context?: string;
};

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-blue-700 flex items-center justify-center shrink-0 mt-1">
          <Bot size={14} />
        </div>
      )}
      <div
        className={`max-w-2xl rounded-2xl px-4 py-3 text-sm ${isUser ? 'bg-blue-700 text-white rounded-tr-sm' : 'bg-slate-800 text-slate-100 rounded-tl-sm'}`}
      >
        <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
        <p className="text-xs opacity-50 mt-1.5 text-right">
          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
      {isUser && (
        <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center shrink-0 mt-1">
          <User size={14} />
        </div>
      )}
    </div>
  );
}

export default function CopilotPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Hello! I am the Sonalit Copilot. I can help you with fleet insights, incident analysis, route optimization, and more. How can I assist you today?',
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const sendMutation = useMutation({
    mutationFn: async (userMessage: string) => {
      const { data } = await api.post<CopilotResponse>('/copilot/chat', {
        message: userMessage,
        history: messages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
      });
      return data;
    },
    onSuccess: (data, userMessage) => {
      setMessages((prev) => [
        ...prev,
        { id: `user-${Date.now()}`, role: 'user', content: userMessage, timestamp: Date.now() },
        { id: `assistant-${Date.now()}`, role: 'assistant', content: data.message, timestamp: Date.now() },
      ]);
    },
    onError: () => {
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: 'I encountered an error processing your request. Please try again.',
          timestamp: Date.now(),
        },
      ]);
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || sendMutation.isPending) return;
    setInput('');
    sendMutation.mutate(text);
  };

  const SUGGESTIONS = [
    'Show me top alerts from today',
    'Which vehicles are overdue for maintenance?',
    'Summarize incidents from this week',
    'What is the current fleet utilization?',
  ];

  return (
    <div className="flex flex-col h-full -m-6 overflow-hidden">
      <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-800 bg-slate-900 shrink-0">
        <Bot size={20} className="text-blue-400" />
        <h1 className="font-semibold">Sonalit Copilot</h1>
        <span className="text-xs text-slate-500 ml-1">AI Fleet Assistant</span>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
        {messages.map((m) => (
          <ChatBubble key={m.id} message={m} />
        ))}

        {sendMutation.isPending && (
          <div className="flex gap-3 justify-start">
            <div className="w-8 h-8 rounded-full bg-blue-700 flex items-center justify-center shrink-0">
              <Bot size={14} />
            </div>
            <div className="bg-slate-800 rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex gap-1.5">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </div>
          </div>
        )}

        {messages.length === 1 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => { setInput(s); }}
                className="text-left px-4 py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-sm text-slate-300 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="border-t border-slate-800 bg-slate-900 px-6 py-4 shrink-0">
        <div className="flex gap-3">
          <input
            className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Ask the Copilot anything…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            disabled={sendMutation.isPending}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sendMutation.isPending}
            className="p-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-xl transition-colors"
            aria-label="Send message"
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
