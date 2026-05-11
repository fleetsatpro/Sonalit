import { BrowserRouter, Routes, Route } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import FleetPage from './pages/FleetPage';
import AlertsPage from './pages/AlertsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import GPSPage from './pages/GPSPage';
import ConvoysPage from './pages/ConvoysPage';
import DevicesPage from './pages/DevicesPage';
import IncidentsPage from './pages/IncidentsPage';
import MessagesPage from './pages/MessagesPage';
import RulesPage from './pages/RulesPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<DashboardPage />} />
      </Routes>
    </BrowserRouter>
  );
}
