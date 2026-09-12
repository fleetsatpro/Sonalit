import { useEffect, useMemo, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { subscribe } from '../lib/centrifuge.js';
import { useAuthStore } from '../stores/auth.js';
import Map, { Marker, Popup, NavigationControl } from 'react-map-gl/maplibre';
import { AlertOctagon, MapPin, CheckCircle, Clock, Radio, ShieldAlert, UserCheck } from 'lucide-react';

interface PanicEvent {
  id: string;
  event_uuid: string;
  device_id: string;
  device_name: string;
  device_model: string | null;
  mode: string;
  trigger_type?: string;
  lat: number | null;
  lng: number | null;
  message: string | null;
  created_at: string;
  resolved_at: string | null;
  acknowledged_at?: string | null;
  acknowledged_by?: string | null;
  resolution_note?: string | null;
  reason_code?: string | null;
  escalation_level?: number;
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
  acknowledged_at?: string;
  acknowledged_by?: string;
  resolved_at?: string;
  escalation_level?: number;
}

const MODE_COLORS: Record<string, string> = {
  loud: 'text-red-400',
  hijack: 'text-red-500',
  security: 'text-orange-400',
  silent: 'text-yellow-400',
  medical: 'text-blue-400',
  voice_distress: 'text-red-500',
};

const MODE_LABELS: Record<string, string> = {
  loud: 'LOUD SOS',
  hijack: 'HIJACK',
  security: 'SECURITY',
  silent: 'SILENT SOS',
  medical: 'MEDICAL',
  voice_distress: 'VOICE DISTRESS',
};

const REASON_CODES: Array<{ value: string; label: string }> = [
  { value: 'resolved_safe', label: 'Resolved — device holder safe' },
  { value: 'false_alarm', label: 'False alarm' },
  { value: 'escalated_to_authorities', label: 'Escalated to authorities' },
  { value: 'training_test', label: 'Training / test trigger' },
  { value: 'other', label: 'Other' },
];

function markerColor(event: PanicEvent): string {
  if (event.resolved_at) return '#22c55e'; // green
  if (event.acknowledged_at) return '#f59e0b'; // amber
  if ((event.escalation_level ?? 0) > 0) return '#dc2626'; // deep red, escalated
  return '#ef4444'; // red, active/unacknowledged
}

function EventCard({
  event,
  onAck,
  onResolve,
  isAcking,
  isResolving,
}: {
  event: PanicEvent;
  onAck: (id: string) => void;
  onResolve: (event: PanicEvent) => void;
  isAcking: boolean;
  isResolving: boolean;
}) {
  const resolved = !!event.resolved_at;
  const acknowledged = !!event.acknowledged_at;
  const modeColor = MODE_COLORS[event.mode] ?? 'text-red-400';
  const modeLabel = MODE_LABELS[event.mode] ?? event.mode.toUpperCase();
  const escalationLevel = event.escalation_level ?? 0;

  return (
    <div
      className={`rounded-lg p-4 border transition-colors ${
        resolved
          ? 'bg-white/[0.03] border-white/[0.06] opacity-60'
          : acknowledged
          ? 'bg-amber-950/20 border-amber-600/40'
          : 'bg-red-950/30 border-red-600/50'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <AlertOctagon size={15} className={resolved ? 'text-gray-500' : 'text-red-400'} />
            <span className={`text-xs font-bold tracking-wider ${modeColor}`}>{modeLabel}</span>
            {event.trigger_type && event.trigger_type !== 'manual' && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-300 border border-amber-700/50">
                {event.trigger_type.replace(/_/g, ' ')}
              </span>
            )}
            {!resolved && escalationLevel > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-red-900/60 text-red-300 border border-red-700/50 flex items-center gap-1">
                <ShieldAlert size={10} /> ESCALATED L{escalationLevel}
              </span>
            )}
            {!resolved && acknowledged && (
              <span className="text-xs text-amber-400 font-medium flex items-center gap-1">
                <UserCheck size={11} /> Acknowledged
              </span>
            )}
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
          {resolved && (event.resolution_note || event.reason_code) && (
            <div className="mt-2 pt-2 border-t border-white/[0.06] text-xs text-gray-500">
              {event.reason_code && (
                <span className="text-gray-400">
                  {REASON_CODES.find((r) => r.value === event.reason_code)?.label ?? event.reason_code}
                </span>
              )}
              {event.resolution_note && <p className="mt-0.5 italic">"{event.resolution_note}"</p>}
            </div>
          )}
        </div>
        {!resolved && (
          <div className="shrink-0 flex flex-col gap-1.5">
            {!acknowledged && (
              <button
                onClick={() => onAck(event.id)}
                disabled={isAcking}
                className="px-3 py-1.5 text-xs font-semibold rounded border border-amber-600/50 text-amber-400 hover:bg-amber-900/30 disabled:opacity-40 transition-colors"
              >
                {isAcking ? 'Acking…' : 'Acknowledge'}
              </button>
            )}
            <button
              onClick={() => onResolve(event)}
              disabled={isResolving}
              className="px-3 py-1.5 text-xs font-semibold rounded border border-green-600/50 text-green-400 hover:bg-green-900/30 disabled:opacity-40 transition-colors"
            >
              {isResolving ? 'Resolving…' : 'Resolve'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ResolveModal({
  event,
  onClose,
  onSubmit,
  isSubmitting,
}: {
  event: PanicEvent;
  onClose: () => void;
  onSubmit: (reasonCode: string, note: string) => void;
  isSubmitting: boolean;
}) {
  const [reasonCode, setReasonCode] = useState('resolved_safe');
  const [note, setNote] = useState('');

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-lg border border-white/10 bg-neutral-900 p-5">
        <h2 className="text-sm font-bold text-white mb-1">Resolve panic — {event.device_name}</h2>
        <p className="text-xs text-gray-500 mb-4">Record why this alert is being closed. This is kept on the audit trail.</p>

        <label className="block text-xs text-gray-400 mb-1">Reason</label>
        <select
          value={reasonCode}
          onChange={(e) => setReasonCode(e.target.value)}
          className="w-full mb-3 rounded border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white"
        >
          {REASON_CODES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>

        <label className="block text-xs text-gray-400 mb-1">Notes (optional)</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="w-full mb-4 rounded border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white resize-none"
          placeholder="What happened, who responded, outcome…"
        />

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded border border-white/10 text-gray-400 hover:bg-white/5">
            Cancel
          </button>
          <button
            onClick={() => onSubmit(reasonCode, note)}
            disabled={isSubmitting}
            className="px-3 py-1.5 text-xs font-semibold rounded bg-green-600/80 text-white hover:bg-green-600 disabled:opacity-40"
          >
            {isSubmitting ? 'Resolving…' : 'Resolve alert'}
          </button>
        </div>
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
  const unackedCount = events.filter((e) => !e.resolved_at && !e.acknowledged_at).length;

  // ─── Live Centrifugo subscription ───────────────────────────────────────────
  useEffect(() => {
    if (!user?.org_id) return;
    return subscribe<PanicChannelEvent>(`org#${user.org_id}`, (raw) => {
      if (raw.type === 'panic' && raw.panic_id && raw.device_name) {
        const incoming: PanicEvent = {
          id: raw.panic_id,
          event_uuid: raw.event_uuid ?? raw.panic_id,
          device_id: raw.device_id ?? '',
          device_name: raw.device_name,
          device_model: null,
          mode: raw.mode ?? 'loud',
          lat: raw.lat ?? null,
          lng: raw.lng ?? null,
          message: raw.message ?? null,
          created_at: raw.created_at ?? raw.triggered_at ?? new Date().toISOString(),
          resolved_at: null,
          acknowledged_at: null,
          escalation_level: 0,
        };
        qc.setQueryData<PanicEvent[]>(['panic-events'], (prev) => {
          if (!prev) return [incoming];
          if (prev.some((e) => e.id === incoming.id)) return prev;
          return [incoming, ...prev];
        });
        return;
      }

      if (raw.type === 'panic_ack' && raw.panic_id) {
        qc.setQueryData<PanicEvent[]>(['panic-events'], (prev) =>
          prev?.map((e) =>
            e.id === raw.panic_id
              ? { ...e, acknowledged_at: raw.acknowledged_at ?? new Date().toISOString(), acknowledged_by: raw.acknowledged_by ?? null }
              : e
          ) ?? []
        );
        return;
      }

      if (raw.type === 'panic_resolved' && raw.panic_id) {
        qc.setQueryData<PanicEvent[]>(['panic-events'], (prev) =>
          prev?.map((e) =>
            e.id === raw.panic_id ? { ...e, resolved_at: raw.resolved_at ?? new Date().toISOString() } : e
          ) ?? []
        );
        return;
      }

      if (raw.type === 'panic_cancel') {
        qc.setQueryData<PanicEvent[]>(['panic-events'], (prev) =>
          prev?.map((e) =>
            e.device_id === raw.device_id && !e.resolved_at ? { ...e, resolved_at: new Date().toISOString() } : e
          ) ?? []
        );
        return;
      }

      if (raw.type === 'panic_escalated' && raw.panic_id) {
        qc.setQueryData<PanicEvent[]>(['panic-events'], (prev) =>
          prev?.map((e) =>
            e.id === raw.panic_id ? { ...e, escalation_level: raw.escalation_level ?? (e.escalation_level ?? 0) + 1 } : e
          ) ?? []
        );
      }
    });
  }, [user?.org_id, qc]);

  // ─── Acknowledge mutation ────────────────────────────────────────────────────
  const [ackingId, setAckingId] = useState<string | null>(null);
  const ackMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/guardian/panic/${id}/ack`, {}),
    onMutate: (id) => setAckingId(id),
    onSuccess: (_, id) => {
      qc.setQueryData<PanicEvent[]>(['panic-events'], (prev) =>
        prev?.map((e) => (e.id === id ? { ...e, acknowledged_at: new Date().toISOString() } : e)) ?? []
      );
      setAckingId(null);
    },
    onError: () => setAckingId(null),
  });

  // ─── Resolve mutation (with reason/notes modal) ─────────────────────────────
  const [resolveTarget, setResolveTarget] = useState<PanicEvent | null>(null);
  const resolveMutation = useMutation({
    mutationFn: ({ id, reasonCode, note }: { id: string; reasonCode: string; note: string }) =>
      api.patch(`/guardian/panic/${id}/resolve`, { reason_code: reasonCode, resolution_note: note || undefined }),
    onSuccess: (_, { id, reasonCode, note }) => {
      qc.setQueryData<PanicEvent[]>(['panic-events'], (prev) =>
        prev?.map((e) =>
          e.id === id ? { ...e, resolved_at: new Date().toISOString(), reason_code: reasonCode, resolution_note: note || null } : e
        ) ?? []
      );
      setResolveTarget(null);
    },
  });

  const activeEvents = events.filter((e) => !e.resolved_at);
  const resolvedEvents = events.filter((e) => !!e.resolved_at);

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const geolocated = useMemo(() => events.filter((e) => e.lat != null && e.lng != null), [events]);
  const selectedEvent = geolocated.find((e) => e.id === selectedEventId) ?? null;

  const bounds = useMemo(() => {
    if (geolocated.length === 0) return null;
    const lats = geolocated.map((e) => e.lat!);
    const lngs = geolocated.map((e) => e.lng!);
    return {
      minLat: Math.min(...lats), maxLat: Math.max(...lats),
      minLng: Math.min(...lngs), maxLng: Math.max(...lngs),
    };
  }, [geolocated]);

  const initialViewState = useMemo(() => {
    if (!bounds) return { longitude: 36.817223, latitude: -1.286389, zoom: 7 };
    return {
      longitude: (bounds.minLng + bounds.maxLng) / 2,
      latitude: (bounds.minLat + bounds.maxLat) / 2,
      zoom: bounds.minLat === bounds.maxLat && bounds.minLng === bounds.maxLng ? 12 : 9,
    };
    // Intentionally computed once on mount from the first snapshot of events —
    // live marker updates re-position pins without yanking the operator's view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <AlertOctagon size={20} className="text-red-400" />
        <h1 className="text-xl font-bold">Panic Center</h1>
        {activeCount > 0 && (
          <span className="bg-red-700/80 text-red-100 text-xs font-bold px-2 py-0.5 rounded-full animate-pulse">
            {activeCount} ACTIVE
          </span>
        )}
        {unackedCount > 0 && (
          <span className="bg-amber-700/80 text-amber-100 text-xs font-bold px-2 py-0.5 rounded-full">
            {unackedCount} UNACKNOWLEDGED
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5 text-xs text-gray-500">
          <Radio size={12} className="text-green-500" />
          Monitoring live feed
        </div>
      </div>

      {/*
        Row height used to be implicit (grid-auto-rows: auto), so it tracked
        whichever column's content was tallest — in practice the events list,
        since it grows/shrinks with the number of active panics. The map sat
        at height:100% of that same row, so it visibly grew or shrank along
        with panic count instead of staying a fixed, reliable size. Pinning
        the row to an explicit height makes both columns — and the map in
        particular — independent of how many events are listed.
      */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-0 lg:h-[640px]">
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
              onAck={(id) => ackMutation.mutate(id)}
              onResolve={(e) => setResolveTarget(e)}
              isAcking={ackingId === event.id}
              isResolving={resolveMutation.isPending && resolveTarget?.id === event.id}
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
                  onAck={(id) => ackMutation.mutate(id)}
                  onResolve={(e) => setResolveTarget(e)}
                  isAcking={false}
                  isResolving={false}
                />
              ))}
            </>
          )}
        </div>

        {/* Map — fixed height so it stays "big enough" and doesn't shrink or
           grow with the events list on mobile (own row) or desktop (shares
           the row above, now pinned to lg:h-[640px]). */}
        <div className="rounded-lg overflow-hidden border border-white/[0.06] h-[420px] lg:h-full">
          <Map
            mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
            initialViewState={initialViewState}
            style={{ width: '100%', height: '100%' }}
          >
            <NavigationControl position="top-right" />
            {geolocated.map((event) => (
              <Marker
                key={event.id}
                longitude={event.lng!}
                latitude={event.lat!}
                anchor="bottom"
                onClick={(e) => {
                  e.originalEvent.stopPropagation();
                  setSelectedEventId(event.id);
                }}
              >
                <div
                  className={!event.resolved_at ? 'animate-pulse cursor-pointer' : 'cursor-pointer'}
                  style={{
                    width: 16, height: 16, borderRadius: '50%',
                    border: '2px solid white', boxShadow: '0 0 8px rgba(0,0,0,.5)',
                    background: markerColor(event),
                  }}
                  title={`${event.device_name} — ${event.mode}`}
                />
              </Marker>
            ))}

            {selectedEvent && (
              <Popup
                longitude={selectedEvent.lng!}
                latitude={selectedEvent.lat!}
                anchor="top"
                onClose={() => setSelectedEventId(null)}
                closeOnClick={false}
              >
                <div className="text-xs text-black min-w-[160px]">
                  <p className="font-bold">{selectedEvent.device_name}</p>
                  <p className="uppercase text-red-600 font-semibold">{MODE_LABELS[selectedEvent.mode] ?? selectedEvent.mode}</p>
                  <p className="text-gray-600 mt-1">{new Date(selectedEvent.created_at).toLocaleString()}</p>
                  {selectedEvent.resolved_at ? (
                    <p className="text-green-700 mt-1">Resolved</p>
                  ) : selectedEvent.acknowledged_at ? (
                    <p className="text-amber-700 mt-1">Acknowledged</p>
                  ) : (
                    <p className="text-red-700 mt-1">Unacknowledged</p>
                  )}
                </div>
              </Popup>
            )}
          </Map>
        </div>
      </div>

      {resolveTarget && (
        <ResolveModal
          event={resolveTarget}
          onClose={() => setResolveTarget(null)}
          onSubmit={(reasonCode, note) => resolveMutation.mutate({ id: resolveTarget.id, reasonCode, note })}
          isSubmitting={resolveMutation.isPending}
        />
      )}
    </div>
  );
}
