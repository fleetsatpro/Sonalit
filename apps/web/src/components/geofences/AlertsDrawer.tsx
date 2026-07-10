import { Bell, ChevronLeft } from 'lucide-react';
import { fmtAge } from '../../lib/geoMath.js';
import { SEVERITY_COLOR } from './types.js';
import type { AlertRow } from './types.js';

export default function AlertsDrawer({
  open, onClose, alerts, onAcknowledge, onResolve,
}: {
  open: boolean;
  onClose: () => void;
  alerts: AlertRow[];
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
}) {
  return (
    <div className={`absolute top-0 left-0 h-full w-80 bg-black/90 backdrop-blur border-r border-gray-700 flex flex-col transition-transform duration-300 ${open ? '' : '-translate-x-full'}`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
        <span className="text-sm font-bold text-white flex items-center gap-2"><Bell size={14} className="text-orange-400" /> Alerts ({alerts.length})</span>
        <button onClick={onClose} className="text-gray-400 hover:text-white"><ChevronLeft size={18} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {alerts.length === 0 && <div className="text-xs text-gray-500 font-medium text-center py-6">No open alerts.</div>}
        {alerts.map(a => (
          <div key={a.id} className="bg-gray-800 rounded-lg p-3 space-y-1.5">
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
    </div>
  );
}
