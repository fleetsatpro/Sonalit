import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { BarChart2, Activity, Fuel, MapPin, Clock } from 'lucide-react';

interface GpsEvent {
  time: string;
  count: number;
}

interface AlertByType {
  type: string;
  count: number;
}

interface AnalyticsSummary {
  total_distance_km: number;
  active_hours: number;
  fuel_events: number;
  geofence_violations: number;
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  unit?: string;
}

function StatCard({ label, value, icon, unit }: StatCardProps) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg bg-slate-700 flex items-center justify-center text-blue-400">
        {icon}
      </div>
      <div>
        <p className="text-xs text-slate-400">{label}</p>
        <p className="text-xl font-bold">
          {value}
          {unit && <span className="text-sm font-normal text-slate-400 ml-1">{unit}</span>}
        </p>
      </div>
    </div>
  );
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function Analytics() {
  const today = new Date();
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [from, setFrom] = useState(formatDate(weekAgo));
  const [to, setTo] = useState(formatDate(today));

  const params = { from, to };

  const { data: gpsEvents, isLoading: gpsLoading } = useQuery<GpsEvent[]>({
    queryKey: ['analytics-gps', from, to],
    queryFn: async () => {
      const res = await api.get<GpsEvent[]>('/analytics/gps-events', { params });
      return res.data;
    },
    enabled: !!from && !!to,
  });

  const { data: alertsByType, isLoading: alertsLoading } = useQuery<AlertByType[]>({
    queryKey: ['analytics-alerts', from, to],
    queryFn: async () => {
      const res = await api.get<AlertByType[]>('/analytics/alerts-by-type', { params });
      return res.data;
    },
    enabled: !!from && !!to,
  });

  const { data: summary } = useQuery<AnalyticsSummary>({
    queryKey: ['analytics-summary', from, to],
    queryFn: async () => {
      const res = await api.get<AnalyticsSummary>('/analytics/summary', { params });
      return res.data;
    },
    enabled: !!from && !!to,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart2 size={20} className="text-blue-400" />
          <h1 className="text-xl font-bold">Analytics</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-400">From</label>
            <input
              type="date"
              className="bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-400">To</label>
            <input
              type="date"
              className="bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Distance"
          value={summary?.total_distance_km?.toLocaleString() ?? '—'}
          unit="km"
          icon={<MapPin size={18} />}
        />
        <StatCard
          label="Active Hours"
          value={summary?.active_hours?.toLocaleString() ?? '—'}
          unit="hrs"
          icon={<Clock size={18} />}
        />
        <StatCard
          label="Fuel Events"
          value={summary?.fuel_events ?? '—'}
          icon={<Fuel size={18} />}
        />
        <StatCard
          label="Geofence Violations"
          value={summary?.geofence_violations ?? '—'}
          icon={<Activity size={18} />}
        />
      </div>

      {/* GPS Events Line Chart */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-slate-300 mb-4">GPS Events Over Time</h2>
        {gpsLoading ? (
          <div className="h-48 flex items-center justify-center text-slate-400 text-sm">
            Loading…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={gpsEvents ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 6 }}
                labelStyle={{ color: '#e2e8f0' }}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
              <Line type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} dot={false} name="GPS Events" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Alerts by Type Bar Chart */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-slate-300 mb-4">Alerts by Type</h2>
        {alertsLoading ? (
          <div className="h-48 flex items-center justify-center text-slate-400 text-sm">
            Loading…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={alertsByType ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="type" tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 6 }}
                labelStyle={{ color: '#e2e8f0' }}
              />
              <Bar dataKey="count" fill="#f59e0b" name="Alerts" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
