import { useState, useEffect } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { subscribe } from '../lib/centrifuge.js';
import { useAuthStore } from '../stores/auth.js';
import Map, { Marker } from 'react-map-gl/maplibre';
import { AlertOctagon, MapPin, Send } from 'lucide-react';

interface PanicEvent {
  id: string;
  driver_name: string;
  vehicle_plate: string;
  location: { lat: number; lon: number };
  timestamp: string;
  dispatched: boolean;
}

interface PanicPayload {
  driver_name: string;
  vehicle_plate: string;
  lat: number;
  lon: number;
}

interface RawPanicEvent {
  id?: string;
  driver_name: string;
  vehicle_plate: string;
  location: { lat: number; lon: number };
  timestamp?: string;
}

function EventCard({
  event,
  onDispatch,
  isDispatching,
}: {
  event: PanicEvent;
  onDispatch: (event: PanicEvent) => void;
  isDispatching: boolean;
}) {
  return (
    <div
      className={`bg-slate-800 border rounded-lg p-4 ${
        event.dispatched ? 'border-slate-600 opacity-70' : 'border-red-600'
      }`}
    >
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <AlertOctagon size={16} className="text-red-400 shrink-0" />
            <span className="font-semibold">{event.driver_name}</span>
            <span className="text-slate-400 text-sm">{event.vehicle_plate}</span>
          </div>
          <div className="flex items-center gap-1 text-sm text-slate-300">
            <MapPin size={13} className="text-slate-400" />
            <span>
              {event.location.lat.toFixed(5)}, {event.location.lon.toFixed(5)}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {new Date(event.timestamp).toLocaleString()}
          </p>
        </div>
        {!event.dispatched && (
          <button
            onClick={() => onDispatch(event)}
            disabled={isDispatching}
            className="shrink-0 flex items-center gap-1 px-3 py-1.5 bg-red-700 hover:bg-red-600 disabled:opacity-50 rounded text-sm font-medium"
          >
            <Send size={13} />
            Dispatch
          </button>
        )}
        {event.dispatched && (
          <span className="shrink-0 text-xs text-green-400 font-medium">Dispatched</span>
        )}
      </div>
    </div>
  );
}

export default function PanicCenter() {
  const user = useAuthStore((s) => s.user);
  const [events, setEvents] = useState<PanicEvent[]>([]);
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const unsub = subscribe<RawPanicEvent>(
      `org#${user.org_id}`,
      (raw) => {
        if (!raw || !raw.driver_name || !raw.location?.lat || !raw.location?.lon) return;
        const event: PanicEvent = {
          id: raw.id ?? `${Date.now()}-${Math.random()}`,
          driver_name: raw.driver_name,
          vehicle_plate: raw.vehicle_plate,
          location: raw.location,
          timestamp: raw.timestamp ?? new Date().toISOString(),
          dispatched: false,
        };
        setEvents((prev) => [event, ...prev]);
      },
    );
    return unsub;
  }, [user]);

  const dispatchMutation = useMutation({
    mutationFn: (payload: PanicPayload & { type: string }) =>
      api.post('/incidents', payload),
    onSuccess: (_, variables) => {
      setEvents((prev) =>
        prev.map((e) =>
          e.vehicle_plate === variables.vehicle_plate && e.driver_name === variables.driver_name
            ? { ...e, dispatched: true }
            : e,
        ),
      );
      setDispatchingId(null);
    },
    onError: () => {
      setDispatchingId(null);
    },
  });

  const handleDispatch = (event: PanicEvent) => {
    setDispatchingId(event.id);
    dispatchMutation.mutate({
      type: 'panic',
      driver_name: event.driver_name,
      vehicle_plate: event.vehicle_plate,
      lat: event.location.lat,
      lon: event.location.lon,
    });
  };

  const mapCenter = events[0]?.location ?? { lat: -1.286389, lon: 36.817223 };

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center gap-2">
        <AlertOctagon size={20} className="text-red-400" />
        <h1 className="text-xl font-bold">Panic Center</h1>
        {events.length > 0 && (
          <span className="bg-red-700 text-red-100 text-xs font-bold px-2 py-0.5 rounded-full">
            {events.filter((e) => !e.dispatched).length} active
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-0">
        {/* Events list */}
        <div className="flex flex-col gap-3 overflow-y-auto">
          {events.length === 0 && (
            <div className="text-slate-500 text-sm text-center py-12 bg-slate-800 rounded-lg border border-slate-700">
              <AlertOctagon size={36} className="mx-auto mb-2 opacity-30" />
              <p>No panic events. Monitoring live feed…</p>
            </div>
          )}
          {events.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              onDispatch={handleDispatch}
              isDispatching={dispatchingId === event.id}
            />
          ))}
        </div>

        {/* Map */}
        <div className="rounded-lg overflow-hidden border border-slate-700 min-h-64">
          <Map
            mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
            initialViewState={{
              longitude: mapCenter.lon,
              latitude: mapCenter.lat,
              zoom: 10,
            }}
            style={{ width: '100%', height: '100%' }}
          >
            {events.map((event) => (
              <Marker
                key={event.id}
                longitude={event.location.lon}
                latitude={event.location.lat}
                anchor="bottom"
              >
                <div className="relative">
                  <div
                    className={`w-4 h-4 rounded-full border-2 border-white ${
                      event.dispatched ? 'bg-green-500' : 'bg-red-500'
                    }`}
                    title={`${event.driver_name} — ${event.vehicle_plate}`}
                  />
                </div>
              </Marker>
            ))}
          </Map>
        </div>
      </div>
    </div>
  );
}
