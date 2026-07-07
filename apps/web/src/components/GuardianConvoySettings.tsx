import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Smartphone, Plus, Trash2, KeyRound, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { Link } from '@tanstack/react-router';

const INPUT_CLS = 'w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-orange-500';
const BTN_PRIMARY = 'text-sm bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg';
const BTN_GHOST = 'text-sm text-slate-400 hover:text-white';

interface CfoAssignment {
  id: string;
  name: string;
  email: string;
  status: string;
  assignment_id: string | null;
  convoy_id: string | null;
  convoy_name: string | null;
  convoy_status: string | null;
}

interface Convoy {
  id: string;
  name: string;
  status: string;
}

function StatusBadge({ status }: { status: string }) {
  const color = status === 'active' ? 'text-green-400 bg-green-900/30 border-green-700'
    : 'text-slate-400 bg-slate-800 border-slate-600';
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${color}`}>{status}</span>
  );
}

function ConvoyBadge({ name, status }: { name: string; status: string }) {
  const color = status === 'active' ? 'text-lime-400' : 'text-slate-400';
  return <span className={`text-sm font-mono ${color}`}>{name}</span>;
}

export function GuardianConvoySettings() {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', email: '', password: '' });
  const [createError, setCreateError] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [newPin, setNewPin] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [selectedConvoy, setSelectedConvoy] = useState('');

  const { data: cfoData, isLoading } = useQuery({
    queryKey: ['cfo-assignments'],
    queryFn: () => api.get<{ data: CfoAssignment[] }>('/auth/cfo-assignments').then(r => r.data),
  });

  const { data: convoysData } = useQuery({
    queryKey: ['convoys-simple'],
    queryFn: () =>
      api.get<{ data: Convoy[] }>('/convoys?limit=100').then(r => r.data),
    enabled: assignFor !== null,
  });

  const cfos: CfoAssignment[] = cfoData?.data ?? [];
  const convoys: Convoy[] = convoysData?.data ?? [];

  const createMut = useMutation({
    mutationFn: (body: typeof createForm) =>
      api.post('/auth/users', { ...body, role: 'cfo' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cfo-assignments'] });
      setShowCreate(false);
      setCreateForm({ name: '', email: '', password: '' });
      setCreateError(null);
    },
    onError: (e: any) => setCreateError(e?.response?.data?.error ?? 'Failed to create account'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/auth/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cfo-assignments'] }),
    onError: (e: any) => alert(e?.response?.data?.error ?? 'Failed to delete CFO account'),
  });

  const resetPinMut = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      api.patch(`/auth/users/${id}`, { password }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cfo-assignments'] });
      setResetFor(null);
      setNewPin('');
      setResetError(null);
    },
    onError: (e: any) => setResetError(e?.response?.data?.error ?? 'Failed to reset password'),
  });

  const assignMut = useMutation({
    mutationFn: ({ convoyId, userId }: { convoyId: string; userId: string }) =>
      api.post(`/convoys/${convoyId}/cfos`, { cfo_user_id: userId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cfo-assignments'] });
      setAssignFor(null);
      setSelectedConvoy('');
    },
    onError: (e: any) => alert(e?.response?.data?.error ?? 'Assignment failed'),
  });

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 space-y-4">
      {/* Header */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between border-b border-slate-700 pb-3"
      >
        <div className="flex items-center gap-2">
          <Smartphone size={16} className="text-lime-400" />
          <span className="font-semibold">Guardian Convoy App</span>
          <span className="text-xs text-slate-500 ml-1">CFO Accounts & Assignments</span>
        </div>
        {expanded ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
      </button>

      {!expanded && null}

      {expanded && (
        <div className="space-y-4">
          {/* Action bar */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              CFO accounts log into the Guardian app with their email and convoy name.
            </p>
            <button
              onClick={() => { setShowCreate(v => !v); setCreateError(null); }}
              className="flex items-center gap-1 text-sm text-lime-400 hover:text-lime-300 border border-lime-700 rounded-lg px-3 py-1.5"
            >
              <Plus size={13} /> New CFO
            </button>
          </div>

          {/* Create form */}
          {showCreate && (
            <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 space-y-3">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">New CFO Account</p>
              <input
                placeholder="Full name"
                value={createForm.name}
                onChange={e => setCreateForm(p => ({ ...p, name: e.target.value }))}
                className={INPUT_CLS}
              />
              <input
                placeholder="Email address"
                type="email"
                value={createForm.email}
                onChange={e => setCreateForm(p => ({ ...p, email: e.target.value }))}
                className={INPUT_CLS}
              />
              <input
                placeholder="Initial PIN / password"
                type="password"
                value={createForm.password}
                onChange={e => setCreateForm(p => ({ ...p, password: e.target.value }))}
                className={INPUT_CLS}
              />
              {createError && <p className="text-red-400 text-xs">{createError}</p>}
              <div className="flex gap-3 justify-end">
                <button onClick={() => setShowCreate(false)} className={BTN_GHOST}>Cancel</button>
                <button
                  onClick={() => createMut.mutate(createForm)}
                  disabled={createMut.isPending || !createForm.name || !createForm.email || !createForm.password}
                  className={BTN_PRIMARY}
                >
                  {createMut.isPending ? 'Creating…' : 'Create Account'}
                </button>
              </div>
            </div>
          )}

          {/* CFO list */}
          {isLoading ? (
            <div className="flex items-center gap-2 text-slate-500 text-sm py-4">
              <Loader2 size={14} className="animate-spin" /> Loading CFO accounts…
            </div>
          ) : cfos.length === 0 ? (
            <p className="text-sm text-slate-500 py-4 text-center">
              No CFO accounts yet. Create one above.
            </p>
          ) : (
            <div className="divide-y divide-slate-700">
              {cfos.map(cfo => (
                <div key={cfo.id} className="py-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-slate-200">{cfo.name}</span>
                        <StatusBadge status={cfo.status} />
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{cfo.email}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-slate-600">Convoy:</span>
                        {cfo.convoy_name ? (
                          <ConvoyBadge name={cfo.convoy_name} status={cfo.convoy_status ?? ''} />
                        ) : (
                          <span className="text-xs text-slate-600 italic">Not assigned</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        title="Assign to convoy"
                        onClick={() => { setAssignFor(cfo.id); setSelectedConvoy(''); }}
                        className="text-xs text-slate-400 hover:text-lime-400 border border-slate-700 rounded px-2 py-1"
                      >
                        Assign
                      </button>
                      <button
                        title="Reset PIN"
                        onClick={() => { setResetFor(cfo.id); setNewPin(''); setResetError(null); }}
                        className="text-slate-500 hover:text-orange-400"
                      >
                        <KeyRound size={14} />
                      </button>
                      <button
                        title="Delete account"
                        disabled={deleteMut.isPending}
                        onClick={() => { if (confirm(`Remove CFO account for ${cfo.name}?`)) deleteMut.mutate(cfo.id); }}
                        className="text-slate-500 hover:text-red-400 disabled:opacity-40"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Reset PIN inline */}
                  {resetFor === cfo.id && (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2 bg-slate-900 rounded p-2">
                        <input
                          placeholder="New PIN / password"
                          type="password"
                          value={newPin}
                          onChange={e => setNewPin(e.target.value)}
                          className="flex-1 bg-transparent border border-slate-700 rounded px-2 py-1 text-sm focus:outline-none focus:border-orange-500"
                        />
                        <button
                          onClick={() => resetPinMut.mutate({ id: cfo.id, password: newPin })}
                          disabled={resetPinMut.isPending || !newPin}
                          className={BTN_PRIMARY}
                        >
                          {resetPinMut.isPending ? 'Saving…' : 'Save'}
                        </button>
                        <button onClick={() => { setResetFor(null); setResetError(null); }} className={BTN_GHOST}>Cancel</button>
                      </div>
                      {resetError && <p className="text-red-400 text-xs">{resetError}</p>}
                    </div>
                  )}

                  {/* Assign to convoy inline */}
                  {assignFor === cfo.id && (
                    <div className="flex items-center gap-2 bg-slate-900 rounded p-2">
                      <select
                        value={selectedConvoy}
                        onChange={e => setSelectedConvoy(e.target.value)}
                        className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm focus:outline-none focus:border-lime-500"
                      >
                        <option value="">— Select convoy —</option>
                        {convoys.map(c => (
                          <option key={c.id} value={c.id}>{c.name} ({c.status})</option>
                        ))}
                      </select>
                      <button
                        onClick={() => assignMut.mutate({ convoyId: selectedConvoy, userId: cfo.id })}
                        disabled={assignMut.isPending || !selectedConvoy}
                        className={BTN_PRIMARY}
                      >
                        {assignMut.isPending ? 'Assigning…' : 'Assign'}
                      </button>
                      <button onClick={() => setAssignFor(null)} className={BTN_GHOST}>Cancel</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-slate-600 border-t border-slate-700 pt-3">
            To manage convoy vehicles and full CFO assignments, go to{' '}
            <Link to="/convoys" className="text-lime-500 hover:text-lime-400">Convoys</Link>.
          </p>
        </div>
      )}
    </div>
  );
}
