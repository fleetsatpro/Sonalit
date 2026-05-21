import { useState, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { getAccessToken } from '../stores/auth.js';
import { Bot, Send, Loader2, Clock } from 'lucide-react';

interface PastDecision {
  id: string;
  query: string;
  response: string;
  created_at: string;
}

interface QueryPayload {
  query: string;
  context?: string;
}

const API_BASE = '/api/v1';

export default function AIDecision() {
  const [query, setQuery] = useState('');
  const [context, setContext] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamedText, setStreamedText] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const { data: decisions, isLoading, isError, refetch } = useQuery<PastDecision[]>({
    queryKey: ['ai-decisions'],
    queryFn: async () => {
      const res = await api.get<PastDecision[]>('/ai/decisions', { params: { limit: 10 } });
      return res.data;
    },
  });

  const handleSubmit = useCallback(async () => {
    if (!query.trim() || streaming) return;

    abortRef.current = new AbortController();
    setStreaming(true);
    setStreamedText('');

    const payload: QueryPayload = { query: query.trim() };
    if (context.trim()) payload.context = context.trim();

    try {
      const authHeader = (() => {
        const token = getAccessToken();
        return token ? `Bearer ${token}` : '';
      })();

      const response = await fetch(`${API_BASE}/ai/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
        body: JSON.stringify(payload),
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
                setStreamedText((prev) => prev + parsed.content);
              }
            } catch {
              // plain text chunk
              setStreamedText((prev) => prev + chunk);
            }
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setStreamedText('Error: failed to get response. Please try again.');
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      refetch();
    }
  }, [query, context, streaming, refetch]);

  const handleStop = () => {
    abortRef.current?.abort();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Bot size={20} className="text-blue-400" />
        <h1 className="text-xl font-bold">AI Decision Support</h1>
      </div>

      {/* Query form */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 space-y-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Question</label>
          <textarea
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500 resize-none"
            rows={3}
            placeholder="Ask a question about fleet operations, incidents, risk analysis…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={streaming}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Context (optional)</label>
          <textarea
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500 resize-none"
            rows={2}
            placeholder="Additional context for the query…"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            disabled={streaming}
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleSubmit}
            disabled={!query.trim() || streaming}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-sm font-medium"
          >
            {streaming ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            {streaming ? 'Thinking…' : 'Ask AI'}
          </button>
          {streaming && (
            <button
              onClick={handleStop}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm"
            >
              Stop
            </button>
          )}
        </div>
      </div>

      {/* Streamed response */}
      {(streamedText || streaming) && (
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Bot size={16} className="text-blue-400" />
            <span className="text-xs text-slate-400 uppercase font-medium">AI Response</span>
            {streaming && <Loader2 size={12} className="animate-spin text-blue-400 ml-1" />}
          </div>
          <pre className="text-sm text-slate-100 whitespace-pre-wrap leading-relaxed font-sans">
            {streamedText}
            {streaming && <span className="inline-block w-1.5 h-4 bg-blue-400 ml-0.5 animate-pulse align-middle" />}
          </pre>
        </div>
      )}

      {/* Past decisions */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Clock size={16} className="text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-300">Recent Decisions</h2>
        </div>
        {isLoading && <div className="text-slate-400 text-sm">Loading past decisions…</div>}
        {isError && <div className="text-red-400 text-sm">Failed to load past decisions.</div>}
        <div className="space-y-3">
          {decisions?.map((decision) => (
            <div key={decision.id} className="bg-slate-800 border border-slate-700 rounded-lg p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="text-sm font-medium text-slate-200">{decision.query}</p>
                <span className="text-xs text-slate-500 shrink-0">
                  {new Date(decision.created_at).toLocaleString()}
                </span>
              </div>
              <p className="text-sm text-slate-400 line-clamp-3">{decision.response}</p>
            </div>
          ))}
          {decisions?.length === 0 && (
            <div className="text-slate-500 text-sm text-center py-4">No past decisions.</div>
          )}
        </div>
      </div>
    </div>
  );
}
