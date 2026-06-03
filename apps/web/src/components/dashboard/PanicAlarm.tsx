import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { useDashboardStore } from '../../stores/dashboardStore.js';

interface PanicPollData {
  status: 'clear' | 'active';
  active_event: { id: string; vehicle_id: string; lat: number | null; lng: number | null; triggered_at: string } | null;
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
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!isActive) {
      stopRef.current?.();
      stopRef.current = null;
      return;
    }

    let running = true;
    let ctx: AudioContext | null = null;

    const start = async () => {
      ctx = new AudioContext();

      const pattern: [number, number][] = [
        [960, 380], [700, 380],
        [960, 380], [700, 380],
        [960, 380], [700, 800],
      ];

      let idx = 0;
      while (running) {
        const [freq, ms] = pattern[idx % pattern.length]!;
        idx++;
        if (!running || !ctx) break;

        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();

        await new Promise<void>((r) => setTimeout(r, ms));
        if (ctx) gain.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
        osc.stop(ctx.currentTime + 0.12);
        await new Promise<void>((r) => setTimeout(r, 20));
      }
    };

    start().catch(() => {});

    stopRef.current = () => {
      running = false;
      ctx?.close().catch(() => {});
    };

    return () => {
      stopRef.current?.();
      stopRef.current = null;
    };
  }, [isActive]);

  if (!isActive) return null;

  return (
    <div
      aria-hidden='true'
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999 }}
    >
      <style>{`
        @keyframes panic-edge {
          0%   { box-shadow: inset 0 0 0 3px #ff0000, inset 0 0 50px rgba(255,0,0,.25); }
          50%  { box-shadow: inset 0 0 0 7px #ff2200, inset 0 0 110px rgba(255,0,0,.55); }
          100% { box-shadow: inset 0 0 0 3px #ff0000, inset 0 0 50px rgba(255,0,0,.25); }
        }
        .panic-edge-overlay {
          position: absolute;
          inset: 0;
          animation: panic-edge .45s ease-in-out infinite;
        }
      `}</style>
      <div className='panic-edge-overlay' />
    </div>
  );
}
