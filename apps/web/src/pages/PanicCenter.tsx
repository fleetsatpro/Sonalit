import { useState, useEffect } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { subscribe } from '../lib/centrifuge.js';
import { useAuthStore } from '../stores/auth.js';
import Map, { Marker } from 'react-map-gl/maplibre';
import { AlertOctagon, MapPin, CheckCircle, Clock, Radio } from 'lucide-react';

interface PanicEvent {
  id: string;
  event_uuid: string;
  device_id: string;
  device_name: string;
  device_model: string | null;
  mode: string;
  lat: number | null;
  lng: number | null;
  message: string | null;
  created_at: string;
  resolved_at: string | null;
}

// Shape published by backend over Centrifugo
interface PanicChannelEvent {
  type?: string;
  panic_id?: string;
  event_uuid?: string;
  device_id?: string;
  device_name?: string;
  mode?: string;
  lat?: number | null;
  lng?: number | null;
  message?: string | null;
  created_at?: string;
  triggered_at?: string;
}

const MODE_COLORS: Record<string, string> = {
  loud: 'text-red-400',
  hijack: 'text-red-500',
  security: 'text-orange-400',
  silent: 'text-yellow-400',
  medical: 'text-blue-400',
};

const MODE_LABELS: Record<string, string> = {
  loud: 'LOUD SOS',
  hijack: 'HIJACK',
  security: 'SECURITY',
  silent: 'SILENT SOS',
  medical: 'MEDICAL',
};

function EventCard({
  event,
  onResolve,
  isResolving,
}: {
  event: PanicEvent;
  onResolve: (id: string) => void;
  isResolving: boolean;
}) {
  const resolved = !!event.resolved_at;
  const modeColor = MODE_COLORS[event.mode] ?? 'text-red-400';
  const modeLabel = MODE_LABELS[event.mode] ?? event.mode.toUpperCase();

  return (
    <div
      className={`rounded-lg p-4 border transition-colors ${
        resolved
          ? 'bg-white/[0.03] border-white/[0.06] opacity-60'
          : 'bg-red-950/30 border-red-600/50'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1.5">
            <AlertOctagon size={15} className={resolved ? 'text-gray-500' : 'text-red-400'} />
            <span className={`text-xs font-bold tracking-wider ${modeColor}`}>{modeLabel}</span>
            {resolved && (
              <span className="text-xs text-green-500 font-medium flex items-center gap-1">
                <CheckCircle size={11} /> Resolved
              </span>
            )}
          </div>
          <p className="text-sm font-semibold text-white truncate">{event.device_name}</p>
          {event.message && (
            <p className="text-xs text-gray-400 mt-0.5 truncate">"{event.message}"</p>
          )}
          {event.lat != null && event.lng != null && (
            <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
              <MapPin size={11} />
              <span>{event.lat.toFixed(5)}, {event.lng.toFixed(5)}</span>
            </div>
          )}
          <div className="flex items-center gap-1 text-xs text-gray-600 mt-1">
            <Clock size={10} />
            <span>{new Date(event.created_at).toLocaleString()}</span>
          </div>
        </div>
        {!resolved && (
          <button
            onClick={() => onResolve(event.id)}
            disabled={isResolving}
            className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded border border-green-600/50 text-green-400 hover:bg-green-900/30 disabled:opacity-40 transition-colors"
          >
            {isResolving ? 'Resolving…' : 'Resolve'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function PanicCenter() {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();

  // ─── Initial fetch of active panic events ────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ['panic-events'],
    queryFn: async () => {
      const res = await api.get<{ data: PanicEvent[]; total: number }>(
        '/guardian/panic?active_only=true&limit=100'
      );
      return res.data.data ?? [];
    },
    enabled: !!user,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const events: PanicEvent[] = data ?? [];
  const activeCount = events.filter((e) => !e.resolved_at).length;

  // ─── Live Centrifugo subscription ───────────────────────────────────────────
  useEffect(() => {
    if (!user?.org_id) return;
    return subscribe<PanicChannelEvent>(`org#${user.org_id}`, (raw) => {
      if (raw.type !== 'panic' && !raw.panic_id) return;
      if (!raw.device_name || !raw.panic_id) return;

      const incoming: PanicEvent = {
        id: raw.panic_id!,
        event_uuid: raw.event_uuid ?? raw.panic_id!,
        device_id: raw.device_id ?? '',
        device_name: raw.device_name!,
        device_model: null,
        mode: raw.mode ?? 'loud',
        lat: raw.lat ?? null,
        lng: raw.lng ?? null,
        message: raw.message ?? null,
        created_at: raw.created_at ?? raw.triggered_at ?? new Date().toISOString(),
        resolved_at: null,
      };

      qc.setQueryData<PanicEvent[]>(['panic-events'], (prev) => {
        if (!prev) return [incoming];
        if (prev.some((e) => e.id === incoming.id)) return prev;
        return [incoming, ...prev];
      });
    });
  }, [user?.org_id, qc]);

  // ─── Resolve mutation ────────────────────────────────────────────────────────
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const resolveMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/guardian/panic/${id}/resolve`, {}),
    onMutate: (id) => setResolvingId(id),
    onSuccess: (_, id) => {
      qc.setQueryData<PanicEvent[]>(['panic-events'], (prev) =>
        prev?.map((e) => (e.id === id ? { ...e, resolved_at: new Date().toISOString() } : e)) ?? []
      );
      setResolvingId(null);
    },
    onError: () => setResolvingId(null),
  });

  const activeEvents = events.filter((e) => !e.resolved_at);
  const resolvedEvents = events.filter((e) => !!e.resolved_at);

  const mapCenter = activeEvents[0] ?? events[0];

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex items-center gap-3">
        <AlertOctagon size={20} className="text-red-400" />
        <h1 className="text-xl font-bold">Panic Center</h1>
        {activeCount > 0 && (
          <span className="bg-red-700/80 text-red-100 text-xs font-bold px-2 py-0.5 rounded-full animate-pulse">
            {activeCount} ACTIVE
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5 text-xs text-gray-500">
          <Radio size={12} className="text-green-500" />
          Monitoring live feed
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-0">
        {/* Events list */}
        <div className="flex flex-col gap-3 overflow-y-auto">
          {isLoading && (
            <div className="text-center py-8 text-gray-500 text-sm">Loading…</div>
          )}

          {!isLoading && events.length === 0 && (
            <div className="text-center py-12 rounded-lg border border-white/[0.06] bg-white/[0.02]">
              <AlertOctagon size={36} className="mx-auto mb-2 text-gray-700" />
              <p className="text-sm text-gray-500">No panic events. Monitoring live feed…</p>
            </div>
          )}

          {activeEvents.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              onResolve={(id) => resolveMutation.mutate(id)}
              isResolving={resolvingId === event.id}
            />
          ))}

          {resolvedEvents.length > 0 && (
            <>
              <p className="text-xs text-gray-600 font-medium uppercase tracking-wider pt-1">
                Resolved
              </p>
              {resolvedEvents.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  onResolve={(id) => resolveMutation.mutate(id)}
                  isResolving={resolvingId === event.id}
                />
              ))}
            </>
          )}
        </div>

        {/* Map */}
        <div className="rounded-lg overflow-hidden border border-white/[0.06] min-h-64">
          <Map
            mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
            initialViewState={{
              longitude: mapCenter?.lng ?? 36.817223,
              latitude: mapCenter?.lat ?? -1.286389,
              zoom: mapCenter ? 12 : 7,
            }}
            style={{ width: '100%', height: '100%' }}
          >
            {events
              .filter((e) => e.lat != null && e.lng != null)
              .map((event) => (
                <Marker
                  key={event.id}
                  longitude={event.lng!}
                  latitude={event.lat!}
                  anchor="bottom"
                >
                  <div
                    className={`w-4 h-4 rounded-full border-2 border-white shadow-lg ${
                      event.resolved_at ? 'bg-green-500' : 'bg-red-500'
                    }`}
                    title={`${event.device_name} — ${event.mode}`}
                  />
                </Marker>
              ))}
          </Map>
        </div>
      </div>
    </div>
  );
}
