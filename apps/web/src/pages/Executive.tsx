import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { BarChart2, AlertTriangle, TrendingUp, Truck, CheckCircle, Activity } from 'lucide-react';

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

interface AlertItem {
  id: string;
  title: string;
  severity: string;
  created_at: string;
}

function KpiCard({
  label,
  value,
  unit,
  icon,
  color,
}: {
  label: string;
  value: string | number;
  unit?: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${color}`}>
        {icon}
      </div>
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className="text-2xl font-bold">
        {value}
        {unit && <span className="text-sm font-normal text-slate-400 ml-1">{unit}</span>}
      </p>
    </div>
  );
}

const SEVERITY_COLORS: Record<string, string> = {
  low: 'bg-slate-600 text-slate-200',
  medium: 'bg-yellow-700 text-yellow-100',
  high: 'bg-orange-700 text-orange-100',
  critical: 'bg-red-700 text-red-100',
};

function fmtDay(d: string) {
  const date = new Date(d);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export default function Executive() {
  const { data: summary, isLoading: summaryLoading, isError: summaryError } = useQuery<DashboardSummary>({
    queryKey: ['analytics-dashboard'],
    queryFn: async () => {
      const res = await api.get<{ data: DashboardSummary }>('/analytics/dashboard');
      return res.data.data;
    },
    refetchInterval: 60_000,
  });

  const { data: convoyMetrics, isLoading: metricsLoading } = useQuery<ConvoyMetricDay[]>({
    queryKey: ['analytics-convoy-metrics'],
    queryFn: async () => {
      const res = await api.get<{ data: ConvoyMetricDay[] }>('/analytics/convoy-metrics');
      return res.data.data ?? [];
    },
  });

  const { data: alertsData, isLoading: alertsLoading } = useQuery<AlertItem[]>({
    queryKey: ['alerts-top', 'open'],
    queryFn: async () => {
      const res = await api.get<{ data: AlertItem[] }>('/alerts', {
        params: { status: 'open', limit: 5 },
      });
      const raw = res.data;
      if (Array.isArray(raw)) return (raw as AlertItem[]).slice(0, 5);
      return (raw?.data ?? []).slice(0, 5);
    },
  });

  const trendData = (convoyMetrics ?? [])
    .slice(-7)
    .map((d) => ({ ...d, day: fmtDay(d.day) }));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <BarChart2 size={20} className="text-orange-400" />
        <h1 className="text-xl font-bold">Executive Dashboard</h1>
      </div>

      {summaryError && (
        <div className="text-red-400 text-sm py-12 text-center">Failed to load executive summary.</div>
      )}

      {summaryLoading ? (
        <div className="text-slate-400 text-sm py-12 text-center">Loading executive summary…</div>
      ) : summary ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            label="Fleet Utilization"
            value={(summary.fleetUtilisation ?? 0).toFixed(1)}
            unit="%"
            icon={<Activity size={20} />}
            color="bg-blue-900 text-orange-400"
          />
          <KpiCard
            label="On-Time Rate"
            value={(summary.onTimeRate ?? 0).toFixed(1)}
            unit="%"
            icon={<TrendingUp size={20} />}
            color="bg-green-900 text-green-400"
          />
          <KpiCard
            label="Active Convoys"
            value={summary.activeConvoys}
            icon={<Truck size={20} />}
            color="bg-indigo-900 text-orange-400"
          />
          <KpiCard
            label="Open Alerts"
            value={summary.openAlerts}
            icon={<AlertTriangle size={20} />}
            color={summary.openAlerts > 0 ? 'bg-red-900 text-red-400' : 'bg-slate-700 text-slate-400'}
          />
          <KpiCard
            label="Active Vehicles"
            value={`${summary.activeVehicles} / ${summary.totalVehicles}`}
            icon={<CheckCircle size={20} />}
            color="bg-purple-900 text-purple-400"
          />
        </div>
      ) : null}

      <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-slate-300 mb-4">Convoy Performance (Last 7 Days)</h2>
        {metricsLoading ? (
          <div className="h-48 flex items-center justify-center text-slate-400 text-sm">Loading…</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 6 }}
                labelStyle={{ color: '#e2e8f0' }}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
              <Line type="monotone" dataKey="completed" stroke="#6366f1" strokeWidth={2} dot={false} name="Completed" />
              <Line type="monotone" dataKey="on_time" stroke="#22c55e" strokeWidth={2} dot={false} name="On Time" />
              <Line type="monotone" dataKey="delayed" stroke="#f59e0b" strokeWidth={2} dot={false} name="Delayed" />
              <Line type="monotone" dataKey="aborted" stroke="#ef4444" strokeWidth={2} dot={false} name="Aborted" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-slate-300 mb-3">Recent Open Alerts</h2>
        {alertsLoading ? (
          <div className="text-slate-400 text-sm">Loading…</div>
        ) : (alertsData ?? []).length === 0 ? (
          <p className="text-slate-500 text-sm">No open alerts.</p>
        ) : (
          <div className="space-y-2">
            {(alertsData ?? []).map((alert) => (
              <div
                key={alert.id}
                className="flex items-center justify-between py-2 border-b border-slate-700 last:border-0"
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle size={14} className="text-orange-400 shrink-0" />
                  <span className="text-sm">{alert.title}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${SEVERITY_COLORS[alert.severity] ?? 'bg-slate-600 text-slate-200'}`}>
                    {alert.severity}
                  </span>
                  <span className="text-xs text-slate-500">
                    {new Date(alert.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
