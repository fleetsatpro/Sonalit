import React, { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import Rail from './Rail.js';
import DrawerNav from './DrawerNav.js';
import BottomNav from './BottomNav.js';
import DispatchSheet from './DispatchSheet.js';
import Topbar from '../dashboard/Topbar.js';
import EventsTicker from '../dashboard/EventsTicker.js';
import ThreatStrip from '../dashboard/ThreatStrip.js';
import PanicAlarm from '../dashboard/PanicAlarm.js';
import OpsSidebar from '../dashboard/OpsSidebar.js';
const TacticalMap = lazy(() => import('../dashboard/TacticalMap.js'));
const DashboardShell = React.memo(function DashboardShell({ children }) {
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [dispatchOpen, setDispatchOpen] = useState(false);
    const [navOpen, setNavOpen] = useState(true);
    const [sbOpen, setSbOpen] = useState(true);
    const mainRef = useRef(null);
    const openDrawer = useCallback(() => setDrawerOpen(true), []);
    const closeDrawer = useCallback(() => setDrawerOpen(false), []);
    const openDispatch = useCallback(() => setDispatchOpen(true), []);
    const closeDispatch = useCallback(() => setDispatchOpen(false), []);
    // IntersectionObserver for staggered section reveals.
    useEffect(() => {
        const io = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('vis');
                    io.unobserve(entry.target);
                }
            });
        }, { threshold: 0.07 });
        const observeNew = () => {
            mainRef.current?.querySelectorAll('.d-section-reveal:not(.vis)').forEach(el => io.observe(el));
        };
        observeNew();
        const mo = new MutationObserver(observeNew);
        if (mainRef.current)
            mo.observe(mainRef.current, { childList: true, subtree: true });
        return () => { io.disconnect(); mo.disconnect(); };
    }, []);
    const toggleBtnBase = {
        position: 'fixed',
        top: '50%',
        zIndex: 350,
        display: 'none',
        alignItems: 'center',
        justifyContent: 'center',
        width: 18,
        height: 52,
        background: 'var(--d-carbon)',
        border: '1px solid var(--d-rim2)',
        cursor: 'pointer',
        color: 'var(--d-t3)',
        fontSize: 10,
        padding: 0,
        transition: 'background .15s, color .15s',
    };
    return (<>
      {/* Desktop rail */}
      <div style={{ display: 'none' }} className={`d-rail-wrapper${navOpen ? '' : ' d-nav-hidden'}`}>
        <Rail />
      </div>

      {/* Nav toggle tab (desktop) */}
      <button className='d-nav-toggle' onClick={() => setNavOpen(v => !v)} title={navOpen ? 'Hide nav' : 'Show nav'} style={{
            ...toggleBtnBase,
            left: navOpen ? 'var(--d-rail-w)' : 0,
            transform: 'translateY(-50%)',
            borderRadius: '0 6px 6px 0',
            borderLeft: navOpen ? undefined : '1px solid var(--d-rim2)',
        }}>
        {navOpen ? '‹' : '›'}
      </button>

      {/* Mobile drawer */}
      <DrawerNav open={drawerOpen} onClose={closeDrawer}/>

      {/* Main column */}
      <div style={{
            display: 'flex',
            flexDirection: 'column',
            minHeight: '100vh',
            width: '100%',
            minWidth: 0,
            overflowX: 'clip',
            background: 'var(--d-void)',
            overscrollBehavior: 'contain',
        }} className={`d-main-col${navOpen ? '' : ' d-nav-collapsed'}${sbOpen ? '' : ' d-sb-collapsed'}`}>
        <Topbar onMenuOpen={openDrawer} onDispatch={openDispatch}/>
        <EventsTicker />
        <ThreatStrip />
        <main ref={mainRef} style={{
            paddingBottom: 88,
            overscrollBehavior: 'contain',
        }}>
          <Suspense fallback={<div style={{ padding: 16 }}>
              <div style={{ height: 420, background: 'var(--d-well)', borderRadius: 12, border: '1px solid var(--d-rim2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ fontSize: 12, color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace' }}>Loading tactical map…</div>
              </div>
            </div>}>
            <TacticalMap />
          </Suspense>
          {children}
        </main>
      </div>

      {/* Desktop ops sidebar */}
      <div className={`d-ops-sidebar-wrap${sbOpen ? '' : ' d-sb-hidden'}`} style={{ display: 'none', position: 'fixed', right: 0, top: 0, width: 'var(--d-sb-w)', zIndex: 100 }}>
        <OpsSidebar />
      </div>

      {/* Sidebar toggle tab (desktop) */}
      <button className='d-sb-toggle' onClick={() => setSbOpen(v => !v)} title={sbOpen ? 'Hide sidebar' : 'Show sidebar'} style={{
            ...toggleBtnBase,
            right: sbOpen ? 'var(--d-sb-w)' : 0,
            transform: 'translateY(-50%)',
            borderRadius: '6px 0 0 6px',
        }}>
        {sbOpen ? '›' : '‹'}
      </button>

      {/* Mobile bottom nav */}
      <div className='d-mobile-nav'>
        <BottomNav onMenuOpen={openDrawer} onDispatch={openDispatch}/>
      </div>

      {/* Dispatch sheet */}
      <DispatchSheet open={dispatchOpen} onClose={closeDispatch}/>

      {/* Panic alarm — screen-edge flash + audio */}
      <PanicAlarm />

      <style>{`
        @media (min-width: 900px) {
          .d-rail-wrapper { display: flex !important; }
          .d-nav-toggle  { display: flex !important; }
          .d-sb-toggle   { display: flex !important; }
          .d-ops-sidebar-wrap { display: block !important; }
          .d-main-col { margin-left: var(--d-rail-w); margin-right: var(--d-sb-w); }
          .d-main-col.d-nav-collapsed { margin-left: 0 !important; }
          .d-main-col.d-sb-collapsed  { margin-right: 0 !important; }
          .d-mobile-nav { display: none !important; }
          .d-nav-hidden { display: none !important; }
          .d-sb-hidden  { display: none !important; }
        }
        @media (max-width: 899px) {
          .d-mobile-nav { display: block !important; }
        }
        .d-nav-toggle:hover, .d-sb-toggle:hover {
          background: var(--d-lift2) !important;
          color: var(--d-t1) !important;
        }
      `}</style>
    </>);
});
export default DashboardShell;
