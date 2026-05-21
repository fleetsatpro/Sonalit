import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../lib/api.js';
import { subscribe } from '../lib/centrifuge.js';
import { useAuthStore } from '../stores/auth.js';
import type { Alert, AlertSeverity, AlertStatus } from '@sonalit/contracts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AlertListResponse = {
  data: Alert[];
  meta: { total: number; has_more: boolean; next_cursor: string | null };
};

type NewAlertEvent = { type: 'alert.new'; alert: Alert };

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

const SEVERITY_BADGE: Record<AlertSeverity, string> = {
  critical: 'bg-red-900/60 text-red-300 border-red-700',
  warning: 'bg-orange-900/60 text-orange-300 border-orange-700',
  info: 'bg-gray-800 text-gray-400 border-gray-600',
};

const STATUS_BADGE: Record<AlertStatus, string> = {
  open: 'bg-yellow-900/60 text-yellow-300 border-yellow-700',
  acknowledged: 'bg-blue-900/60 text-blue-300 border-blue-700',
  resolved: 'bg-green-900/60 text-green-300 border-green-700',
};

function SeverityBadge({ severity }: { severity: AlertSeverity }): React.ReactElement {
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded border ${SEVERITY_BADGE[severity]}`}>
      {severity}
    </span>
  );
}

function StatusBadge({ status }: { status: AlertStatus }): React.ReactElement {
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded border ${STATUS_BADGE[status]}`}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

export default function Alerts(): React.ReactElement {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const orgId = user?.org_id ?? '';

  const [page, setPage] = useState(1);
  const [severityFilter, setSeverityFilter] = useState<AlertSeverity | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<AlertStatus | 'all'>('all');

  const { data, isLoading, isError } = useQuery<AlertListResponse>({
    queryKey: ['alerts', page, severityFilter, statusFilter],
    queryFn: async () => {
      const res = await api.get<AlertListResponse | Alert[]>('/alerts', {
        params: {
          page,
          limit: PAGE_SIZE,
          severity: severityFilter !== 'all' ? severityFilter : undefined,
          status: statusFilter !== 'all' ? statusFilter : undefined,
        },
      });
      const raw = res.data;
      if (Array.isArray(raw)) {
        return { data: raw, meta: { total: raw.length, has_more: false, next_cursor: null } };
      }
      return raw as AlertListResponse;
    },
    enabled: !!orgId,
    placeholderData: (prev) => prev,
  });

  // Live new-alert events → invalidate
  useEffect(() => {
    if (!orgId) return;
    return subscribe<NewAlertEvent>(`org#${orgId}`, (event) => {
      if (event.type === 'alert.new') {
        void queryClient.invalidateQueries({ queryKey: ['alerts'] });
      }
    });
  }, [orgId, queryClient]);

  const acknowledgeMutation = useMutation<Alert, Error, string>({
    mutationFn: async (id) => {
      const res = await api.patch<Alert>(`/alerts/${id}`, { status: 'acknowledged' });
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
  });

  const totalPages = data?.meta?.total ? Math.ceil(data.meta.total / PAGE_SIZE) : 1;
  const openCount = data?.data.filter((a) => a.status === 'open').length ?? 0;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-amber-400" />
          <h1 className="text-xl font-bold text-white">Alerts</h1>
          {data && (
            <span className="text-sm text-gray-400">
              {openCount} open
            </span>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div>
          <label className="text-xs text-gray-400 block mb-1">Severity</label>
          <select
            value={severityFilter}
            onChange={(e) => { setSeverityFilter(e.target.value as AlertSeverity | 'all'); setPage(1); }}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as AlertStatus | 'all'); setPage(1); }}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading alerts…
        </div>
      )}
      {isError && <p className="text-red-400 text-sm py-8 text-center">Failed to load alerts.</p>}

      {data && (
        <>
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-800 text-gray-400 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Severity</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Title</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Triggered</th>
                  <th className="px-4 py-3 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.data.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                      No alerts.
                    </td>
                  </tr>
                )}
                {data.data.map((alert) => (
                  <tr
                    key={alert.id}
                    className={`border-t border-gray-800 transition-colors ${
                      alert.status === 'open'
                        ? 'hover:bg-gray-800/40'
                        : 'hover:bg-gray-800/20 opacity-70'
                    }`}
                  >
                    <td className="px-4 py-3">
                      <SeverityBadge severity={alert.severity} />
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs font-mono">{alert.type}</td>
                    <td className="px-4 py-3">
                      <p className="text-white font-medium">{alert.title}</p>
                      {alert.body && (
                        <p className="text-gray-500 text-xs mt-0.5 truncate max-w-56">{alert.body}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={alert.status} />
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                      {new Date(alert.triggered_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      {alert.status === 'open' && (
                        <button
                          type="button"
                          onClick={() => acknowledgeMutation.mutate(alert.id)}
                          disabled={acknowledgeMutation.isPending}
                          className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-50 transition-colors"
                          title="Acknowledge"
                        >
                          {acknowledgeMutation.isPending ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <CheckCheck className="w-3 h-3" />
                          )}
                          Ack
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-gray-400">
              <span>Page {page} of {totalPages}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 rounded-lg hover:bg-gray-700 disabled:opacity-40"
                >
                  <ChevronLeft className="w-4 h-4" /> Prev
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 rounded-lg hover:bg-gray-700 disabled:opacity-40"
                >
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
