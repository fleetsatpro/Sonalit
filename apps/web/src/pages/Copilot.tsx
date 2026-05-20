import { useState, useRef, useEffect, useCallback } from 'react';
import { Bot, Send, User, Loader2 } from 'lucide-react';

type Role = 'user' | 'assistant';

interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  timestamp: number;
  streaming?: boolean;
}

const API_BASE = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '/v4';
const SESSION_KEY = 'sonalit-copilot-session';

function getAuthToken(): string {
  try {
    const raw = localStorage.getItem('sonalit-auth');
    if (!raw) return '';
    const parsed = JSON.parse(raw) as { state?: { token?: string } };
    return parsed.state?.token ?? '';
  } catch {
    return '';
  }
}

function getOrCreateSessionId(): string {
  let sid = sessionStorage.getItem(SESSION_KEY);
  if (!sid) {
    sid = `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(SESSION_KEY, sid);
  }
  return sid;
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
        <p className="whitespace-pre-wrap leading-relaxed">
          {message.content}
          {message.streaming && (
            <span className="inline-block w-1.5 h-4 bg-blue-400 ml-0.5 animate-pulse align-middle" />
          )}
        </p>
        {!message.streaming && (
          <p className={`text-xs mt-1.5 ${isUser ? 'text-blue-300' : 'text-slate-500'} text-right`}>
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
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

export default function Copilot() {
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionId = useRef(getOrCreateSessionId());

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    const assistantMsgId = `assistant-${Date.now()}`;
    const assistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      streaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setIsStreaming(true);

    abortRef.current = new AbortController();

    try {
      const token = getAuthToken();
      const response = await fetch(`${API_BASE}/ai/copilot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ message: text, session_id: sessionId.current }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const chunk = line.slice(6);
            if (chunk === '[DONE]') break;
            try {
              const parsed = JSON.parse(chunk) as { content?: string };
              if (parsed.content) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, content: m.content + parsed.content }
                      : m,
                  ),
                );
              }
            } catch {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? { ...m, content: m.content + chunk }
                    : m,
                ),
              );
            }
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: 'Sorry, I encountered an error. Please try again.' }
              : m,
          ),
        );
      }
    } finally {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId ? { ...m, streaming: false } : m,
        ),
      );
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [input, isStreaming]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const SUGGESTIONS = [
    'Which vehicles are overdue for maintenance?',
    'Summarize incidents from this week',
    'What is the current fleet utilization?',
    'Show top safety risks',
  ];

  return (
    <div className="flex flex-col h-full -m-6 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-700 bg-slate-900 shrink-0">
        <Bot size={20} className="text-blue-400" />
        <h1 className="font-semibold">Sonalit Copilot</h1>
        <span className="text-xs text-slate-500 ml-1">RAG-powered fleet assistant</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
        {messages.map((m) => (
          <ChatBubble key={m.id} message={m} />
        ))}

        {isStreaming && messages[messages.length - 1]?.content === '' && (
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

      {/* Input */}
      <div className="border-t border-slate-700 bg-slate-900 px-6 py-4 shrink-0">
        <div className="flex gap-3">
          <textarea
            className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            placeholder="Ask the Copilot anything… (Enter to send)"
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            className="p-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl transition-colors"
            aria-label="Send message"
          >
            {isStreaming ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}
