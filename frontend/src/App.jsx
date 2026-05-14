import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect, Suspense, lazy, Component } from 'react';
import { Toaster } from 'react-hot-toast';
import { useAuthStore } from './store';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import { registerServiceWorker } from './services/offline';
import socketService from './services/socket';
import LoginPage from './pages/LoginPage';

// A page is a separate hashed chunk. After a redeploy, an already-open tab
// holds stale chunk hashes — navigating to a page then fails to fetch its
// chunk and the lazy import throws. lazyWithReload catches that and does a
// one-time full reload to pull the fresh index.html + current hashes.
// The 60s window stops a genuinely-broken chunk from looping — after one
// reload it falls through to the error boundary instead.
function lazyWithReload(factory) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (err) {
      const last = Number(sessionStorage.getItem('chunkReloadAt') || 0);
      if (Date.now() - last > 60000) {
        sessionStorage.setItem('chunkReloadAt', String(Date.now()));
        window.location.reload();
        return new Promise(() => {}); // hang until the reload takes over
      }
      throw err;
    }
  });
}

const DashboardPage  = lazyWithReload(() => import('./pages/DashboardPage'));
const FleetPage      = lazyWithReload(() => import('./pages/FleetPage'));
const ConvoysPage    = lazyWithReload(() => import('./pages/ConvoysPage'));
const GPSPage        = lazyWithReload(() => import('./pages/GPSPage'));
const AlertsPage     = lazyWithReload(() => import('./pages/AlertsPage'));
const IncidentsPage  = lazyWithReload(() => import('./pages/IncidentsPage'));
const AnalyticsPage  = lazyWithReload(() => import('./pages/AnalyticsPage'));
const ReportsPage    = lazyWithReload(() => import('./pages/ReportsPage'));
const MessagesPage   = lazyWithReload(() => import('./pages/MessagesPage'));
const SettingsPage   = lazyWithReload(() => import('./pages/SettingsPage'));
const DevicesPage    = lazyWithReload(() => import('./pages/DevicesPage'));
const RulesPage      = lazyWithReload(() => import('./pages/RulesPage'));
const ShipmentsPage  = lazyWithReload(() => import('./pages/ShipmentsPage'));
const DriversPage    = lazyWithReload(() => import('./pages/DriversPage'));
const FinancePage    = lazyWithReload(() => import('./pages/FinancePage'));
const MaintenancePage= lazyWithReload(() => import('./pages/MaintenancePage'));

const Loader = () => (
  <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',background:'#080C14'}}>
    <div style={{width:40,height:40,border:'2px solid rgba(240,180,41,0.2)',borderTopColor:'#F0B429',borderRadius:'50%',animation:'spin 1s linear infinite'}} />
  </div>
);

// Catches render errors in a page so one broken page shows a contained
// message instead of white-screening the whole app.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'60vh', padding:24, fontFamily:'monospace' }}>
        <div style={{ maxWidth:480, textAlign:'center', background:'rgba(239,68,68,0.06)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:14, padding:'28px 32px' }}>
          <div style={{ fontSize:28, marginBottom:8 }}>⚠</div>
          <h2 style={{ color:'#ef4444', fontSize:14, letterSpacing:2, margin:'0 0 8px' }}>PAGE ERROR</h2>
          <p style={{ color:'#94a3b8', fontSize:12, lineHeight:1.6, margin:'0 0 16px' }}>
            Something went wrong rendering this page. The rest of the app still works — use the sidebar to go elsewhere.
          </p>
          <pre style={{ background:'rgba(0,0,0,0.3)', border:'1px solid rgba(255,255,255,0.06)', borderRadius:8, padding:'10px 12px', fontSize:11, color:'#f87171', textAlign:'left', overflow:'auto', maxHeight:120, margin:'0 0 16px' }}>
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <button onClick={() => window.location.reload()} style={{ background:'#F0B429', color:'#0A0F1A', border:'none', borderRadius:8, padding:'8px 20px', fontSize:12, fontWeight:700, cursor:'pointer', letterSpacing:1 }}>
            RELOAD
          </button>
        </div>
      </div>
    );
  }
}

function RequireAuth({ children }) {
  const location = useLocation();
  return (
    <ProtectedRoute>
      <Layout>
        {/* key on pathname → boundary resets when navigating to another page */}
        <ErrorBoundary key={location.pathname}>
          <Suspense fallback={<Loader />}>{children}</Suspense>
        </ErrorBoundary>
      </Layout>
    </ProtectedRoute>
  );
}

export default function App() {
  const { token, fetchMe } = useAuthStore();
  useEffect(() => { registerServiceWorker(); }, []);
  useEffect(() => {
    if (token) { fetchMe(); socketService.connect(); }
  }, [token, fetchMe]);

  return (
    <BrowserRouter>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#0D1321',
            color: '#e2e8f0',
            border: '1px solid rgba(255,255,255,0.08)',
            fontFamily: 'Space Grotesk, sans-serif',
            fontSize: 13,
            borderRadius: 10,
          },
          success: { iconTheme: { primary: '#22D3A0', secondary: '#0D1321' } },
          error:   { iconTheme: { primary: '#F25252', secondary: '#0D1321' } },
        }}
      />
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
