
import React, { useEffect, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
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
import { Component } from 'react';

const GPSPage = React.lazy(() => import('./pages/GPSPage'));
const Fallback = () => <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-gold/20 border-t-gold rounded-full animate-spin"/></div>;

class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) return (
      <div className="flex flex-col items-center justify-center h-screen bg-navy-950 text-center px-6">
        <p className="font-display text-gold text-xl mb-3">Something went wrong</p>
        <p className="text-slate-400 text-sm mb-6 max-w-md">{this.state.error.message}</p>
        <button onClick={()=>{this.setState({error:null});window.location.reload();}} className="px-5 py-2 bg-gold text-navy-950 rounded-lg font-medium text-sm">Reload</button>
      </div>
    );
    return this.props.children;
  }
}

function AppRoutes() {
  const { token, fetchMe } = useAuthStore();
  useEffect(() => { if (token) fetchMe(); }, [token]);
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/*" element={
        <ProtectedRoute>
          <Layout>
            <ErrorBoundary>
              <Routes>
                <Route path="/"           element={<DashboardPage />} />
                <Route path="/fleet"      element={<FleetPage />} />
                <Route path="/convoys"    element={<ConvoysPage />} />
                <Route path="/alerts"     element={<AlertsPage />} />
                <Route path="/analytics"  element={<AnalyticsPage />} />
                <Route path="/messages"   element={<MessagesPage />} />
                <Route path="/settings"   element={<SettingsPage />} />
                <Route path="/incidents"  element={<IncidentsPage />} />
                <Route path="/devices"    element={<DevicesPage />} />
                <Route path="/rules"      element={<RulesPage />} />
                <Route path="/gps"        element={<Suspense fallback={<Fallback/>}><GPSPage/></Suspense>} />
                <Route path="*"           element={<Navigate to="/" replace />} />
              </Routes>
            </ErrorBoundary>
          </Layout>
        </ProtectedRoute>
      } />
    </Routes>
  );
}

export default function App() { return <BrowserRouter><AppRoutes /></BrowserRouter>; }
