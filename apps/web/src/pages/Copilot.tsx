import { useState, useRef, useEffect, useCallback } from 'react';
import { Bot, Send, User, Loader2, MapPin, Trash2, CheckCheck, X, Activity, Database, ShieldCheck, Radar, Sparkles, ChevronRight } from 'lucide-react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { api } from '../lib/api.js';
import { formatArea, polygonAreaM2, polygonValidationError, toGeoJsonPolygon } from '../lib/geofenceGeometry.js';
import { shouldOpenManualPolygonDrawing } from '../lib/geofenceIntent.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';

type Role = 'user' | 'assistant';
interface ChatMessage { id: string; role: Role; content: string; timestamp: number }
interface HistoryEntry { role: Role; content: string }
interface DecisionResponse {
  answer?: string;
  response?: string;
  message?: string;
  decision?: string | { summary?: string };
  meta?: { degraded?: boolean; fatal?: boolean; latency_ms?: number; agent_count?: number; agent_failures?: number; provider_fallback_available?: boolean };
  assurance?: { safety_gate?: string; evidence_health?: { succeeded?: number } };
  risk_level?: string;
  confidence?: number;
  created?: Array<{ type?: string; name?: string; geofence_id?: string; message?: string; precision?: string; route_provider?: string; road_distance_km?: string; path_points?: number; buffer_m?: number; location?: string; shape?: string; radius_m?: number | null; vertex_count?: number; geometry_source?: string }>;
  task?: { type?: string; precision?: string; completed?: boolean };
  actions?: string[];
  source?: string;
  request_id?: string;
  decision_id?: string | null;
  pending_actions?: PendingAction[];
  action_receipt?: { id?: string; request_id?: string; tool_name?: string; risk_level?: string; status?: string; created_at?: string; completed_at?: string | null };
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
  preview?: Record<string, unknown>;
}

const DARK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const INITIAL_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content: 'Hello. I am Sonalit Copilot — an evidence-linked operational agent. I can investigate fleet, convoy, shipment, maintenance, security, route, spatial and incident questions; execute supported operational tasks; and create high-precision geofences and route corridors.',
  timestamp: Date.now(),
};

const SUGGESTIONS = [
  'Which vehicles are overdue for maintenance?',
  'Assess the safest route for the active convoy',
  'Draw a high-precision geofence around Nairobi',
  'Create a corridor geofence from Nairobi to Mombasa with a 500m buffer',
];

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-orange-700/60 border border-orange-600/40 flex items-center justify-center shrink-0 mt-1">
          <Bot size={14} className="text-orange-300" />
        </div>
      )}
      <div className={`max-w-xl rounded-2xl px-4 py-3 text-sm ${isUser ? 'bg-orange-600/80 text-white rounded-tr-sm' : 'bg-gray-800 text-gray-100 rounded-tl-sm border border-gray-700/60'}`}>
        <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
        <p className={`text-xs mt-1.5 ${isUser ? 'text-orange-200/70' : 'text-gray-500'} text-right`}>
          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
      {isUser && (
        <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center shrink-0 mt-1">
          <User size={14} className="text-gray-300" />
        </div>
      )}
    </div>
  );
}

function DrawPanel({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [points, setPoints] = useState<[number, number][]>([]);
  const [name, setName] = useState('');
  const [done, setDone] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const polygonError = polygonValidationError(points);

  const createMutation = useMutation({
    mutationFn: () => api.post('/geofences', { name: name.trim(), type: 'polygon', coordinates: toGeoJsonPolygon(points) }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['geofences'] }),
        queryClient.invalidateQueries({ queryKey: ['geofences-list'] }),
        queryClient.invalidateQueries({ queryKey: ['geofence-map-data'] }),
      ]);
      onClose();
    },
  });

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: DARK_STYLE,
      center: [27.5, -11.5],
      zoom: 5,
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.on('load', () => {
      map.addSource('draw', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'draw-fill', type: 'fill', source: 'draw', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#a78bfa', 'fill-opacity': 0.2 } });
      map.addLayer({ id: 'draw-line', type: 'line', source: 'draw', filter: ['==', '$type', 'LineString'], paint: { 'line-color': '#c4b5fd', 'line-width': 3 } });
      map.addLayer({ id: 'draw-pts', type: 'circle', source: 'draw', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#ff9040', 'circle-stroke-width': 2.5, 'circle-stroke-color': '#fff' } });
      setMapReady(true);
    });

    map.on('click', (e) => {
      if ((e.originalEvent.target as HTMLElement).closest('button')) return;
      // Sonalit geofence storage/engine use [lat,lng] for plain path arrays.
      setPoints((prev) => [...prev, [e.lngLat.lat, e.lngLat.lng]]);
    });

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !map.loaded()) return;
    const source = map.getSource('draw') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    const features: GeoJSON.Feature[] = points.map((p, index) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p[1], p[0]] }, properties: { index: index + 1 } }));
    if (points.length >= 2) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: points.map(([lat, lng]) => [lng, lat]) }, properties: {} });
    if (points.length >= 3) features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: toGeoJsonPolygon(points).coordinates }, properties: {} });
    source.setData({ type: 'FeatureCollection', features });
  }, [points, mapReady]);

  return (
    <div className="flex flex-col h-full border-l border-gray-800" style={{ minWidth: 0 }}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 shrink-0">
        <span className="text-sm font-medium text-white flex items-center gap-1.5">
          <MapPin size={14} className="text-orange-400" /> Draw Geofence
        </span>
        <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={14} /></button>
      </div>

      <div className="relative flex-1">
        <div ref={mapContainer} className="w-full h-full" />
        <div className="absolute bottom-3 left-3 right-3 z-10 flex flex-col gap-2">
          {points.length > 0 && !done && (
            <div className="rounded-xl border border-white/10 bg-gray-950/95 p-2.5 space-y-2 shadow-2xl backdrop-blur-xl">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-bold text-white"><span>{points.length} vertices · {formatArea(polygonAreaM2(points))}</span><span className="text-xs font-semibold text-violet-200">Area preview</span></div>
              {polygonError && <p className="text-xs font-bold text-amber-200" role="status">{polygonError}</p>}
              <div className="flex gap-2">
                <button onClick={() => setPoints(prev => prev.slice(0, -1))} className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800 px-3 text-sm font-bold text-gray-100 hover:bg-gray-700"><ChevronRight size={15} className="rotate-180" /> Undo</button>
                <button onClick={() => { setPoints([]); setDone(false); createMutation.reset(); }} className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800 px-3 text-sm font-bold text-gray-100 hover:bg-gray-700"><Trash2 size={15} /> Clear</button>
                <button onClick={() => setDone(true)} disabled={Boolean(polygonError)} className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-violet-400/40 bg-violet-600 px-3 text-sm font-extrabold text-white shadow-lg shadow-violet-950/40 hover:bg-violet-500 disabled:opacity-40"><CheckCheck size={15} strokeWidth={2.5} /> Finish</button>
              </div>
            </div>
          )}
          {points.length === 0 && (
            <span className="px-3 py-2 bg-gray-950/95 text-gray-100 text-sm font-bold rounded-xl border border-white/10 text-center shadow-xl">
              Click the map to place area vertices · 3 or more points
            </span>
          )}
        </div>
      </div>

      {done && (
        <div className="shrink-0 border-t border-gray-800 p-3 space-y-2">
          <input autoFocus aria-label="Geofence name" className="w-full min-h-11 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-base font-bold text-white focus:outline-none focus:border-violet-400" placeholder="Geofence name…" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && !polygonError && createMutation.mutate()} />
          <div className="flex gap-2">
            <button onClick={() => createMutation.mutate()} disabled={!name.trim() || Boolean(polygonError) || createMutation.isPending} className="flex-1 min-h-11 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-extrabold rounded-lg transition-colors">{createMutation.isPending ? 'Saving area…' : 'Create Polygon Geofence'}</button>
            <button onClick={() => { setDone(false); createMutation.reset(); }} className="min-h-11 px-4 text-gray-100 hover:text-white text-sm font-bold rounded-lg border border-gray-700">Back</button>
          </div>
          {createMutation.isError && <p className="text-red-200 text-sm font-bold" role="alert">{(createMutation.error as any)?.response?.data?.details ?? (createMutation.error as any)?.response?.data?.error ?? 'Failed to create geofence. Review the polygon boundary and try again.'}</p>}
        </div>
      )}
    </div>
  );
}

export default function Copilot() {
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showDraw, setShowDraw] = useState(false);
  const [telemetry, setTelemetry] = useState<DecisionResponse['meta'] & { confidence?: number; risk?: string; safety?: string; evidence?: number }>({});
  const [responseStatus, setResponseStatus] = useState<'NOT_CHECKED' | 'RESPONDED' | 'DEGRADED' | 'FAILED' | 'COMPLETED' | 'AWAITING_APPROVAL'>('NOT_CHECKED');
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const [confirmingActionId, setConfirmingActionId] = useState<string | null>(null);
  const responseDotClass = responseStatus === 'RESPONDED' || responseStatus === 'COMPLETED' ? 'bg-emerald-400' : responseStatus === 'DEGRADED' || responseStatus === 'AWAITING_APPROVAL' ? 'bg-amber-400' : responseStatus === 'FAILED' ? 'bg-rose-400' : 'bg-slate-500';
  const bottomRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HistoryEntry[]>([]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Restore the user's own persisted requests and any still-live action approvals.
  // Pending confirmation tokens are only held in component state and are re-issued
  // by the backend when the authenticated operator reloads the page.
  useEffect(() => {
    let active = true;
    const restore = async () => {
      const historyPromise = api.get<{ data?: Array<{ id: string; request_id?: string | null; command: string; answer: string; created_at: string }> }>('/ai/decision/history?limit=12')
        .catch(() => ({ data: { data: [] } } as { data: { data: Array<{ id: string; request_id?: string | null; command: string; answer: string; created_at: string }> } }));
      const pendingPromise = api.get<{ pending_actions?: PendingAction[] }>('/ai/dispatch/pending')
        .catch(() => ({ data: { pending_actions: [] } } as { data: { pending_actions: PendingAction[] } }));
      const [historyResponse, pendingResponse] = await Promise.all([historyPromise, pendingPromise]);
      if (!active) return;

      const rows = Array.isArray(historyResponse.data?.data) ? historyResponse.data.data.slice().reverse() : [];
      const restored: ChatMessage[] = rows.flatMap((entry) => {
        const timestamp = Date.parse(entry.created_at) || Date.now();
        return [
          { id: 'history-user-' + entry.id, role: 'user' as const, content: entry.command, timestamp },
          { id: entry.request_id ? 'request-' + entry.request_id : 'history-assistant-' + entry.id, role: 'assistant' as const, content: entry.answer, timestamp },
        ];
      });
      if (restored.length) {
        setMessages([INITIAL_MESSAGE, ...restored]);
        historyRef.current = rows.flatMap((entry) => [
          { role: 'user' as const, content: entry.command },
          { role: 'assistant' as const, content: entry.answer },
        ]).slice(-12);
      }

      const pending = Array.isArray(pendingResponse.data?.pending_actions) ? pendingResponse.data.pending_actions : [];
      setPendingActions(pending);
      if (pending.length) setResponseStatus('AWAITING_APPROVAL');
    };
    void restore();
    return () => { active = false; };
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;
    const userMsg: ChatMessage = { id: `user-${Date.now()}`, role: 'user', content: text, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);
    const history = historyRef.current.slice(-6);
    try {
      if (shouldOpenManualPolygonDrawing(text)) {
        setShowDraw(true);
        const responseText = 'Polygon drawing mode is open. Click the map to place at least three vertices. You can undo the last point, review the approximate area and boundary validation, then name and confirm the polygon. Nothing is saved until you press Create Polygon Geofence.';
        const assistantMsg: ChatMessage = { id: `assistant-${Date.now()}`, role: 'assistant', content: responseText, timestamp: Date.now() };
        historyRef.current = [...historyRef.current, { role: 'user', content: text }, { role: 'assistant', content: responseText }].slice(-12);
        setResponseStatus('RESPONDED');
        setMessages((prev) => [...prev, assistantMsg]);
        return;
      }
      // The backend owns classification, tool policy, evidence collection,
      // approvals and durable receipts. The client never authorizes a write.
      const res = await api.post<DecisionResponse>('/ai/dispatch', {
        command: text,
        history,
        request_id: crypto.randomUUID(),
      });
      const d = res.data;
      const baseResponseText = d?.answer ?? d?.response ?? d?.message ?? d?.decision?.summary ?? 'The operational agent returned no readable result.';
      const receiptSuffix = d?.action_receipt?.id ? `\n\nAction receipt: ${d.action_receipt.id} · ${d.action_receipt.status || 'recorded'}` : '';
      const responseText = baseResponseText + receiptSuffix;
      const createdTypes = new Set((d?.created || []).map(item => item.type));
      if (createdTypes.has('geofence')) {
        queryClient.invalidateQueries({ queryKey: ['geofences'] });
        queryClient.invalidateQueries({ queryKey: ['geofences-list'] });
        queryClient.invalidateQueries({ queryKey: ['geofence-map-data'] });
      }
      if (createdTypes.has('risk_zone')) {
        queryClient.invalidateQueries({ queryKey: ['risk-zones'] });
        queryClient.invalidateQueries({ queryKey: ['risk-zones-list'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      }
      if (d?.pending_actions?.length) {
        setPendingActions((current) => {
          const byId = new Map(current.map(action => [action.action_id, action]));
          for (const action of d.pending_actions || []) byId.set(action.action_id, action);
          return [...byId.values()].slice(-10);
        });
      }
      const pendingActionId = d?.pending_actions?.[0]?.action_id;
      const pendingRequestId = d?.request_id || d?.pending_actions?.[0]?.request_id;
      const assistantMsg: ChatMessage = { id: pendingActionId ? (pendingRequestId ? 'request-' + pendingRequestId : 'action-' + pendingActionId) : `assistant-${Date.now()}`, role: 'assistant', content: responseText, timestamp: Date.now() };
      setTelemetry({ ...(d.meta || {}), confidence: d.confidence, risk: d.risk_level, safety: d.assurance?.safety_gate, evidence: d.assurance?.evidence_health?.succeeded, agent_count: d.task?.completed ? 0 : d.meta?.agent_count });
      if (d?.pending_actions?.length) setResponseStatus('AWAITING_APPROVAL');
      else if (d.task) setResponseStatus(d.task.completed === true ? 'COMPLETED' : 'FAILED');
      else if (d.meta?.fatal) setResponseStatus('FAILED');
      else if (d.meta?.degraded || ['error', 'unconfigured', 'groq-fallback', 'geofence-error', 'geofence-validation'].includes(String(d.source || ''))) setResponseStatus('DEGRADED');
      else setResponseStatus('RESPONDED');
      historyRef.current = [...historyRef.current, { role: 'user', content: text }, { role: 'assistant', content: responseText }].slice(-12);
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (error: any) {
      const detail = error?.response?.data?.error || error?.response?.data?.message;
      const status = error?.response?.status;
      setResponseStatus('FAILED');
      setMessages((prev) => [...prev, { id: `error-${Date.now()}`, role: 'assistant', content: detail || `Copilot request failed${status ? ` (HTTP ${status})` : ''}. Please try again.` , timestamp: Date.now() }]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, queryClient]);

  const handleActionDecision = useCallback(async (action: PendingAction, approved: boolean) => {
    if (confirmingActionId) return;
    setConfirmingActionId(action.action_id);
    try {
      const result = await api.post<DecisionResponse>('/ai/dispatch/confirm', {
        action_id: action.action_id,
        confirmation_token: action.confirmation_token,
        approved,
      });
      const d = result.data;
      const responseText = d?.answer ?? d?.response ?? (approved ? 'Action completed.' : 'Action declined.');
      setPendingActions((current) => current.filter(item => item.action_id !== action.action_id));
      const createdTypes = new Set((d?.created || []).map(item => item.type));
      if (createdTypes.has('geofence')) {
        queryClient.invalidateQueries({ queryKey: ['geofences'] });
        queryClient.invalidateQueries({ queryKey: ['geofences-list'] });
        queryClient.invalidateQueries({ queryKey: ['geofence-map-data'] });
      }
      if (createdTypes.has('risk_zone')) {
        queryClient.invalidateQueries({ queryKey: ['risk-zones'] });
        queryClient.invalidateQueries({ queryKey: ['risk-zones-list'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      }

      const receiptSuffix = d?.action_receipt?.id ? '\n\nAction receipt: ' + d.action_receipt.id + ' · ' + (d.action_receipt.status || 'recorded') : '';
      const finalContent = responseText + receiptSuffix;
      setMessages((current) => {
        let replaced = false;
        const next = current.map((message) => {
          if (
            (action.request_id && message.id === 'request-' + action.request_id)
            || message.id === 'action-' + action.action_id
          ) {
            replaced = true;
            return { ...message, content: finalContent, timestamp: Date.now() };
          }
          return message;
        });
        return replaced ? next : [...next, {
          id: 'action-result-' + action.action_id,
          role: 'assistant',
          content: finalContent,
          timestamp: Date.now(),
        }];
      });

      // Replace the pending answer in the working context so future turns reason
      // from the actual outcome rather than a stale "awaiting confirmation" state.
      const last = historyRef.current[historyRef.current.length - 1];
      if (last && last.role === 'assistant' && /awaiting|prepared but has not been executed/i.test(last.content)) {
        historyRef.current = [...historyRef.current.slice(0, -1), { role: 'assistant', content: finalContent }].slice(-12);
      } else {
        historyRef.current = [...historyRef.current, { role: 'assistant', content: finalContent }].slice(-12);
      }
      setResponseStatus(d?.task?.completed === true ? 'COMPLETED' : 'RESPONDED');
    } catch (error: any) {
      const detail = error?.response?.data?.message || error?.response?.data?.error;
      setMessages((current) => [...current, {
        id: 'action-error-' + Date.now(),
        role: 'assistant',
        content: detail || 'The confirmation could not be completed. Check the action status before submitting a new command.',
        timestamp: Date.now(),
      }]);
      setResponseStatus('FAILED');
    } finally {
      setConfirmingActionId(null);
    }
  }, [confirmingActionId, queryClient]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div className="flex h-full -m-4 md:-m-6 overflow-hidden bg-[#050811] text-slate-100">
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <div className="border-b border-cyan-400/10 shrink-0 bg-[radial-gradient(circle_at_18%_-30%,rgba(34,211,238,.16),transparent_38%),linear-gradient(180deg,#0a1220,#050811)]">
          <div className="flex items-center gap-3 px-5 py-3">
            <div className="relative grid h-10 w-10 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/5">
              <Bot size={19} className="text-cyan-200" />
              <span className={`absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full ${responseDotClass}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-semibold tracking-[0.18em] text-white text-sm uppercase">SONALIT COPILOT</h1>
                <span className="rounded border border-cyan-300/20 bg-cyan-300/5 px-1.5 py-0.5 font-mono text-[9px] text-cyan-200">DECISION FABRIC</span>
              </div>
              <div className="mt-0.5 text-[10px] text-slate-500">Evidence-linked operational intelligence · human-gated actions</div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <div className="hidden xl:flex items-center gap-2 rounded-lg border border-slate-700/70 bg-slate-950/60 px-2.5 py-1.5">
                <Activity size={12} className="text-cyan-300" /><div><div className="text-[8px] tracking-widest text-slate-600">SWARM</div><div className="font-mono text-[9px] text-slate-300">{telemetry.agent_count ?? 'NOT CHECKED'}</div></div>
              </div>
              <div className="hidden xl:flex items-center gap-2 rounded-lg border border-slate-700/70 bg-slate-950/60 px-2.5 py-1.5">
                <Database size={12} className="text-cyan-300" /><div><div className="text-[8px] tracking-widest text-slate-600">EVIDENCE</div><div className="font-mono text-[9px] text-slate-300">{telemetry.evidence ?? 'NOT REPORTED'}</div></div>
              </div>
              <div className="hidden xl:flex items-center gap-2 rounded-lg border border-slate-700/70 bg-slate-950/60 px-2.5 py-1.5">
                <ShieldCheck size={12} className="text-cyan-300" /><div><div className="text-[8px] tracking-widest text-slate-600">SAFETY</div><div className="font-mono text-[9px] text-slate-300">{telemetry.safety ?? 'NOT ASSESSED'}</div></div>
              </div>
              <button onClick={() => setShowDraw((v) => !v)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-700 bg-slate-900/70 text-slate-300 hover:border-cyan-300/30 hover:text-cyan-200">
                <MapPin size={12} /> {showDraw ? 'Hide Map' : 'Draw Geofence'}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-4 border-t border-cyan-400/10 bg-slate-950/70">
            {[
              ['POSTURE', telemetry.risk || 'UNASSESSED'],
              ['CONFIDENCE', telemetry.confidence != null ? `${Math.round(telemetry.confidence * 100)}%` : '—'],
              ['LATENCY', telemetry.latency_ms ? `${telemetry.latency_ms}ms` : '—'],
              ['FALLBACK', telemetry.provider_fallback_available ? 'READY' : 'CHECK']
            ].map(([k, v]) => (
              <div key={k} className="px-3 py-2 border-r border-cyan-400/10 last:border-0">
                <div className="text-[8px] tracking-[0.16em] text-slate-600">{k}</div>
                <div className="font-mono text-[10px] text-slate-200 mt-0.5">{v}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4 bg-[radial-gradient(circle_at_70%_15%,rgba(34,211,238,.035),transparent_32%)]">
          <div className="flex items-center gap-2 rounded-xl border border-cyan-400/10 bg-cyan-300/[0.025] px-3 py-2 text-[9px] uppercase tracking-[0.16em] text-slate-500">
            <Radar size={12} className="text-cyan-300" /> COPILOT RESPONSE STATUS <span className={`ml-auto font-mono ${responseDotClass.replace('bg-', 'text-')}`}>● {responseStatus.replaceAll('_', ' ')}</span>
          </div>
          {messages.map((m) => <ChatBubble key={m.id} message={m} />)}
          {pendingActions.map((action) => (
            <section key={action.action_id} className="mx-auto w-full max-w-2xl rounded-2xl border border-amber-400/35 bg-amber-950/25 p-4 shadow-lg shadow-black/20" aria-label="Action approval required">
              <div className="flex items-start gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-amber-300/30 bg-amber-300/10">
                  <ShieldCheck size={17} className="text-amber-200" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-extrabold text-amber-50">Approval required</h2>
                    <span className="rounded-md border border-amber-300/25 bg-amber-300/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-200">{action.risk_level} risk</span>
                  </div>
                  <p className="mt-1 text-sm font-bold text-white">{action.title}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-amber-50/80">{action.summary}</p>
                  {action.expires_at && <p className="mt-2 text-xs text-amber-200/70">Approval expires {new Date(action.expires_at).toLocaleString()}</p>}
                  <p className="mt-2 text-xs font-semibold text-amber-100/80">Nothing has been executed yet.</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button onClick={() => handleActionDecision(action, true)} disabled={Boolean(confirmingActionId)} className="min-h-10 rounded-lg border border-amber-200/40 bg-amber-300 px-4 py-2 text-sm font-extrabold text-slate-950 hover:bg-amber-200 disabled:cursor-wait disabled:opacity-50">
                      {confirmingActionId === action.action_id ? 'Verifying…' : 'Confirm and execute'}
                    </button>
                    <button onClick={() => handleActionDecision(action, false)} disabled={Boolean(confirmingActionId)} className="min-h-10 rounded-lg border border-slate-500/70 bg-slate-900 px-4 py-2 text-sm font-bold text-slate-100 hover:bg-slate-800 disabled:cursor-wait disabled:opacity-50">Decline</button>
                  </div>
                </div>
              </div>
            </section>
          ))}
          {isLoading && (
            <div className="flex gap-3">
              <div className="grid h-8 w-8 place-items-center rounded-lg border border-cyan-300/20 bg-cyan-300/5"><Loader2 size={14} className="animate-spin text-cyan-200" /></div>
              <div className="rounded-xl border border-cyan-300/10 bg-slate-900 px-4 py-3 flex items-center gap-2">
                <Sparkles size={12} className="text-cyan-300" />
                <span className="text-[10px] uppercase tracking-widest text-slate-500">Reconciling operational evidence</span>
              </div>
            </div>
          )}
          {messages.length === 1 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => setInput(s)} className="group flex items-center justify-between text-left px-4 py-3 bg-slate-900/70 hover:bg-cyan-300/[0.04] border border-slate-800 hover:border-cyan-300/20 rounded-xl text-sm text-slate-300 transition-colors">
                  <span>
                    <span className="block text-[8px] uppercase tracking-widest text-slate-600">COPILOT QUERY</span>
                    {s}
                  </span>
                  <ChevronRight size={14} className="text-slate-700 group-hover:text-cyan-300" />
                </button>
              ))}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-cyan-400/10 px-4 py-3 shrink-0 bg-[#050811]/95">
          <div className="flex gap-2 rounded-2xl border border-slate-700/80 bg-slate-950/90 p-2">
            <textarea className="flex-1 bg-slate-900/80 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-300/30 resize-none" placeholder="Ask, investigate or instruct: fleet, convoys, routes, security, incidents, shipments, maintenance, spatial context or geofences…" rows={1} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown} disabled={isLoading} />
            <button onClick={handleSend} disabled={!input.trim() || isLoading} className="p-2.5 rounded-xl border border-cyan-300/30 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20 disabled:opacity-30" aria-label="Send">
              {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </div>
      {showDraw && <div className="w-80 shrink-0 flex flex-col overflow-hidden"><DrawPanel onClose={() => setShowDraw(false)} /></div>}
    </div>
  );
}
