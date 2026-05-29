import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Calendar, Plus, XCircle, Clock, Users } from 'lucide-react';

interface Shift {
  id: string;
  driver_id: string | null;
  driver_name: string | null;
  vehicle_id: string | null;
  vehicle_reg: string | null;
  role: string;
  start_time: string;
  end_time: string;
  actual_start: string | null;
  actual_end: string | null;
  status: string;
  notes: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  scheduled: 'bg-blue-900/60 text-blue-300',
  active: 'bg-green-900/60 text-green-300',
  completed: 'bg-gray-700 text-gray-400',
  cancelled: 'bg-red-900/30 text-red-400',
  no_show: 'bg-red-900/60 text-red-300',
};

function fmtTime(t: string) {
  return new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function ShiftsPage() {
  const [showNew, setShowNew] = useState(false);
  const [newShift, setNewShift] = useState({ start_time: '', end_time: '', role: 'driver', notes: '' });
  const qc = useQueryClient();

  const shiftsQ = useQuery<{ data: Shift[] }>({
    queryKey: ['shifts'],
    queryFn: () => api.get('/shifts').then(r => r.data),
    refetchInterval: 30_000,
  });

  const onDutyQ = useQuery<{ data: Shift[] }>({
    queryKey: ['shifts-on-duty'],
    queryFn: () => api.get('/shifts/on-duty').then(r => r.data),
    refetchInterval: 60_000,
  });

  const createMut = useMutation({
    mutationFn: (body: object) => api.post('/shifts', body, {
      headers: { 'X-Idempotency-Key': `shift-${Date.now()}` },
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['shifts'] }); setShowNew(false); },
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => api.delete(`/shifts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shifts'] }),
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-orange-400" />
          <h1 className="text-2xl font-bold text-white">Shifts & Roster</h1>
        </div>
        <button onClick={() => setShowNew(true)} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm">
          <Plus className="w-4 h-4" /> Schedule Shift
        </button>
      </div>

      {/* On Duty Now */}
      {onDutyQ.data && onDutyQ.data.data.length > 0 && (
        <div className="bg-green-900/20 border border-green-800/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-green-400" />
            <span className="text-green-400 font-medium text-sm">On Duty Now ({onDutyQ.data.data.length})</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {onDutyQ.data.data.map(s => (
              <span key={s.id} className="bg-green-900/40 text-green-300 text-xs px-3 py-1 rounded-full">
                {s.driver_name ?? 'Unknown'} {s.vehicle_reg ? `— ${s.vehicle_reg}` : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Shifts Table */}
      <div className="bg-gray-800 rounded-lg overflow-hidden">
        {shiftsQ.isLoading && <div className="p-8 text-center text-gray-400">Loading...</div>}
        {shiftsQ.data && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 border-b border-gray-700 text-xs uppercase">
                <th className="p-3 text-left">Driver</th>
                <th className="p-3 text-left">Vehicle</th>
                <th className="p-3 text-left">Role</th>
                <th className="p-3 text-left">Start</th>
                <th className="p-3 text-left">End</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-left">Action</th>
              </tr>
            </thead>
            <tbody>
              {shiftsQ.data.data.map(s => (
                <tr key={s.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                  <td className="p-3 text-white">{s.driver_name ?? '—'}</td>
                  <td className="p-3 text-gray-300 font-mono text-xs">{s.vehicle_reg ?? '—'}</td>
                  <td className="p-3 text-gray-300 capitalize">{s.role.replace('_', ' ')}</td>
                  <td className="p-3 text-gray-300 text-xs">{fmtTime(s.start_time)}</td>
                  <td className="p-3 text-gray-300 text-xs">{fmtTime(s.end_time)}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[s.status] ?? 'bg-gray-700 text-gray-300'}`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="p-3">
                    {s.status === 'scheduled' && (
                      <button onClick={() => cancelMut.mutate(s.id)} className="text-xs text-red-400 hover:text-red-300">
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {shiftsQ.data.data.length === 0 && (
                <tr><td colSpan={7} className="p-8 text-center text-gray-500">No shifts scheduled</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {showNew && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2"><Clock className="w-4 h-4" /> Schedule Shift</h2>
              <button onClick={() => setShowNew(false)} className="text-gray-400 hover:text-white"><XCircle className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <select value={newShift.role} onChange={e => setNewShift(p => ({ ...p, role: e.target.value }))} className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm">
                <option value="driver">Driver</option>
                <option value="co_driver">Co-Driver</option>
                <option value="loader">Loader</option>
                <option value="escort">Escort</option>
                <option value="supervisor">Supervisor</option>
              </select>
              <div className="space-y-1">
                <label className="text-xs text-gray-400">Start Time</label>
                <input type="datetime-local" value={newShift.start_time} onChange={e => setNewShift(p => ({ ...p, start_time: e.target.value }))} className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-400">End Time</label>
                <input type="datetime-local" value={newShift.end_time} onChange={e => setNewShift(p => ({ ...p, end_time: e.target.value }))} className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm" />
              </div>
              <textarea placeholder="Notes (optional)" value={newShift.notes} onChange={e => setNewShift(p => ({ ...p, notes: e.target.value }))} className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm h-16 resize-none" />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowNew(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
              <button
                onClick={() => createMut.mutate({
                  role: newShift.role,
                  start_time: newShift.start_time ? new Date(newShift.start_time).toISOString() : undefined,
                  end_time: newShift.end_time ? new Date(newShift.end_time).toISOString() : undefined,
                  notes: newShift.notes || undefined,
                })}
                disabled={!newShift.start_time || !newShift.end_time || createMut.isPending}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg"
              >
                {createMut.isPending ? 'Saving...' : 'Schedule'}
              </button>
            </div>
            {createMut.isError && <p className="text-red-400 text-xs">Failed to create shift</p>}
          </div>
        </div>
      )}
    </div>
  );
}
