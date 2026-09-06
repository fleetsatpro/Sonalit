import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Clock, Users, Plus, XCircle, Repeat, CheckCircle2, CalendarClock, X } from 'lucide-react';

type Tab = 'roster' | 'on-duty' | 'coverage';

interface Shift {
  id: string;
  driver_id: string | null;
  driver_name: string | null;
  driver_phone?: string | null;
  vehicle_id: string | null;
  vehicle_reg: string | null;
  convoy_id: string | null;
  role: string;
  start_time: string;
  end_time: string;
  actual_start: string | null;
  actual_end: string | null;
  status: 'scheduled' | 'active' | 'completed' | 'cancelled' | 'no_show';
  notes: string | null;
}

interface CoverageDay {
  day: string;
  drivers_scheduled: string;
  shifts_count: string;
}

interface DriverUser { id: string; name: string; email: string; role: string; status: string }
interface Vehicle { id: string; registration: string }

const STATUS_STYLE: Record<Shift['status'], string> = {
  scheduled: 'bg-blue-500/15 text-blue-400',
  active: 'bg-green-500/15 text-green-400',
  completed: 'bg-gray-500/15 text-gray-400',
  cancelled: 'bg-red-500/15 text-red-400',
  no_show: 'bg-yellow-500/15 text-yellow-400',
};

const ROLE_LABELS: Record<string, string> = {
  driver: 'Driver',
  co_driver: 'Co-Driver',
  loader: 'Loader',
  escort: 'Escort',
  supervisor: 'Supervisor',
};

function fmt(t: string | null): string {
  if (!t) return '—';
  return new Date(t).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function ShiftsPage() {
  const [tab, setTab] = useState<Tab>('roster');
  const [showCreate, setShowCreate] = useState(false);
  const [handoverFor, setHandoverFor] = useState<Shift | null>(null);
  const qc = useQueryClient();

  const [form, setForm] = useState({ driver_id: '', vehicle_id: '', convoy_id: '', role: 'driver', start_time: '', end_time: '', notes: '' });

  const rosterQ = useQuery<{ data: Shift[] }>({
    queryKey: ['shifts-roster'],
    queryFn: () => api.get('/shifts').then(r => r.data),
    enabled: tab === 'roster',
  });

  const onDutyQ = useQuery<{ data: Shift[] }>({
    queryKey: ['shifts-on-duty'],
    queryFn: () => api.get('/shifts/on-duty').then(r => r.data),
    enabled: tab === 'on-duty',
    refetchInterval: tab === 'on-duty' ? 20_000 : false,
  });

  const coverageQ = useQuery<{ data: CoverageDay[] }>({
    queryKey: ['shifts-coverage'],
    queryFn: () => api.get('/shifts/coverage').then(r => r.data),
    enabled: tab === 'coverage',
  });

  const driversQ = useQuery<{ data: DriverUser[] }>({
    queryKey: ['users-drivers'],
    queryFn: () => api.get('/auth/users?role=driver&limit=200').then(r => r.data),
    enabled: showCreate,
  });

  const vehiclesQ = useQuery<{ data: Vehicle[] }>({
    queryKey: ['vehicles-lite'],
    queryFn: () => api.get('/vehicles?limit=200').then(r => r.data),
    enabled: showCreate,
  });

  // Candidate "next" shifts a handover can roll onto — same vehicle, still scheduled, starts after this shift's start.
  const handoverTargets = useMemo(() => {
    if (!handoverFor || !rosterQ.data) return [];
    return rosterQ.data.data.filter(s =>
      s.id !== handoverFor.id &&
      s.status === 'scheduled' &&
      s.vehicle_id === handoverFor.vehicle_id &&
      new Date(s.start_time) >= new Date(handoverFor.start_time),
    );
  }, [handoverFor, rosterQ.data]);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['shifts-roster'] });
    qc.invalidateQueries({ queryKey: ['shifts-on-duty'] });
    qc.invalidateQueries({ queryKey: ['shifts-coverage'] });
  };

  const createMut = useMutation({
    mutationFn: (body: object) => api.post('/shifts', body, { headers: { 'X-Idempotency-Key': `shift-${Date.now()}` } }),
    onSuccess: () => {
      invalidateAll();
      setShowCreate(false);
      setForm({ driver_id: '', vehicle_id: '', convoy_id: '', role: 'driver', start_time: '', end_time: '', notes: '' });
    },
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => api.delete(`/shifts/${id}`),
    onSuccess: invalidateAll,
  });

  const [handoverForm, setHandoverForm] = useState({ to_shift_id: '', odometer_km: '', fuel_level_pct: '', condition_notes: '', seal_intact: true });

  const handoverMut = useMutation({
    mutationFn: (body: object) => api.post(`/shifts/${handoverFor!.id}/handover`, body),
    onSuccess: () => {
      invalidateAll();
      setHandoverFor(null);
      setHandoverForm({ to_shift_id: '', odometer_km: '', fuel_level_pct: '', condition_notes: '', seal_intact: true });
    },
  });

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'roster', label: 'Roster', icon: <CalendarClock className="w-4 h-4" /> },
    { id: 'on-duty', label: 'On Duty', icon: <Users className="w-4 h-4" /> },
    { id: 'coverage', label: 'Coverage', icon: <Clock className="w-4 h-4" /> },
  ];

  const activeQ = tab === 'roster' ? rosterQ : tab === 'on-duty' ? onDutyQ : null;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Shifts &amp; Roster</h1>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm">
          <Plus className="w-4 h-4" /> New Shift
        </button>
      </div>

      <div className="flex gap-1 bg-gray-800 p-1 rounded-lg w-fit">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm transition-colors ${tab === t.id ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {(tab === 'roster' || tab === 'on-duty') && (
        <div className="bg-gray-800 rounded-lg overflow-hidden">
          {activeQ?.isLoading && <div className="p-8 text-center text-gray-400">Loading...</div>}
          {activeQ?.isError && <div className="p-8 text-center text-red-400">Failed to load shifts</div>}
          {activeQ?.data && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="p-3 text-left">Driver</th>
                  {tab === 'on-duty' && <th className="p-3 text-left">Phone</th>}
                  <th className="p-3 text-left">Role</th>
                  <th className="p-3 text-left">Vehicle</th>
                  <th className="p-3 text-left">Start</th>
                  <th className="p-3 text-left">End</th>
                  <th className="p-3 text-left">Status</th>
                  <th className="p-3 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {activeQ.data.data.map(s => (
                  <tr key={s.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                    <td className="p-3 text-gray-200">{s.driver_name ?? '—'}</td>
                    {tab === 'on-duty' && <td className="p-3 text-gray-400 text-xs font-mono">{s.driver_phone ?? '—'}</td>}
                    <td className="p-3 text-gray-300">{ROLE_LABELS[s.role] ?? s.role}</td>
                    <td className="p-3 font-mono text-xs text-gray-300">{s.vehicle_reg ?? '—'}</td>
                    <td className="p-3 text-gray-400 text-xs">{fmt(s.start_time)}</td>
                    <td className="p-3 text-gray-400 text-xs">{fmt(s.end_time)}</td>
                    <td className="p-3"><span className={`text-xs px-2 py-0.5 rounded capitalize ${STATUS_STYLE[s.status]}`}>{s.status.replace('_', ' ')}</span></td>
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        {s.status === 'active' && (
                          <button onClick={() => setHandoverFor(s)} className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
                            <Repeat className="w-3 h-3" /> Handover
                          </button>
                        )}
                        {s.status === 'scheduled' && (
                          <button onClick={() => cancelMut.mutate(s.id)} className="text-xs text-red-400 hover:text-red-300">Cancel</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {activeQ.data.data.length === 0 && (
                  <tr><td colSpan={tab === 'on-duty' ? 8 : 7} className="p-8 text-center text-gray-500">
                    {tab === 'on-duty' ? 'No drivers currently on shift' : 'No shifts scheduled yet'}
                  </td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'coverage' && (
        <div className="bg-gray-800 rounded-lg overflow-hidden">
          {coverageQ.isLoading && <div className="p-8 text-center text-gray-400">Loading...</div>}
          {coverageQ.data && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="p-3 text-left">Day</th>
                  <th className="p-3 text-right">Drivers Scheduled</th>
                  <th className="p-3 text-right">Shifts</th>
                </tr>
              </thead>
              <tbody>
                {coverageQ.data.data.map(d => (
                  <tr key={d.day} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                    <td className="p-3 text-gray-200">{new Date(d.day).toLocaleDateString([], { weekday: 'short', month: 'short', day: '2-digit' })}</td>
                    <td className="p-3 text-right text-white">{d.drivers_scheduled}</td>
                    <td className="p-3 text-right text-gray-300">{d.shifts_count}</td>
                  </tr>
                ))}
                {coverageQ.data.data.length === 0 && (
                  <tr><td colSpan={3} className="p-8 text-center text-gray-500">No upcoming shifts in the next 7 days</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Create Shift Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">New Shift</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <select value={form.driver_id} onChange={e => setForm(p => ({ ...p, driver_id: e.target.value }))} className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm">
                <option value="">Select driver...</option>
                {driversQ.data?.data.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <select value={form.vehicle_id} onChange={e => setForm(p => ({ ...p, vehicle_id: e.target.value }))} className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm">
                <option value="">Select vehicle...</option>
                {vehiclesQ.data?.data.map(v => <option key={v.id} value={v.id}>{v.registration}</option>)}
              </select>
              <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))} className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm">
                {Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <label className="block text-xs text-gray-400">Start</label>
              <input type="datetime-local" value={form.start_time} onChange={e => setForm(p => ({ ...p, start_time: e.target.value }))} className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm" />
              <label className="block text-xs text-gray-400">End</label>
              <input type="datetime-local" value={form.end_time} onChange={e => setForm(p => ({ ...p, end_time: e.target.value }))} className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm" />
              <textarea placeholder="Notes" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm" rows={2} />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
              <button
                onClick={() => createMut.mutate({
                  driver_id: form.driver_id || undefined,
                  vehicle_id: form.vehicle_id || undefined,
                  role: form.role,
                  start_time: new Date(form.start_time).toISOString(),
                  end_time: new Date(form.end_time).toISOString(),
                  notes: form.notes || undefined,
                })}
                disabled={!form.start_time || !form.end_time || createMut.isPending}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg"
              >
                {createMut.isPending ? 'Saving...' : 'Create Shift'}
              </button>
            </div>
            {createMut.isError && <p className="text-red-400 text-xs">Failed to create shift</p>}
          </div>
        </div>
      )}

      {/* Handover Modal */}
      {handoverFor && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Shift Handover</h2>
              <button onClick={() => setHandoverFor(null)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-xs text-gray-400">Ending shift for <span className="text-gray-200">{handoverFor.driver_name ?? 'this driver'}</span> and rolling the vehicle onto the next shift.</p>
            <div className="space-y-3">
              <select value={handoverForm.to_shift_id} onChange={e => setHandoverForm(p => ({ ...p, to_shift_id: e.target.value }))} className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm">
                <option value="">Select incoming shift...</option>
                {handoverTargets.map(s => (
                  <option key={s.id} value={s.id}>{s.driver_name ?? 'Unassigned'} — {fmt(s.start_time)}</option>
                ))}
              </select>
              <input placeholder="Odometer (km)" type="number" value={handoverForm.odometer_km} onChange={e => setHandoverForm(p => ({ ...p, odometer_km: e.target.value }))} className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm" />
              <input placeholder="Fuel level (%)" type="number" min={0} max={100} value={handoverForm.fuel_level_pct} onChange={e => setHandoverForm(p => ({ ...p, fuel_level_pct: e.target.value }))} className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm" />
              <textarea placeholder="Condition notes" value={handoverForm.condition_notes} onChange={e => setHandoverForm(p => ({ ...p, condition_notes: e.target.value }))} className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm" rows={2} />
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input type="checkbox" checked={handoverForm.seal_intact} onChange={e => setHandoverForm(p => ({ ...p, seal_intact: e.target.checked }))} />
                Seal intact
              </label>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setHandoverFor(null)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
              <button
                onClick={() => handoverMut.mutate({
                  to_shift_id: handoverForm.to_shift_id,
                  odometer_km: handoverForm.odometer_km ? parseFloat(handoverForm.odometer_km) : undefined,
                  fuel_level_pct: handoverForm.fuel_level_pct ? parseInt(handoverForm.fuel_level_pct, 10) : undefined,
                  condition_notes: handoverForm.condition_notes || undefined,
                  seal_intact: handoverForm.seal_intact,
                })}
                disabled={!handoverForm.to_shift_id || handoverMut.isPending}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg"
              >
                <CheckCircle2 className="w-4 h-4" /> {handoverMut.isPending ? 'Submitting...' : 'Complete Handover'}
              </button>
            </div>
            {handoverMut.isError && <p className="text-red-400 text-xs flex items-center gap-1"><XCircle className="w-3 h-3" /> Failed to record handover</p>}
          </div>
        </div>
      )}
    </div>
  );
}
