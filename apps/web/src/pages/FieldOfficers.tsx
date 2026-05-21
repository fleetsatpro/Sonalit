import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { subscribe } from '../lib/centrifuge.js';
import { useAuthStore } from '../stores/auth.js';
import { Users, Plus, X, Circle } from 'lucide-react';

type OfficerStatus = 'available' | 'busy' | 'offline';

interface FieldOfficer {
  id: string;
  name: string;
  badge_number: string;
  phone: string;
  assigned_zone: string | null;
  status: OfficerStatus;
}

interface CreateOfficerPayload {
  name: string;
  badge_number: string;
  phone: string;
  assigned_zone: string;
}

interface OfficerStatusEvent {
  officer_id: string;
  status: OfficerStatus;
}

const STATUS_COLORS: Record<OfficerStatus, string> = {
  available: 'text-green-400',
  busy: 'text-yellow-400',
  offline: 'text-slate-500',
};

const STATUS_DOT: Record<OfficerStatus, string> = {
  available: 'bg-green-400',
  busy: 'bg-yellow-400',
  offline: 'bg-slate-600',
};

type FieldKey = keyof CreateOfficerPayload;

function CreateForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateOfficerPayload>({
    name: '',
    badge_number: '',
    phone: '',
    assigned_zone: '',
  });

  const mutation = useMutation({
    mutationFn: (payload: CreateOfficerPayload) =>
      api.post('/field-officers', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['field-officers'] });
      onClose();
    },
  });

  const fields: { key: FieldKey; label: string; placeholder: string }[] = [
    { key: 'name', label: 'Full Name', placeholder: 'John Doe' },
    { key: 'badge_number', label: 'Badge Number', placeholder: 'FO-001' },
    { key: 'phone', label: 'Phone', placeholder: '+254700000000' },
    { key: 'assigned_zone', label: 'Assigned Zone', placeholder: 'Zone A' },
  ];

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 mb-4">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold">Add Field Officer</h3>
        <button onClick={onClose}><X size={16} /></button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {fields.map(({ key, label, placeholder }) => (
          <div key={key}>
            <label className="block text-xs text-slate-400 mb-1">{label}</label>
            <input
              className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              placeholder={placeholder}
              value={form[key]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      {mutation.isError && (
        <p className="text-red-400 text-sm mt-2">Failed to add officer.</p>
      )}
      <button
        onClick={() => mutation.mutate(form)}
        disabled={mutation.isPending || !form.name || !form.badge_number}
        className="mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-sm font-medium"
      >
        {mutation.isPending ? 'Adding…' : 'Add Officer'}
      </button>
    </div>
  );
}

export default function FieldOfficers() {
  const [showForm, setShowForm] = useState(false);
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery<FieldOfficer[]>({
    queryKey: ['field-officers'],
    queryFn: async () => {
      const res = await api.get<FieldOfficer[] | { data: FieldOfficer[] }>('/field-officers');
      const raw = res.data;
      return Array.isArray(raw) ? raw : (raw?.data ?? []);
    },
  });

  useEffect(() => {
    if (!user) return;
    const unsub = subscribe<OfficerStatusEvent>(
      `org#${user.org_id}`,
      (evt) => {
        if (!evt?.officer_id) return;
        queryClient.setQueryData<FieldOfficer[]>(['field-officers'], (prev) =>
          prev?.map((o) =>
            o.id === evt.officer_id ? { ...o, status: evt.status } : o,
          ),
        );
      },
    );
    return unsub;
  }, [user, queryClient]);

  const counts = data
    ? {
        available: data.filter((o) => o.status === 'available').length,
        busy: data.filter((o) => o.status === 'busy').length,
        offline: data.filter((o) => o.status === 'offline').length,
      }
    : null;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Users size={20} className="text-blue-400" />
          <h1 className="text-xl font-bold">Field Officers</h1>
          {counts && (
            <div className="flex items-center gap-3 ml-2 text-xs">
              <span className="text-green-400">{counts.available} available</span>
              <span className="text-yellow-400">{counts.busy} busy</span>
              <span className="text-slate-500">{counts.offline} offline</span>
            </div>
          )}
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium"
        >
          <Plus size={16} />
          Add Officer
        </button>
      </div>

      {showForm && <CreateForm onClose={() => setShowForm(false)} />}

      {isLoading && (
        <div className="text-slate-400 text-sm py-8 text-center">Loading officers…</div>
      )}
      {isError && (
        <div className="text-red-400 text-sm py-8 text-center">Failed to load field officers.</div>
      )}

      {data && (
        <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Badge</th>
                <th className="px-4 py-3 text-left">Phone</th>
                <th className="px-4 py-3 text-left">Zone</th>
                <th className="px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((officer) => (
                <tr key={officer.id} className="border-t border-slate-700 hover:bg-slate-750">
                  <td className="px-4 py-3 font-medium">{officer.name}</td>
                  <td className="px-4 py-3 font-mono text-sm text-slate-300">{officer.badge_number}</td>
                  <td className="px-4 py-3 text-slate-300">{officer.phone}</td>
                  <td className="px-4 py-3 text-slate-400">{officer.assigned_zone ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <Circle
                        size={8}
                        className={`fill-current ${STATUS_DOT[officer.status]} ${STATUS_COLORS[officer.status]}`}
                      />
                      <span className={`text-xs capitalize ${STATUS_COLORS[officer.status]}`}>
                        {officer.status}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    No field officers found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
