import { useState, useEffect } from 'react';
import { Link } from '@tanstack/react-router';
import {
  LayoutDashboard, MapPin, Package, FileText, Lock, Users, Truck,
  Anchor, Activity, MessageSquare, DollarSign, FileBarChart,
  BarChart2, Settings, Search, Bell,
  type LucideIcon,
} from 'lucide-react';
import { KPICard, CDSDrawer, CDSToastContainer } from './components.js';
import { useDashboardKPIs, useActivity, useTrips } from './hooks.js';
import { useCDSStore, type CDSView } from './store.js';
import { CDS_VIEWS } from './constants.js';
import { ContainersView, BookingsView, DriversView, TransportersView } from './CDSDataPage.js';
import {
  LocksView, PortView, PulseView, InboxView,
  BillingView, ReportsView, AnalyticsView, SettingsView,
} from './pages.js';

const VIEW_ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard, live: MapPin, containers: Package,
  bookings: FileText, locks: Lock, drivers: Users, transporters: Truck,
  port: Anchor, pulse: Activity, inbox: MessageSquare, billing: DollarSign,
  reports: FileBarChart, analytics: BarChart2, settings: Settings,
};

const gold = '#F0B429';
const goldDim = 'rgba(240,180,41,.12)';
const ink = '#0c0e12';
const rim = 'rgba(255,255,255,.06)';

export default function CDSApp() {
  const { activeView, setActiveView } = useCDSStore();
  const [clock, setClock] = useState('');

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('en-GB', { hour12: false }) + ' EAT');
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const currentView = CDS_VIEWS.find(v => v.id === activeView);

  return (
    <div style={{ display: 'flex', height: '100dvh', background: ink }}>
      <nav style={{
        width: 72, flexShrink: 0, background: '#0a0c10',
        borderRight: `1px solid ${rim}`, display: 'flex',
        flexDirection: 'column', overflowY: 'auto', scrollbarWidth: 'none',
      }}>
        <Link to="/" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: 56, borderBottom: `1px solid ${rim}`, textDecoration: 'none',
        }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: `linear-gradient(135deg, ${gold}, #ff7a00)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 900, fontSize: 15, color: ink,
          }}>S</div>
        </Link>
        <div style={{ flex: 1, padding: '8px 0' }}>
          {CDS_VIEWS.map(v => {
            const Icon = VIEW_ICONS[v.id];
            const active = activeView === v.id;
            return (
              <button
                key={v.id}
                onClick={() => setActiveView(v.id as CDSView)}
                title={v.label}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: '100%', height: 44, padding: 0,
                  background: active ? goldDim : 'transparent',
                  border: 'none',
                  borderLeft: active ? `3px solid ${gold}` : '3px solid transparent',
                  color: active ? gold : 'rgba(255,255,255,.4)',
                  cursor: 'pointer', transition: 'all .15s',
                }}
              >
                {Icon && <Icon size={18} strokeWidth={active ? 2.2 : 1.5} />}
              </button>
            );
          })}
        </div>
      </nav>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header style={{
          height: 52, flexShrink: 0,
          background: 'rgba(12,14,18,.95)', backdropFilter: 'blur(20px)',
          borderBottom: `1px solid ${rim}`,
          display: 'flex', alignItems: 'center', padding: '0 20px', gap: 16,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#fff' }}>
              {currentView?.label ?? 'Dashboard'}
            </div>
            <div style={{
              fontSize: 10, fontFamily: 'monospace',
              letterSpacing: '.08em', color: 'rgba(255,255,255,.35)', marginTop: 1,
            }}>{currentView?.sub ?? ''}</div>
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.07)',
            borderRadius: 8, padding: '0 10px', height: 32,
          }}>
            <Search size={13} color="rgba(255,255,255,.35)" />
            <input placeholder="Search or AI command…" style={{
              background: 'transparent', border: 'none', outline: 'none',
              color: '#fff', fontSize: 12, width: 200,
            }} />
          </div>
          <div style={{
            fontFamily: 'monospace', fontSize: 12,
            color: 'rgba(255,255,255,.5)', letterSpacing: '.06em',
          }}>{clock}</div>
          <button style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'rgba(255,255,255,.04)', border: `1px solid ${rim}`,
            color: 'rgba(255,255,255,.5)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Bell size={15} />
          </button>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain' }}>
          {activeView === 'dashboard' && <DashboardView />}
          {activeView === 'live' && <LiveView />}
          {activeView === 'containers' && <ContainersView />}
          {activeView === 'bookings' && <BookingsView />}
          {activeView === 'locks' && <LocksView />}
          {activeView === 'drivers' && <DriversView />}
          {activeView === 'transporters' && <TransportersView />}
          {activeView === 'port' && <PortView />}
          {activeView === 'pulse' && <PulseView />}
          {activeView === 'inbox' && <InboxView />}
          {activeView === 'billing' && <BillingView />}
          {activeView === 'reports' && <ReportsView />}
          {activeView === 'analytics' && <AnalyticsView />}
          {activeView === 'settings' && <SettingsView />}
        </div>
      </div>

      <CDSDrawer />
      <CDSToastContainer />
    </div>
  );
}

function DashboardView() {
  const { data: kpis, isLoading } = useDashboardKPIs();
  const { data: activity } = useActivity(20);
  if (isLoading) return <LoadingState />;

  const cards = [
    { label: 'ACTIVE CONTAINERS', value: String(kpis?.['active_containers'] ?? 0), delta: 'fleet capacity', trend: 'up' as const },
    { label: 'IN TRANSIT', value: String(kpis?.['in_transit'] ?? 0), delta: 'on the road', trend: 'up' as const },
    { label: 'DELIVERED TODAY', value: String(kpis?.['delivered_today'] ?? 0), delta: 'completed', trend: 'up' as const },
    { label: 'ACTIVE LOCKS', value: String(kpis?.['active_locks'] ?? 0), delta: 'deployed', trend: 'up' as const },
    { label: 'DELAYED', value: String(kpis?.['delayed_trips'] ?? 0), delta: 'needs attention', trend: 'down' as const },
    { label: 'AVG TRANSIT', value: `${kpis?.['avg_transit_hours'] ?? 0}h`, delta: 'hours average', trend: 'up' as const },
  ];

  const actIcons: Record<string, string> = {
    clamp: '\u{1F512}', depart: '\u{1F69B}', checkpoint: '\u{1F4CD}', sync: '\u{1F504}',
    arrival: '✅', unclamp: '\u{1F513}', ai: '\u{1F916}', alert: '⚠️',
  };

  return (
    <div className="p-5 max-w-[1600px] mx-auto">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        {cards.map(k => <KPICard key={k.label} {...k} />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-2xl border border-[rgba(255,255,255,.07)] bg-[rgba(255,255,255,.02)] p-4">
          <div className="font-bold text-sm text-text-0 mb-3">Live Map</div>
          <div className="h-[300px] rounded-xl bg-ink-3 flex items-center justify-center text-text-2 text-xs font-mono">
            Map integration — GPS feed renders here
          </div>
        </div>
        <div className="rounded-2xl border border-[rgba(255,255,255,.07)] bg-[rgba(255,255,255,.02)] p-4">
          <div className="font-bold text-sm text-text-0 mb-3">Recent Activity</div>
          <div className="space-y-0 max-h-[340px] overflow-y-auto">
            {(activity ?? []).map((item, i) => (
              <div key={String(item['id'] ?? i)} className="flex items-start gap-2.5 py-2 border-b border-[rgba(255,255,255,.05)]">
                <span className="text-sm flex-none mt-0.5">
                  {actIcons[String(item['icon'] ?? item['type'] ?? '')] ?? '\u{1F4CB}'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-text-0 truncate">{String(item['description'] ?? item['text'] ?? '—')}</div>
                  <div className="text-[10px] text-text-2 font-mono mt-0.5">
                    {String(item['meta'] ?? (item['created_at'] ? new Date(String(item['created_at'])).toLocaleTimeString() : ''))}
                  </div>
                </div>
              </div>
            ))}
            {(activity ?? []).length === 0 && (
              <div className="text-xs text-text-2 text-center py-8 font-mono">No recent activity</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function LiveView() {
  const { data, isLoading } = useTrips({ status: 'dispatched' });
  if (isLoading) return <LoadingState />;
  const trips = (data?.data ?? []) as Record<string, unknown>[];

  return (
    <div className="p-5 max-w-[1600px] mx-auto">
      <div className="rounded-2xl border border-[rgba(255,255,255,.07)] bg-[rgba(255,255,255,.02)] p-4 mb-4">
        <div className="font-bold text-sm text-text-0 mb-3">Live Fleet Tracking</div>
        <div className="h-[350px] rounded-xl bg-ink-3 flex items-center justify-center text-text-2 text-xs font-mono">
          Real-time GPS map — vehicle positions rendered here
        </div>
      </div>
      <div className="rounded-2xl border border-[rgba(255,255,255,.07)] bg-[rgba(255,255,255,.02)] p-4">
        <div className="font-bold text-sm text-text-0 mb-3">Active Trips ({trips.length})</div>
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {trips.map((t, i) => (
            <div key={String(t['id'] ?? i)} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-ink-2/50 border border-[rgba(255,255,255,.06)]">
              <div className="w-2 h-2 rounded-full bg-cds-teal shadow-[0_0_8px_rgba(51,214,168,.6)] flex-none" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-mono font-bold text-cds-orange">{String(t['reference'] ?? t['trip_number'] ?? '—')}</div>
                <div className="text-[11px] text-text-1 truncate">{String(t['customer_name'] ?? '—')} → {String(t['destination'] ?? '—')}</div>
              </div>
              <div className="text-[10px] text-text-2 font-mono">{String(t['vehicleReg'] ?? t['vehicle_reg'] ?? '—')}</div>
            </div>
          ))}
          {trips.length === 0 && (
            <div className="text-xs text-text-2 text-center py-8 font-mono">No active trips</div>
          )}
        </div>
      </div>
    </div>
  );
}

export function LoadingState() {
  return <div className="flex items-center justify-center h-64 text-text-2 font-mono text-sm">Loading…</div>;
}
