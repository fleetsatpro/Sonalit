import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import DataError from './DataError.js';
const STATUS_COLOR = { live: 'var(--d-ok)', delayed: 'var(--d-warn)', weak: 'var(--d-warn)', offline: 'var(--d-fire)' };
function RelTime({ iso }) {
    const [val, setVal] = useState('—');
    useEffect(() => {
        if (!iso)
            return;
        const tick = () => {
            const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
            if (sec < 60)
                setVal(`${sec}s ago`);
            else if (sec < 3600)
                setVal(`${Math.floor(sec / 60)}m ago`);
            else
                setVal(`${Math.floor(sec / 3600)}h ago`);
        };
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [iso]);
    const sec = iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 1000) : 9999;
    const color = sec < 30 ? 'var(--d-ok)' : sec < 300 ? 'var(--d-warn)' : 'var(--d-fire)';
    return <span style={{ color, fontFamily: 'IBM Plex Mono, monospace', fontSize: 11 }}>{val}</span>;
}
function SignalBars({ bars }) {
    return (<div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 14 }}>
      {[1, 2, 3, 4, 5].map(b => (<div key={b} style={{
                width: 4, borderRadius: 1,
                height: `${(b / 5) * 14}px`,
                background: b <= bars ? 'var(--d-sig)' : 'var(--d-t4)',
            }}/>))}
    </div>);
}
const CommunicationsStatus = React.memo(function CommunicationsStatus() {
    const { data, isError, refetch } = useQuery({
        queryKey: ['dashboard-comms'],
        queryFn: async () => { const r = await api.get('/dashboard/comms'); return r.data.data ?? []; },
        staleTime: 30000,
        refetchInterval: 30000,
    });
    if (isError)
        return <DataError section='Communications' onRetry={refetch}/>;
    return (<div className='d-section-reveal d-card' style={{ padding: 16 }}>
      <SH />
      <div style={{ overflowX: 'auto', scrollbarWidth: 'none' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {['VEHICLE', 'SIGNAL', 'PINGS', 'LAST CONTACT', 'STATUS'].map(h => (<th key={h} style={{ textAlign: 'left', padding: '4px 8px 8px 0', fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '.08em', color: 'var(--d-t3)', fontWeight: 600 }}>{h}</th>))}
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map(v => (<tr key={v.vehicle_id} style={{ borderTop: '1px solid var(--d-rim)' }}>
                <td style={{ padding: '8px 8px 8px 0', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, color: 'var(--d-t1)' }}>{v.registration}</td>
                <td style={{ padding: '8px 8px 8px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <SignalBars bars={v.signal_bars}/>
                    <span style={{ fontSize: 9, color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace' }}>{v.network_type}</span>
                  </div>
                </td>
                <td style={{ padding: '8px 8px 8px 0', fontFamily: 'Orbitron, sans-serif', fontSize: 11, fontWeight: 700, color: 'var(--d-t1)' }}>{v.ping_count_today}</td>
                <td style={{ padding: '8px 8px 8px 0' }}><RelTime iso={v.last_ping_at}/></td>
                <td style={{ padding: '8px 0' }}>
                  <span style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, letterSpacing: '.08em', color: STATUS_COLOR[v.status], background: `${STATUS_COLOR[v.status]}1a`, borderRadius: 4, padding: '2px 6px', textTransform: 'uppercase' }}>
                    {v.status}
                  </span>
                </td>
              </tr>))}
            {(!data || data.length === 0) && (<tr><td colSpan={5} style={{ padding: 16, textAlign: 'center', color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 12 }}>No vehicles</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>);
});
function SH() {
    return (<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      <div style={{ width: 3, height: 14, background: 'var(--d-orange)', borderRadius: 2 }}/>
      <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 11, letterSpacing: '.12em', color: 'var(--d-t1)' }}>COMMUNICATIONS STATUS</span>
    </div>);
}
export default CommunicationsStatus;
