import React, { useState, useCallback } from 'react';
import { Outlet } from '@tanstack/react-router';
import Rail from './Rail.js';
import DrawerNav from './DrawerNav.js';
import Topbar from '../dashboard/Topbar.js';
import GlobalPanicAlarm from './GlobalPanicAlarm.js';

// Universal app chrome — Rail (left), Topbar, mobile drawer. Extracted from
// DashboardShell so every authenticated route wears the same shell instead
// of Dashboard alone. Dashboard-specific chrome (TacticalMap, EventsTicker,
// ThreatStrip, OpsSidebar) lives in Dashboard.tsx now — this shell is
// deliberately generic, except for GlobalPanicAlarm: a panic must reach the
// operator regardless of which page they're on, so it's mounted here rather
// than inside Dashboard.tsx.
//
// The floating mobile bottom-nav pill (Convoys/GPS Live/dispatch FAB/Alerts/
// Menu) and the Topbar DISPATCH button were removed — both were redundant
// with Rail/DrawerNav's own entries and Topbar's own hamburger menu button,
// and found more distracting than useful.
//
// Route composition (see router.tsx):
//   authShellRoute → AppShell (this) → <Outlet /> → any authenticated page
//   authFullscreenRoute → <Outlet /> alone → pages that need full viewport
//     (e.g. ConvoyReports, which paints edge-to-edge PDF-like layouts)
const AppShell = React.memo(function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(true);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const toggleBtnBase: React.CSSProperties = {
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

  return (
    <>
      {/* Desktop rail */}
      <div style={{ display: 'none' }} className={`d-rail-wrapper${navOpen ? '' : ' d-nav-hidden'}`}>
        <Rail />
      </div>

      {/* Nav toggle tab (desktop) */}
      <button
        className='d-nav-toggle'
        onClick={() => setNavOpen((v) => !v)}
        title={navOpen ? 'Hide nav' : 'Show nav'}
        style={{
          ...toggleBtnBase,
          left: navOpen ? 'var(--d-rail-w)' : 0,
          transform: 'translateY(-50%)',
          borderRadius: '0 6px 6px 0',
          borderLeft: navOpen ? undefined : '1px solid var(--d-rim2)',
        }}
      >
        {navOpen ? '‹' : '›'}
      </button>

      {/* Mobile drawer */}
      <DrawerNav open={drawerOpen} onClose={closeDrawer} />

      {/* Global panic alarm — full-screen flash + siren, active on every authenticated route */}
      <GlobalPanicAlarm />

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
        className={`d-main-col${navOpen ? '' : ' d-nav-collapsed'}`}
      >
        <Topbar onMenuOpen={openDrawer} />
        <main style={{ overscrollBehavior: 'contain' }}>
          <Outlet />
        </main>
      </div>

      <style>{`
        @media (min-width: 900px) {
          .d-rail-wrapper { display: flex !important; }
          .d-nav-toggle  { display: flex !important; }
          .d-main-col { margin-left: var(--d-rail-w); }
          .d-main-col.d-nav-collapsed { margin-left: 0 !important; }
          .d-nav-hidden { display: none !important; }
        }
        .d-nav-toggle:hover { background: var(--d-lift2) !important; color: var(--d-t1) !important; }
      `}</style>
    </>
  );
});

export default AppShell;
