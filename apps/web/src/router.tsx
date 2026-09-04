import { createRouter, createRoute, createRootRoute, Outlet, redirect, lazyRouteComponent } from '@tanstack/react-router';
import { useAuthStore, getAccessToken } from './stores/auth.js';
import AppShell from './components/layout/AppShell.js';
import GlobalPanicAlarm from './components/layout/GlobalPanicAlarm.js';
import { RootErrorComponent } from './components/ErrorBoundary.js';

const rootRoute = createRootRoute({ component: Outlet, errorComponent: RootErrorComponent });

// Preserves the page that triggered the redirect (via ?redirect=) so a
// dedicated shell (e.g. the Handover Capacitor app, pointed straight at
// /handover) lands back where it opened after login instead of the home
// launcher — LoginPage already reads and honors this param.
const authCheck = () => {
  if (!getAccessToken() && !useAuthStore.getState().user) {
    throw redirect({ to: '/login', search: { redirect: window.location.pathname + window.location.search } });
  }
};

// Every authenticated page wears the same chrome — AppShell provides the Rail
// (left), Topbar, mobile drawer + bottom nav. Dashboard-specific chrome
// (TacticalMap, EventsTicker, ThreatStrip, PanicAlarm, OpsSidebar) lives
// inside Dashboard.tsx itself, so there is exactly one sidebar system
// everywhere. See components/layout/AppShell.tsx.
const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'auth',
  beforeLoad: authCheck,
  component: AppShell,
});

// Authenticated routes that need an edge-to-edge viewport (no chrome). Used
// only for print/report-style pages that draw their own top nav. Still needs
// GlobalPanicAlarm — a panic must reach the operator even from here.
function FullscreenShell() {
  return (
    <>
      <GlobalPanicAlarm />
      <Outlet />
    </>
  );
}

const authFullscreenRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'auth-fullscreen',
  beforeLoad: authCheck,
  component: FullscreenShell,
});

const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: lazyRouteComponent(() => import('./pages/Login.js')) });
// Driver tracking activation. Hangs off rootRoute, not authRoute: the driver
// scanning this has no Sonalit account and must never reach operator chrome —
// the QR token in the path is the only credential involved.
const driverTrackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/t/$token',
  component: lazyRouteComponent(() => import('./pages/DriverTrack.js')),
});
const notFoundRoute = createRoute({ getParentRoute: () => rootRoute, path: '*', component: lazyRouteComponent(() => import('./pages/NotFound.js')) });

// ─── Public marketing site — the only crawlable surface ──────────────────────
// These hang off rootRoute with no auth check at all: sonalit.com/ and the
// service pages must render for an anonymous visitor (and for Googlebot).
// They are also prerendered to static HTML at build time (scripts/prerender.tsx),
// so a crawler or a social scraper that never runs our bundle still gets the
// full page and its metadata. Nothing here reads operational data.
const publicHomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  // A signed-in operator opening the site root wants the launcher, not the
  // marketing homepage — this preserves the pre-existing behaviour of "/" for
  // authenticated users (and for the Capacitor shell, which boots at "/").
  // Anonymous visitors, including crawlers, fall through to the public page.
  beforeLoad: () => {
    if (getAccessToken() || useAuthStore.getState().user) {
      throw redirect({ to: '/home' });
    }
  },
  component: lazyRouteComponent(() => import('./pages/public/Home.js')),
});
const publicFleetRoute = createRoute({ getParentRoute: () => rootRoute, path: '/fleet-management', component: lazyRouteComponent(() => import('./pages/public/FleetManagement.js')) });
const publicConvoyRoute = createRoute({ getParentRoute: () => rootRoute, path: '/convoy-management', component: lazyRouteComponent(() => import('./pages/public/ConvoyManagement.js')) });
const publicContainerRoute = createRoute({ getParentRoute: () => rootRoute, path: '/container-delivery', component: lazyRouteComponent(() => import('./pages/public/ContainerDelivery.js')) });
const publicSecurityRoute = createRoute({ getParentRoute: () => rootRoute, path: '/security-operations', component: lazyRouteComponent(() => import('./pages/public/SecurityOperations.js')) });
const publicAboutRoute = createRoute({ getParentRoute: () => rootRoute, path: '/about', component: lazyRouteComponent(() => import('./pages/public/About.js')) });
const publicContactRoute = createRoute({ getParentRoute: () => rootRoute, path: '/contact', component: lazyRouteComponent(() => import('./pages/public/Contact.js')) });

// The authenticated launcher is the immersive Orbit surface — a full-viewport
// globe + folder grid that replaces the rail. It lives under the fullscreen
// shell (no AppShell rail) but still gets GlobalPanicAlarm. It sits at /home
// rather than / because / is now the public marketing homepage; signing in and
// the in-app "home" affordances all land here. The former command console
// keeps its home at /command, reachable from the Command folder.
const orbitRoute = createRoute({ getParentRoute: () => authFullscreenRoute, path: '/home', component: lazyRouteComponent(() => import('./pages/Orbit.js')) });
const commandRoute = createRoute({ getParentRoute: () => authRoute, path: '/command', component: lazyRouteComponent(() => import('./pages/Dashboard.js')) });
const fleetRoute = createRoute({ getParentRoute: () => authRoute, path: '/fleet', component: lazyRouteComponent(() => import('./pages/Fleet.js')) });
const gpsRoute = createRoute({ getParentRoute: () => authRoute, path: '/gps', component: lazyRouteComponent(() => import('./pages/GPS.js')) });
const convoysRoute = createRoute({ getParentRoute: () => authRoute, path: '/convoys', component: lazyRouteComponent(() => import('./pages/Convoys.js')) });
// ─── Handover — dedicated shell, no operator chrome ─────────────────────────
// The Capacitor APK (io.sonalit.handover) loads /handover directly. It needs
// operator auth (email/password) but NOT the Topbar/APPS/LIVE chrome — those
// belong to the operator dashboard, not a single-purpose handover officer app.
// HandoverShell provides its own minimal header (branding + clock + logout).
const handoverLoginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/handover/login',
  component: lazyRouteComponent(() => import('./pages/HandoverLogin.js')),
});

const handoverAuthCheck = () => {
  if (!getAccessToken() && !useAuthStore.getState().user) {
    throw redirect({ to: '/handover/login' });
  }
};

const handoverShellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'handover-shell',
  beforeLoad: handoverAuthCheck,
  component: lazyRouteComponent(() => import('./pages/HandoverShell.js')),
});
const handoverRoute = createRoute({ getParentRoute: () => handoverShellRoute, path: '/handover', component: lazyRouteComponent(() => import('./pages/Handover.js')) });
const convoyNewRoute = createRoute({ getParentRoute: () => authRoute, path: '/convoys/new', component: lazyRouteComponent(() => import('./pages/CfoConvoyForm.js')) });
const convoyEditRoute = createRoute({ getParentRoute: () => authRoute, path: '/convoys/$id/edit', component: lazyRouteComponent(() => import('./pages/CfoConvoyForm.js')) });
const driversRoute = createRoute({ getParentRoute: () => authRoute, path: '/drivers', component: lazyRouteComponent(() => import('./pages/Drivers.js')) });
const alertsRoute = createRoute({ getParentRoute: () => authRoute, path: '/alerts', component: lazyRouteComponent(() => import('./pages/Alerts.js')) });
// Incidents and Incident Center were merged into the Alerts page (alerts and
// incidents are the same "something bad happened" concept split across two
// under-maintained tables/pages) — keep these as redirects so old links and
// nav bookmarks still land somewhere instead of 404ing.
const incidentsRoute = createRoute({ getParentRoute: () => authRoute, path: '/incidents', component: lazyRouteComponent(() => import('./pages/Incident.js')) });
const incidentCenterRoute = createRoute({ getParentRoute: () => authRoute, path: '/incident-center', beforeLoad: () => { throw redirect({ to: '/alerts' }); } });
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
const shiftsRoute = createRoute({ getParentRoute: () => authRoute, path: '/shifts', component: lazyRouteComponent(() => import('./pages/Shifts.js')) });
const claimsRoute = createRoute({ getParentRoute: () => authRoute, path: '/claims', component: lazyRouteComponent(() => import('./pages/Claims.js')) });
const geofencesRoute = createRoute({ getParentRoute: () => authRoute, path: '/geofences', component: lazyRouteComponent(() => import('./pages/Geofences.js')) });
const riskIntelRoute = createRoute({ getParentRoute: () => authRoute, path: '/risk-intel', component: lazyRouteComponent(() => import('./pages/RiskIntel.js')) });
const rulesRoute = createRoute({ getParentRoute: () => authRoute, path: '/rules', component: lazyRouteComponent(() => import('./pages/Rules.js')) });
const fieldOfficersRoute = createRoute({ getParentRoute: () => authRoute, path: '/field-officers', component: lazyRouteComponent(() => import('./pages/FieldOfficers.js')) });
const executiveRoute = createRoute({ getParentRoute: () => authRoute, path: '/executive', component: lazyRouteComponent(() => import('./pages/Executive.js')) });
const devicesRoute = createRoute({ getParentRoute: () => authRoute, path: '/devices', component: lazyRouteComponent(() => import('./pages/Devices.js')) });
const guardianRoute = createRoute({ getParentRoute: () => authRoute, path: '/guardian', component: lazyRouteComponent(() => import('./pages/Guardian.js')) });
const surveillanceRoute = createRoute({ getParentRoute: () => authRoute, path: '/surveillance', component: lazyRouteComponent(() => import('./pages/Surveillance.js')) });
const signalHealthRoute = createRoute({ getParentRoute: () => authRoute, path: '/signal-health', component: lazyRouteComponent(() => import('./pages/SignalHealth.js')) });
const corridorRoute = createRoute({ getParentRoute: () => authRoute, path: '/corridor', component: lazyRouteComponent(() => import('./pages/Corridor.js')) });
const driveReplayRoute = createRoute({ getParentRoute: () => authFullscreenRoute, path: '/drive', component: lazyRouteComponent(() => import('./pages/DriveReplay.js')) });
const replayRoute = createRoute({ getParentRoute: () => authRoute, path: '/replay', component: lazyRouteComponent(() => import('./pages/Replay.js')) });
const knoxRemoteSessionRoute = createRoute({ getParentRoute: () => authRoute, path: '/guardian/devices/$deviceId/remote', component: lazyRouteComponent(() => import('./pages/KnoxRemoteSession.js')) });
const aiDecisionRoute = createRoute({ getParentRoute: () => authRoute, path: '/ai', component: lazyRouteComponent(() => import('./pages/AIDecision.js')) });
const copilotRoute = createRoute({ getParentRoute: () => authRoute, path: '/copilot', component: lazyRouteComponent(() => import('./pages/Copilot.js')) });
const settingsRoute = createRoute({ getParentRoute: () => authRoute, path: '/settings', component: lazyRouteComponent(() => import('./pages/Settings.js')) });
const routeAnalysisRoute = createRoute({ getParentRoute: () => authRoute, path: '/route-analysis', component: lazyRouteComponent(() => import('./pages/RouteAnalysis.js')) });
const cargoPortalRoute = createRoute({ getParentRoute: () => authRoute, path: '/cargo-portal', component: lazyRouteComponent(() => import('./pages/CargoPortal.js')) });
const portalViewRoute = createRoute({ getParentRoute: () => rootRoute, path: '/portal-view', component: lazyRouteComponent(() => import('./pages/PortalView.js')) });

// ─── Container Delivery System — fullscreen with its own rail + chrome ────────
const cdsDashRoute = createRoute({ getParentRoute: () => authFullscreenRoute, path: '/cds', component: lazyRouteComponent(() => import('./pages/cds/CDSDashboard.js')) });

// ─── CDS Field ops (Yard/Port teams — mobile / APK) ───────────────────────────
// A separate application that happens to ship in the same bundle. It hangs off
// the router ROOT, not authRoute/authFullscreenRoute, because it has its own
// login system: device pairing plus a per-worker PIN, with tokens that are
// neither the operator JWT nor a cookie (see pages/field/fieldAuth.ts and
// backend/src/routes/field.js). Putting it under authCheck would have meant a
// yard tablet needed an operator session to open — the exact coupling the
// separate login exists to remove.
//
// FieldShell does the gating: it boots the device/session credentials, shows
// the pairing or PIN screen when they are missing, and role-checks
// /field/yard vs /field/port before mounting either.
const fieldRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'field',
  component: lazyRouteComponent(() => import('./pages/field/FieldShell.js')),
});

const fieldHomeRoute = createRoute({ getParentRoute: () => fieldRoute, path: '/field', component: lazyRouteComponent(() => import('./pages/field/FieldHome.js')) });
const fieldYardRoute = createRoute({ getParentRoute: () => fieldRoute, path: '/field/yard', component: lazyRouteComponent(() => import('./pages/field/YardApp.js')) });
const fieldPortRoute = createRoute({ getParentRoute: () => fieldRoute, path: '/field/port', component: lazyRouteComponent(() => import('./pages/field/PortApp.js')) });
const fieldResponseRoute = createRoute({ getParentRoute: () => fieldRoute, path: '/field/response', component: lazyRouteComponent(() => import('./pages/field/ResponseCrewApp.js')) });
const fieldDeparturesRoute = createRoute({ getParentRoute: () => fieldRoute, path: '/field/departures', component: lazyRouteComponent(() => import('./pages/field/DeparturesApp.js')) });

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
  publicHomeRoute,
  publicFleetRoute,
  publicConvoyRoute,
  publicContainerRoute,
  publicSecurityRoute,
  publicAboutRoute,
  publicContactRoute,
  loginRoute,
  driverTrackRoute,
  notFoundRoute,
  portalViewRoute,
  portalRootRoute.addChildren([
    portalLoginRoute, portalVerifyRoute, portalDashboardRoute, portalManifestRoute, portalPODRoute,
    portalExceptionsRoute, portalNotificationsRoute, portalDocumentsRoute,
    portalSensorsRoute, portalReplayRoute,
    portalTrackRoute, portalConvoyRoute, portalCustodyRoute, portalSecurityRoute,
  ]),
  fieldRoute.addChildren([fieldHomeRoute, fieldYardRoute, fieldPortRoute, fieldResponseRoute, fieldDeparturesRoute]),
  handoverLoginRoute,
  handoverShellRoute.addChildren([handoverRoute]),
  authFullscreenRoute.addChildren([
    orbitRoute,
    convoyReportsRoute,
    driveReplayRoute,
    cdsDashRoute,
  ]),
  authRoute.addChildren([
    commandRoute,
    fleetRoute, gpsRoute,
    convoysRoute, convoyNewRoute, convoyEditRoute,
    driversRoute, alertsRoute, incidentsRoute,
    incidentCenterRoute, panicCenterRoute, messagesRoute,
    analyticsRoute, reportsRoute, shipmentsRoute,
    financeRoute, maintenanceRoute, fuelRoute, shiftsRoute, claimsRoute, geofencesRoute,
    riskIntelRoute, rulesRoute, fieldOfficersRoute,
    executiveRoute, devicesRoute, guardianRoute, knoxRemoteSessionRoute,
    aiDecisionRoute, copilotRoute, settingsRoute, routeAnalysisRoute, cargoPortalRoute,
    surveillanceRoute, replayRoute, signalHealthRoute, corridorRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}