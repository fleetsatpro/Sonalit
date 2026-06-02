import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { useDashboardStore } from '../../stores/dashboardStore.js';
import DataError from './DataError.js';

interface PanicData {
  status: 'clear' | 'active';
  active_event: { id: string; vehicle_id: string; lat: number | null; lng: number | null; triggered_at: string } | null;
  response_time_avg_s: number;
  last_event_days_ago: number;
  response_teams: Array<{ name: string; type: string; eta_min: number; location: string; status: string }>;
}

function useCountdown(triggeredAt: string | null | undefined): string {
  const [elapsed, setElapsed] = useState('00:00');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!triggeredAt) { setElapsed('00:00'); return; }
    const tick = () => {
      const sec = Math.floor((Date.now() - new Date(triggeredAt).getTime()) / 1000);
      const mm = String(Math.floor(sec / 60)).padStart(2, '0');
      const ss = String(sec % 60).padStart(2, '0');
      setElapsed(`${mm}:${ss}`);
    };
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [triggeredAt]);

  return elapsed;
}

const PanicCenter = React.memo(function PanicCenter() {
  const panicState = useDashboardStore((s) => s.panicState);
  const [confirm, setConfirm] = useState(false);

  const { data, isError, refetch } = useQuery<PanicData>({
    queryKey: ['dashboard-panic'],
    queryFn: async () => { const r = await api.get<PanicData>('/dashboard/panic'); return r.data; },
    staleTime: 15000,
    refetchInterval: 15000,
  });

  const activateMut = useMutation({
    mutationFn: () => api.post('/panic/activate'),
    onSuccess: () => { setConfirm(false); refetch(); },
  });

  const handleActivate = useCallback(() => {
    if (!confirm) { setConfirm(true); return; }
    activateMut.mutate();
  }, [confirm, activateMut]);

  const isActive = panicState?.status === 'active' || data?.status === 'active';
  const elapsed = useCountdown(isActive ? data?.active_event?.triggered_at : null);

  if (isError) return <DataError section='Panic Center' onRetry={refetch} />;

  return (
    <div
      className='d-section-reveal d-card'
      style={{
        padding: 16,
        border: isActive ? '1px solid rgba(255,68,34,.45)' : '1px solid var(--d-rim2)',
        background: isActive ? 'rgba(255,68,34,.08)' : undefined,
        animation: isActive ? 'd-pfz 1s infinite' : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <div style={{ width: 3, height: 14, background: isActive ? 'var(--d-fire)' : 'var(--d-ok)', borderRadius: 2 }} />
        <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 11, letterSpacing: '.12em', color: isActive ? 'var(--d-fire)' : 'var(--d-t1)' }}>
          {isActive ? '🚨 PANIC — ACTIVE' : '✓ PANIC CENTER'}
        </span>
      </div>

      {!isActive ? (
        <>
          {/* ALL CLEAR state */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{
              width: 44, height: 44, borderRadius: '50%',
              background: 'var(--d-okg)',
              border: '2px solid var(--d-ok)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              {/* Shield with checkmark */}
              <svg width='22' height='24' viewBox='0 0 22 24' fill='none'>
                <path d='M11 1L2 5v6c0 5.25 3.85 10.16 9 11.35C16.15 21.16 20 16.25 20 11V5L11 1z' fill='var(--d-okg)' stroke='var(--d-ok)' strokeWidth='1.5' strokeLinejoin='round' />
                <path d='M7.5 12l2.5 2.5 5-5' stroke='var(--d-ok)' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round' />
              </svg>
            </div>
            <div>
              <div style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 14, fontWeight: 700, color: 'var(--d-ok)', letterSpacing: '.06em' }}>ALL CLEAR</div>
              <div style={{ fontSize: 11, color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace', marginTop: 2 }}>No active panic events</div>
            </div>
          </div>

          {/* Stats row */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
            <Stat label='Avg Response' value={data ? `${data.response_time_avg_s}s` : '—'} />
            <Stat label='Teams Ready' value={data?.response_teams?.length?.toString() ?? '—'} />
            <Stat label='Last Event' value={(data?.last_event_days_ago ?? -1) >= 0 ? `${data!.last_event_days_ago}d ago` : 'Never'} />
          </div>

          {(data?.response_teams ?? []).map((t, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--d-rim)', fontSize: 12 }}>
              <span style={{ flex: 1, color: 'var(--d-t1)' }}>{t.name}</span>
              <span style={{ color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 10 }}>{t.type}</span>
              <span style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 12, fontWeight: 700, color: 'var(--d-warn)' }}>{t.eta_min}m</span>
              <span style={{ fontSize: 9, color: 'var(--d-ok)', fontFamily: 'IBM Plex Mono, monospace' }}>{t.status}</span>
            </div>
          ))}
        </>
      ) : (
        <>
          {/* ACTIVE state */}
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 8, animation: 'd-pfz 0.8s ease-in-out infinite' }}>🚨</div>
            <div style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 16, fontWeight: 800, color: 'var(--d-fire)', letterSpacing: '.1em', marginBottom: 8 }}>
              PANIC ALERT ACTIVE
            </div>
            <div style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 24, fontWeight: 900, color: 'var(--d-fire)', letterSpacing: '.12em', marginBottom: 6 }}>
              {elapsed}
            </div>
            <div style={{ fontSize: 11, color: 'var(--d-t2)', fontFamily: 'IBM Plex Mono, monospace' }}>
              {data?.active_event ? `Vehicle: ${data.active_event.vehicle_id}` : 'Emergency response activated'}
            </div>
          </div>

          {/* Response teams during active state */}
          {(data?.response_teams ?? []).length > 0 && (
            <div style={{ marginTop: 12 }}>
              {(data?.response_teams ?? []).map((t, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--d-rim)', fontSize: 12 }}>
                  <span style={{ flex: 1, color: 'var(--d-t1)' }}>{t.name}</span>
                  <span style={{ color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 10 }}>{t.type}</span>
                  <span style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 12, fontWeight: 700, color: 'var(--d-fire)' }}>{t.eta_min}m</span>
                  <span style={{ fontSize: 9, color: 'var(--d-warn)', fontFamily: 'IBM Plex Mono, monospace' }}>{t.status}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <button
        onClick={handleActivate}
        disabled={activateMut.isPending}
        style={{
          marginTop: 14, width: '100%', padding: '10px',
          background: confirm
            ? 'var(--d-fg)'
            : 'linear-gradient(90deg, rgba(255,68,34,.18) 0%, rgba(255,100,34,.28) 100%)',
          border: `1px solid ${confirm ? 'var(--d-fire)' : 'rgba(255,68,34,.45)'}`,
          borderRadius: 8,
          color: confirm ? 'var(--d-fire)' : 'var(--d-fire)',
          cursor: 'pointer', fontFamily: 'Orbitron, sans-serif', fontWeight: 700,
          fontSize: 11, letterSpacing: '.08em',
        }}
      >
        {activateMut.isPending ? 'ACTIVATING…' : confirm ? '⚠ CONFIRM — TAP TO ACTIVATE' : 'ACTIVATE EMERGENCY RESPONSE'}
      </button>
      {confirm && (
        <button onClick={() => setConfirm(false)} style={{ marginTop: 6, width: '100%', background: 'none', border: 'none', color: 'var(--d-t3)', cursor: 'pointer', fontSize: 11 }}>
          Cancel
        </button>
      )}
    </div>
  );
});

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t3)', marginBottom: 2, letterSpacing: '.08em' }}>{label}</div>
      <div style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 14, fontWeight: 700, color: 'var(--d-ok)' }}>{value}</div>
    </div>
  );
}

export default PanicCenter;
