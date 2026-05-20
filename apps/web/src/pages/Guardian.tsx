import { useQuery } from '@tanstack/react-query';
import { Wifi } from 'lucide-react';
import { api } from '../lib/api.js';

type GuardianStatus = 'healthy' | 'degraded' | 'critical' | 'offline';

type GuardianNode = {
  id: string;
  name: string;
  type: string;
  status: GuardianStatus;
  uptime_pct: number;
  latency_ms: number | null;
  last_heartbeat: string;
  region: string;
};

const STATUS_CONFIG: Record<GuardianStatus, { label: string; color: string; ring: string }> = {
  healthy: { label: 'Healthy', color: 'text-green-400', ring: 'ring-green-500' },
  degraded: { label: 'Degraded', color: 'text-amber-400', ring: 'ring-amber-500' },
  critical: { label: 'Critical', color: 'text-red-400', ring: 'ring-red-500' },
  offline: { label: 'Offline', color: 'text-slate-500', ring: 'ring-slate-600' },
};

export default function GuardianPage() {
  const { data, isLoading, isError } = useQuery<GuardianNode[]>({
    queryKey: ['guardian', 'nodes'],
    queryFn: async () => {
      const { data } = await api.get<GuardianNode[]>('/guardian/nodes');
      return data;
    },
    refetchInterval: 15_000,
  });

  const critical = data?.filter((n) => n.status === 'critical' || n.status === 'offline').length ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Wifi size={20} className="text-blue-400" />
        <h1 className="text-xl font-bold">Guardian</h1>
        {data && (
          <span className={`text-sm ${critical > 0 ? 'text-red-400' : 'text-green-400'}`}>
            {critical > 0 ? `${critical} nodes need attention` : 'All nodes healthy'}
          </span>
        )}
      </div>

      {isLoading && <div className="text-slate-400 text-sm py-12 text-center">Loading guardian nodes…</div>}
      {isError && <div className="text-red-400 text-sm py-12 text-center">Failed to load guardian status.</div>}

      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.map((node) => {
            const cfg = STATUS_CONFIG[node.status];
            return (
              <div key={node.id} className={`bg-slate-900 border border-slate-800 rounded-xl p-5 ring-1 ${cfg.ring}`}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-white">{node.name}</h3>
                    <p className="text-xs text-slate-500">{node.type} — {node.region}</p>
                  </div>
                  <span className={`text-sm font-semibold ${cfg.color}`}>{cfg.label}</span>
                </div>

                <div className="space-y-2">
                  <div>
                    <div className="flex justify-between text-xs text-slate-400 mb-1">
                      <span>Uptime</span>
                      <span className={node.uptime_pct >= 99 ? 'text-green-400' : 'text-amber-400'}>
                        {node.uptime_pct.toFixed(2)}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${node.uptime_pct >= 99 ? 'bg-green-500' : 'bg-amber-500'}`}
                        style={{ width: `${node.uptime_pct}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Latency</span>
                    <span className="text-slate-200">{node.latency_ms !== null ? `${node.latency_ms} ms` : '—'}</span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Last heartbeat</span>
                    <span className="text-slate-200">{new Date(node.last_heartbeat).toLocaleTimeString()}</span>
                  </div>
                </div>
              </div>
            );
          })}
          {data.length === 0 && (
            <div className="col-span-3 text-slate-400 text-sm py-12 text-center">No guardian nodes configured.</div>
          )}
        </div>
      )}
    </div>
  );
}
