import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { DollarSign, TrendingDown, Fuel, Wrench } from 'lucide-react';

interface FinanceDashboard {
  invoices: {
    total_invoices: string;
    revenue_collected: string | null;
    revenue_pending: string | null;
    revenue_overdue: string | null;
    overdue_count: string;
  };
  expenses: {
    total_expenses: string | null;
    fuel_costs: string | null;
    maintenance_costs: string | null;
    toll_costs: string | null;
    allowances: string | null;
  };
  trips: {
    total_trips: string;
    total_km: string | null;
    total_fuel_used: string | null;
    avg_fuel_per_100km: string | null;
    total_trip_cost: string | null;
  };
}

interface Invoice {
  id: string;
  invoice_number: string;
  customer_name: string;
  status: string;
  total: number;
  created_at: string;
}

const PIE_COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6'];

const STATUS_BADGES: Record<string, string> = {
  paid: 'bg-green-800 text-green-200',
  sent: 'bg-blue-800 text-blue-200',
  overdue: 'bg-red-800 text-red-200',
  draft: 'bg-slate-700 text-slate-300',
};

function formatCurrency(value: string | number | null | undefined): string {
  const num = parseFloat(String(value ?? '0')) || 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(num);
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
      <div className="w-9 h-9 rounded-lg bg-slate-700 flex items-center justify-center text-orange-400 mb-2">
        {icon}
      </div>
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}

export default function Finance() {
  const [statusFilter, setStatusFilter] = useState('all');

  const { data: dashboard, isLoading: dashLoading, isError: dashError } = useQuery<FinanceDashboard>({
    queryKey: ['finance-dashboard'],
    queryFn: async () => {
      const res = await api.get<{ data: FinanceDashboard }>('/finance/dashboard');
      return res.data?.data ?? res.data;
    },
  });

  const { data: invoices, isLoading: invLoading } = useQuery<Invoice[]>({
    queryKey: ['finance-invoices', statusFilter],
    queryFn: async () => {
      const params: Record<string, string> = { limit: '20' };
      if (statusFilter !== 'all') params['status'] = statusFilter;
      const res = await api.get<{ data: Invoice[] } | Invoice[]>('/finance/invoices', { params });
      const raw = res.data;
      return Array.isArray(raw) ? raw : (raw?.data ?? []);
    },
  });

  const expenseBreakdown = dashboard
    ? [
        { category: 'Fuel', amount: parseFloat(dashboard.expenses.fuel_costs ?? '0') || 0 },
        { category: 'Maintenance', amount: parseFloat(dashboard.expenses.maintenance_costs ?? '0') || 0 },
        { category: 'Tolls', amount: parseFloat(dashboard.expenses.toll_costs ?? '0') || 0 },
        { category: 'Allowances', amount: parseFloat(dashboard.expenses.allowances ?? '0') || 0 },
      ].filter((e) => e.amount > 0)
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <DollarSign size={20} className="text-green-400" />
        <h1 className="text-xl font-bold">Finance</h1>
      </div>

      {dashError && <div className="text-red-400 text-sm">Failed to load finance data.</div>}

      {dashLoading ? (
        <div className="text-slate-400 text-sm">Loading summary…</div>
      ) : dashboard ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Revenue Collected (30d)"
            value={formatCurrency(dashboard.invoices.revenue_collected)}
            icon={<DollarSign size={18} />}
          />
          <StatCard
            label="Revenue Pending"
            value={formatCurrency(dashboard.invoices.revenue_pending)}
            icon={<DollarSign size={18} />}
          />
          <StatCard
            label="Total Expenses (30d)"
            value={formatCurrency(dashboard.expenses.total_expenses)}
            icon={<TrendingDown size={18} />}
          />
          <StatCard
            label="Fuel Costs (30d)"
            value={formatCurrency(dashboard.expenses.fuel_costs)}
            icon={<Fuel size={18} />}
          />
          <StatCard
            label="Maintenance Costs (30d)"
            value={formatCurrency(dashboard.expenses.maintenance_costs)}
            icon={<Wrench size={18} />}
          />
          <StatCard
            label="Total Trips (30d)"
            value={String(dashboard.trips.total_trips ?? '0')}
            icon={<DollarSign size={18} />}
          />
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-slate-300 mb-4">Expense Breakdown (30 Days)</h2>
          {dashLoading ? (
            <div className="h-48 flex items-center justify-center text-slate-400 text-sm">Loading…</div>
          ) : expenseBreakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={expenseBreakdown}
                  dataKey="amount"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                >
                  {expenseBreakdown.map((_, index) => (
                    <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}
                  formatter={(v: number) => formatCurrency(v)}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex items-center justify-center text-slate-500 text-sm">
              No expense data.
            </div>
          )}
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-300">Invoices</h2>
            <select
              className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All</option>
              <option value="paid">Paid</option>
              <option value="sent">Sent</option>
              <option value="overdue">Overdue</option>
              <option value="draft">Draft</option>
            </select>
          </div>
          {invLoading ? (
            <div className="text-slate-400 text-sm">Loading…</div>
          ) : (
            <div className="overflow-y-auto max-h-64 space-y-1">
              {(invoices ?? []).map((inv) => (
                <div
                  key={inv.id}
                  className="flex justify-between items-center py-2 border-b border-slate-700 last:border-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{inv.customer_name}</p>
                    <p className="text-xs text-slate-500">
                      {inv.invoice_number} · {new Date(inv.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-3 shrink-0">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${STATUS_BADGES[inv.status] ?? 'bg-slate-700 text-slate-300'}`}>
                      {inv.status}
                    </span>
                    <span className="text-sm font-semibold text-green-400">
                      {formatCurrency(inv.total)}
                    </span>
                  </div>
                </div>
              ))}
              {(invoices ?? []).length === 0 && (
                <p className="text-slate-500 text-sm text-center py-4">No invoices.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
