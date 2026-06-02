import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import DataError from './DataError.js';

interface CommVehicle {
  vehicle_id: string; registration: string;
  ping_count_today: number; last_ping_at: string | null;
  signal_bars: number; network_type: string;
  status: 'live' | 'delayed' | 'weak' | 'offline';
}

const STATUS_COLOR: Record<CommVehicle['status'], string> = {
  live: 'var(--d-ok)',
  delayed: 'var(--d-warn)',
  weak: 'var(--d-warn)',
  offline: 'var(--d-fire)',
};

function elapsedColor(iso: string | null): string {
  if (!iso) return 'var(--d-fire)';
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 30) return 'var(--d-sig)';
  if (sec < 300) return 'var(--d-warn)';
  return 'var(--d-fire)';
}

function RelTime({ iso }: { iso: string | null }) {
  const [val, setVal] = useState('—');
  const [color, setColor] = useState('var(--d-t3)');

  useEffect(() => {
    if (!iso) {
      setVal('—');
      setColor('var(--d-t3)');
      return;
    }
    const tick = () => {
      const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
      if (sec < 60) setVal(`${sec}s ago`);
      else if (sec < 3600) setVal(`${Math.floor(sec / 60)}m ago`);
      else setVal(`${Math.floor(sec / 3600)}h ago`);
      setColor(elapsedColor(iso));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [iso]);

  return (
    <span style={{ color, fontFamily: 'IBM Plex Mono, monospace', fontSize: 11 }}>{val}</span>
  );
}

// 5 signal bars of progressively taller spans: heights 4,6,8,10,12px, width 3px
function SignalBars({ bars }: { bars: number }) {
  const heights = [4, 6, 8, 10, 12];
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 14 }}>
      {heights.map((h, idx) => (
        <span
          key={idx}
          style={{
            display: 'inline-block',
            width: 3,
            height: h,
            borderRadius: 1,
            background: idx < bars ? 'var(--d-sig)' : 'var(--d-lift2)',
          }}
        />
      ))}
    </div>
  );
}

const CommunicationsStatus = React.memo(function CommunicationsStatus() {
  const { data, isError, refetch } = useQuery<CommVehicle[]>({
    queryKey: ['dashboard-comms'],
    queryFn: async () => { const r = await api.get<{ data: CommVehicle[] }>('/dashboard/comms'); return r.data.data ?? []; },
    staleTime: 30000,
    refetchInterval: 30000,
  });

  if (isError) return <DataError section='Communications' onRetry={refetch} />;

  return (
    <div className='d-section-reveal d-card' style={{ padding: 16 }}>
      <SH />
      <div style={{ overflowX: 'auto', scrollbarWidth: 'none' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {['VEHICLE', 'SIGNAL', 'PINGS', 'LAST CONTACT', 'STATUS'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '4px 8px 8px 0', fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '.08em', color: 'var(--d-t3)', fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map(v => {
              const isWeak = v.signal_bars <= 1;
              const statusColor = STATUS_COLOR[v.status];
              return (
                <tr key={v.vehicle_id} style={{ borderTop: '1px solid var(--d-rim)' }}>
                  {/* VEHICLE — IBM Plex Mono */}
                  <td style={{ padding: '8px 8px 8px 0', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, color: 'var(--d-t1)' }}>{v.registration}</td>

                  {/* SIGNAL — bars + network type */}
                  <td style={{ padding: '8px 8px 8px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <SignalBars bars={v.signal_bars} />
                      {/* Orbitron for signal strength number */}
                      <span style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 9, fontWeight: 700, color: 'var(--d-t2)' }}>{v.signal_bars}</span>
                      <span style={{ fontSize: 9, color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace' }}>{v.network_type}</span>
                    </div>
                  </td>

                  {/* PINGS — Orbitron */}
                  <td style={{ padding: '8px 8px 8px 0', fontFamily: 'Orbitron, sans-serif', fontSize: 11, fontWeight: 700, color: 'var(--d-t1)' }}>{v.ping_count_today}</td>

                  {/* LAST CONTACT — RelTime with setInterval + color thresholds */}
                  <td style={{ padding: '8px 8px 8px 0' }}><RelTime iso={v.last_ping_at} /></td>

                  {/* STATUS — with d-pfz animation for WEAK */}
                  <td style={{ padding: '8px 0' }}>
                    <span style={{
                      fontSize: 9,
                      fontFamily: 'IBM Plex Mono, monospace',
                      fontWeight: 700,
                      letterSpacing: '.08em',
                      color: statusColor,
                      background: `${statusColor}1a`,
                      borderRadius: 4,
                      padding: '2px 6px',
                      textTransform: 'uppercase',
                      animation: isWeak ? 'd-pfz 1.2s ease-in-out infinite' : 'none',
                      display: 'inline-block',
                    }}>
                      {v.status}
                    </span>
                  </td>
                </tr>
              );
            })}
            {(!data || data.length === 0) && (
              <tr><td colSpan={5} style={{ padding: 16, textAlign: 'center', color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 12 }}>No vehicles</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
});

function SH() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      <div style={{ width: 3, height: 14, background: 'var(--d-sig)', borderRadius: 2 }} />
      <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 11, letterSpacing: '.12em', color: 'var(--d-t1)' }}>COMMUNICATIONS STATUS</span>
    </div>
  );
}

export default CommunicationsStatus;
