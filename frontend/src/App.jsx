import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, Suspense, lazy } from 'react';
import { useAuthStore } from './store';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import { registerServiceWorker } from './services/offline';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import FleetPage from './pages/FleetPage';
import ConvoysPage from './pages/ConvoysPage';
import AlertsPage from './pages/AlertsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import MessagesPage from './pages/MessagesPage';
import SettingsPage from './pages/SettingsPage';
import IncidentsPage from './pages/IncidentsPage';
import DevicesPage from './pages/DevicesPage';
import RulesPage from './pages/RulesPage';
import ReportsPage from './pages/ReportsPage';

const GPSPage = lazy(() => import('./pages/GPSPage'));

function RequireAuth({ children }) {
  return (
    <ProtectedRoute>
      <Layout>{children}</Layout>
    </ProtectedRoute>
  );
}

const Loader = () => (
  <div className="flex items-center justify-center h-full">
    <div className="w-10 h-10 border-2 border-gold/20 border-t-gold rounded-full animate-spin" />
  </div>
);

export default function App() {
  const { token, fetchMe } = useAuthStore();

  useEffect(() => {
    if (token) fetchMe();
    registerServiceWorker();
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login"      element={<LoginPage />} />
        <Route path="/"           element={<RequireAuth><DashboardPage /></RequireAuth>} />
        <Route path="/fleet"      element={<RequireAuth><FleetPage /></RequireAuth>} />
        <Route path="/convoys"    element={<RequireAuth><ConvoysPage /></RequireAuth>} />
        <Route path="/alerts"     element={<RequireAuth><AlertsPage /></RequireAuth>} />
        <Route path="/analytics"  element={<RequireAuth><AnalyticsPage /></RequireAuth>} />
        <Route path="/messages"   element={<RequireAuth><MessagesPage /></RequireAuth>} />
        <Route path="/settings"   element={<RequireAuth><SettingsPage /></RequireAuth>} />
        <Route path="/incidents"  element={<RequireAuth><IncidentsPage /></RequireAuth>} />
        <Route path="/devices"    element={<RequireAuth><DevicesPage /></RequireAuth>} />
        <Route path="/rules"      element={<RequireAuth><RulesPage /></RequireAuth>} />
        <Route path="/reports"    element={<RequireAuth><ReportsPage /></RequireAuth>} />
        <Route path="/gps"        element={
          <RequireAuth>
            <Suspense fallback={<Loader />}><GPSPage /></Suspense>
          </RequireAuth>
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
