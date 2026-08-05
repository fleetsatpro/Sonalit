import { createRouter, createRoute, createRootRoute, redirect } from '@tanstack/react-router';
import React, { lazy, Suspense } from 'react';
import { CDSAppShell } from './components/layout/AppShell.js';

const rootRoute = createRootRoute({
  component: CDSAppShell,
});

const Loader = () => (
  <div className="flex items-center justify-center h-full">
    <div className="w-6 h-6 border-2 border-cds-orange border-t-transparent rounded-full animate-spin" />
  </div>
);

function lazyPage(factory: () => Promise<{ default: React.ComponentType }>) {
  const Component = lazy(factory);
  return () => (
    <Suspense fallback={<Loader />}>
      <Component />
    </Suspense>
  );
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cds',
  component: lazyPage(() => import('./pages/Dashboard.js')),
});

const shipmentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cds/shipments',
  component: lazyPage(() => import('./pages/Shipments.js')),
});

const containersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cds/containers',
  component: lazyPage(() => import('./pages/Containers.js')),
});

const locksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cds/locks',
  component: lazyPage(() => import('./pages/Locks.js')),
});

const liveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cds/live',
  component: lazyPage(() => import('./pages/LiveOperations.js')),
});

const driversRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cds/drivers',
  component: lazyPage(() => import('./pages/Drivers.js')),
});

const vehiclesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cds/vehicles',
  component: lazyPage(() => import('./pages/Vehicles.js')),
});

const transportersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cds/transporters',
  component: lazyPage(() => import('./pages/Transporters.js')),
});

const customersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cds/customers',
  component: lazyPage(() => import('./pages/Customers.js')),
});

const deliveryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cds/delivery',
  component: lazyPage(() => import('./pages/DeliveryOperations.js')),
});

const geofencesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cds/geofences',
  component: lazyPage(() => import('./pages/Geofences.js')),
});

const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cds/inbox',
  component: lazyPage(() => import('./pages/AIInbox.js')),
});

const incidentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cds/incidents',
  component: lazyPage(() => import('./pages/Incidents.js')),
});

const alertsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cds/alerts',
  component: lazyPage(() => import('./pages/Alerts.js')),
});

const documentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cds/documents',
  component: lazyPage(() => import('./pages/Documents.js')),
});

const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cds/reports',
  component: lazyPage(() => import('./pages/Reports.js')),
});

const analyticsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cds/analytics',
  component: lazyPage(() => import('./pages/Analytics.js')),
});

const auditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cds/audit',
  component: lazyPage(() => import('./pages/AuditLogs.js')),
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cds/settings',
  component: lazyPage(() => import('./pages/Settings.js')),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  shipmentsRoute,
  containersRoute,
  locksRoute,
  liveRoute,
  driversRoute,
  vehiclesRoute,
  transportersRoute,
  customersRoute,
  deliveryRoute,
  geofencesRoute,
  inboxRoute,
  incidentsRoute,
  alertsRoute,
  documentsRoute,
  reportsRoute,
  analyticsRoute,
  auditRoute,
  settingsRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
