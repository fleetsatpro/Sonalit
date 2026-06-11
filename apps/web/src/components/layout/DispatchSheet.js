import React, { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
const DispatchSheet = React.memo(function DispatchSheet({ open, onClose }) {
    const [vehicleId, setVehicleId] = useState('');
    const [driverId, setDriverId] = useState('');
    const [routeId, setRouteId] = useState('');
    const [priority, setPriority] = useState('standard');
    const [status, setStatus] = useState('idle');
    const { data: vehicles } = useQuery({
        queryKey: ['vehicles-list'],
        queryFn: async () => { const r = await api.get('/vehicles'); return r.data.data; },
        staleTime: 60000,
    });
    const { data: drivers } = useQuery({
        queryKey: ['drivers-list'],
        queryFn: async () => { const r = await api.get('/drivers'); return r.data.data; },
        staleTime: 60000,
    });
    const handleSubmit = useCallback(async (e) => {
        e.preventDefault();
        setStatus('loading');
        try {
            await api.post('/convoys/dispatch', { vehicle_id: vehicleId, driver_id: driverId, route_id: routeId || undefined, priority });
            setStatus('success');
            setTimeout(() => { setStatus('idle'); onClose(); }, 1500);
        }
        catch {
            setStatus('error');
            setTimeout(() => setStatus('idle'), 2500);
        }
    }, [vehicleId, driverId, routeId, priority, onClose]);
    useEffect(() => {
        if (!open)
            return;
        const h = (e) => { if (e.key === 'Escape')
            onClose(); };
        document.addEventListener('keydown', h);
        return () => document.removeEventListener('keydown', h);
    }, [open, onClose]);
    const selStyle = {
        width: '100%', padding: '10px 12px',
        background: 'var(--d-lift)', border: '1px solid var(--d-rim2)',
        borderRadius: 8, color: 'var(--d-t1)', fontSize: 13,
        fontFamily: 'DM Sans, sans-serif', outline: 'none',
    };
    return (<>
      <div onClick={onClose} style={{
            position: 'fixed', inset: 0, zIndex: 800,
            background: 'rgba(0,0,0,.35)',
            opacity: open ? 1 : 0, pointerEvents: open ? 'all' : 'none',
            transition: 'opacity .2s',
        }}/>
      <div style={{
            position: 'fixed', bottom: 0, left: '50%',
            transform: `translateX(-50%) translateY(${open ? 0 : '100%'})`,
            width: '100%', maxWidth: 432,
            background: 'var(--d-deep)',
            border: '1px solid var(--d-rim2)',
            borderBottom: 'none',
            borderRadius: '16px 16px 0 0',
            padding: '12px 24px 24px',
            paddingBottom: 'max(24px, env(safe-area-inset-bottom))',
            zIndex: 900,
            transition: 'transform .3s cubic-bezier(.4,0,.2,1)',
        }}>
        {/* Drag handle */}
        <div style={{ width: 36, height: 4, background: 'var(--d-rim3)', borderRadius: 2, margin: '0 auto 16px' }}/>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <div style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 14, color: 'var(--d-t1)', letterSpacing: '.08em' }}>QUICK DISPATCH</div>
            <div style={{ fontSize: 11, color: 'var(--d-t2)', fontFamily: 'IBM Plex Mono, monospace', marginTop: 2 }}>Assign vehicle to route</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--d-t2)', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <select value={vehicleId} onChange={e => setVehicleId(e.target.value)} required style={selStyle}>
            <option value=''>Select vehicle…</option>
            {vehicles?.map(v => <option key={v.id} value={v.id}>{v.registration}</option>)}
          </select>

          <select value={driverId} onChange={e => setDriverId(e.target.value)} required style={selStyle}>
            <option value=''>Select driver…</option>
            {drivers?.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>

          <input value={routeId} onChange={e => setRouteId(e.target.value)} placeholder='Route ID (optional)' style={{ ...selStyle }}/>

          <div style={{ display: 'flex', gap: 8 }}>
            {['standard', 'express', 'critical'].map(p => (<button key={p} type='button' onClick={() => setPriority(p)} style={{
                flex: 1, padding: '9px 4px',
                background: priority === p
                    ? (p === 'critical' ? 'var(--d-fg)' : p === 'express' ? 'var(--d-wg)' : 'var(--d-og)')
                    : 'var(--d-lift)',
                border: `1px solid ${priority === p
                    ? (p === 'critical' ? 'var(--d-fire)' : p === 'express' ? 'var(--d-warn)' : 'var(--d-orange)')
                    : 'var(--d-rim2)'}`,
                borderRadius: 8,
                color: priority === p
                    ? (p === 'critical' ? 'var(--d-fire)' : p === 'express' ? 'var(--d-warn)' : 'var(--d-orange)')
                    : 'var(--d-t2)',
                fontSize: 11, cursor: 'pointer', fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: '.06em',
                fontFamily: 'IBM Plex Mono, monospace',
            }}>{p}</button>))}
          </div>

          <button type='submit' disabled={status === 'loading' || status === 'success'} style={{
            padding: '12px',
            background: status === 'success' ? 'var(--d-sg)' : status === 'error' ? 'var(--d-fg)' : 'var(--d-og)',
            border: `1px solid ${status === 'success' ? 'var(--d-sig)' : status === 'error' ? 'var(--d-fire)' : 'var(--d-orange)'}`,
            borderRadius: 8,
            color: status === 'success' ? 'var(--d-sig)' : status === 'error' ? 'var(--d-fire)' : 'var(--d-orange)',
            fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 13,
            letterSpacing: '.1em', cursor: 'pointer',
        }}>
            {status === 'loading' ? 'DISPATCHING…' : status === 'success' ? 'DISPATCHED ✓' : status === 'error' ? 'FAILED — RETRY' : 'DISPATCH ⚡'}
          </button>
        </form>
      </div>
    </>);
});
export default DispatchSheet;
