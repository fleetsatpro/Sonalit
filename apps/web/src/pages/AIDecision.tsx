import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Bot, Send, Loader2, AlertCircle, ShieldCheck, CheckCircle2, XCircle } from 'lucide-react';

interface Anomaly {
  id: string;
  type: string;
  title: string;
  severity: string;
  created_at: string;
  registration: string | null;
}

interface PendingAction {
  action_id: string;
  request_id?: string;
  confirmation_token: string;
  tool_name: string;
  title: string;
  summary: string;
  risk_level: string;
  expires_at?: string | null;
}

interface CreatedOperation {
  type: string;
  name?: string;
  location?: string;
  geofence_id?: string;
  risk_zone_id?: string;
  fence_type?: string;
  geometry_source?: string;
  precision?: string;
  requested_precision?: string;
  vertex_count?: number;
  radius_m?: number | null;
  buffer_m?: number;
  route_distance_km?: number | string;
  fallback_used?: boolean;
  geometry_verification?: { start_drift_m?: number; end_drift_m?: number; persisted_path_points?: number; persisted_vertices?: number; vertices?: number; persisted?: boolean };
  message?: string;
  error?: string;
}

interface DispatchResponse {
  response?: string;
  answer?: string;
  actions?: string[];
  source?: string;
  request_id?: string;
  decision_id?: string | null;
  task?: { type?: string; completed?: boolean };
  created?: CreatedOperation[];
  pending_actions?: PendingAction[];
  action_receipt?: { id?: string; request_id?: string; tool_name?: string; risk_level?: string; status?: string; created_at?: string; completed_at?: string | null };
  decision?: string;
  risk_level?: string;
  id?: string;
  confidence?: number;
  recommended_actions?: Array<{ action: string; reason?: string; approval?: string; urgency?: string }>;
  risks?: Array<{ risk: string; severity: string }>;
  missing_data?: string[];
  dissent?: string[];
  swarm?: Array<{
    id: string;
    name: string;
    status: string;
    confidence: number;
    provider: string;
    finding: string;
    dissent?: string;
  }>;
  meta?: {
    agent_count?: number;
    agent_failures?: number;
    evidence_tools?: string[];
    latency_ms?: number;
    degraded?: boolean;
    model_fallback_available?: boolean;
  };
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
  const [history, setHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [feedbackSent, setFeedbackSent] = useState('');
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const [lastActionOutcome, setLastActionOutcome] = useState<DispatchResponse | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    let active = true;
    api.get<{ pending_actions?: PendingAction[] }>('/ai/dispatch/pending')
      .then(({ data }) => { if (active) setPendingActions(data.pending_actions || []); })
      .catch(() => { /* Existing server versions may not expose persisted approvals yet. */ });
    return () => { active = false; };
  }, []);

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
      // The backend classifies the request and selects the governed execution
      // lane. This page must not bypass operational dispatch with /ai/decision.
      const res = await api.post<DispatchResponse>('/ai/dispatch', {
        command,
        history: history.slice(-10),
        request_id: crypto.randomUUID(),
      });
      return res.data;
    },
    onSuccess: (data, command) => {
      const answer = data.answer ?? data.response ?? 'No result was returned by Copilot.';
      setLastResponse(answer);
      if (data.task || data.created?.length || data.action_receipt || data.pending_actions?.length) {
        setLastActionOutcome(data);
      } else {
        setLastActionOutcome(null);
      }
      setPendingActions((current) => {
        const byId = new Map<string, PendingAction>(current.map(action => [action.action_id, action] as const));
        for (const action of data.pending_actions || []) byId.set(action.action_id, action);
        return [...byId.values()].slice(-10);
      });
      const createdTypes = new Set((data.created || []).map(item => item.type));
      if (createdTypes.has('geofence')) {
        queryClient.invalidateQueries({ queryKey: ['geofences'] });
        queryClient.invalidateQueries({ queryKey: ['geofences-list'] });
        queryClient.invalidateQueries({ queryKey: ['geofence-map-data'] });
      }
      if (createdTypes.has('risk_zone')) {
        queryClient.invalidateQueries({ queryKey: ['risk-zones'] });
        queryClient.invalidateQueries({ queryKey: ['risk-zones-list'] });
      }
      setHistory((items) => [...items, { role: 'user' as const, content: command }, { role: 'assistant' as const, content: answer }].slice(-12));
      setQuery('');
    },
  });

  const confirmActionMutation = useMutation<
    DispatchResponse,
    Error,
    { action: PendingAction; approved: boolean }
  >({
    mutationFn: async ({ action, approved }) => {
      const res = await api.post<DispatchResponse>('/ai/dispatch/confirm', {
        action_id: action.action_id,
        confirmation_token: action.confirmation_token,
        approved,
      });
      return res.data;
    },
    onSuccess: (data, variables) => {
      setPendingActions((current) => current.filter(action => action.action_id !== variables.action.action_id));
      setLastActionOutcome(data);
      const answer = data.answer ?? data.response ?? 'The action request has been resolved.';
      const receipt = data.action_receipt?.id
        ? '\n\nAction receipt: ' + data.action_receipt.id + ' · ' + (data.action_receipt.status || 'recorded')
        : '';
      setLastResponse(answer + receipt);
      setHistory((items) => [...items, {
        role: 'assistant' as const,
        content: answer + receipt,
      }].slice(-12));
      const createdTypes = new Set((data.created || []).map(item => item.type));
      if (createdTypes.has('geofence')) {
        queryClient.invalidateQueries({ queryKey: ['geofences'] });
        queryClient.invalidateQueries({ queryKey: ['geofences-list'] });
        queryClient.invalidateQueries({ queryKey: ['geofence-map-data'] });
      }
      if (createdTypes.has('risk_zone')) {
        queryClient.invalidateQueries({ queryKey: ['risk-zones'] });
        queryClient.invalidateQueries({ queryKey: ['risk-zones-list'] });
      }
    },
  });

  const handleSubmit = useCallback(() => {
    const fullCommand = context.trim()
      ? `${query.trim()}\n\nContext: ${context.trim()}`
      : query.trim();
    if (!fullCommand) return;
    dispatchMutation.mutate(fullCommand);
  }, [query, context, dispatchMutation]);

  const feedbackMutation = useMutation<{ ok: boolean }, Error, { outcome: string; notes?: string }>({
    mutationFn: async ({ outcome, notes }) => {
      const decisionId = dispatchMutation.data?.decision_id || (dispatchMutation.data as DispatchResponse & { id?: string })?.id;
      if (!decisionId) throw new Error('Decision identifier unavailable');
      const res = await api.post<{ ok: boolean }>(`/ai/decision/${decisionId}/feedback`, { outcome, notes });
      return res.data;
    },
    onSuccess: (_, vars) => setFeedbackSent(vars.outcome),
  });

  const dispatchError = dispatchMutation.error as (Error & {
    response?: { data?: { error?: string; message?: string } };
  }) | null;
  const confirmError = confirmActionMutation.error as (Error & {
    response?: { data?: { error?: string; message?: string } };
  }) | null;
  const dispatchErrorMessage = dispatchError?.response?.data?.message
    || dispatchError?.response?.data?.error
    || dispatchError?.message
    || 'Copilot could not complete this request.';
  const confirmErrorMessage = confirmError?.response?.data?.message
    || confirmError?.response?.data?.error
    || confirmError?.message
    || 'Check the durable action receipt before retrying.';

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
        <h1 className="text-xl font-bold">Sonalit Copilot</h1>
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
            <span>{dispatchErrorMessage} No operation is reported as completed unless the result panel confirms it.</span>
          </div>
        )}
        <button
          onClick={handleSubmit}
          disabled={!query.trim() || dispatchMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 rounded text-sm font-medium"
        >
          {dispatchMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          {dispatchMutation.isPending ? 'Thinking…' : 'Ask Copilot'}
        </button>
      </div>

      {dispatchMutation.data && (dispatchMutation.data.decision || dispatchMutation.data.risk_level || dispatchMutation.data.confidence != null || dispatchMutation.data.swarm?.length) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-3"><div className="text-[10px] uppercase text-slate-500">Decision</div><div className="text-sm font-semibold text-cyan-300 mt-1">{dispatchMutation.data.decision ?? '—'}</div></div>
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-3"><div className="text-[10px] uppercase text-slate-500">Risk</div><div className="text-sm font-semibold text-orange-300 mt-1">{dispatchMutation.data.risk_level ?? '—'}</div></div>
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-3"><div className="text-[10px] uppercase text-slate-500">Confidence</div><div className="text-sm font-semibold text-emerald-300 mt-1">{dispatchMutation.data.confidence != null ? Math.round(dispatchMutation.data.confidence * 100) + '%' : '—'}</div></div>
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-3"><div className="text-[10px] uppercase text-slate-500">Swarm</div><div className="text-sm font-semibold text-violet-300 mt-1">{dispatchMutation.data.meta?.agent_count ?? dispatchMutation.data.swarm?.length ?? 0} agents</div></div>
        </div>
      )}

      {lastActionOutcome && (
        <section className="rounded-xl border border-slate-700 bg-slate-950 p-4 space-y-3" aria-label="Operational action result">
          <div className="flex items-center gap-3">
            {lastActionOutcome.task?.completed
              ? <CheckCircle2 size={20} className="text-emerald-400" />
              : lastActionOutcome.pending_actions?.length
                ? <ShieldCheck size={20} className="text-amber-300" />
                : <XCircle size={20} className="text-rose-400" />}
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-extrabold text-slate-100">
                {lastActionOutcome.pending_actions?.length
                  ? 'Awaiting operator confirmation'
                  : lastActionOutcome.task?.completed
                    ? 'Operational action completed'
                    : 'Operational action not completed'}
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                {lastActionOutcome.source || 'dispatch'}{lastActionOutcome.request_id ? ' · Request ' + lastActionOutcome.request_id : ''}
              </p>
            </div>
          </div>
          {(lastActionOutcome.created || []).map((item, index) => (
            <div key={(item.geofence_id || item.risk_zone_id || item.type) + '-' + index} className="rounded-lg border border-slate-800 bg-slate-900 p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-bold text-slate-100">{item.name || item.type.replace(/_/g, ' ')}</span>
                <span className="rounded border border-emerald-800 bg-emerald-950 px-2 py-1 text-[10px] font-bold uppercase text-emerald-300">Persisted result</span>
              </div>
              {item.message && <p className="text-sm leading-relaxed text-slate-300">{item.message}</p>}
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
                {item.geofence_id && <div><dt className="text-slate-500">Geofence ID</dt><dd className="mt-0.5 break-all font-mono text-slate-200">{item.geofence_id}</dd></div>}
                {item.risk_zone_id && <div><dt className="text-slate-500">Risk-zone ID</dt><dd className="mt-0.5 break-all font-mono text-slate-200">{item.risk_zone_id}</dd></div>}
                {item.location && <div><dt className="text-slate-500">Resolved location</dt><dd className="mt-0.5 text-slate-200">{item.location}</dd></div>}
                {item.geometry_source && <div><dt className="text-slate-500">Geometry provenance</dt><dd className="mt-0.5 text-slate-200">{item.geometry_source}</dd></div>}
                {item.precision && <div><dt className="text-slate-500">Geometry status</dt><dd className="mt-0.5 text-slate-200">{item.precision}</dd></div>}
                {item.vertex_count != null && <div><dt className="text-slate-500">Vertices</dt><dd className="mt-0.5 text-slate-200">{item.vertex_count}</dd></div>}
                {item.radius_m != null && <div><dt className="text-slate-500">Radius</dt><dd className="mt-0.5 text-slate-200">{item.radius_m} m</dd></div>}
                {item.buffer_m != null && <div><dt className="text-slate-500">Corridor buffer</dt><dd className="mt-0.5 text-slate-200">{item.buffer_m} m</dd></div>}
                {item.route_distance_km != null && <div><dt className="text-slate-500">Road distance</dt><dd className="mt-0.5 text-slate-200">{item.route_distance_km} km</dd></div>}
                {item.geometry_verification && <div><dt className="text-slate-500">Geometry verification</dt><dd className="mt-0.5 text-slate-200">{item.geometry_verification.persisted_vertices ?? item.geometry_verification.persisted_path_points ?? 'verified persisted geometry'}</dd></div>}
                {item.fallback_used && <div><dt className="text-amber-300">Precision warning</dt><dd className="mt-0.5 text-amber-200">Fallback geometry used. Review before operational use.</dd></div>}
              </dl>
            </div>
          ))}
          {lastActionOutcome.action_receipt && (
            <div className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs">
              <div className="font-bold uppercase tracking-wide text-slate-400">Durable action receipt</div>
              <div className="mt-1 break-all font-mono text-slate-200">{lastActionOutcome.action_receipt.id}</div>
              <div className="mt-1 text-slate-400">Status: {lastActionOutcome.action_receipt.status || 'recorded'}</div>
            </div>
          )}
        </section>
      )}

      {pendingActions.map((action) => (
        <section key={action.action_id} className="rounded-xl border border-amber-400/40 bg-amber-950/20 p-4 space-y-3" aria-label="Operational approval required">
          <div className="flex items-center gap-3">
            <ShieldCheck size={20} className="text-amber-300" />
            <div>
              <h2 className="text-sm font-extrabold text-amber-50">Approval required · {action.risk_level} risk</h2>
              <p className="mt-1 text-sm font-bold text-white">{action.title}</p>
              <p className="mt-1 text-sm text-amber-50/80">{action.summary}</p>
              {action.expires_at && <p className="mt-1 text-xs text-amber-200/70">Expires {new Date(action.expires_at).toLocaleString()}</p>}
              <p className="mt-2 text-xs font-semibold text-amber-100">Nothing has been executed yet.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => confirmActionMutation.mutate({ action, approved: true })} disabled={confirmActionMutation.isPending} className="rounded-lg bg-amber-300 px-4 py-2 text-sm font-extrabold text-slate-950 disabled:opacity-50">
              Confirm and execute
            </button>
            <button type="button" onClick={() => confirmActionMutation.mutate({ action, approved: false })} disabled={confirmActionMutation.isPending} className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-bold text-slate-100 disabled:opacity-50">
              Decline
            </button>
          </div>
          {confirmActionMutation.isError && <p className="text-sm text-rose-300">{confirmErrorMessage}</p>}
        </section>
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


      {dispatchMutation.data?.id && (
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
          <div className="text-xs uppercase font-semibold text-slate-400 mb-3">Decision Outcome Feedback</div>
          <div className="flex flex-wrap gap-2">
            {['correct','partially_correct','incorrect','superseded','unknown'].map((outcome) => (
              <button
                key={outcome}
                type="button"
                disabled={feedbackMutation.isPending}
                onClick={() => feedbackMutation.mutate({ outcome })}
                className="px-3 py-1.5 rounded border border-slate-700 bg-slate-950 text-xs text-slate-300 hover:border-cyan-500/50 disabled:opacity-50"
              >
                {outcome.replace('_',' ')}
              </button>
            ))}
          </div>
          {feedbackSent && <div className="text-[11px] text-emerald-400 mt-2">Recorded: {feedbackSent}</div>}
        </div>
      )}

      {lastResponse && (
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Bot size={16} className="text-orange-400" />
            <span className="text-xs text-slate-400 uppercase font-medium">Sonalit Copilot</span>
          </div>
          <pre className="text-sm text-slate-100 whitespace-pre-wrap leading-relaxed font-sans">
            {lastResponse}
          </pre>
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold text-slate-300 mb-3">Copilot-Detected Signals</h2>
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
