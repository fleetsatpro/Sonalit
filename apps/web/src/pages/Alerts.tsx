import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { api } from '../lib/api.js';
import { subscribe } from '../lib/centrifuge.js';
import { useAuthStore } from '../stores/auth.js';

type AlertSeverity = 'info' | 'warning' | 'critical';

type Alert = {
  id: string;
  title: string;
  body: string;
  severity: AlertSeverity;
  acknowledged: boolean;
  created_at: string;
  vehicle_plate: string | null;
};

const SEVERITY_STYLE: Record<AlertSeverity, string> = {
  info: 'border-blue-800 bg-blue-950/40',
  warning: 'border-amber-800 bg-amber-950/40',
  critical: 'border-red-800 bg-red-950/40',
};

const BADGE_STYLE: Record<AlertSeverity, string> = {
  info: 'bg-blue-800 text-blue-200',
  warning: 'bg-amber-800 text-amber-200',
  critical: 'bg-red-800 text-red-200',
};

export default function AlertsPage() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery<Alert[]>({
    queryKey: ['alerts'],
    queryFn: async () => {
      const { data } = await api.get<Alert[]>('/alerts');
      return data;
    },
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!user) return;
    const unsub = subscribe<{ type: string }>(`alerts#${user.org_id}`, () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
    });
    return unsub;
  }, [user, queryClient]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Bell size={20} className="text-amber-400" />
        <h1 className="text-xl font-bold">Alerts</h1>
        {data && (
          <span className="text-sm text-slate-400">
            {data.filter((a) => !a.acknowledged).length} unacknowledged
          </span>
        )}
      </div>

      {isLoading && <div className="text-slate-400 text-sm py-12 text-center">Loading alerts…</div>}
      {isError && <div className="text-red-400 text-sm py-12 text-center">Failed to load alerts.</div>}

      {data && (
        <div className="space-y-3">
          {data.map((a) => (
            <div key={a.id} className={`border rounded-xl p-4 ${SEVERITY_STYLE[a.severity]} ${a.acknowledged ? 'opacity-50' : ''}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium uppercase ${BADGE_STYLE[a.severity]}`}>
                    {a.severity}
                  </span>
                  <span className="font-medium text-white">{a.title}</span>
                  {a.vehicle_plate && (
                    <span className="text-xs font-mono text-slate-400">{a.vehicle_plate}</span>
                  )}
                </div>
                <span className="text-xs text-slate-500 shrink-0">
                  {new Date(a.created_at).toLocaleString()}
                </span>
              </div>
              {a.body && <p className="mt-2 text-sm text-slate-300">{a.body}</p>}
            </div>
          ))}
          {data.length === 0 && (
            <div className="text-slate-400 text-sm py-12 text-center">No alerts.</div>
          )}
        </div>
      )}
    </div>
  );
}
