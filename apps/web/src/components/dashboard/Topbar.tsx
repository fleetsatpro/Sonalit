import React, { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useRouter, useRouterState } from '@tanstack/react-router';
import { ArrowLeft, Bell, LayoutGrid, Home, ShieldCheck, ShieldAlert, CircleHelp } from 'lucide-react';
import { fetchSystemHealth, getOverallHealthState } from '../../lib/systemHealth.js';
import { api } from '../../lib/api.js';
import NotificationPanel from '../layout/NotificationPanel.js';

interface TopbarProps { onMenuOpen: () => void; }

const Topbar = React.memo(function Topbar({ onMenuOpen }: TopbarProps) {
  const [time, setTime] = useState(() => new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  const [bellOpen, setBellOpen] = useState(false);
  const router = useRouter();
  const pathname = useRouterState({ select: state => state.location.pathname });

  useEffect(() => {
    const id = setInterval(() => setTime(new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })), 1000);
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

  const { data: systemHealth, isError: healthRequestFailed } = useQuery({
    queryKey: ['system-health'],
    queryFn: fetchSystemHealth,
    refetchInterval: 15_000,
    staleTime: 5_000,
    retry: 1,
  });
  const healthState = getOverallHealthState(systemHealth, healthRequestFailed);
  const healthLabel = healthState === 'healthy' ? 'CORE CHECKS PASS' : healthState === 'unavailable' ? 'CORE UNAVAILABLE' : healthState === 'degraded' ? 'DEGRADED' : 'STATUS UNKNOWN';
  const HealthIcon = healthState === 'healthy' ? ShieldCheck : healthState === 'unavailable' || healthState === 'degraded' ? ShieldAlert : CircleHelp;
  const toggleBell = useCallback(() => setBellOpen(o => !o), []);
  const closeBell = useCallback(() => setBellOpen(false), []);
  const goBack = useCallback(() => {
    // Back is a history operation, not a route-relative navigation. Using
    // router.history.back() preserves the exact previous location, including
    // nested module state, search params and hashes. Only fall back to Orbit
    // when this tab has no earlier history entry.
    if (window.history.length > 1) {
      router.history.back();
      return;
    }
    void router.navigate({ to: '/home', replace: true });
  }, [router]);
  const showBack = pathname !== '/home';

  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 200, height: 'var(--d-top-h)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', background: 'rgba(5,9,16,.92)', backdropFilter: 'blur(30px)', borderBottom: '1px solid var(--d-rim)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {showBack && <button onClick={goBack} title="Back" aria-label="Back to previous view" style={{ background: 'none', border: '1px solid var(--d-rim2)', color: 'var(--d-t2)', cursor: 'pointer', padding: 6, borderRadius: 8, display: 'flex', alignItems: 'center' }}><ArrowLeft size={17} strokeWidth={2} /></button>}
        <Link to='/home' title='Home — Orbit' aria-label='Home' style={{ background: 'none', border: '1px solid var(--d-rim2)', color: 'var(--d-t2)', cursor: 'pointer', padding: 6, borderRadius: 8, display: 'flex', alignItems: 'center', textDecoration: 'none' }}><Home size={17} strokeWidth={2} /></Link>
        <button onClick={onMenuOpen} style={{ background: 'none', border: '1px solid var(--d-rim2)', color: 'var(--d-t2)', cursor: 'pointer', padding: '6px 10px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 7, fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, fontWeight: 700, letterSpacing: '.08em' }} aria-label='Open apps'><LayoutGrid size={16} strokeWidth={2} /> APPS</button>
        <Link to='/system-health' aria-label={`System health: ${healthLabel.toLowerCase()}`} title='Open system health ledger' style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 3, padding: '6px 8px', border: '1px solid var(--d-rim2)', borderRadius: 7, color: healthState === 'healthy' ? '#8FCAB5' : healthState === 'unavailable' ? '#E99595' : healthState === 'degraded' ? '#E5B873' : 'var(--d-t2)', textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}><HealthIcon size={15} strokeWidth={1.8}/><span className="d-health-label-long" style={{ fontSize: 10, fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '.04em', fontWeight: 600 }}>{healthLabel}</span><span className="d-health-label-short" style={{ display: 'none', fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '.02em', fontWeight: 700 }}>{healthState === 'healthy' ? 'CORE' : healthState === 'unavailable' ? 'UNAVAIL' : healthState === 'degraded' ? 'DEGRADED' : 'UNKNOWN'}</span></Link>
      </div>
      <div style={{ fontFamily: 'Space Mono, ui-monospace, monospace', fontWeight: 700, fontSize: 20, color: 'var(--d-sig)', letterSpacing: '.08em', userSelect: 'none', fontVariantNumeric: 'tabular-nums' }}>{time}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}><div style={{ position: 'relative' }}><button onClick={toggleBell} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: 'var(--d-t2)', position: 'relative', display: 'flex', alignItems: 'center' }} aria-label='Notifications'><Bell size={18} strokeWidth={1.8} />{(alertCount ?? 0) > 0 && <span style={{ position: 'absolute', top: 2, right: 2, background: 'var(--d-fire)', color: '#fff', borderRadius: '50%', width: 16, height: 16, fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Orbitron, sans-serif' }}>{Math.min(alertCount ?? 0, 99)}</span>}</button><NotificationPanel open={bellOpen} onClose={closeBell} /></div></div>
      <style>{`@media (min-width: 900px) { .d-desktop-hide { display: none !important; } } @media (max-width: 480px) { .d-health-label-long { display: none !important; } .d-health-label-short { display: inline !important; } }`}</style>
    </header>
  );
});

export default Topbar;
