import { Routes, Route, Navigate } from 'react-router-dom';
import AlertsPage from './pages/AlertsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import ConvoysPage from './pages/ConvoysPage';
import DashboardPage from './pages/DashboardPage';
import DevicesPage from './pages/DevicesPage';
import FleetPage from './pages/FleetPage';
import GPSPage from './pages/GPSPage';
import IncidentsPage from './pages/IncidentsPage';
import LoginPage from './pages/LoginPage';
import MessagesPage from './pages/MessagesPage';
import RulesPage from './pages/RulesPage';
import SettingsPage from './pages/SettingsPage';

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/fleet" element={<FleetPage />} />
      <Route path="/gps" element={<GPSPage />} />
      <Route path="/alerts" element={<AlertsPage />} />
      <Route path="/analytics" element={<AnalyticsPage />} />
      <Route path="/convoys" element={<ConvoysPage />} />
      <Route path="/devices" element={<DevicesPage />} />
      <Route path="/incidents" element={<IncidentsPage />} />
      <Route path="/messages" element={<MessagesPage />} />
      <Route path="/rules" element={<RulesPage />} />
      <Route path="/settings" element={<SettingsPage />} />
    </Routes>
  );
}
