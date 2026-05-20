import { useQuery } from '@tanstack/react-query';
import { BarChart2 } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { api } from '../lib/api.js';

type KpiData = {
  fleet_utilization_pct: number;
  on_time_delivery_pct: number;
  avg_fuel_efficiency_lper100km: number;
  incident_rate_per_100trips: number;
  revenue_per_vehicle: number;
  currency: string;
};

type TrendPoint = {
  date: string;
  utilization: number;
  on_time: number;
};

type ExecutiveData = {
  kpis: KpiData;
  trend: TrendPoint[];
};

function KpiCard({ label, value, unit, target, good }: { label: string; value: number; unit: string; target: number; good: 'high' | 'low' }) {
  const isGood = good === 'high' ? value >= target : value <= target;
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <p className="text-slate-400 text-sm">{label}</p>
      <div className="flex items-baseline gap-1 mt-1">
        <p className={`text-2xl font-bold ${isGood ? 'text-green-400' : 'text-red-400'}`}>{value.toFixed(1)}</p>
        <span className="text-slate-500 text-sm">{unit}</span>
      </div>
      <p className="text-xs text-slate-600 mt-1">Target: {target}{unit}</p>
    </div>
  );
}

export default function ExecutivePage() {
  const { data, isLoading, isError } = useQuery<ExecutiveData>({
    queryKey: ['executive', 'dashboard'],
    queryFn: async () => {
      const { data } = await api.get<ExecutiveData>('/executive/dashboard');
      return data;
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <BarChart2 size={20} className="text-blue-400" />
        <h1 className="text-xl font-bold">Executive Dashboard</h1>
      </div>

      {isLoading && <div className="text-slate-400 text-sm py-12 text-center">Loading executive data…</div>}
      {isError && <div className="text-red-400 text-sm py-12 text-center">Failed to load executive dashboard.</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            <KpiCard label="Fleet Utilization" value={data.kpis.fleet_utilization_pct} unit="%" target={80} good="high" />
            <KpiCard label="On-Time Delivery" value={data.kpis.on_time_delivery_pct} unit="%" target={90} good="high" />
            <KpiCard label="Fuel Efficiency" value={data.kpis.avg_fuel_efficiency_lper100km} unit="L/100km" target={12} good="low" />
            <KpiCard label="Incident Rate" value={data.kpis.incident_rate_per_100trips} unit="/100 trips" target={2} good="low" />
            <KpiCard label={`Rev/Vehicle (${data.kpis.currency})`} value={data.kpis.revenue_per_vehicle} unit="" target={5000} good="high" />
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h2 className="text-base font-semibold mb-4">30-Day Performance Trend</h2>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={data.trend} margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} domain={[0, 100]} unit="%" />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} />
                <Legend />
                <Line type="monotone" dataKey="utilization" name="Utilization %" stroke="#60a5fa" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="on_time" name="On-Time %" stroke="#34d399" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
