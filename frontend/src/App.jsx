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
import { Suspense } from 'react';
import React from 'react';
const GPSPage = React.lazy(() => import('./pages/GPSPage'));

function PrivateLayout({ children }) {
  const { token } = useAuthStore();
  if (!token) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<PrivateLayout><DashboardPage /></PrivateLayout>} />
        <Route path="/fleet" element={<PrivateLayout><FleetPage /></PrivateLayout>} />
        <Route path="/convoys" element={<PrivateLayout><ConvoysPage /></PrivateLayout>} />
        <Route path="/alerts" element={<PrivateLayout><AlertsPage /></PrivateLayout>} />
        <Route path="/analytics" element={<PrivateLayout><AnalyticsPage /></PrivateLayout>} />
        <Route path="/messages" element={<PrivateLayout><MessagesPage /></PrivateLayout>} />
        <Route path="/settings" element={<PrivateLayout><SettingsPage /></PrivateLayout>} />
        <Route path="/incidents" element={<PrivateLayout><IncidentsPage /></PrivateLayout>} />
        <Route path="/devices" element={<PrivateLayout><DevicesPage /></PrivateLayout>} />
        <Route path="/rules" element={<PrivateLayout><RulesPage /></PrivateLayout>} />
        <Route path="/gps" element={<PrivateLayout><Suspense fallback={<div/>}><GPSPage /></Suspense></PrivateLayout>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
