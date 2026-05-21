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
import { BarChart2, AlertTriangle, TrendingUp, Shield, Truck } from 'lucide-react';

interface ExecutiveSummary {
  fleet_utilization_pct: number;
  on_time_delivery_pct: number;
  safety_score: number;
  active_incidents: number;
  weekly_trend: { date: string; utilization: number; on_time: number; safety: number }[];
  top_alerts: { id: string; title: string; severity: string; created_at: string }[];
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

export default function Executive() {
  const { data, isLoading, isError } = useQuery<ExecutiveSummary>({
    queryKey: ['analytics-executive-summary'],
    queryFn: async () => {
      const res = await api.get<ExecutiveSummary>('/analytics/executive-summary');
      return res.data;
    },
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <BarChart2 size={20} className="text-blue-400" />
        <h1 className="text-xl font-bold">Executive Dashboard</h1>
      </div>

      {isLoading && (
        <div className="text-slate-400 text-sm py-12 text-center">Loading executive summary…</div>
      )}
      {isError && (
        <div className="text-red-400 text-sm py-12 text-center">Failed to load executive summary.</div>
      )}

      {data && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Fleet Utilization"
              value={(data.fleet_utilization_pct ?? 0).toFixed(1)}
              unit="%"
              icon={<Truck size={20} />}
              color="bg-blue-900 text-blue-400"
            />
            <KpiCard
              label="On-Time Delivery"
              value={(data.on_time_delivery_pct ?? 0).toFixed(1)}
              unit="%"
              icon={<TrendingUp size={20} />}
              color="bg-green-900 text-green-400"
            />
            <KpiCard
              label="Safety Score"
              value={(data.safety_score ?? 0).toFixed(1)}
              unit="/100"
              icon={<Shield size={20} />}
              color="bg-purple-900 text-purple-400"
            />
            <KpiCard
              label="Active Incidents"
              value={data.active_incidents}
              icon={<AlertTriangle size={20} />}
              color={data.active_incidents > 0 ? 'bg-red-900 text-red-400' : 'bg-slate-700 text-slate-400'}
            />
          </div>

          {/* Weekly Trend */}
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
            <h2 className="text-sm font-semibold text-slate-300 mb-4">Weekly Performance Trends</h2>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={data.weekly_trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} domain={[0, 100]} unit="%" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 6 }}
                  labelStyle={{ color: '#e2e8f0' }}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
                <Line
                  type="monotone"
                  dataKey="utilization"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                  name="Fleet Utilization %"
                />
                <Line
                  type="monotone"
                  dataKey="on_time"
                  stroke="#22c55e"
                  strokeWidth={2}
                  dot={false}
                  name="On-Time Delivery %"
                />
                <Line
                  type="monotone"
                  dataKey="safety"
                  stroke="#a855f7"
                  strokeWidth={2}
                  dot={false}
                  name="Safety Score"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Top Alerts */}
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
            <h2 className="text-sm font-semibold text-slate-300 mb-3">Top 5 Alerts This Week</h2>
            {data.top_alerts.length === 0 ? (
              <p className="text-slate-500 text-sm">No alerts this week.</p>
            ) : (
              <div className="space-y-2">
                {data.top_alerts.slice(0, 5).map((alert) => (
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
        </>
      )}
    </div>
  );
}
