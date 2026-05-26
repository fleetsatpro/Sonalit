import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Truck, Users, Bell, Route, AlertTriangle, FileWarning } from 'lucide-react';
import { api } from '../lib/api.js';
import { subscribe } from '../lib/centrifuge.js';
import { useAuthStore } from '../stores/auth.js';
import { normalizeList, type NormalizedList } from '../lib/normalize.js';
import type { Alert, Incident } from '@sonalit/contracts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OrgEvent = { type: string; payload: unknown };

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

function useCountUp(target: number, skip: boolean): number {
  const [display, setDisplay] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    if (skip) return;
    const from = prev.current;
    prev.current = target;
    if (from === target) return;
    const start = performance.now();
    const duration = Math.min(600, Math.abs(target - from) * 40);
    const raf = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (target - from) * ease));
      if (t < 1) requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
  }, [target, skip]);
  return skip ? target : display;
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  isLoading,
  isError,
  liveOverride,
}: {
  label: string;
  value: number | undefined;
  icon: React.ElementType;
  color: string;
  isLoading: boolean;
  isError: boolean;
  liveOverride?: number | null;
}): React.ReactElement {
  const raw = liveOverride !== null && liveOverride !== undefined ? liveOverride : (value ?? 0);
  const animated = useCountUp(raw, isLoading || isError);
  const isLive = liveOverride !== null && liveOverride !== undefined;
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex items-center gap-4 transition-shadow hover:shadow-lg hover:shadow-gray-950/50">
      <div className={`relative flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
        <Icon className="w-6 h-6 text-white" />
        {isLive && (
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-400 rounded-full border-2 border-gray-900">
            <span className="absolute inset-0 rounded-full bg-green-400 animate-ping opacity-75" />
          </span>
        )}
      </div>
      <div>
        <p className="text-gray-400 text-sm">{label}</p>
        {isLoading ? (
          <div className="h-7 w-12 bg-gray-800 rounded animate-pulse mt-0.5" />
        ) : isError ? (
          <p className="text-red-400 text-sm">Error</p>
        ) : (
          <p className="text-white text-2xl font-bold tabular-nums">{animated}</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Severity badge
// ---------------------------------------------------------------------------

function SeverityBadge({ severity }: { severity: Alert['severity'] }): React.ReactElement {
  const map: Record<Alert['severity'], string> = {
    critical: 'bg-red-900/60 text-red-300 border-red-700',
    warning: 'bg-yellow-900/60 text-yellow-300 border-yellow-700',
    info: 'bg-blue-900/60 text-orange-300 border-blue-700',
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded border ${map[severity]}`}>
      {severity}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Priority badge
// ---------------------------------------------------------------------------

function PriorityBadge({ priority }: { priority: number }): React.ReactElement {
  const colors = ['', 'bg-red-900/60 text-red-300', 'bg-orange-900/60 text-orange-300',
    'bg-yellow-900/60 text-yellow-300', 'bg-blue-900/60 text-orange-300', 'bg-gray-800 text-gray-400'];
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded ${colors[priority] ?? colors[5]}`}>
      P{priority}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function Dashboard(): React.ReactElement {
  const user = useAuthStore((s) => s.user);
  const orgId = user?.org_id ?? '';
  const [liveVehicleCount, setLiveVehicleCount] = useState<number | null>(null);

  const { data: activeVehicles, isLoading: lvLoading, isError: lvError } = useQuery<NormalizedList<unknown>>({
    queryKey: ['vehicles', 'count', 'active'],
    queryFn: async () => {
      const res = await api.get('/vehicles', { params: { status: 'active', limit: 1 } });
      return normalizeList(res.data);
    },
    enabled: !!orgId,
  });

  const { data: activeDrivers, isLoading: ldLoading, isError: ldError } = useQuery<NormalizedList<unknown>>({
    queryKey: ['drivers', 'count', 'active'],
    queryFn: async () => {
      const res = await api.get('/drivers', { params: { status: 'active', limit: 1 } });
      return normalizeList(res.data);
    },
    enabled: !!orgId,
  });

  const { data: openAlerts, isLoading: laLoading, isError: laError } = useQuery<NormalizedList<unknown>>({
    queryKey: ['alerts', 'count', 'open'],
    queryFn: async () => {
      const res = await api.get('/alerts', { params: { status: 'open', limit: 1 } });
      return normalizeList(res.data);
    },
    enabled: !!orgId,
  });

  const { data: activeConvoys, isLoading: lcLoading, isError: lcError } = useQuery<NormalizedList<unknown>>({
    queryKey: ['convoys', 'count', 'active'],
    queryFn: async () => {
      const res = await api.get('/convoys', { params: { status: 'active', limit: 1 } });
      return normalizeList(res.data);
    },
    enabled: !!orgId,
  });

  const { data: recentAlerts, isLoading: raLoading, isError: raError } = useQuery<NormalizedList<Alert>>({
    queryKey: ['alerts', 'recent'],
    queryFn: async () => {
      const res = await api.get('/alerts', { params: { limit: 5 } });
      return normalizeList<Alert>(res.data);
    },
    enabled: !!orgId,
  });

  const { data: recentIncidents, isLoading: riLoading, isError: riError } = useQuery<NormalizedList<Incident>>({
    queryKey: ['incidents', 'recent'],
    queryFn: async () => {
      const res = await api.get('/incidents', { params: { limit: 5 } });
      return normalizeList<Incident>(res.data);
    },
    enabled: !!orgId,
  });

  useEffect(() => {
    if (!orgId) return;
    return subscribe<OrgEvent>(`org#${orgId}`, (event) => {
      if (event.type === 'vehicle.count') {
        const p = event.payload as { count?: number };
        if (typeof p.count === 'number') setLiveVehicleCount(p.count);
      }
    });
  }, [orgId]);

  const stats = [
    { label: 'Active Vehicles', value: activeVehicles?.total, icon: Truck, color: 'bg-orange-600', isLoading: lvLoading, isError: lvError, liveOverride: liveVehicleCount },
    { label: 'Active Drivers', value: activeDrivers?.total, icon: Users, color: 'bg-green-600', isLoading: ldLoading, isError: ldError },
    { label: 'Open Alerts', value: openAlerts?.total, icon: Bell, color: 'bg-red-600', isLoading: laLoading, isError: laError },
    { label: 'Ongoing Convoys', value: activeConvoys?.total, icon: Route, color: 'bg-amber-600', isLoading: lcLoading, isError: lcError },
  ];

  return (
    <div className="p-6 space-y-8">
      <h1 className="text-2xl font-bold text-white">Dashboard</h1>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Alerts */}
        <section className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-semibold text-white">Recent Alerts</h2>
          </div>
          {raLoading && (
            <div className="space-y-2">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="h-12 bg-gray-800 rounded-lg animate-pulse" />
              ))}
            </div>
          )}
          {raError && <p className="text-red-400 text-sm">Failed to load alerts.</p>}
          {!raLoading && !raError && (
            <ul className="space-y-2">
              {(recentAlerts?.data?.length ?? 0) === 0 && (
                <li className="text-gray-500 text-sm">No alerts</li>
              )}
              {recentAlerts?.data?.map((alert) => (
                <li key={alert.id} className="flex items-center gap-3 bg-gray-800/50 rounded-lg px-3 py-2.5">
                  <SeverityBadge severity={alert.severity} />
                  <div className="min-w-0 flex-1">
                    <p className="text-white text-sm font-medium truncate">{alert.title}</p>
                    <p className="text-gray-400 text-xs">{alert.triggered_at ? new Date(alert.triggered_at).toLocaleString() : '—'}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Recent Incidents */}
        <section className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <FileWarning className="w-5 h-5 text-red-400" />
            <h2 className="text-lg font-semibold text-white">Recent Incidents</h2>
          </div>
          {riLoading && (
            <div className="space-y-2">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="h-12 bg-gray-800 rounded-lg animate-pulse" />
              ))}
            </div>
          )}
          {riError && <p className="text-red-400 text-sm">Failed to load incidents.</p>}
          {!riLoading && !riError && (
            <ul className="space-y-2">
              {(recentIncidents?.data?.length ?? 0) === 0 && (
                <li className="text-gray-500 text-sm">No incidents</li>
              )}
              {recentIncidents?.data?.map((inc) => (
                <li key={inc.id} className="flex items-center gap-3 bg-gray-800/50 rounded-lg px-3 py-2.5">
                  <PriorityBadge priority={inc.priority} />
                  <div className="min-w-0 flex-1">
                    <p className="text-white text-sm font-medium truncate">{inc.title}</p>
                    <p className="text-gray-400 text-xs capitalize">{inc.status}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
