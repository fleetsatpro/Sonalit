import { useState, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Bot, Send, Loader2, AlertCircle } from 'lucide-react';

interface Anomaly {
  id: string;
  type: string;
  title: string;
  severity: string;
  created_at: string;
  registration: string | null;
}

interface DispatchResponse {
  response: string;
  actions: string[];
  source: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-900/60 text-red-300',
  warning: 'bg-orange-900/60 text-orange-300',
  high: 'bg-orange-900/60 text-orange-300',
  info: 'bg-gray-800 text-gray-400',
  low: 'bg-gray-800 text-gray-400',
};

export default function AIDecision() {
  const [query, setQuery] = useState('');
  const [context, setContext] = useState('');
  const [lastResponse, setLastResponse] = useState('');

  const { data: anomalies, isLoading: anomaliesLoading } = useQuery<Anomaly[]>({
    queryKey: ['ai-anomalies'],
    queryFn: async () => {
      const res = await api.get<{ data: Anomaly[] }>('/ai/anomalies');
      return res.data?.data ?? [];
    },
    refetchInterval: 30_000,
  });

  const dispatchMutation = useMutation<DispatchResponse, Error, string>({
    mutationFn: async (command) => {
      const res = await api.post<DispatchResponse>('/ai/decision', { command, history: [] });
      return res.data;
    },
    onSuccess: (data) => {
      setLastResponse(data.answer ?? data.response ?? 'No decision response received.');
      setQuery('');
    },
  });

  const handleSubmit = useCallback(() => {
    const fullCommand = context.trim()
      ? `${query.trim()}\n\nContext: ${context.trim()}`
      : query.trim();
    if (!fullCommand) return;
    dispatchMutation.mutate(fullCommand);
  }, [query, context, dispatchMutation]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Bot size={20} className="text-orange-400" />
        <h1 className="text-xl font-bold">AI Decision Support</h1>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 space-y-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Question</label>
          <textarea
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-orange-500 resize-none"
            rows={3}
            placeholder="Ask about fleet operations, incidents, risk analysis…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={dispatchMutation.isPending}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Context (optional)</label>
          <textarea
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-orange-500 resize-none"
            rows={2}
            placeholder="Additional context…"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            disabled={dispatchMutation.isPending}
          />
        </div>
        {dispatchMutation.isError && (
          <div className="flex items-center gap-2 text-red-400 text-sm">
            <AlertCircle size={14} />
            <span>Failed to get response. Please try again.</span>
          </div>
        )}
        <button
          onClick={handleSubmit}
          disabled={!query.trim() || dispatchMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 rounded text-sm font-medium"
        >
          {dispatchMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          {dispatchMutation.isPending ? 'Thinking…' : 'Ask AI'}
        </button>
      </div>



      {dispatchMutation.data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-3"><div className="text-[10px] uppercase text-slate-500">Decision</div><div className="text-sm font-semibold text-cyan-300 mt-1">{dispatchMutation.data.decision ?? '—'}</div></div>
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-3"><div className="text-[10px] uppercase text-slate-500">Risk</div><div className="text-sm font-semibold text-orange-300 mt-1">{dispatchMutation.data.risk_level ?? '—'}</div></div>
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-3"><div className="text-[10px] uppercase text-slate-500">Confidence</div><div className="text-sm font-semibold text-emerald-300 mt-1">{dispatchMutation.data.confidence != null ? Math.round(dispatchMutation.data.confidence * 100) + '%' : '—'}</div></div>
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-3"><div className="text-[10px] uppercase text-slate-500">Swarm</div><div className="text-sm font-semibold text-violet-300 mt-1">{dispatchMutation.data.meta?.agent_count ?? dispatchMutation.data.swarm?.length ?? 0} agents</div></div>
        </div>
      )}

      {dispatchMutation.data?.swarm && (
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
          <div className="text-xs uppercase font-semibold text-slate-400 mb-3">Independent Agent Findings</div>
          <div className="space-y-2">
            {dispatchMutation.data.swarm.map((agent) => (
              <div key={agent.id} className="flex items-center gap-3 border-b border-slate-800 pb-2 last:border-0">
                <span className={agent.status === 'supported' ? 'text-emerald-400' : agent.status === 'uncertain' ? 'text-amber-400' : 'text-red-400'}>●</span>
                <div className="min-w-0 flex-1"><div className="text-xs text-slate-200">{agent.name}</div><div className="text-[11px] text-slate-500 truncate">{agent.finding}</div></div>
                <span className="text-[10px] font-mono text-slate-500">{Math.round((agent.confidence || 0) * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
\n      {lastResponse && (
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Bot size={16} className="text-orange-400" />
            <span className="text-xs text-slate-400 uppercase font-medium">AI Response</span>
          </div>
          <pre className="text-sm text-slate-100 whitespace-pre-wrap leading-relaxed font-sans">
            {lastResponse}
          </pre>
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold text-slate-300 mb-3">AI-Detected Anomalies</h2>
        {anomaliesLoading && <div className="text-slate-400 text-sm">Loading anomalies…</div>}
        <div className="space-y-2">
          {(anomalies ?? []).map((anomaly) => (
            <div key={anomaly.id} className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-200 truncate">{anomaly.title}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {anomaly.type}
                  {anomaly.registration ? ` · ${anomaly.registration}` : ''}
                  {' · '}{new Date(anomaly.created_at).toLocaleString()}
                </p>
              </div>
              <span className={`shrink-0 px-2 py-0.5 rounded text-xs font-medium ${SEVERITY_COLORS[anomaly.severity] ?? 'bg-gray-800 text-gray-400'}`}>
                {anomaly.severity}
              </span>
            </div>
          ))}
          {!anomaliesLoading && (anomalies ?? []).length === 0 && (
            <div className="text-slate-500 text-sm text-center py-4">No anomalies detected.</div>
          )}
        </div>
      </div>
    </div>
  );
}
