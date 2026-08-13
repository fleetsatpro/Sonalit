import React from 'react';
import { Outlet, useMatches } from '@tanstack/react-router';
import { Rail } from './Rail.js';
import { Topbar } from './Topbar.js';
import { Drawer } from '@/components/ui/Drawer.js';
import { ToastContainer } from '@/components/ui/Toast.js';
import { useUIStore } from '@/stores/ui.js';

const routeMeta: Record<string, { title: string; subtitle: string }> = {
  '/cds': { title: 'Dashboard', subtitle: "TODAY'S OPERATIONS OVERVIEW" },
  '/cds/shipments': { title: 'Shipments', subtitle: 'SHIPMENT LIFECYCLE MANAGEMENT' },
  '/cds/containers': { title: 'Containers', subtitle: 'CHAIN-OF-CUSTODY TRACKING' },
  '/cds/locks': { title: 'E-Locks', subtitle: 'FLEET LOCK HEALTH' },
  '/cds/live': { title: 'Live Operations', subtitle: 'REAL-TIME FLEET TRACKING' },
  '/cds/drivers': { title: 'Drivers', subtitle: 'FIELD TEAM ROSTER' },
  '/cds/vehicles': { title: 'Vehicles', subtitle: 'FLEET VEHICLE MANAGEMENT' },
  '/cds/transporters': { title: 'Transporters', subtitle: 'CONTRACTED PARTNERS' },
  '/cds/customers': { title: 'Customers', subtitle: 'CUSTOMER MANAGEMENT' },
  '/cds/delivery': { title: 'Delivery Operations', subtitle: 'PORT & DESTINATION OPERATIONS' },
  '/cds/geofences': { title: 'Geofences', subtitle: 'ZONE & CORRIDOR MANAGEMENT' },
  '/cds/inbox': { title: 'AI Inbox', subtitle: 'WHATSAPP INTAKE · AUTO-EXTRACTION' },
  '/cds/incidents': { title: 'Incidents', subtitle: 'INCIDENT TRACKING & RESOLUTION' },
  '/cds/alerts': { title: 'Alerts', subtitle: 'SYSTEM & OPERATIONAL ALERTS' },
  '/cds/documents': { title: 'Documents', subtitle: 'DOCUMENT MANAGEMENT' },
  '/cds/reports': { title: 'Reports', subtitle: 'GENERATE & EXPORT' },
  '/cds/analytics': { title: 'Analytics', subtitle: 'FLEET PERFORMANCE, LAST 30 DAYS' },
  '/cds/audit': { title: 'Audit Logs', subtitle: 'COMPLETE AUDIT TRAIL' },
  '/cds/settings': { title: 'Settings', subtitle: 'ACCOUNT & PLATFORM PREFERENCES' },
};

export function CDSAppShell() {
  const matches = useMatches();
  const currentPath = matches[matches.length - 1]?.pathname ?? '/cds';
  const meta = routeMeta[currentPath] ?? { title: 'Container Delivery System', subtitle: 'SONALIT CDS' };
  const collapsed = useUIStore((s) => s.sidebarCollapsed);

  return (
    <div className={`h-screen grid ${collapsed ? 'grid-cols-[76px_1fr]' : 'grid-cols-[200px_1fr]'} bg-ink-0 text-text-0 font-sans overflow-hidden transition-all duration-200`}>
      <Rail />
      <div className="flex flex-col min-w-0">
        <Topbar title={meta.title} subtitle={meta.subtitle} />
        <main className="flex-1 min-h-0 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <Drawer />
      <ToastContainer />
    </div>
  );
}
