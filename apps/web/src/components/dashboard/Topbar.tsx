import React, { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import NotificationPanel from '../layout/NotificationPanel.js';

interface TopbarProps {
  onMenuOpen: () => void;
  onDispatch: () => void;
}

const Topbar = React.memo(function Topbar({ onMenuOpen, onDispatch }: TopbarProps) {
  const [time, setTime] = useState(() => new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  const [bellOpen, setBellOpen] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      setTime(new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const { data: alertCount } = useQuery({
    queryKey: ['alerts-unread-count'],
    queryFn: async () => {
      try {
        const r = await api.get<{ data: Array<{id:string}> }>('/dashboard/alerts?limit=20');
        return r.data.data?.length ?? 0;
      } catch { return 0; }
    },
    refetchInterval: 30000,
  });

  const toggleBell = useCallback(() => setBellOpen(o => !o), []);
  const closeBell = useCallback(() => setBellOpen(false), []);

  return (
    <header style={{
      position: 'sticky',
      top: 0,
      zIndex: 200,
      height: 'var(--d-top-h)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 16px',
      background: 'rgba(5,9,16,.92)',
      backdropFilter: 'blur(30px)',
      borderBottom: '1px solid var(--d-rim)',
    }}>
      {/* Left */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={onMenuOpen}
          style={{ background: 'none', border: 'none', color: 'var(--d-t2)', cursor: 'pointer', fontSize: 18, padding: 4 }}
          className='d-desktop-hide'
          aria-label='Open menu'
        >☰</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ position: 'relative', width: 8, height: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--d-sig)', boxShadow: '0 0 6px var(--d-sglow)' }} />
            <div style={{
              position: 'absolute', inset: -4, borderRadius: '50%',
              border: '1.5px solid var(--d-sig)',
              animation: 'd-sonar 2s ease-out infinite',
              opacity: 0,
            }} />
          </div>
          <span style={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-sig)', letterSpacing: '.1em', fontWeight: 600 }}>LIVE</span>
        </div>
      </div>

      {/* Center clock */}
      <div style={{
        fontFamily: 'Orbitron, sans-serif',
        fontWeight: 700,
        fontSize: 20,
        color: 'var(--d-sig)',
        letterSpacing: '.08em',
        textShadow: '0 0 20px rgba(0,255,204,.5), 0 0 40px rgba(0,255,204,.2)',
        userSelect: 'none',
      }}>
        {time}
      </div>

      {/* Right */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
        <div style={{ position: 'relative' }}>
          <button
            onClick={toggleBell}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: 'var(--d-t2)', fontSize: 18, position: 'relative' }}
            aria-label='Notifications'
          >
            🔔
            {(alertCount ?? 0) > 0 && (
              <span style={{
                position: 'absolute', top: 2, right: 2,
                background: 'var(--d-fire)', color: '#fff',
                borderRadius: '50%', width: 16, height: 16,
                fontSize: 9, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'Orbitron, sans-serif',
              }}>{Math.min(alertCount ?? 0, 99)}</span>
            )}
          </button>
          <NotificationPanel open={bellOpen} onClose={closeBell} />
        </div>
        <button
          onClick={onDispatch}
          style={{
            background: 'var(--d-sg)', border: '1px solid var(--d-sig)',
            borderRadius: 8, padding: '6px 12px',
            color: 'var(--d-sig)', fontSize: 13, cursor: 'pointer',
            fontFamily: 'Orbitron, sans-serif', fontWeight: 700, letterSpacing: '.06em',
          }}
          aria-label='Quick dispatch'
        >⚡ DISPATCH</button>
      </div>

      <style>{`
        @media (min-width: 900px) { .d-desktop-hide { display: none !important; } }
      `}</style>
    </header>
  );
});

export default Topbar;
