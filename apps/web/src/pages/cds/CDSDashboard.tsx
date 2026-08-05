import React from 'react';
import { Link } from '@tanstack/react-router';
import {
  Container,
  Truck,
  CheckCircle,
  Lock,
  Clock,
  AlertTriangle,
  TrendingUp,
} from 'lucide-react';
import {
  KPICard,
  Card,
  DataTable,
  StatusBadge,
  ProgressBar,
  CDSDrawer,
  CDSToastContainer,
} from './components.js';
import { useDashboard, useTrips, useActivityFeed } from './hooks.js';
import type { Shipment, ActivityItem, DashboardKPI } from './types.js';

/* ------------------------------------------------------------------ */
/*  KPI icon mapping                                                   */
/* ------------------------------------------------------------------ */

const KPI_ICON_MAP: Record<string, React.ElementType> = {
  'active containers': Container,
  'in transit': Truck,
  'delivered today': CheckCircle,
  'active locks': Lock,
  'locks removed': Lock,
  'pending unclamp': Clock,
  'delayed trips': AlertTriangle,
  'avg transit': TrendingUp,
  'avg transit time': TrendingUp,
};

function kpiIcon(label: string): React.ElementType {
  return KPI_ICON_MAP[label.toLowerCase()] ?? TrendingUp;
}

/* ------------------------------------------------------------------ */
/*  Activity feed dot colors                                           */
/* ------------------------------------------------------------------ */

const ACTIVITY_DOT: Record<string, string> = {
  clamp: 'bg-cds-orange shadow-[0_0_6px_rgba(255,122,0,0.5)]',
  depart: 'bg-cds-teal shadow-[0_0_6px_rgba(51,214,168,0.5)]',
  checkpoint: 'bg-cds-amber shadow-[0_0_6px_rgba(255,176,32,0.5)]',
  sync: 'bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.5)]',
  arrival: 'bg-cds-teal shadow-[0_0_6px_rgba(51,214,168,0.5)]',
  unclamp: 'bg-purple-400 shadow-[0_0_6px_rgba(167,139,250,0.5)]',
  ai: 'bg-purple-400 shadow-[0_0_6px_rgba(167,139,250,0.5)]',
  alert: 'bg-cds-red shadow-[0_0_6px_rgba(255,92,92,0.5)]',
  lock: 'bg-cds-orange shadow-[0_0_6px_rgba(255,122,0,0.5)]',
  unlock: 'bg-cds-amber shadow-[0_0_6px_rgba(255,176,32,0.5)]',
};

/* ------------------------------------------------------------------ */
/*  Fallback KPIs (shown when data hasn't resolved yet)                */
/* ------------------------------------------------------------------ */

const FALLBACK_KPIS: DashboardKPI[] = [
  { label: 'Active Containers', value: '—', delta: '—', trend: 'up' },
  { label: 'In Transit', value: '—', delta: '—', trend: 'up' },
  { label: 'Delivered Today', value: '—', delta: '—', trend: 'up' },
  { label: 'Active Locks', value: '—', delta: '—', trend: 'up' },
  { label: 'Locks Removed', value: '—', delta: '—', trend: 'up' },
  { label: 'Pending Unclamp', value: '—', delta: '—', trend: 'up' },
  { label: 'Delayed Trips', value: '—', delta: '—', trend: 'up' },
  { label: 'Avg Transit Time', value: '—', delta: '—', trend: 'up' },
];

/* ------------------------------------------------------------------ */
/*  Trip table column definitions                                      */
/* ------------------------------------------------------------------ */

const tripColumns = [
  {
    id: 'reference',
    header: 'Trip No.',
    sortable: true,
    accessor: (row: Shipment) => (
      <span className="font-mono font-semibold text-text-0 text-xs">
        {row.reference}
      </span>
    ),
  },
  {
    id: 'status',
    header: 'Status',
    accessor: (row: Shipment) => <StatusBadge status={row.status} />,
  },
  {
    id: 'driver',
    header: 'Driver',
    accessor: (row: Shipment) => (
      <span className="text-text-1">{row.driverName ?? '—'}</span>
    ),
  },
  {
    id: 'vehicle',
    header: 'Vehicle',
    accessor: (row: Shipment) => (
      <span className="text-text-1">{row.vehicleReg ?? '—'}</span>
    ),
  },
  {
    id: 'destination',
    header: 'Destination',
    accessor: (row: Shipment) => (
      <span className="text-text-1">{row.destination}</span>
    ),
  },
  {
    id: 'eta',
    header: 'ETA',
    sortable: true,
    accessor: (row: Shipment) => (
      <span className="font-mono text-text-1 text-xs">
        {row.eta
          ? new Date(row.eta).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })
          : '—'}
      </span>
    ),
  },
  {
    id: 'progress',
    header: 'Progress',
    accessor: (row: Shipment) => (
      <div className="flex items-center gap-2">
        <ProgressBar value={row.progress} />
        <span className="font-mono text-text-2 text-[11px] min-w-[30px]">
          {row.progress}%
        </span>
      </div>
    ),
  },
];

/* ------------------------------------------------------------------ */
/*  ActivityRow                                                        */
/* ------------------------------------------------------------------ */

function ActivityRow({ item }: { item: ActivityItem }) {
  const dot = ACTIVITY_DOT[item.icon] ?? 'bg-text-2';
  return (
    <div className="px-[18px] py-3 border-b border-[rgba(255,255,255,0.04)] flex gap-2.5 items-start">
      <span className={`w-2 h-2 rounded-full flex-none mt-1.5 ${dot}`} />
      <div className="min-w-0">
        <div className="text-[13px] text-text-0 font-medium leading-snug">
          {item.text}
        </div>
        <div className="font-mono text-[10.5px] text-text-2 mt-1 truncate">
          {item.meta}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  CDSDashboard                                                       */
/* ------------------------------------------------------------------ */

export default function CDSDashboard() {
  const { data: dashboard, isLoading: dashLoading } = useDashboard();
  const { data: tripsResponse, isLoading: tripsLoading } = useTrips({
    pageSize: 8,
  });
  const { data: activityFeed, isLoading: activityLoading } = useActivityFeed();

  const kpis = dashboard?.kpis ?? FALLBACK_KPIS;
  const trips = tripsResponse?.data ?? [];
  const activities = activityFeed ?? dashboard?.recentActivity ?? [];

  if (dashLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-2 font-mono text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div className="px-6 py-6 max-w-[1400px] mx-auto">
      {/* Page header */}
      <div className="mb-5">
        <h1 className="font-display font-extrabold text-[22px] text-text-0">
          Container Delivery System
        </h1>
        <p className="font-mono text-[12px] text-text-2 tracking-[0.08em] mt-1">
          TODAY&apos;S OPERATIONS OVERVIEW
        </p>
      </div>

      {/* KPI grid — 4 columns */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {kpis.map((kpi) => {
          const Icon = kpiIcon(kpi.label);
          return (
            <div key={kpi.label} className="relative">
              <KPICard
                label={kpi.label}
                value={kpi.value}
                delta={kpi.delta}
                trend={kpi.trend}
                {...(kpi.sparkline ? { sparkline: kpi.sparkline } : {})}
              />
              <Icon
                size={28}
                className="absolute top-4 right-4 text-text-2 opacity-15 pointer-events-none"
              />
            </div>
          );
        })}
      </div>

      {/* Two-column layout: trips table + activity feed */}
      <div className="grid grid-cols-[1.7fr_1fr] gap-4">
        {/* Active Trips */}
        <div>
          <div className="flex justify-between items-center mb-3">
            <span className="font-display font-bold text-[13px] text-text-0">
              Active Trips
            </span>
            <Link
              to="/cds/shipments"
              className="text-[11px] text-cds-orange font-semibold no-underline hover:brightness-110 transition-all"
            >
              View all &rarr;
            </Link>
          </div>

          {tripsLoading ? (
            <div className="flex items-center justify-center h-40 text-text-2 font-mono text-sm">
              Loading...
            </div>
          ) : (
            <DataTable
              columns={tripColumns}
              data={trips}
              keyExtractor={(row) => row.id}
              pageSize={8}
              emptyMessage="No active trips."
            />
          )}
        </div>

        {/* Activity Feed */}
        <Card className="overflow-hidden flex flex-col self-start">
          <div className="px-[18px] py-3.5 border-b border-[rgba(255,255,255,0.07)] flex-none">
            <span className="font-display font-bold text-[13px] text-text-0">
              Activity Feed
            </span>
          </div>
          <div className="max-h-[380px] overflow-y-auto flex-1">
            {activityLoading ? (
              <div className="p-8 text-center text-text-2 font-mono text-sm">
                Loading...
              </div>
            ) : activities.length === 0 ? (
              <div className="p-8 text-center text-text-2 font-mono text-sm">
                No recent activity.
              </div>
            ) : (
              activities.map((item) => (
                <ActivityRow key={item.id} item={item} />
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Global drawer & toast support */}
      <CDSDrawer />
      <CDSToastContainer />
    </div>
  );
}
