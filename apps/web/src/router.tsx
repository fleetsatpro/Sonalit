import { createRouter, createRoute, createRootRoute, Outlet, redirect, lazyRouteComponent } from '@tanstack/react-router';
import { useAuthStore, getAccessToken } from './stores/auth.js';
import Layout from './components/Layout.js';
import { RootErrorComponent } from './components/ErrorBoundary.js';
import LoginPage from './pages/Login.js';

const rootRoute = createRootRoute({ component: Outlet, errorComponent: RootErrorComponent });

const authCheck = () => {
  if (!getAccessToken() && !useAuthStore.getState().user) throw redirect({ to: '/login' });
};

// Authenticated routes wrapped in the old NavSidebar + TopBar layout
const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'auth',
  beforeLoad: authCheck,
  component: Layout,
});

// Authenticated routes that render full-screen (no old sidebar/topbar)
const authFullscreenRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'auth-fullscreen',
  beforeLoad: authCheck,
  component: Outlet,
});

const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: LoginPage });
const notFoundRoute = createRoute({ getParentRoute: () => rootRoute, path: '*', component: lazyRouteComponent(() => import('./pages/NotFound.js')) });

const dashboardRoute = createRoute({ getParentRoute: () => authFullscreenRoute, path: '/', component: lazyRouteComponent(() => import('./pages/Dashboard.js')) });
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

// ─── Convoy Reports — fullscreen within app (no double sidebar) ───────────────
const convoyReportsRoute = createRoute({
  getParentRoute: () => authFullscreenRoute,
  path: '/convoy-reports',
  component: lazyRouteComponent(() => import('./pages/ConvoyReports.js')),
});

const shipmentsRoute = createRoute({ getParentRoute: () => authRoute, path: '/shipments', component: lazyRouteComponent(() => import('./pages/Shipments.js')) });
const financeRoute = createRoute({ getParentRoute: () => authRoute, path: '/finance', component: lazyRouteComponent(() => import('./pages/Finance.js')) });
const maintenanceRoute = createRoute({ getParentRoute: () => authRoute, path: '/maintenance', component: lazyRouteComponent(() => import('./pages/Maintenance.js')) });
const fuelRoute = createRoute({ getParentRoute: () => authRoute, path: '/fuel', component: lazyRouteComponent(() => import('./pages/Fuel.js')) });
const claimsRoute = createRoute({ getParentRoute: () => authRoute, path: '/claims', component: lazyRouteComponent(() => import('./pages/Claims.js')) });
const shiftsRoute = createRoute({ getParentRoute: () => authRoute, path: '/shifts', component: lazyRouteComponent(() => import('./pages/Shifts.js')) });
const geofencesRoute = createRoute({ getParentRoute: () => authRoute, path: '/geofences', component: lazyRouteComponent(() => import('./pages/Geofences.js')) });
const riskIntelRoute = createRoute({ getParentRoute: () => authRoute, path: '/risk-intel', component: lazyRouteComponent(() => import('./pages/RiskIntel.js')) });
const rulesRoute = createRoute({ getParentRoute: () => authRoute, path: '/rules', component: lazyRouteComponent(() => import('./pages/Rules.js')) });
const fieldOfficersRoute = createRoute({ getParentRoute: () => authRoute, path: '/field-officers', component: lazyRouteComponent(() => import('./pages/FieldOfficers.js')) });
const executiveRoute = createRoute({ getParentRoute: () => authRoute, path: '/executive', component: lazyRouteComponent(() => import('./pages/Executive.js')) });
const devicesRoute = createRoute({ getParentRoute: () => authRoute, path: '/devices', component: lazyRouteComponent(() => import('./pages/Devices.js')) });
const guardianRoute = createRoute({ getParentRoute: () => authRoute, path: '/guardian', component: lazyRouteComponent(() => import('./pages/Guardian.js')) });
const knoxRemoteSessionRoute = createRoute({ getParentRoute: () => authRoute, path: '/guardian/devices/$deviceId/remote', component: lazyRouteComponent(() => import('./pages/KnoxRemoteSession.js')) });
const aiDecisionRoute = createRoute({ getParentRoute: () => authRoute, path: '/ai', component: lazyRouteComponent(() => import('./pages/AIDecision.js')) });
const copilotRoute = createRoute({ getParentRoute: () => authRoute, path: '/copilot', component: lazyRouteComponent(() => import('./pages/Copilot.js')) });
const settingsRoute = createRoute({ getParentRoute: () => authRoute, path: '/settings', component: lazyRouteComponent(() => import('./pages/Settings.js')) });
const routeAnalysisRoute = createRoute({ getParentRoute: () => authRoute, path: '/route-analysis', component: lazyRouteComponent(() => import('./pages/RouteAnalysis.js')) });
const cargoPortalRoute = createRoute({ getParentRoute: () => authRoute, path: '/cargo-portal', component: lazyRouteComponent(() => import('./pages/CargoPortal.js')) });
const portalViewRoute = createRoute({ getParentRoute: () => rootRoute, path: '/portal-view', component: lazyRouteComponent(() => import('./pages/PortalView.js')) });

// Portal client routes
const portalRootRoute = createRoute({ getParentRoute: () => rootRoute, id: 'portal-root', component: lazyRouteComponent(() => import('./pages/portal/PortalLayout.js')) });
const portalLoginRoute = createRoute({ getParentRoute: () => portalRootRoute, path: '/portal/login', component: lazyRouteComponent(() => import('./pages/portal/PortalLogin.js')) });
const portalVerifyRoute = createRoute({ getParentRoute: () => portalRootRoute, path: '/portal/verify', component: lazyRouteComponent(() => import('./pages/portal/PortalLogin.js')) });
const portalDashboardRoute = createRoute({ getParentRoute: () => portalRootRoute, path: '/portal/dashboard', component: lazyRouteComponent(() => import('./pages/portal/PortalDashboard.js')) });
const portalManifestRoute = createRoute({ getParentRoute: () => portalRootRoute, path: '/portal/convoy/$convoy_id/manifest', component: lazyRouteComponent(() => import('./pages/portal/PortalManifest.js')) });
const portalPODRoute = createRoute({ getParentRoute: () => portalRootRoute, path: '/portal/convoy/$convoy_id/pod', component: lazyRouteComponent(() => import('./pages/portal/PortalPOD.js')) });
const portalExceptionsRoute = createRoute({ getParentRoute: () => portalRootRoute, path: '/portal/convoy/$convoy_id/exceptions', component: lazyRouteComponent(() => import('./pages/portal/PortalExceptions.js')) });
const portalNotificationsRoute = createRoute({ getParentRoute: () => portalRootRoute, path: '/portal/notifications', component: lazyRouteComponent(() => import('./pages/portal/PortalNotifications.js')) });
const portalDocumentsRoute = createRoute({ getParentRoute: () => portalRootRoute, path: '/portal/convoy/$convoy_id/documents', component: lazyRouteComponent(() => import('./pages/portal/PortalDocuments.js')) });
const portalSensorsRoute = createRoute({ getParentRoute: () => portalRootRoute, path: '/portal/convoy/$convoy_id/sensors', component: lazyRouteComponent(() => import('./pages/portal/PortalSensors.js')) });
const portalReplayRoute = createRoute({ getParentRoute: () => portalRootRoute, path: '/portal/convoy/$convoy_id/replay', component: lazyRouteComponent(() => import('./pages/portal/PortalReplay.js')) });
const portalTrackRoute = createRoute({ getParentRoute: () => portalRootRoute, path: '/portal/convoy/$convoy_id/track', component: lazyRouteComponent(() => import('./pages/portal/PortalTrack.js')) });
const portalConvoyRoute = createRoute({ getParentRoute: () => portalRootRoute, path: '/portal/convoy/$convoy_id/convoy', component: lazyRouteComponent(() => import('./pages/portal/PortalConvoy.js')) });
const portalCustodyRoute = createRoute({ getParentRoute: () => portalRootRoute, path: '/portal/convoy/$convoy_id/custody', component: lazyRouteComponent(() => import('./pages/portal/PortalCustody.js')) });
const portalSecurityRoute = createRoute({ getParentRoute: () => portalRootRoute, path: '/portal/convoy/$convoy_id/security', component: lazyRouteComponent(() => import('./pages/portal/PortalSecurity.js')) });

const routeTree = rootRoute.addChildren([
  loginRoute,
  notFoundRoute,
  portalViewRoute,
  portalRootRoute.addChildren([
    portalLoginRoute, portalVerifyRoute, portalDashboardRoute, portalManifestRoute, portalPODRoute,
    portalExceptionsRoute, portalNotificationsRoute, portalDocumentsRoute,
    portalSensorsRoute, portalReplayRoute,
    portalTrackRoute, portalConvoyRoute, portalCustodyRoute, portalSecurityRoute,
  ]),
  authFullscreenRoute.addChildren([
    dashboardRoute, convoyReportsRoute,
  ]),
  authRoute.addChildren([
    fleetRoute, gpsRoute,
    convoysRoute, convoyNewRoute, convoyEditRoute,
    driversRoute, alertsRoute, incidentsRoute,
    incidentCenterRoute, panicCenterRoute, messagesRoute,
    analyticsRoute, reportsRoute, shipmentsRoute,
    financeRoute, maintenanceRoute, fuelRoute, claimsRoute, shiftsRoute, geofencesRoute,
    riskIntelRoute, rulesRoute, fieldOfficersRoute,
    executiveRoute, devicesRoute, guardianRoute, knoxRemoteSessionRoute,
    aiDecisionRoute, copilotRoute, settingsRoute, routeAnalysisRoute, cargoPortalRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}