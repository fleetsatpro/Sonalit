import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card.js';
import { StatusBadge } from '@/components/ui/Badge.js';
import { PageHeader } from '@/components/ui/PageHeader.js';
import { api } from '@/lib/api.js';

function ActivityGlyph({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12h4l3-8 4 16 3-8h4" /></svg>;
}

function MapPinGlyph({ size = 15 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg>;
}

function AlertGlyph({ size = 19 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 10 18H2L12 3Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>;
}

interface LiveTrip {
  id: string;
  trip_number: string | null;
  status: string;
  phase: string;
  origin: string | null;
  destination: string | null;
  eta: string | null;
  vehicle_reg: string | null;
  lat: number | null;
  lng: number | null;
  last_seen: string | null;
  position_is_live: boolean;
  tracking_health: string | null;
  position_source: string | null;
}

const s = (v: unknown) => String(v ?? '—');

function hasValidCoordinates(trip: LiveTrip): trip is LiveTrip & { lat: number; lng: number } {
  return typeof trip.lat === 'number'
    && Number.isFinite(trip.lat)
    && Math.abs(trip.lat) <= 90
    && typeof trip.lng === 'number'
    && Number.isFinite(trip.lng)
    && Math.abs(trip.lng) <= 180;
}

function freshnessLabel(trip: LiveTrip): string {
  if (trip.position_is_live) return 'LIVE FIX';
  if (trip.tracking_health) return trip.tracking_health.replace(/_/g, ' ').toUpperCase();
  return trip.last_seen ? 'LAST KNOWN' : 'NO FIX';
}

function ageLabel(iso: string | null): string {
  if (!iso) return 'Timestamp unavailable';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'Timestamp invalid';
  const ageSecondsRaw = (Date.now() - t) / 1000;
  if (ageSecondsRaw < -30) return 'Timestamp in future';
  const ageSeconds = Math.max(0, Math.floor(ageSecondsRaw));
  if (ageSeconds < 60) return ageSeconds <= 1 ? 'just now' : `${ageSeconds}s ago`;
  if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m ago`;
  if (ageSeconds < 86400) return `${Math.floor(ageSeconds / 3600)}h ago`;
  return `${Math.floor(ageSeconds / 86400)}d ago`;
}

export default function LiveOperations() {
  const { data, isPending, isError, dataUpdatedAt } = useQuery<{ data: LiveTrip[] }>({
    queryKey: ['trips', 'live'],
    queryFn: async () => {
      const { data } = await api.get('/trips/live');
      return data;
    },
    refetchInterval: 15_000,
  });

  const trips = Array.isArray(data?.data) ? data.data : [];
  const locatedTrips = trips.filter(hasValidCoordinates);
  const liveFixes = locatedTrips.filter(t => t.position_is_live).length;
  const feedAge = dataUpdatedAt > 0 ? Date.now() - dataUpdatedAt : Infinity;
  const feedState = isPending && !data
    ? 'CHECKING FEED'
    : isError
      ? data ? 'FEED DEGRADED' : 'FEED UNAVAILABLE'
      : feedAge <= 45_000
        ? 'FEED CURRENT'
        : 'FEED STALE';
  const feedTone = feedState === 'FEED CURRENT'
    ? 'border-emerald-500/20 bg-emerald-500/[0.04] text-emerald-300'
    : feedState === 'FEED DEGRADED'
      ? 'border-amber-500/20 bg-amber-500/[0.04] text-amber-300'
      : feedState === 'FEED UNAVAILABLE'
        ? 'border-red-500/20 bg-red-500/[0.04] text-red-300'
        : 'border-white/10 bg-black/20 text-white/45';

  return (
    <div className="p-6 pb-10 animate-fade-in">
      <PageHeader
        title="Live Operations"
        description="Verified GPS fixes and dispatch state. Trips without coordinates remain listed but are never plotted as guessed positions."
      />

      <div className="grid grid-cols-1 xl:grid-cols-[1.35fr_1fr] gap-4 items-start">
        <Card className="min-h-[420px] p-0 overflow-hidden">
          <div className="flex items-start justify-between gap-3 border-b border-hair px-4 py-4">
            <div>
              <div className="font-display font-bold text-[13px]">GPS Evidence</div>
              <div className="mt-1 text-2xs text-text-2 font-mono">
                {locatedTrips.length} of {trips.length} open trips have valid coordinates
              </div>
            </div>
            <div className={`rounded-md border px-2 py-1 font-mono text-[9px] font-semibold tracking-[.05em] ${feedTone}`} role="status" aria-live="polite">
              {feedState}
            </div>
          </div>

          <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-b border-hair text-2xs font-mono text-text-2">
            <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-sm bg-emerald-400" />{liveFixes} current fixes</span>
            <span className="text-text-2/50">/</span>
            <span>{locatedTrips.length - liveFixes} last-known or stale</span>
          </div>

          <div className="max-h-[500px] overflow-y-auto">
            {locatedTrips.map(trip => (
              <div key={trip.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-hair px-4 py-3 last:border-0">
                <div className="min-w-0 flex gap-3">
                  <div className={`mt-0.5 w-8 h-8 shrink-0 rounded-md border flex items-center justify-center ${trip.position_is_live ? 'border-emerald-500/20 bg-emerald-500/[0.04] text-emerald-300' : 'border-white/[0.07] bg-white/[0.02] text-text-2'}`}>
                    <MapPinGlyph size={15} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display font-bold text-[12px] text-text-0">{s(trip.trip_number)}</span>
                      <span className="text-2xs font-mono text-text-2">{s(trip.vehicle_reg)}</span>
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-text-1">
                      {trip.lat.toFixed(5)}, {trip.lng.toFixed(5)}
                    </div>
                    <div className="mt-1 text-2xs text-text-2">
                      {s(trip.position_source)} · {ageLabel(trip.last_seen)}
                    </div>
                  </div>
                </div>
                <div className={`self-start rounded-md border px-2 py-1 font-mono text-[9px] ${trip.position_is_live ? 'border-emerald-500/20 text-emerald-300' : 'border-white/10 text-text-2'}`}>
                  {freshnessLabel(trip)}
                </div>
              </div>
            ))}
            {locatedTrips.length === 0 && (
              <div className="min-h-[300px] flex flex-col items-center justify-center gap-3 px-8 text-center">
                <div className="h-11 w-11 rounded-xl border border-white/[0.07] bg-white/[0.02] flex items-center justify-center text-text-2">
                  {isError ? <AlertGlyph size={19} /> : <MapPinGlyph size={19} />}
                </div>
                <div className="font-display font-bold text-[13px] text-text-0">
                  {isPending && !data ? 'Checking GPS evidence' : isError ? 'GPS feed unavailable' : 'No verified GPS coordinates'}
                </div>
                <p className="max-w-sm text-xs text-text-2 leading-5">
                  {isPending && !data
                    ? 'Waiting for the tracking endpoint to return a current response.'
                    : isError
                      ? 'The latest tracking request failed. Existing trip records are not treated as proof of current location.'
                      : 'The tracking endpoint returned no valid coordinates for these open trips. No positions are inferred from trip order or dispatch status.'}
                </p>
              </div>
            )}
          </div>
        </Card>

        <Card className="max-h-[620px] overflow-y-auto p-4">
          <div className="font-display font-bold text-[13px] mb-1">Open Trips</div>
          <div className="text-2xs text-text-2 font-mono mb-2.5">Refreshed from the tracking endpoint every 15 seconds</div>
          {trips.map(trip => (
            <div key={trip.id} className="flex gap-2.5 py-3 border-b border-hair last:border-b-0">
              <div className={`w-[26px] h-[26px] rounded-lg flex-none flex items-center justify-center ${trip.position_is_live ? 'bg-emerald-500/[0.05] text-emerald-300' : 'bg-ink-3 text-text-2'}`}>
                <ActivityGlyph size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs-tight text-text-0">{s(trip.trip_number)} <span className="text-text-2">{s(trip.vehicle_reg)}</span></div>
                <div className="text-2xs text-text-2 mt-0.5 font-mono">{s(trip.origin)} → {s(trip.destination)}</div>
                <div className="mt-1 text-2xs text-text-2">{trip.position_is_live ? 'Current GPS fix' : `Location ${ageLabel(trip.last_seen)}`}</div>
              </div>
              <StatusBadge status={s(trip.status)} />
            </div>
          ))}
          {trips.length === 0 && (
            <div className="text-center text-text-2 text-xs py-8 font-mono">No open trips returned by the tracking endpoint.</div>
          )}
        </Card>
      </div>
    </div>
  );
}
