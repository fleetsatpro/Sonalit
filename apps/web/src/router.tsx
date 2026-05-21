import { createRouter, createRoute, createRootRoute, Outlet, redirect } from '@tanstack/react-router';
import { useAuthStore, getAccessToken } from './stores/auth.js';
import Layout from './components/Layout.js';
import { RootErrorComponent } from './components/ErrorBoundary.js';
import LoginPage from './pages/Login.js';
import DashboardPage from './pages/Dashboard.js';
import FleetPage from './pages/Fleet.js';
import GPSPage from './pages/GPS.js';
import ConvoysPage from './pages/Convoys.js';
import CfoConvoyFormPage from './pages/CfoConvoyForm.js';
import DriversPage from './pages/Drivers.js';
import AlertsPage from './pages/Alerts.js';
import IncidentsPage from './pages/Incidents.js';
import IncidentCenterPage from './pages/IncidentCenter.js';
import PanicCenterPage from './pages/PanicCenter.js';
import MessagesPage from './pages/Messages.js';
import AnalyticsPage from './pages/Analytics.js';
import ReportsPage from './pages/Reports.js';
import ShipmentsPage from './pages/Shipments.js';
import FinancePage from './pages/Finance.js';
import MaintenancePage from './pages/Maintenance.js';
import GeofencesPage from './pages/Geofences.js';
import RiskIntelPage from './pages/RiskIntel.js';
import RulesPage from './pages/Rules.js';
import FieldOfficersPage from './pages/FieldOfficers.js';
import ExecutivePage from './pages/Executive.js';
import DevicesPage from './pages/Devices.js';
import GuardianPage from './pages/Guardian.js';
import AIDecisionPage from './pages/AIDecision.js';
import CopilotPage from './pages/Copilot.js';
import SettingsPage from './pages/Settings.js';

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
const dashboardRoute = createRoute({ getParentRoute: () => authRoute, path: '/', component: DashboardPage });
const fleetRoute = createRoute({ getParentRoute: () => authRoute, path: '/fleet', component: FleetPage });
const gpsRoute = createRoute({ getParentRoute: () => authRoute, path: '/gps', component: GPSPage });
const convoysRoute = createRoute({ getParentRoute: () => authRoute, path: '/convoys', component: ConvoysPage });
const convoyNewRoute = createRoute({ getParentRoute: () => authRoute, path: '/convoys/new', component: CfoConvoyFormPage });
const convoyEditRoute = createRoute({ getParentRoute: () => authRoute, path: '/convoys/$id/edit', component: CfoConvoyFormPage });
const driversRoute = createRoute({ getParentRoute: () => authRoute, path: '/drivers', component: DriversPage });
const alertsRoute = createRoute({ getParentRoute: () => authRoute, path: '/alerts', component: AlertsPage });
const incidentsRoute = createRoute({ getParentRoute: () => authRoute, path: '/incidents', component: IncidentsPage });
const incidentCenterRoute = createRoute({ getParentRoute: () => authRoute, path: '/incident-center', component: IncidentCenterPage });
const panicCenterRoute = createRoute({ getParentRoute: () => authRoute, path: '/panic-center', component: PanicCenterPage });
const messagesRoute = createRoute({ getParentRoute: () => authRoute, path: '/messages', component: MessagesPage });
const analyticsRoute = createRoute({ getParentRoute: () => authRoute, path: '/analytics', component: AnalyticsPage });
const reportsRoute = createRoute({ getParentRoute: () => authRoute, path: '/reports', component: ReportsPage });
const shipmentsRoute = createRoute({ getParentRoute: () => authRoute, path: '/shipments', component: ShipmentsPage });
const financeRoute = createRoute({ getParentRoute: () => authRoute, path: '/finance', component: FinancePage });
const maintenanceRoute = createRoute({ getParentRoute: () => authRoute, path: '/maintenance', component: MaintenancePage });
const geofencesRoute = createRoute({ getParentRoute: () => authRoute, path: '/geofences', component: GeofencesPage });
const riskIntelRoute = createRoute({ getParentRoute: () => authRoute, path: '/risk-intel', component: RiskIntelPage });
const rulesRoute = createRoute({ getParentRoute: () => authRoute, path: '/rules', component: RulesPage });
const fieldOfficersRoute = createRoute({ getParentRoute: () => authRoute, path: '/field-officers', component: FieldOfficersPage });
const executiveRoute = createRoute({ getParentRoute: () => authRoute, path: '/executive', component: ExecutivePage });
const devicesRoute = createRoute({ getParentRoute: () => authRoute, path: '/devices', component: DevicesPage });
const guardianRoute = createRoute({ getParentRoute: () => authRoute, path: '/guardian', component: GuardianPage });
const aiDecisionRoute = createRoute({ getParentRoute: () => authRoute, path: '/ai', component: AIDecisionPage });
const copilotRoute = createRoute({ getParentRoute: () => authRoute, path: '/copilot', component: CopilotPage });
const settingsRoute = createRoute({ getParentRoute: () => authRoute, path: '/settings', component: SettingsPage });

const routeTree = rootRoute.addChildren([
  loginRoute,
  authRoute.addChildren([
    dashboardRoute, fleetRoute, gpsRoute,
    convoysRoute, convoyNewRoute, convoyEditRoute,
    driversRoute, alertsRoute, incidentsRoute,
    incidentCenterRoute, panicCenterRoute, messagesRoute,
    analyticsRoute, reportsRoute, shipmentsRoute,
    financeRoute, maintenanceRoute, geofencesRoute,
    riskIntelRoute, rulesRoute, fieldOfficersRoute,
    executiveRoute, devicesRoute, guardianRoute,
    aiDecisionRoute, copilotRoute, settingsRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}
