import React, { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Bell, LayoutGrid, Home } from 'lucide-react';
import { api } from '../../lib/api.js';
import NotificationPanel from '../layout/NotificationPanel.js';

interface TopbarProps {
  onMenuOpen: () => void;
}

const Topbar = React.memo(function Topbar({ onMenuOpen }: TopbarProps) {
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Link
          to='/'
          title='Home — Orbit'
          aria-label='Home'
          style={{ background: 'none', border: '1px solid var(--d-rim2)', color: 'var(--d-t2)', cursor: 'pointer', padding: 6, borderRadius: 8, display: 'flex', alignItems: 'center', textDecoration: 'none' }}
        ><Home size={17} strokeWidth={2} /></Link>
        <button
          onClick={onMenuOpen}
          style={{ background: 'none', border: '1px solid var(--d-rim2)', color: 'var(--d-t2)', cursor: 'pointer', padding: '6px 10px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 7, fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, fontWeight: 700, letterSpacing: '.08em' }}
          aria-label='Open apps'
        ><LayoutGrid size={16} strokeWidth={2} /> APPS</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
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
        fontFamily: 'Space Mono, ui-monospace, monospace',
        fontWeight: 700,
        fontSize: 20,
        color: 'var(--d-sig)',
        letterSpacing: '.08em',
        textShadow: '0 0 20px var(--d-sglow), 0 0 40px var(--d-sg)',
        userSelect: 'none',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {time}
      </div>

      {/* Right */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
        <div style={{ position: 'relative' }}>
          <button
            onClick={toggleBell}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: 'var(--d-t2)', position: 'relative', display: 'flex', alignItems: 'center' }}
            aria-label='Notifications'
          >
            <Bell size={18} strokeWidth={1.8} />
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
      </div>

      <style>{`
        @media (min-width: 900px) { .d-desktop-hide { display: none !important; } }
      `}</style>
    </header>
  );
});

export default Topbar;
