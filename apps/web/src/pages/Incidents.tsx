import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { subscribe } from '../lib/centrifuge.js';
import { useAuthStore } from '../stores/auth.js';
import { AlertTriangle, ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import * as Y from 'yjs';

type Severity = 'low' | 'medium' | 'high' | 'critical';
type IncidentStatus = 'open' | 'investigating' | 'resolved' | 'closed';

interface Incident {
  id: string;
  title: string;
  description: string;
  severity: Severity;
  status: IncidentStatus;
  assigned_to: string | null;
  created_at: string;
  notes: string;
}

interface CreateIncidentPayload {
  title: string;
  description: string;
  severity: Severity;
}

const SEVERITY_COLORS: Record<Severity, string> = {
  low: 'bg-slate-600 text-slate-200',
  medium: 'bg-yellow-700 text-yellow-100',
  high: 'bg-orange-700 text-orange-100',
  critical: 'bg-red-700 text-red-100',
};

const STATUS_COLORS: Record<IncidentStatus, string> = {
  open: 'bg-blue-700 text-blue-100',
  investigating: 'bg-purple-700 text-purple-100',
  resolved: 'bg-green-700 text-green-100',
  closed: 'bg-slate-600 text-slate-200',
};

function NotesEditor({ incident }: { incident: Incident }) {
  const [text, setText] = useState(incident.notes ?? '');
  const docRef = useRef<Y.Doc | null>(null);
  const textRef = useRef<Y.Text | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const doc = new Y.Doc();
    const yText = doc.getText('notes');
    yText.insert(0, incident.notes ?? '');
    docRef.current = doc;
    textRef.current = yText;
    yText.observe(() => {
      setText(yText.toString());
    });
    return () => { doc.destroy(); };
  }, [incident.id, incident.notes]);

  const patchMutation = useMutation({
    mutationFn: (notes: string) =>
      api.patch(`/incidents/${incident.id}`, { notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
    },
  });

  const handleChange = (value: string) => {
    if (textRef.current && docRef.current) {
      docRef.current.transact(() => {
        textRef.current!.delete(0, textRef.current!.length);
        textRef.current!.insert(0, value);
      });
    }
  };

  return (
    <div className="p-4 bg-slate-800 border-t border-slate-700">
      <p className="text-xs text-slate-400 mb-2">Collaborative Notes</p>
      <textarea
        className="w-full bg-slate-900 text-slate-100 rounded p-2 text-sm border border-slate-600 focus:outline-none focus:border-blue-500 resize-none"
        rows={4}
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Add collaborative notes..."
      />
      <button
        onClick={() => patchMutation.mutate(text)}
        disabled={patchMutation.isPending}
        className="mt-2 px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-sm"
      >
        {patchMutation.isPending ? 'Saving…' : 'Save Notes'}
      </button>
    </div>
  );
}

function CreateIncidentForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateIncidentPayload>({
    title: '',
    description: '',
    severity: 'medium',
  });

  const mutation = useMutation({
    mutationFn: (payload: CreateIncidentPayload) =>
      api.post('/incidents', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      onClose();
    },
  });

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 mb-4">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold">Create Incident</h3>
        <button onClick={onClose}><X size={16} /></button>
      </div>
      <div className="space-y-3">
        <input
          className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
          placeholder="Title"
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        />
        <textarea
          className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500 resize-none"
          placeholder="Description"
          rows={3}
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
        <select
          className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
          value={form.severity}
          onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value as Severity }))}
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
        {mutation.isError && (
          <p className="text-red-400 text-sm">Failed to create incident.</p>
        )}
        <button
          onClick={() => mutation.mutate(form)}
          disabled={mutation.isPending || !form.title}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-sm font-medium"
        >
          {mutation.isPending ? 'Creating…' : 'Create Incident'}
        </button>
      </div>
    </div>
  );
}

export default function Incidents() {
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const { data, isLoading, isError } = useQuery<Incident[]>({
    queryKey: ['incidents'],
    queryFn: async () => {
      const res = await api.get<Incident[] | { data: Incident[] }>('/incidents');
      return Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
    },
  });

  useEffect(() => {
    if (!user) return;
    const unsub = subscribe<{ id: string }>(
      `org#${user.org_id}`,
      (evt) => {
        if (evt && 'id' in evt) {
          queryClient.invalidateQueries({ queryKey: ['incidents'] });
        }
      },
    );
    return unsub;
  }, [user, queryClient]);

  const toggleRow = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <AlertTriangle size={20} className="text-orange-400" />
          <h1 className="text-xl font-bold">Incidents</h1>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium"
        >
          <Plus size={16} />
          Create Incident
        </button>
      </div>

      {showForm && <CreateIncidentForm onClose={() => setShowForm(false)} />}

      {isLoading && (
        <div className="text-slate-400 text-sm py-8 text-center">Loading incidents…</div>
      )}
      {isError && (
        <div className="text-red-400 text-sm py-8 text-center">Failed to load incidents.</div>
      )}

      {data && (
        <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left w-8"></th>
                <th className="px-4 py-3 text-left">Title</th>
                <th className="px-4 py-3 text-left">Severity</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Assigned To</th>
                <th className="px-4 py-3 text-left">Created</th>
              </tr>
            </thead>
            <tbody>
              {data.map((incident) => (
                <React.Fragment key={incident.id}>
                  <tr
                    className="border-t border-slate-700 hover:bg-slate-750 cursor-pointer"
                    onClick={() => toggleRow(incident.id)}
                  >
                    <td className="px-4 py-3 text-slate-400">
                      {expandedId === incident.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </td>
                    <td className="px-4 py-3 font-medium">{incident.title}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${SEVERITY_COLORS[incident.severity]}`}>
                        {incident.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[incident.status]}`}>
                        {incident.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{incident.assigned_to ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-400">
                      {new Date(incident.created_at).toLocaleString()}
                    </td>
                  </tr>
                  {expandedId === incident.id && (
                    <tr className="border-t border-slate-700">
                      <td colSpan={6} className="p-0">
                        <NotesEditor incident={incident} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {data.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    No incidents found.
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
