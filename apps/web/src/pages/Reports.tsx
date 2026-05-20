import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { FileText, Download, Plus, X, RefreshCw } from 'lucide-react';

type ReportStatus = 'pending' | 'ready' | 'failed';
type ReportType = 'convoy' | 'fleet' | 'driver';
type ReportFormat = 'PDF' | 'CSV';

interface Report {
  id: string;
  title: string;
  type: ReportType;
  generated_at: string;
  status: ReportStatus;
  url: string | null;
}

interface GenerateReportPayload {
  type: ReportType;
  from: string;
  to: string;
  format: ReportFormat;
}

const STATUS_STYLES: Record<ReportStatus, string> = {
  pending: 'bg-yellow-800 text-yellow-200',
  ready: 'bg-green-800 text-green-200',
  failed: 'bg-red-800 text-red-200',
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
    mutationFn: (payload: GenerateReportPayload) =>
      api.post('/reports', payload),
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
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Type</label>
          <select
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as ReportType }))}
          >
            <option value="convoy">Convoy</option>
            <option value="fleet">Fleet</option>
            <option value="driver">Driver</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Format</label>
          <select
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
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
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            value={form.from}
            onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">To</label>
          <input
            type="date"
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
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
        className="mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-sm font-medium"
      >
        {mutation.isPending ? 'Generating…' : 'Generate'}
      </button>
    </div>
  );
}

export default function Reports() {
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading, isError } = useQuery<Report[]>({
    queryKey: ['reports'],
    queryFn: async () => {
      const res = await api.get<Report[]>('/reports');
      return res.data;
    },
    refetchInterval: (query) => {
      const reports = query.state.data;
      if (!reports) return 10_000;
      const hasPending = reports.some((r) => r.status === 'pending');
      return hasPending ? 10_000 : false;
    },
  });

  const hasPending = data?.some((r) => r.status === 'pending') ?? false;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <FileText size={20} className="text-blue-400" />
          <h1 className="text-xl font-bold">Reports</h1>
          {hasPending && (
            <div className="flex items-center gap-1 text-xs text-yellow-400">
              <RefreshCw size={12} className="animate-spin" />
              Polling for updates…
            </div>
          )}
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium"
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
        <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Title</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Generated</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Download</th>
              </tr>
            </thead>
            <tbody>
              {data.map((report) => (
                <tr key={report.id} className="border-t border-slate-700">
                  <td className="px-4 py-3 font-medium">{report.title}</td>
                  <td className="px-4 py-3 capitalize text-slate-300">{report.type}</td>
                  <td className="px-4 py-3 text-slate-400">
                    {new Date(report.generated_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[report.status]}`}>
                      {report.status === 'pending' ? (
                        <span className="flex items-center gap-1">
                          <RefreshCw size={10} className="animate-spin" />
                          pending
                        </span>
                      ) : report.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {report.status === 'ready' && report.url ? (
                      <a
                        href={report.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 text-blue-400 hover:text-blue-300 text-sm"
                      >
                        <Download size={14} />
                        Download
                      </a>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
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
