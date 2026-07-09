import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { FileText, Download, Plus, X, Trash2, Truck, Route, Users, Gauge, TrendingUp, Fuel } from 'lucide-react';

type ReportType = 'fleet' | 'convoy' | 'driver' | 'daily_ops' | 'sla_compliance' | 'fuel_efficiency';
type ReportFormat = 'PDF' | 'CSV';

interface Report {
  id: string;
  title: string;
  type: ReportType;
  format: ReportFormat;
  status: 'ready';
  period_from: string | null;
  period_to: string | null;
  generated_at: string;
}

interface GenerateReportPayload {
  type: ReportType;
  from: string;
  to: string;
  format: ReportFormat;
}

const TYPE_META: Record<ReportType, { label: string; icon: React.ReactNode }> = {
  fleet: { label: 'Fleet Status', icon: <Truck className="w-4 h-4" /> },
  convoy: { label: 'Convoy Activity', icon: <Route className="w-4 h-4" /> },
  driver: { label: 'Driver Performance', icon: <Users className="w-4 h-4" /> },
  daily_ops: { label: 'Daily Operations', icon: <Gauge className="w-4 h-4" /> },
  sla_compliance: { label: 'SLA Compliance', icon: <TrendingUp className="w-4 h-4" /> },
  fuel_efficiency: { label: 'Fuel Efficiency', icon: <Fuel className="w-4 h-4" /> },
};

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function GenerateForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const today = new Date();
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [form, setForm] = useState<GenerateReportPayload>({
    type: 'fleet',
    from: formatDate(weekAgo),
    to: formatDate(today),
    format: 'PDF',
  });

  const mutation = useMutation({
    mutationFn: (payload: GenerateReportPayload) => api.post('/reports', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      onClose();
    },
  });

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 mb-4">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold">Generate Report</h3>
        <button onClick={onClose}><X size={16} /></button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Type</label>
          <select
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as ReportType }))}
          >
            {(Object.entries(TYPE_META) as [ReportType, typeof TYPE_META[ReportType]][]).map(([v, m]) => (
              <option key={v} value={v}>{m.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Format</label>
          <select
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
            value={form.format}
            onChange={(e) => setForm((f) => ({ ...f, format: e.target.value as ReportFormat }))}
          >
            <option value="PDF">PDF</option>
            <option value="CSV">CSV</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">From</label>
          <input
            type="date"
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
            value={form.from}
            onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">To</label>
          <input
            type="date"
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
            value={form.to}
            onChange={(e) => setForm((f) => ({ ...f, to: e.target.value }))}
          />
        </div>
      </div>
      {mutation.isError && (
        <p className="text-red-400 text-sm mt-2">Failed to generate report.</p>
      )}
      <button
        onClick={() => mutation.mutate(form)}
        disabled={mutation.isPending}
        className="mt-3 px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 rounded text-sm font-medium"
      >
        {mutation.isPending ? 'Generating…' : 'Generate'}
      </button>
    </div>
  );
}

function DownloadButton({ report }: { report: Report }) {
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const res = await api.get(`/reports/${report.id}/export`, { responseType: 'blob' });
      const ext = report.format === 'CSV' ? 'csv' : 'pdf';
      const blobUrl = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `${report.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button onClick={download} disabled={busy} className="flex items-center gap-1 text-orange-400 hover:text-orange-300 text-sm disabled:opacity-50">
      <Download size={14} />
      {busy ? 'Preparing…' : 'Download'}
    </button>
  );
}

export default function Reports() {
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery<Report[]>({
    queryKey: ['reports'],
    queryFn: async () => {
      const res = await api.get<{ data: Report[] }>('/reports');
      return res.data.data ?? [];
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/reports/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reports'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <FileText size={20} className="text-orange-400" />
          <h1 className="text-xl font-bold">Reports</h1>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 px-3 py-2 bg-orange-600 hover:bg-orange-700 rounded text-sm font-medium"
        >
          <Plus size={16} />
          Generate Report
        </button>
      </div>

      {showForm && <GenerateForm onClose={() => setShowForm(false)} />}

      {isLoading && (
        <div className="text-slate-400 text-sm py-8 text-center">Loading reports…</div>
      )}
      {isError && (
        <div className="text-red-400 text-sm py-8 text-center">Failed to load reports.</div>
      )}

      {data && (
        <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Title</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Period</th>
                <th className="px-4 py-3 text-left">Format</th>
                <th className="px-4 py-3 text-left">Generated</th>
                <th className="px-4 py-3 text-left">Download</th>
                <th className="px-4 py-3 text-left"></th>
              </tr>
            </thead>
            <tbody>
              {data.map((report) => (
                <tr key={report.id} className="border-t border-slate-700">
                  <td className="px-4 py-3 font-medium">{report.title}</td>
                  <td className="px-4 py-3 text-slate-300">
                    <span className="flex items-center gap-1.5">{TYPE_META[report.type]?.icon}{TYPE_META[report.type]?.label ?? report.type}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">
                    {report.period_from && report.period_to ? `${report.period_from} – ${report.period_to}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-300">{report.format}</td>
                  <td className="px-4 py-3 text-slate-400">
                    {new Date(report.generated_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3"><DownloadButton report={report} /></td>
                  <td className="px-4 py-3">
                    <button onClick={() => deleteMut.mutate(report.id)} className="text-slate-500 hover:text-red-400" aria-label="Delete report">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    No reports generated yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
