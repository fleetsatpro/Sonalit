import { X, Circle as CircleIcon, Waypoints, Minus, Bell, Trash2, Plus } from 'lucide-react';
import { REGIONS, ACTION_TYPE_META } from './types.js';

type DrawMode = 'circle' | 'linear' | 'corridor' | null;
interface Form { name: string; region: string; radius: string; buffer_km: string }
interface PendingAction { action_type: string; recipient: string }

const TYPE_META: { type: Exclude<DrawMode, null>; label: string; hint: string; icon: React.ReactNode }[] = [
  { type: 'circle', label: 'Circle', hint: 'A radius around one point', icon: <CircleIcon size={18} /> },
  { type: 'linear', label: 'Linear', hint: 'A plain route line, no buffer', icon: <Minus size={18} /> },
  { type: 'corridor', label: 'Corridor', hint: 'A route line with a buffered safety band', icon: <Waypoints size={18} /> },
];

export default function CreateGeofenceModal({
  drawMode, drawCenter, drawPath, form, setForm, pendingActions, setPendingActions,
  onStartDraw, onClose, onSubmit, submitting, error,
}: {
  drawMode: DrawMode;
  drawCenter: [number, number] | null;
  drawPath: [number, number][];
  form: Form;
  setForm: (f: Form) => void;
  pendingActions: PendingAction[];
  setPendingActions: (a: PendingAction[]) => void;
  onStartDraw: (mode: DrawMode) => void;
  onClose: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: boolean;
}) {
  const addAction = () => setPendingActions([...pendingActions, { action_type: 'sms', recipient: '' }]);
  const updateAction = (i: number, patch: Partial<PendingAction>) => setPendingActions(pendingActions.map((a, idx) => idx === i ? { ...a, ...patch } : a));
  const removeAction = (i: number) => setPendingActions(pendingActions.filter((_, idx) => idx !== i));

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Add Geofence</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        {!drawMode && (
          <div className="space-y-4">
            <input placeholder="Zone Name *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm font-medium" />
            <select value={form.region} onChange={e => setForm({ ...form, region: e.target.value })} className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm font-medium">
              {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>

            <div className="text-xs font-bold text-gray-400 uppercase tracking-wide">Shape</div>
            {form.name.trim().length === 0 && <p className="text-xs text-gray-500 font-medium -mt-2">Name the zone, then pick a shape below to draw it on the map.</p>}

            <div className="grid grid-cols-1 gap-2">
              {TYPE_META.map(t => (
                <button
                  key={t.type}
                  onClick={() => onStartDraw(t.type)}
                  disabled={!form.name.trim()}
                  className="flex items-center gap-3 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-3 rounded-lg text-left"
                >
                  <span className="text-cyan-400">{t.icon}</span>
                  <span>
                    <div className="text-sm font-semibold">{t.label}</div>
                    <div className="text-xs text-gray-400 font-medium">{t.hint}</div>
                  </span>
                </button>
              ))}
            </div>

            <div className="border-t border-gray-700 pt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wide flex items-center gap-1.5"><Bell size={12} className="text-yellow-400" /> Notification Actions (optional)</span>
                <button onClick={addAction} className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 flex items-center gap-1"><Plus size={12} /> Add</button>
              </div>
              {pendingActions.length === 0 && <div className="text-xs text-gray-500 font-medium">No actions configured — you can add these later too.</div>}
              <div className="space-y-2">
                {pendingActions.map((a, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select value={a.action_type} onChange={e => updateAction(i, { action_type: e.target.value })} className="bg-gray-700 text-white text-xs font-semibold px-2 py-2 rounded">
                      {Object.entries(ACTION_TYPE_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
                    </select>
                    <input placeholder="Phone / email" value={a.recipient} onChange={e => updateAction(i, { recipient: e.target.value })} className="flex-1 bg-gray-700 text-white text-xs px-2 py-2 rounded" />
                    <button onClick={() => removeAction(i)} className="text-gray-500 hover:text-red-400"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {drawMode && (
          <div className="space-y-3">
            <div className="text-xs font-bold text-cyan-400 uppercase tracking-wide">
              {drawMode === 'circle'
                ? `Center: ${drawCenter ? `${drawCenter[0].toFixed(4)}, ${drawCenter[1].toFixed(4)}` : 'not set'} · Radius: ${form.radius}m`
                : `${drawPath.length} points captured${drawMode === 'corridor' ? ` · Buffer ${form.buffer_km}km` : ''}`}
            </div>
            {drawMode === 'circle' && (
              <input type="number" value={form.radius} onChange={e => setForm({ ...form, radius: e.target.value })} placeholder="Radius (m)" className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm font-medium" />
            )}
            {drawMode === 'corridor' && (
              <input type="number" value={form.buffer_km} onChange={e => setForm({ ...form, buffer_km: e.target.value })} placeholder="Buffer width (km)" className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm font-medium" />
            )}
            <div className="flex gap-3 justify-end">
              <button onClick={() => onStartDraw(null)} className="px-4 py-2 text-sm font-semibold text-gray-400 hover:text-white">Back</button>
              <button
                onClick={onSubmit}
                disabled={!form.name || submitting || (drawMode === 'circle' ? !drawCenter : drawPath.length < 2)}
                className="px-4 py-2 text-sm font-bold bg-cyan-600 hover:bg-cyan-700 disabled:opacity-40 text-white rounded-lg"
              >
                {submitting ? 'Creating…' : 'Create Geofence'}
              </button>
            </div>
            {error && <p className="text-red-400 text-xs font-semibold">Failed to create geofence.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
