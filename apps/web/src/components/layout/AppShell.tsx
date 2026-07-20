import React, { useState, useCallback } from 'react';
import { Outlet } from '@tanstack/react-router';
import Topbar from '../dashboard/Topbar.js';
import GlobalPanicAlarm from './GlobalPanicAlarm.js';
import AppLauncherOverlay from './AppLauncherOverlay.js';

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
  // The old always-on rail is gone: deep pages open the same Orbit folder
  // launcher on demand (Topbar → Apps), so navigation stays consistent with
  // the home surface instead of resurrecting a rigid side panel.
  const [launcherOpen, setLauncherOpen] = useState(false);
  const openLauncher = useCallback(() => setLauncherOpen(true), []);
  const closeLauncher = useCallback(() => setLauncherOpen(false), []);

  return (
    <>
      {/* App launcher — folders → apps, over a scrim (all screen sizes) */}
      <AppLauncherOverlay open={launcherOpen} onClose={closeLauncher} />

      {/* Global panic alarm — full-screen flash + siren, active on every authenticated route */}
      <GlobalPanicAlarm />

      {/* Main column */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          // Must be a definite height, not minHeight — <main> below is a
          // percentage-height page like GPS.tsx's Live Fleet map, and a
          // percentage height only resolves against a definite parent height.
          // With minHeight, this box's height was 'auto' whenever content was
          // shorter than the viewport, so height:'100%' cascaded down through
          // <main> as 'auto' too, collapsing pages that rely on it (map/list
          // panels rendering at ~0 height while fixed-height chrome above
          // them, like GPS.tsx's 44px header, still appeared to work fine).
          // 100dvh (not 100vh) so mobile browser chrome showing/hiding
          // doesn't over- or under-size this against the visual viewport.
          height: '100dvh',
          width: '100%',
          minWidth: 0,
          overflowX: 'clip',
          background: 'var(--d-void)',
          overscrollBehavior: 'contain',
        }}
        className="d-main-col"
      >
        <Topbar onMenuOpen={openLauncher} />
        {/* flex:1 to actually claim the remaining height after Topbar;
            minHeight:0 so it can shrink instead of overflowing to content
            size (the classic flex-child sizing trap); overflowY:auto so
            normal scrolling pages (Dashboard, Convoys, tables, ...) still
            scroll exactly as before — only now within a definite box instead
            of relying on the whole document growing taller than the viewport. */}
        <main style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
          <Outlet />
        </main>
      </div>

    </>
  );
});

export default AppShell;
