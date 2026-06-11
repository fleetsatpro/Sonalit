import React, { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import DataError from './DataError.js';
import CompactEmpty from './CompactEmpty.js';
const RISK_COLOR = { high: 'var(--d-fire)', medium: 'var(--d-warn)', low: 'var(--d-ok)' };
function RiskBar({ score }) {
    const ref = useRef(null);
    useEffect(() => {
        const el = ref.current;
        if (!el)
            return;
        const color = score >= 70 ? 'var(--d-fire)' : score >= 40 ? 'var(--d-warn)' : 'var(--d-ok)';
        requestAnimationFrame(() => {
            el.style.transition = 'width 1.5s ease, background .4s';
            el.style.width = `${score}%`;
            el.style.background = color;
        });
    }, [score]);
    return (<div style={{ height: 4, background: 'var(--d-lift2)', borderRadius: 2, overflow: 'hidden', marginTop: 6 }}>
      <div ref={ref} style={{ height: '100%', width: 0, borderRadius: 2, transformOrigin: 'left' }}/>
    </div>);
}
const RouteRiskIntelligence = React.memo(function RouteRiskIntelligence() {
    const { data, isError, refetch } = useQuery({
        queryKey: ['dashboard-route-risk'],
        queryFn: async () => { const r = await api.get('/dashboard/route-risk'); return r.data.data ?? []; },
        staleTime: 60000,
    });
    if (isError)
        return <DataError section='Route Risk' onRetry={refetch}/>;
    const rows = data ?? [];
    if (rows.length === 0) {
        return <CompactEmpty accent='var(--d-warn)' title='ROUTE RISK INTELLIGENCE' message='No corridors configured'/>;
    }
    return (<div className='d-section-reveal d-card' style={{ padding: 16 }}>
      <SH />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.map((row, i) => {
            const color = RISK_COLOR[row.risk];
            return (<div key={i} style={{ borderBottom: '1px solid var(--d-rim)', paddingBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, letterSpacing: '.1em', color, background: `${color}1a`, borderRadius: 4, padding: '2px 6px', textTransform: 'uppercase' }}>
                  {row.risk}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--d-t1)', flex: 1 }}>{row.corridor}</span>
                <span style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 13, fontWeight: 700, color }}>{row.risk_score}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace' }}>{row.origin} → {row.destination}</div>
              {row.last_incident_summary && (<div style={{ fontSize: 11, color: 'var(--d-t2)', marginTop: 3 }}>{row.last_incident_summary}</div>)}
              {row.active_convoys.length > 0 && (<div style={{ fontSize: 10, color: 'var(--d-sig)', fontFamily: 'IBM Plex Mono, monospace', marginTop: 3 }}>
                  Active: {row.active_convoys.join(', ')}
                </div>)}
              <RiskBar score={row.risk_score}/>
            </div>);
        })}
      </div>
    </div>);
});
function SH() {
    return (<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      <div style={{ width: 3, height: 14, background: 'var(--d-warn)', borderRadius: 2 }}/>
      <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 11, letterSpacing: '.12em', color: 'var(--d-t1)' }}>ROUTE RISK INTELLIGENCE</span>
    </div>);
}
export default RouteRiskIntelligence;
