import { createRouter, createRoute, createRootRoute, Outlet, redirect, lazyRouteComponent } from '@tanstack/react-router';
import { useAuthStore, getAccessToken } from './stores/auth.js';
import Layout from './components/Layout.js';
import { RootErrorComponent } from './components/ErrorBoundary.js';
import LoginPage from './pages/Login.js';

const rootRoute = createRootRoute({ component: Outlet, errorComponent: RootErrorComponent });

const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'auth',
  beforeLoad: () => {
    // Check in-memory access token first; fall back to persisted user (T1.2)
    if (!getAccessToken() && !useAuthStore.getState().user) throw redirect({ to: '/login' });
  },
  component: Layout,
});

const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: LoginPage });
const notFoundRoute = createRoute({ getParentRoute: () => rootRoute, path: '*', component: lazyRouteComponent(() => import('./pages/NotFound.js')) });

const dashboardRoute = createRoute({ getParentRoute: () => authRoute, path: '/', component: lazyRouteComponent(() => import('./pages/Dashboard.js')) });
const fleetRoute = createRoute({ getParentRoute: () => authRoute, path: '/fleet', component: lazyRouteComponent(() => import('./pages/Fleet.js')) });
const gpsRoute = createRoute({ getParentRoute: () => authRoute, path: '/gps', component: lazyRouteComponent(() => import('./pages/GPS.js')) });
const convoysRoute = createRoute({ getParentRoute: () => authRoute, path: '/convoys', component: lazyRouteComponent(() => import('./pages/Convoys.js')) });
const convoyNewRoute = createRoute({ getParentRoute: () => authRoute, path: '/convoys/new', component: lazyRouteComponent(() => import('./pages/CfoConvoyForm.js')) });
const convoyEditRoute = createRoute({ getParentRoute: () => authRoute, path: '/convoys/$id/edit', component: lazyRouteComponent(() => import('./pages/CfoConvoyForm.js')) });
const driversRoute = createRoute({ getParentRoute: () => authRoute, path: '/drivers', component: lazyRouteComponent(() => import('./pages/Drivers.js')) });
const alertsRoute = createRoute({ getParentRoute: () => authRoute, path: '/alerts', component: lazyRouteComponent(() => import('./pages/Alerts.js')) });
const incidentsRoute = createRoute({ getParentRoute: () => authRoute, path: '/incidents', component: lazyRouteComponent(() => import('./pages/Incidents.js')) });
const incidentCenterRoute = createRoute({ getParentRoute: () => authRoute, path: '/incident-center', component: lazyRouteComponent(() => import('./pages/IncidentCenter.js')) });
const panicCenterRoute = createRoute({ getParentRoute: () => authRoute, path: '/panic-center', component: lazyRouteComponent(() => import('./pages/PanicCenter.js')) });
const messagesRoute = createRoute({ getParentRoute: () => authRoute, path: '/messages', component: lazyRouteComponent(() => import('./pages/Messages.js')) });
const analyticsRoute = createRoute({ getParentRoute: () => authRoute, path: '/analytics', component: lazyRouteComponent(() => import('./pages/Analytics.js')) });
const reportsRoute = createRoute({ getParentRoute: () => authRoute, path: '/reports', component: lazyRouteComponent(() => import('./pages/Reports.js')) });
const convoyReportsRoute = createRoute({ getParentRoute: () => authRoute, path: '/convoy-reports', component: lazyRouteComponent(() => import('./pages/ConvoyReports.js')) });
const shipmentsRoute = createRoute({ getParentRoute: () => authRoute, path: '/shipments', component: lazyRouteComponent(() => import('./pages/Shipments.js')) });
const financeRoute = createRoute({ getParentRoute: () => authRoute, path: '/finance', component: lazyRouteComponent(() => import('./pages/Finance.js')) });
const maintenanceRoute = createRoute({ getParentRoute: () => authRoute, path: '/maintenance', component: lazyRouteComponent(() => import('./pages/Maintenance.js')) });
const geofencesRoute = createRoute({ getParentRoute: () => authRoute, path: '/geofences', component: lazyRouteComponent(() => import('./pages/Geofences.js')) });
const riskIntelRoute = createRoute({ getParentRoute: () => authRoute, path: '/risk-intel', component: lazyRouteComponent(() => import('./pages/RiskIntel.js')) });
const rulesRoute = createRoute({ getParentRoute: () => authRoute, path: '/rules', component: lazyRouteComponent(() => import('./pages/Rules.js')) });
const fieldOfficersRoute = createRoute({ getParentRoute: () => authRoute, path: '/field-officers', component: lazyRouteComponent(() => import('./pages/FieldOfficers.js')) });
const executiveRoute = createRoute({ getParentRoute: () => authRoute, path: '/executive', component: lazyRouteComponent(() => import('./pages/Executive.js')) });
const devicesRoute = createRoute({ getParentRoute: () => authRoute, path: '/devices', component: lazyRouteComponent(() => import('./pages/Devices.js')) });
const guardianRoute = createRoute({ getParentRoute: () => authRoute, path: '/guardian', component: lazyRouteComponent(() => import('./pages/Guardian.js')) });
const aiDecisionRoute = createRoute({ getParentRoute: () => authRoute, path: '/ai', component: lazyRouteComponent(() => import('./pages/AIDecision.js')) });
const copilotRoute = createRoute({ getParentRoute: () => authRoute, path: '/copilot', component: lazyRouteComponent(() => import('./pages/Copilot.js')) });
const settingsRoute = createRoute({ getParentRoute: () => authRoute, path: '/settings', component: lazyRouteComponent(() => import('./pages/Settings.js')) });
const routeAnalysisRoute = createRoute({ getParentRoute: () => authRoute, path: '/route-analysis', component: lazyRouteComponent(() => import('./pages/RouteAnalysis.js')) });
const cargoPortalRoute = createRoute({ getParentRoute: () => authRoute, path: '/cargo-portal', component: lazyRouteComponent(() => import('./pages/CargoPortal.js')) });

const routeTree = rootRoute.addChildren([
  loginRoute,
  notFoundRoute,
  authRoute.addChildren([
    dashboardRoute, fleetRoute, gpsRoute,
    convoysRoute, convoyNewRoute, convoyEditRoute,
    driversRoute, alertsRoute, incidentsRoute,
    incidentCenterRoute, panicCenterRoute, messagesRoute,
    analyticsRoute, reportsRoute, convoyReportsRoute, shipmentsRoute,
    financeRoute, maintenanceRoute, geofencesRoute,
    riskIntelRoute, rulesRoute, fieldOfficersRoute,
    executiveRoute, devicesRoute, guardianRoute,
    aiDecisionRoute, copilotRoute, settingsRoute, routeAnalysisRoute, cargoPortalRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}
