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
import { DollarSign, TrendingUp, TrendingDown, Fuel, Wrench } from 'lucide-react';

interface FinanceSummary {
  monthly_revenue: number;
  expenses: number;
  fuel_costs: number;
  maintenance_costs: number;
  expense_breakdown: { category: string; amount: number }[];
}

interface Transaction {
  id: string;
  description: string;
  type: 'income' | 'expense';
  amount: number;
  category: string;
  date: string;
}

const PIE_COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899'];

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function getCurrentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function StatCard({
  label,
  value,
  icon,
  trend,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  trend?: 'up' | 'down';
}) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="w-9 h-9 rounded-lg bg-slate-700 flex items-center justify-center text-blue-400">
          {icon}
        </div>
        {trend === 'up' && <TrendingUp size={16} className="text-green-400" />}
        {trend === 'down' && <TrendingDown size={16} className="text-red-400" />}
      </div>
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}

export default function Finance() {
  const [month, setMonth] = useState(getCurrentMonth());

  const { data: summary, isLoading: summaryLoading, isError: summaryError } = useQuery<FinanceSummary>({
    queryKey: ['finance-summary', month],
    queryFn: async () => {
      const res = await api.get<FinanceSummary>('/finance/summary', { params: { month } });
      return res.data;
    },
    enabled: !!month,
  });

  const { data: transactions, isLoading: txLoading } = useQuery<Transaction[]>({
    queryKey: ['finance-transactions', month],
    queryFn: async () => {
      const res = await api.get<Transaction[]>('/finance/transactions', { params: { month } });
      return res.data;
    },
    enabled: !!month,
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <DollarSign size={20} className="text-green-400" />
          <h1 className="text-xl font-bold">Finance</h1>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-400">Month</label>
          <input
            type="month"
            className="bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </div>
      </div>

      {summaryError && (
        <div className="text-red-400 text-sm">Failed to load finance summary.</div>
      )}

      {summaryLoading ? (
        <div className="text-slate-400 text-sm">Loading summary…</div>
      ) : summary ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Monthly Revenue"
            value={formatCurrency(summary.monthly_revenue)}
            icon={<DollarSign size={18} />}
            trend="up"
          />
          <StatCard
            label="Total Expenses"
            value={formatCurrency(summary.expenses)}
            icon={<TrendingDown size={18} />}
            trend="down"
          />
          <StatCard
            label="Fuel Costs"
            value={formatCurrency(summary.fuel_costs)}
            icon={<Fuel size={18} />}
          />
          <StatCard
            label="Maintenance Costs"
            value={formatCurrency(summary.maintenance_costs)}
            icon={<Wrench size={18} />}
          />
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-slate-300 mb-4">Expense Breakdown</h2>
          {summaryLoading ? (
            <div className="h-48 flex items-center justify-center text-slate-400 text-sm">Loading…</div>
          ) : summary?.expense_breakdown && summary.expense_breakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={summary.expense_breakdown}
                  dataKey="amount"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                >
                  {summary.expense_breakdown.map((_, index) => (
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
          <h2 className="text-sm font-semibold text-slate-300 mb-4">Recent Transactions</h2>
          {txLoading ? (
            <div className="text-slate-400 text-sm">Loading…</div>
          ) : (
            <div className="overflow-y-auto max-h-64 space-y-1">
              {transactions?.map((tx) => (
                <div
                  key={tx.id}
                  className="flex justify-between items-center py-2 border-b border-slate-700 last:border-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{tx.description}</p>
                    <p className="text-xs text-slate-500">
                      {tx.category} · {new Date(tx.date).toLocaleDateString()}
                    </p>
                  </div>
                  <span
                    className={`text-sm font-semibold ml-3 shrink-0 ${
                      tx.type === 'income' ? 'text-green-400' : 'text-red-400'
                    }`}
                  >
                    {tx.type === 'income' ? '+' : '-'}
                    {formatCurrency(tx.amount)}
                  </span>
                </div>
              ))}
              {transactions?.length === 0 && (
                <p className="text-slate-500 text-sm text-center py-4">No transactions.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
