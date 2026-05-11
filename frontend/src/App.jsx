import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store';
import Layout from './components/Layout';
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
import React, { Suspense } from 'react';
const GPSPage = React.lazy(() => import('./pages/GPSPage'));

function RequireAuth({ children }) {
  const { token } = useAuthStore();
  if (!token) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<RequireAuth><DashboardPage /></RequireAuth>} />
        <Route path="/fleet" element={<RequireAuth><FleetPage /></RequireAuth>} />
        <Route path="/convoys" element={<RequireAuth><ConvoysPage /></RequireAuth>} />
        <Route path="/alerts" element={<RequireAuth><AlertsPage /></RequireAuth>} />
        <Route path="/analytics" element={<RequireAuth><AnalyticsPage /></RequireAuth>} />
        <Route path="/messages" element={<RequireAuth><MessagesPage /></RequireAuth>} />
        <Route path="/settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
        <Route path="/incidents" element={<RequireAuth><IncidentsPage /></RequireAuth>} />
        <Route path="/devices" element={<RequireAuth><DevicesPage /></RequireAuth>} />
        <Route path="/rules" element={<RequireAuth><RulesPage /></RequireAuth>} />
        <Route path="/gps" element={<RequireAuth><Suspense fallback={<div/>}><GPSPage /></Suspense></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
