import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, Suspense, lazy } from 'react';
import { Toaster } from 'react-hot-toast';
import { useAuthStore } from './store';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import { registerServiceWorker } from './services/offline';

// Eager-loaded core pages
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';

// Lazy-loaded pages
const FleetPage       = lazy(() => import('./pages/FleetPage'));
const ConvoysPage     = lazy(() => import('./pages/ConvoysPage'));
const GPSPage         = lazy(() => import('./pages/GPSPage'));
const AlertsPage      = lazy(() => import('./pages/AlertsPage'));
const IncidentsPage   = lazy(() => import('./pages/IncidentsPage'));
const AnalyticsPage   = lazy(() => import('./pages/AnalyticsPage'));
const ReportsPage     = lazy(() => import('./pages/ReportsPage'));
const MessagesPage    = lazy(() => import('./pages/MessagesPage'));
const SettingsPage    = lazy(() => import('./pages/SettingsPage'));
const DevicesPage     = lazy(() => import('./pages/DevicesPage'));
const RulesPage       = lazy(() => import('./pages/RulesPage'));
const ShipmentsPage   = lazy(() => import('./pages/ShipmentsPage'));
const DriversPage     = lazy(() => import('./pages/DriversPage'));
const FinancePage     = lazy(() => import('./pages/FinancePage'));
const MaintenancePage = lazy(() => import('./pages/MaintenancePage'));

const Loader = () => (
  <div className="flex items-center justify-center h-full">
    <div className="w-10 h-10 border-2 border-gold/20 border-t-gold rounded-full animate-spin" />
  </div>
);

function RequireAuth({ children }) {
  return (
    <ProtectedRoute>
      <Layout>
        <Suspense fallback={<Loader />}>{children}</Suspense>
      </Layout>
    </ProtectedRoute>
  );
}

export default function App() {
  const { token, fetchMe } = useAuthStore();
  useEffect(() => {
    if (token) fetchMe();
    registerServiceWorker();
  }, []);

  return (
    <BrowserRouter>
      <Toaster position="top-right" toastOptions={{
        style: { background:'#0D1321', color:'#e2e8f0', border:'1px solid rgba(255,255,255,0.08)', fontFamily:'Space Grotesk,sans-serif', fontSize:13 },
        success: { iconTheme: { primary:'#22D3A0', secondary:'#0D1321' } },
        error: { iconTheme: { primary:'#F25252', secondary:'#0D1321' } },
      }} />
      <Routes>
        <Route path="/login"       element={<LoginPage />} />
        <Route path="/"            element={<RequireAuth><DashboardPage /></RequireAuth>} />
        <Route path="/fleet"       element={<RequireAuth><FleetPage /></RequireAuth>} />
        <Route path="/convoys"     element={<RequireAuth><ConvoysPage /></RequireAuth>} />
        <Route path="/shipments"   element={<RequireAuth><ShipmentsPage /></RequireAuth>} />
        <Route path="/drivers"     element={<RequireAuth><DriversPage /></RequireAuth>} />
        <Route path="/gps"         element={<RequireAuth><GPSPage /></RequireAuth>} />
        <Route path="/alerts"      element={<RequireAuth><AlertsPage /></RequireAuth>} />
        <Route path="/incidents"   element={<RequireAuth><IncidentsPage /></RequireAuth>} />
        <Route path="/analytics"   element={<RequireAuth><AnalyticsPage /></RequireAuth>} />
        <Route path="/reports"     element={<RequireAuth><ReportsPage /></RequireAuth>} />
        <Route path="/maintenance" element={<RequireAuth><MaintenancePage /></RequireAuth>} />
        <Route path="/finance"     element={<RequireAuth><FinancePage /></RequireAuth>} />
        <Route path="/devices"     element={<RequireAuth><DevicesPage /></RequireAuth>} />
        <Route path="/rules"       element={<RequireAuth><RulesPage /></RequireAuth>} />
        <Route path="/messages"    element={<RequireAuth><MessagesPage /></RequireAuth>} />
        <Route path="/settings"    element={<RequireAuth><SettingsPage /></RequireAuth>} />
        <Route path="*"            element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
