import { useState, useRef, useEffect, useCallback } from 'react';
import { Bot, Send, User, Loader2, MapPin, Trash2, CheckCheck, X } from 'lucide-react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { api } from '../lib/api.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';

type Role = 'user' | 'assistant';
interface ChatMessage { id: string; role: Role; content: string; timestamp: number }
interface HistoryEntry { role: Role; content: string }
interface DispatchResponse { response: string; actions: string[]; source: string }

const DARK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const INITIAL_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content: 'Hello! I am the Sonalit Copilot. I can help with fleet insights, incidents, route optimization, and more. I can also draw geofences — click the map button or type "draw geofence".',
  timestamp: Date.now(),
};

const SUGGESTIONS = [
  'Which vehicles are overdue for maintenance?',
  'Summarize incidents from this week',
  'Draw a geofence',
  'Show top safety risks',
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

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/geofences', {
        name,
        type: 'both',
        coordinates: points,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['geofences'] });
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
      map.addLayer({ id: 'draw-fill', type: 'fill', source: 'draw', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#f07020', 'fill-opacity': 0.2 } });
      map.addLayer({ id: 'draw-line', type: 'line', source: 'draw', filter: ['==', '$type', 'LineString'], paint: { 'line-color': '#ff9040', 'line-width': 2 } });
      map.addLayer({ id: 'draw-pts', type: 'circle', source: 'draw', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#ff9040', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });
    });

    map.on('click', (e) => {
      if ((e.originalEvent.target as HTMLElement).closest('button')) return;
      setPoints((prev) => [...prev, [e.lngLat.lng, e.lngLat.lat]]);
    });

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Sync drawn shape to map source
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.loaded()) return;
    const source = map.getSource('draw') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    const features: GeoJSON.Feature[] = points.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: {} }));
    if (points.length >= 2) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: points }, properties: {} });
    if (points.length >= 3) features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...points, points[0]!]] }, properties: {} });
    source.setData({ type: 'FeatureCollection', features });
  }, [points]);

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
            <div className="flex gap-2">
              <button onClick={() => setPoints([])} className="flex items-center gap-1 px-2 py-1.5 bg-gray-900/90 hover:bg-gray-800 text-gray-300 text-xs rounded-lg border border-gray-700">
                <Trash2 size={11} /> Clear
              </button>
              {points.length >= 3 && (
                <button onClick={() => setDone(true)} className="flex items-center gap-1 px-2 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-xs rounded-lg font-medium">
                  <CheckCheck size={11} /> Finish ({points.length} pts)
                </button>
              )}
              {points.length < 3 && (
                <span className="px-2 py-1.5 bg-gray-900/90 text-gray-400 text-xs rounded-lg border border-gray-700">
                  {points.length} pt{points.length !== 1 ? 's' : ''} — need 3+
                </span>
              )}
            </div>
          )}
          {points.length === 0 && (
            <span className="px-2 py-1.5 bg-gray-900/90 text-gray-400 text-xs rounded-lg border border-gray-700 text-center">
              Click map to place vertices
            </span>
          )}
        </div>
      </div>

      {done && (
        <div className="shrink-0 border-t border-gray-800 p-3 space-y-2">
          <input
            autoFocus
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
            placeholder="Geofence name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && createMutation.mutate()}
          />
          <div className="flex gap-2">
            <button
              onClick={() => createMutation.mutate()}
              disabled={!name.trim() || createMutation.isPending}
              className="flex-1 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
            >
              {createMutation.isPending ? 'Saving…' : 'Create Geofence'}
            </button>
            <button onClick={() => setDone(false)} className="px-3 py-1.5 text-gray-400 hover:text-white text-xs rounded-lg">
              Back
            </button>
          </div>
          {createMutation.isError && <p className="text-red-400 text-xs">Failed to create geofence.</p>}
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
  const bottomRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HistoryEntry[]>([]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Auto-open draw panel when user mentions geofence drawing
  useEffect(() => {
    if (/draw.*(geofence|zone|area)|create.*(geofence|zone)/i.test(input)) setShowDraw(true);
  }, [input]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;
    const userMsg: ChatMessage = { id: `user-${Date.now()}`, role: 'user', content: text, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);
    const history = historyRef.current.slice(-6);
    try {
      const res = await api.post<DispatchResponse>('/ai/dispatch', { command: text, history });
      const responseText = res.data?.response ?? 'No response received.';
      const assistantMsg: ChatMessage = { id: `assistant-${Date.now()}`, role: 'assistant', content: responseText, timestamp: Date.now() };
      historyRef.current = [...historyRef.current, { role: 'user' as Role, content: text }, { role: 'assistant' as Role, content: responseText }].slice(-12);
      setMessages((prev) => [...prev, assistantMsg]);
      // If AI suggests drawing a geofence, open the panel
      if (/draw|map|geofence|zone/i.test(responseText) && /geofence|zone|area/i.test(text)) setShowDraw(true);
    } catch {
      setMessages((prev) => [...prev, { id: `error-${Date.now()}`, role: 'assistant', content: 'Sorry, I encountered an error. Please try again.', timestamp: Date.now() }]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div className="flex h-full -m-6 overflow-hidden">
      {/* Chat column */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <div className="flex items-center gap-2 px-6 py-3 border-b border-gray-800 shrink-0" style={{ background: 'rgba(5,8,19,0.9)' }}>
          <Bot size={18} className="text-orange-400" />
          <h1 className="font-semibold text-white text-sm">Sonalit Copilot</h1>
          <span className="text-xs text-gray-600 ml-1">AI fleet assistant</span>
          <button
            onClick={() => setShowDraw((v) => !v)}
            className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${showDraw ? 'bg-orange-600/20 border-orange-500/50 text-orange-300' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-orange-300 hover:border-orange-500/40'}`}
          >
            <MapPin size={12} /> {showDraw ? 'Hide Map' : 'Draw Geofence'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {messages.map((m) => <ChatBubble key={m.id} message={m} />)}

          {isLoading && (
            <div className="flex gap-3 justify-start">
              <div className="w-8 h-8 rounded-full bg-orange-700/60 border border-orange-600/40 flex items-center justify-center shrink-0">
                <Loader2 size={14} className="animate-spin text-orange-300" />
              </div>
              <div className="bg-gray-800 border border-gray-700/60 rounded-2xl rounded-tl-sm px-4 py-3 flex gap-1.5 items-center">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </div>
          )}

          {messages.length === 1 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => setInput(s)} className="text-left px-4 py-3 bg-gray-800/80 hover:bg-gray-700/80 border border-gray-700 rounded-xl text-sm text-gray-300 transition-colors">
                  {s}
                </button>
              ))}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-gray-800 px-4 py-3 shrink-0" style={{ background: 'rgba(5,8,19,0.9)' }}>
          <div className="flex gap-2">
            <textarea
              className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-orange-500 resize-none"
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
              className="p-2.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 rounded-xl transition-colors"
              aria-label="Send"
            >
              {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </div>

      {/* Draw panel */}
      {showDraw && (
        <div className="w-80 shrink-0 flex flex-col overflow-hidden">
          <DrawPanel onClose={() => setShowDraw(false)} />
        </div>
      )}
    </div>
  );
}
