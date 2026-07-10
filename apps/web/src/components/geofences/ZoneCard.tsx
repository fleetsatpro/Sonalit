import { Bell, Trash2, ChevronDown, ChevronRight, Circle as CircleIcon, Waypoints, CheckCircle2 } from 'lucide-react';
import CorridorStats from './CorridorStats.js';
import { ACTION_TYPE_META } from './types.js';
import type { Geofence, MapGeofence, MapVehicle, GeofenceEvent, GeofenceAction } from './types.js';

interface NewActionForm { action_type: string; recipient: string; message_template: string }

export default function ZoneCard({
  zone, mapGeofence, vehicles, events, expanded, onToggleExpand, onToggleActive, onDelete,
  actions, newAction, setNewAction, onAddAction, onToggleAction, onDeleteAction, addActionPending,
  onEscalate, escalating,
}: {
  zone: Geofence;
  mapGeofence: MapGeofence | undefined;
  vehicles: MapVehicle[];
  events: GeofenceEvent[];
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
  actions: GeofenceAction[];
  newAction: NewActionForm;
  setNewAction: (f: NewActionForm) => void;
  onAddAction: () => void;
  onToggleAction: (id: string) => void;
  onDeleteAction: (id: string) => void;
  addActionPending: boolean;
  onEscalate: (vehicleIds: string[]) => void;
  escalating: boolean;
}) {
  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <button onClick={onToggleExpand} className="text-gray-400 hover:text-white">{expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</button>
        {zone.type === 'corridor' ? <Waypoints size={16} className="text-blue-400 shrink-0" /> : <CircleIcon size={16} className="text-cyan-400 shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-white truncate">{zone.name}</div>
          <div className="text-xs text-gray-400 font-medium">{zone.type} · {zone.region ?? 'Unassigned'}{zone.radius ? ` · ${Math.round(zone.radius)}m` : ''}</div>
        </div>
        <span className={`text-xs font-bold px-2 py-1 rounded ${zone.active ? 'bg-green-900/60 text-green-300' : 'bg-gray-700 text-gray-400'}`}>{zone.active ? 'ACTIVE' : 'INACTIVE'}</span>
        <button onClick={onToggleActive} className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 px-2">{zone.active ? 'Disable' : 'Enable'}</button>
        <button onClick={onDelete} className="text-gray-500 hover:text-red-400"><Trash2 size={16} /></button>
      </div>
      {expanded && (
        <div className="border-t border-gray-700 bg-gray-900/60 px-4 py-3 space-y-3">
          <div className="flex items-center gap-4 text-xs font-semibold text-gray-400"><span className="flex items-center gap-1"><CheckCircle2 size={12} /> {events.filter(e => e.geofence_id === zone.id).length} events recorded</span></div>
          {zone.type === 'corridor' && mapGeofence && (
            <CorridorStats corridor={mapGeofence} vehicles={vehicles} events={events} escalating={escalating} onEscalate={onEscalate} />
          )}
          <div className="flex items-center gap-2 text-sm font-bold text-white"><Bell size={14} className="text-yellow-400" /> Notification Actions</div>
          {actions.map(a => (
            <div key={a.id} className="flex items-center gap-3 bg-gray-800 rounded px-3 py-2">
              <span className="text-sm font-semibold text-white w-24">{ACTION_TYPE_META[a.action_type]?.label ?? a.action_type}</span>
              <span className="text-xs text-gray-400 flex-1 truncate">{a.recipient ?? '—'}</span>
              <button onClick={() => onToggleAction(a.id)} className={`text-xs font-bold px-2 py-0.5 rounded ${a.enabled ? 'bg-green-900/60 text-green-300' : 'bg-gray-700 text-gray-400'}`}>{a.enabled ? 'ON' : 'OFF'}</button>
              <button onClick={() => onDeleteAction(a.id)} className="text-gray-500 hover:text-red-400"><Trash2 size={14} /></button>
            </div>
          ))}
          {actions.length === 0 && <div className="text-xs text-gray-500 font-medium">No notification actions configured.</div>}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <select value={newAction.action_type} onChange={e => setNewAction({ ...newAction, action_type: e.target.value })} className="bg-gray-800 text-white text-xs font-semibold px-2 py-1.5 rounded">
              {Object.entries(ACTION_TYPE_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
            </select>
            <input placeholder="Recipient (phone/email)" value={newAction.recipient} onChange={e => setNewAction({ ...newAction, recipient: e.target.value })} className="bg-gray-800 text-white text-xs px-2 py-1.5 rounded flex-1 min-w-[160px]" />
            <button onClick={onAddAction} disabled={!newAction.recipient || addActionPending} className="bg-cyan-600 hover:bg-cyan-700 disabled:opacity-40 text-white text-xs font-bold px-3 py-1.5 rounded">Add Action</button>
          </div>
        </div>
      )}
    </div>
  );
}
