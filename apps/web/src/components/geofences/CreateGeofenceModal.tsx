import { X, Circle as CircleIcon, Waypoints } from 'lucide-react';
import { REGIONS } from './types.js';

type DrawMode = 'circle' | 'corridor' | null;
interface Form { name: string; region: string; radius: string; buffer_km: string }

export default function CreateGeofenceModal({
  drawMode, drawCenter, drawPath, form, setForm, onStartDraw, onClose, onSubmit, submitting, error,
}: {
  drawMode: DrawMode;
  drawCenter: [number, number] | null;
  drawPath: [number, number][];
  form: Form;
  setForm: (f: Form) => void;
  onStartDraw: (mode: DrawMode) => void;
  onClose: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">New Geofence</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        {!drawMode && (
          <div className="space-y-3">
            <p className="text-sm text-gray-300 font-medium">Choose a shape and draw it on the map first.</p>
            <div className="flex gap-2">
              <button onClick={() => onStartDraw('circle')} className="flex-1 flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-lg text-sm font-semibold"><CircleIcon size={16} /> Circle Zone</button>
              <button onClick={() => onStartDraw('corridor')} className="flex-1 flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-lg text-sm font-semibold"><Waypoints size={16} /> Corridor</button>
            </div>
          </div>
        )}
        {drawMode && (
          <div className="space-y-3">
            <div className="text-xs font-bold text-cyan-400 uppercase tracking-wide">
              {drawMode === 'circle'
                ? `Center: ${drawCenter ? `${drawCenter[0].toFixed(4)}, ${drawCenter[1].toFixed(4)}` : 'not set'} · Radius: ${form.radius}m`
                : `${drawPath.length} points captured · Buffer ${form.buffer_km}km`}
            </div>
            <input placeholder="Zone Name *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm font-medium" />
            <select value={form.region} onChange={e => setForm({ ...form, region: e.target.value })} className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm font-medium">
              {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <div className="flex gap-3 justify-end">
              <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-gray-400 hover:text-white">Cancel</button>
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
