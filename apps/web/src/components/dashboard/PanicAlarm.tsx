import { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { useDashboardStore } from '../../stores/dashboardStore.js';
import { playSiren, stopSiren } from '../../lib/siren.js';

interface PanicPollData {
  status: 'clear' | 'active';
  active_event: { id: string; vehicle_id: string; mode?: string | null; lat: number | null; lng: number | null; triggered_at: string } | null;
}

export default function PanicAlarm() {
  // Real-time source: Centrifugo pushes (new events during this session)
  const panicState = useDashboardStore((s) => s.panicState);
  const updatePanicState = useDashboardStore((s) => s.updatePanicState);

  // REST source: existing active panics present when the page loads.
  // Same query key as PanicCenter so React Query deduplicates the request.
  const { data: pollData } = useQuery<PanicPollData>({
    queryKey: ['dashboard-panic'],
    queryFn: async () => { const r = await api.get<PanicPollData>('/dashboard/panic'); return r.data; },
    staleTime: 15000,
    refetchInterval: 15000,
  });

  // Seed the store from the REST poll so pre-existing panics activate the alarm
  useEffect(() => {
    if (!pollData) return;
    if (pollData.status === 'active' && pollData.active_event) {
      updatePanicState({
        id: pollData.active_event.id,
        status: 'active',
        ...(pollData.active_event.mode != null && { mode: pollData.active_event.mode }),
        ...(pollData.active_event.lat != null && { lat: pollData.active_event.lat }),
        ...(pollData.active_event.lng != null && { lng: pollData.active_event.lng }),
        triggered_at: pollData.active_event.triggered_at,
      });
    } else if (pollData.status === 'clear' && panicState?.status === 'active') {
      // Only clear if the store still thinks it's active — don't fight a newer realtime event
      updatePanicState({ id: panicState.id, status: 'resolved', triggered_at: panicState.triggered_at });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollData]);

  const isActive = panicState?.status === 'active';
  const isVoiceDistress = panicState?.mode === 'voice_distress';
  const isAcknowledged = !!panicState?.acknowledgedAt;

  useEffect(() => {
    if (!isActive) { stopSiren(); return; }
    playSiren(isVoiceDistress ? 'mayday' : 'wail', { loop: true });
    return () => stopSiren();
  }, [isActive, isVoiceDistress]);

  const [acking, setAcking] = useState(false);
  const ackMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/guardian/panic/${id}/ack`, {}),
    onMutate: () => setAcking(true),
    onSettled: () => setAcking(false),
  });

  if (!isActive) return null;

  return (
    <div
      aria-hidden='true'
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 99999 }}
    >
      {/*
        A full-bleed fixed overlay sitting above Rail/Topbar/Outlet strobes
        the entire screen — sidenav, clock, everything underneath — since it
        covers the whole viewport regardless of what's rendered below it.
        `steps(1, end)` gives a hard on/off cut instead of a smooth pulse, so
        it actually reads as a flicker. Cycle held at 400ms (2.5 flashes/sec)
        to stay just under the ~3-flashes/sec threshold flagged by WCAG for
        photosensitive reactions while still feeling urgent/violent.
        Once acknowledged the flash slows and dims (still visible, less
        alarming) — help is confirmed en route, but the siren keeps playing
        until the panic is actually resolved.
      */}
      <style>{`
        @keyframes panic-flash {
          0%, 49%   { background: rgba(255,0,0,.4); box-shadow: inset 0 0 0 10px #ff0000, inset 0 0 180px rgba(255,0,0,.65); }
          50%, 100% { background: rgba(255,0,0,.05); box-shadow: inset 0 0 0 3px #ff0000, inset 0 0 40px rgba(255,0,0,.2); }
        }
        @keyframes panic-flash-acked {
          0%, 74%   { background: rgba(255,140,0,.18); box-shadow: inset 0 0 0 6px #ff8c00, inset 0 0 100px rgba(255,140,0,.3); }
          75%, 100% { background: rgba(255,140,0,.02); box-shadow: inset 0 0 0 2px #ff8c00, inset 0 0 20px rgba(255,140,0,.1); }
        }
        .panic-flash-overlay {
          position: absolute;
          inset: 0;
          animation: panic-flash .4s steps(1, end) infinite;
        }
        .panic-flash-overlay.acked {
          animation: panic-flash-acked 1.6s steps(1, end) infinite;
        }
      `}</style>
      <div className={`panic-flash-overlay${isAcknowledged ? ' acked' : ''}`} />

      <div style={{ position: 'absolute', top: 16, right: 16, pointerEvents: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
        {isAcknowledged ? (
          <span style={{ background: 'rgba(255,140,0,.9)', color: '#1a1000', fontWeight: 700, fontSize: 12, padding: '6px 12px', borderRadius: 6 }}>
            ACKNOWLEDGED{panicState?.acknowledgedByName ? ` BY ${panicState.acknowledgedByName.toUpperCase()}` : ''}
          </span>
        ) : (
          <button
            onClick={() => panicState && ackMutation.mutate(panicState.id)}
            disabled={acking}
            style={{ background: '#fff', color: '#b91c1c', fontWeight: 700, fontSize: 12, padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,.4)' }}
          >
            {acking ? 'ACKNOWLEDGING…' : 'ACKNOWLEDGE'}
          </button>
        )}
      </div>
    </div>
  );
}
