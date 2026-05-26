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
import { BarChart2, Truck, AlertTriangle, CheckCircle, Activity } from 'lucide-react';

interface DashboardSummary {
  activeConvoys: number;
  openAlerts: number;
  fleetUtilisation: number;
  onTimeRate: number;
  totalVehicles: number;
  activeVehicles: number;
}

interface ConvoyMetricDay {
  day: string;
  completed: number;
  on_time: number;
  delayed: number;
  aborted: number;
}

interface FleetRegion {
  region: string | null;
  total: number;
  active: number;
  idle: number;
  maintenance: number;
  offline: number;
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  sub?: string | undefined;
}

function StatCard({ label, value, icon, sub }: StatCardProps) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center text-orange-400 flex-shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-xl font-bold text-white">
          {value}
          {sub && <span className="text-sm font-normal text-gray-400 ml-1">{sub}</span>}
        </p>
      </div>
    </div>
  );
}

function fmtDay(d: string) {
  const date = new Date(d);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export default function Analytics() {
  const { data: summary, isLoading: summaryLoading } = useQuery<DashboardSummary>({
    queryKey: ['analytics-dashboard'],
    queryFn: async () => {
      const res = await api.get<{ data: DashboardSummary }>('/analytics/dashboard');
      return res.data.data;
    },
  });

  const { data: convoyMetrics, isLoading: convoyLoading } = useQuery<ConvoyMetricDay[]>({
    queryKey: ['analytics-convoy-metrics'],
    queryFn: async () => {
      const res = await api.get<{ data: ConvoyMetricDay[] }>('/analytics/convoy-metrics');
      return res.data.data ?? [];
    },
  });

  const { data: fleetRegions, isLoading: fleetLoading } = useQuery<FleetRegion[]>({
    queryKey: ['analytics-fleet-utilization'],
    queryFn: async () => {
      const res = await api.get<{ data: FleetRegion[] }>('/analytics/fleet-utilization');
      return res.data.data ?? [];
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-2">
        <BarChart2 size={20} className="text-orange-400" />
        <h1 className="text-xl font-bold text-white">Analytics</h1>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          label="Active Convoys"
          value={summaryLoading ? '—' : (summary?.activeConvoys ?? '—')}
          icon={<Truck size={18} />}
        />
        <StatCard
          label="Open Alerts"
          value={summaryLoading ? '—' : (summary?.openAlerts ?? '—')}
          icon={<AlertTriangle size={18} />}
        />
        <StatCard
          label="Fleet Utilisation"
          value={summaryLoading ? '—' : `${summary?.fleetUtilisation ?? '—'}`}
          sub="%"
          icon={<Activity size={18} />}
        />
        <StatCard
          label="On-Time Rate"
          value={summaryLoading ? '—' : `${summary?.onTimeRate ?? '—'}`}
          sub="%"
          icon={<CheckCircle size={18} />}
        />
        <StatCard
          label="Active Vehicles"
          value={summaryLoading ? '—' : (summary?.activeVehicles ?? '—')}
          sub={summary ? `/ ${summary.totalVehicles}` : undefined}
          icon={<Truck size={18} />}
        />
      </div>

      {/* Convoy performance over last 30 days */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-white mb-4">Convoy Performance (Last 30 Days)</h2>
        {convoyLoading ? (
          <div className="h-48 flex items-center justify-center text-gray-400 text-sm">Loading…</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={(convoyMetrics ?? []).map((d) => ({ ...d, day: fmtDay(d.day) }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#6b7280' }} interval={4} />
              <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ backgroundColor: '#111827', border: '1px solid #1f2937', borderRadius: 6 }}
                labelStyle={{ color: '#e5e7eb' }}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
              <Line type="monotone" dataKey="completed" stroke="#6366f1" strokeWidth={2} dot={false} name="Completed" />
              <Line type="monotone" dataKey="on_time" stroke="#22c55e" strokeWidth={2} dot={false} name="On Time" />
              <Line type="monotone" dataKey="delayed" stroke="#f59e0b" strokeWidth={2} dot={false} name="Delayed" />
              <Line type="monotone" dataKey="aborted" stroke="#ef4444" strokeWidth={2} dot={false} name="Aborted" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Fleet utilization by region */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-white mb-4">Fleet Utilization by Region</h2>
        {fleetLoading ? (
          <div className="h-48 flex items-center justify-center text-gray-400 text-sm">Loading…</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={(fleetRegions ?? []).map((r) => ({ ...r, region: r.region ?? 'Unknown' }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="region" tick={{ fontSize: 10, fill: '#6b7280' }} />
              <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ backgroundColor: '#111827', border: '1px solid #1f2937', borderRadius: 6 }}
                labelStyle={{ color: '#e5e7eb' }}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
              <Bar dataKey="active" fill="#6366f1" name="Active" radius={[2, 2, 0, 0]} />
              <Bar dataKey="idle" fill="#f59e0b" name="Idle" radius={[2, 2, 0, 0]} />
              <Bar dataKey="maintenance" fill="#ef4444" name="Maintenance" radius={[2, 2, 0, 0]} />
              <Bar dataKey="offline" fill="#374151" name="Offline" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
