import { fmtAge } from '../../lib/geoMath.js';
import { SEVERITY_COLOR } from './types.js';
import type { AlertRow } from './types.js';

export default function AlertsDrawer({
  alerts, onAcknowledge, onResolve,
}: {
  alerts: AlertRow[];
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
}) {
  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-3 space-y-2">
      {alerts.length === 0 && <div className="text-sm text-gray-400 font-medium text-center py-8">No open alerts.</div>}
      {alerts.map(a => (
        <div key={a.id} className="bg-gray-900/60 rounded-lg p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className={`text-xs font-bold uppercase ${SEVERITY_COLOR[a.severity] ?? 'text-gray-300'}`}>{a.severity}</span>
            <span className="text-xs text-gray-500 font-medium">{fmtAge(a.created_at)}</span>
          </div>
          <div className="text-sm text-white font-medium">{a.message}</div>
          <div className="text-xs text-gray-400 font-medium">{a.vehicle_reg ?? 'Unassigned'}{a.region ? ` · ${a.region}` : ''}</div>
          <div className="flex gap-2 pt-1">
            {!a.acknowledged_at && <button onClick={() => onAcknowledge(a.id)} className="text-xs font-bold text-cyan-400 hover:text-cyan-300">Acknowledge</button>}
            {a.acknowledged_at && <button onClick={() => onResolve(a.id)} className="text-xs font-bold text-green-400 hover:text-green-300">Resolve</button>}
          </div>
        </div>
      ))}
    </div>
  );
}
