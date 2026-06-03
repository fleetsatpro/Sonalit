import React, { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import Rail from './Rail.js';
import DrawerNav from './DrawerNav.js';
import BottomNav from './BottomNav.js';
import DispatchSheet from './DispatchSheet.js';
import Topbar from '../dashboard/Topbar.js';
import EventsTicker from '../dashboard/EventsTicker.js';
import ThreatStrip from '../dashboard/ThreatStrip.js';

const TacticalMap = lazy(() => import('../dashboard/TacticalMap.js'));

interface DashboardShellProps {
  children: React.ReactNode;
}

const DashboardShell = React.memo(function DashboardShell({ children }: DashboardShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const mainRef = useRef<HTMLDivElement>(null);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const openDispatch = useCallback(() => setDispatchOpen(true), []);
  const closeDispatch = useCallback(() => setDispatchOpen(false), []);

  // IntersectionObserver for staggered section reveals
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).classList.add('vis');
          }
        });
      },
      { threshold: 0.07 }
    );
    const els = mainRef.current?.querySelectorAll('.d-section-reveal');
    els?.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <>
      {/* Desktop rail */}
      <div style={{ display: 'none' }} className='d-rail-wrapper'>
        <Rail />
      </div>

      {/* Mobile drawer */}
      <DrawerNav open={drawerOpen} onClose={closeDrawer} />

      {/* Main column */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          minHeight: '100vh',
          width: '100%',
          minWidth: 0,
          overflowX: 'clip',
          background: 'var(--d-void)',
          overscrollBehavior: 'contain',
        }}
        className='d-main-col'
      >
        <Topbar onMenuOpen={openDrawer} onDispatch={openDispatch} />
        <EventsTicker />
        <ThreatStrip />
        <main
          ref={mainRef}
          style={{
            paddingBottom: 88,
            overscrollBehavior: 'contain',
          }}
        >
          <Suspense fallback={
            <div style={{ padding: 16 }}>
              <div style={{ height: 320, background: 'var(--d-well)', borderRadius: 12, border: '1px solid var(--d-rim2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ fontSize: 12, color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace' }}>Loading tactical map…</div>
              </div>
            </div>
          }>
            <TacticalMap />
          </Suspense>
          {children}
        </main>
      </div>

      {/* Desktop ops sidebar */}
      <div style={{ display: 'none' }} className='d-ops-wrapper'>
        {/* OpsSidebar rendered from parent when desktop */}
      </div>

      {/* Mobile bottom nav */}
      <div className='d-mobile-nav'>
        <BottomNav onMenuOpen={openDrawer} onDispatch={openDispatch} />
      </div>

      {/* Dispatch sheet */}
      <DispatchSheet open={dispatchOpen} onClose={closeDispatch} />

      <style>{`
        @media (min-width: 900px) {
          .d-rail-wrapper { display: flex !important; }
          .d-main-col { margin-left: var(--d-rail-w); margin-right: var(--d-sb-w); }
          .d-ops-wrapper { display: flex !important; }
          .d-mobile-nav { display: none !important; }
        }
        @media (max-width: 899px) {
          .d-mobile-nav { display: block !important; }
        }
      `}</style>
    </>
  );
});

export default DashboardShell;
