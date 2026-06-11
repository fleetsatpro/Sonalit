import React, { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
const SEVERITY_COLOR = {
    alert: 'var(--d-fire)',
    incident: 'var(--d-warn)',
    convoy: 'var(--d-sig)',
    panic: 'var(--d-fire)',
};
function relTime(iso) {
    const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (sec < 60)
        return `${sec}s ago`;
    if (sec < 3600)
        return `${Math.floor(sec / 60)}m ago`;
    if (sec < 86400)
        return `${Math.floor(sec / 3600)}h ago`;
    return `${Math.floor(sec / 86400)}d ago`;
}
const NotificationPanel = React.memo(function NotificationPanel({ open, onClose }) {
    const ref = useRef(null);
    const qc = useQueryClient();
    const { data: notifications = [] } = useQuery({
        queryKey: ['notifications'],
        queryFn: async () => {
            try {
                const r = await api.get('/notifications?limit=10');
                return r.data.data ?? [];
            }
            catch {
                return [];
            }
        },
        staleTime: 30000,
    });
    const markReadMut = useMutation({
        mutationFn: () => api.post('/notifications/read-all'),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
    });
    useEffect(() => {
        if (open)
            markReadMut.mutate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);
    useEffect(() => {
        if (!open)
            return;
        const handler = (e) => {
            if (ref.current && !ref.current.contains(e.target))
                onClose();
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open, onClose]);
    if (!open)
        return null;
    return (<div ref={ref} style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: 320,
            background: 'var(--d-deep)',
            border: '1px solid var(--d-rim2)',
            borderRadius: 12,
            overflow: 'hidden',
            zIndex: 600,
            boxShadow: '0 16px 48px rgba(0,0,0,.5)',
        }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--d-rim)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: 'var(--d-t1)' }}>NOTIFICATIONS</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--d-t3)', cursor: 'pointer' }}>✕</button>
      </div>
      {notifications.length === 0 ? (<div style={{ padding: 24, textAlign: 'center', color: 'var(--d-t3)', fontSize: 13, fontFamily: 'IBM Plex Mono, monospace' }}>
          No notifications
        </div>) : (<div style={{ maxHeight: 360, overflowY: 'auto', scrollbarWidth: 'none' }}>
          {notifications.map(n => (<div key={n.id} style={{
                    padding: '10px 16px',
                    borderBottom: '1px solid var(--d-rim)',
                    display: 'flex', gap: 10, alignItems: 'flex-start',
                    background: n.read ? 'transparent' : 'rgba(0,255,204,.04)',
                }}>
              <div style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginTop: 4,
                    background: SEVERITY_COLOR[n.type] ?? 'var(--d-t3)',
                }}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--d-t1)', marginBottom: 2 }}>{n.title}</div>
                <div style={{ fontSize: 11, color: 'var(--d-t2)', fontFamily: 'IBM Plex Mono, monospace' }}>{n.body}</div>
                <div style={{ fontSize: 10, color: 'var(--d-t3)', marginTop: 4, fontFamily: 'IBM Plex Mono, monospace' }}>{relTime(n.created_at)}</div>
              </div>
            </div>))}
        </div>)}
    </div>);
});
export default NotificationPanel;
