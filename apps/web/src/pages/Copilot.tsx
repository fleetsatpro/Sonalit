import { useState, useRef, useEffect, useCallback } from 'react';
import { Bot, Send, User, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';

type Role = 'user' | 'assistant';

interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  timestamp: number;
}

interface HistoryEntry {
  role: Role;
  content: string;
}

interface DispatchResponse {
  response: string;
  actions: string[];
  source: string;
}

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
        className={`max-w-2xl rounded-2xl px-4 py-3 text-sm ${
          isUser
            ? 'bg-blue-700 text-white rounded-tr-sm'
            : 'bg-slate-700 text-slate-100 rounded-tl-sm'
        }`}
      >
        <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
        <p className={`text-xs mt-1.5 ${isUser ? 'text-orange-300' : 'text-slate-500'} text-right`}>
          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
      {isUser && (
        <div className="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center shrink-0 mt-1">
          <User size={14} />
        </div>
      )}
    </div>
  );
}

const INITIAL_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content: 'Hello! I am the Sonalit Copilot. I can help you with fleet insights, incident analysis, route optimization, and more. How can I assist you today?',
  timestamp: Date.now(),
};

const SUGGESTIONS = [
  'Which vehicles are overdue for maintenance?',
  'Summarize incidents from this week',
  'What is the current fleet utilization?',
  'Show top safety risks',
];

export default function Copilot() {
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HistoryEntry[]>([]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    const history = historyRef.current.slice(-6);

    try {
      const res = await api.post<DispatchResponse>('/ai/dispatch', {
        command: text,
        history,
      });

      const responseText = res.data?.response ?? 'No response received.';
      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: responseText,
        timestamp: Date.now(),
      };

      historyRef.current = [
        ...historyRef.current,
        { role: 'user' as Role, content: text },
        { role: 'assistant' as Role, content: responseText },
      ].slice(-12);

      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: 'Sorry, I encountered an error. Please try again.',
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full -m-6 overflow-hidden">
      <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-700 bg-slate-900 shrink-0">
        <Bot size={20} className="text-orange-400" />
        <h1 className="font-semibold">Sonalit Copilot</h1>
        <span className="text-xs text-slate-500 ml-1">AI-powered fleet assistant</span>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
        {messages.map((m) => (
          <ChatBubble key={m.id} message={m} />
        ))}

        {isLoading && (
          <div className="flex gap-3 justify-start">
            <div className="w-8 h-8 rounded-full bg-blue-700 flex items-center justify-center shrink-0">
              <Loader2 size={14} className="animate-spin" />
            </div>
            <div className="bg-slate-700 rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex gap-1.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-2 h-2 bg-slate-500 rounded-full animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
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
                onClick={() => setInput(s)}
                className="text-left px-4 py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-sm text-slate-300 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="border-t border-slate-700 bg-slate-900 px-6 py-4 shrink-0">
        <div className="flex gap-3">
          <textarea
            className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            placeholder="Ask the Copilot anything… (Enter to send)"
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="p-3 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 rounded-xl transition-colors"
            aria-label="Send message"
          >
            {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}
