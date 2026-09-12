import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import {
  FileCheck2, Plus, Trash2, KeyRound, ChevronDown, ChevronUp, Loader2,
  ShieldCheck, ShieldOff, Unlock, RotateCcw,
} from 'lucide-react';

const INPUT_CLS = 'w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-orange-500';
const BTN_PRIMARY = 'text-sm bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg';
const BTN_GHOST = 'text-sm text-slate-400 hover:text-white';

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

interface HandoverOfficerUser {
  id: string;
  name: string;
  email: string;
  status: string;
}

interface PinStatus {
  has_pin: boolean;
  must_change: boolean;
  locked: boolean;
  updated_at: string | null;
}

function StatusBadge({ status }: { status: string }) {
  const color = status === 'active' ? 'text-green-400 bg-green-900/30 border-green-700'
    : 'text-slate-400 bg-slate-800 border-slate-600';
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${color}`}>{status}</span>
  );
}

function PinBadge({ officerId }: { officerId: string }) {
  const { data } = useQuery({
    queryKey: ['admin-pin-status', officerId],
    queryFn: () => api.get<{ data: PinStatus }>(`/handover-auth/admin/pin-status/${officerId}`).then(r => r.data.data),
    staleTime: 30_000,
  });

  if (!data) return null;

  if (data.locked) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full border text-red-400 bg-red-900/30 border-red-700 flex items-center gap-1">
        <ShieldOff size={10} /> Locked
      </span>
    );
  }

  if (data.has_pin) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full border text-cyan-400 bg-cyan-900/20 border-cyan-700 flex items-center gap-1">
        <ShieldCheck size={10} /> PIN set
      </span>
    );
  }

  return (
    <span className="text-xs px-2 py-0.5 rounded-full border text-amber-400 bg-amber-900/20 border-amber-700">
      No PIN
    </span>
  );
}

export function HandoverOfficerSettings() {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', email: '', password: '' });
  const [createError, setCreateError] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['handover-officers'],
    queryFn: () => api.get<{ data: HandoverOfficerUser[] }>('/auth/users?role=handover_officer').then(r => r.data),
    enabled: expanded,
  });

  const officers: HandoverOfficerUser[] = data?.data ?? [];

  const createMut = useMutation({
    mutationFn: (body: typeof createForm) =>
      api.post('/auth/users', { ...body, role: 'handover_officer' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['handover-officers'] });
      setShowCreate(false);
      setCreateForm({ name: '', email: '', password: '' });
      setCreateError(null);
    },
    onError: (e: any) => setCreateError(e?.response?.data?.error ?? 'Failed to create account'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/auth/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['handover-officers'] }),
    onError: (e: any) => alert(e?.response?.data?.error ?? 'Failed to delete account'),
  });

  const resetPasswordMut = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      api.patch(`/auth/users/${id}`, { password }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['handover-officers'] });
      setResetFor(null);
      setNewPassword('');
      setResetError(null);
    },
    onError: (e: any) => setResetError(e?.response?.data?.error ?? 'Failed to reset password'),
  });

  const resetPinMut = useMutation({
    mutationFn: (userId: string) =>
      api.post('/handover-auth/admin/reset-pin', { user_id: userId }),
    onSuccess: (_data, userId) => {
      qc.invalidateQueries({ queryKey: ['admin-pin-status', userId] });
    },
    onError: (e: any) => alert(e?.response?.data?.error ?? 'Failed to reset PIN'),
  });

  const unlockPinMut = useMutation({
    mutationFn: (userId: string) =>
      api.post('/handover-auth/admin/unlock', { user_id: userId }),
    onSuccess: (_data, userId) => {
      qc.invalidateQueries({ queryKey: ['admin-pin-status', userId] });
    },
    onError: (e: any) => alert(e?.response?.data?.error ?? 'Failed to unlock PIN'),
  });

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 space-y-4">
      {/* Header */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between border-b border-slate-700 pb-3"
      >
        <div className="flex items-center gap-2">
          <FileCheck2 size={16} className="text-orange-400" />
          <span className="font-semibold">Handover Officers</span>
          <span className="text-xs text-slate-500 ml-1">Sonalit Handover App Accounts</span>
        </div>
        {expanded ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
      </button>

      {expanded && (
        <div className="space-y-4">
          {/* Action bar */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Handover officers sign in with email/password, then set a 4-8 digit PIN for quick re-auth.
            </p>
            <button
              onClick={() => { setShowCreate(v => !v); setCreateError(null); }}
              className="flex items-center gap-1 text-sm text-orange-400 hover:text-orange-300 border border-orange-700 rounded-lg px-3 py-1.5"
            >
              <Plus size={13} /> New Officer
            </button>
          </div>

          {/* Create form */}
          {showCreate && (
            <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 space-y-3">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">New Handover Officer Account</p>
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
              {createForm.email.length > 0 && !isValidEmail(createForm.email) && (
                <p className="text-amber-400 text-xs">Doesn't look like a valid email address.</p>
              )}
              <input
                placeholder="Initial password"
                type="password"
                value={createForm.password}
                onChange={e => setCreateForm(p => ({ ...p, password: e.target.value }))}
                className={INPUT_CLS}
              />
              <p className="text-xs text-slate-500">
                The officer will set their own PIN on first sign-in to the Handover app.
              </p>
              {createError && <p className="text-red-400 text-xs">{createError}</p>}
              <div className="flex gap-3 justify-end">
                <button onClick={() => setShowCreate(false)} className={BTN_GHOST}>Cancel</button>
                <button
                  onClick={() => createMut.mutate(createForm)}
                  disabled={createMut.isPending || !createForm.name || !isValidEmail(createForm.email) || !createForm.password}
                  className={BTN_PRIMARY}
                >
                  {createMut.isPending ? 'Creating...' : 'Create Account'}
                </button>
              </div>
            </div>
          )}

          {/* Officer list */}
          {isLoading ? (
            <div className="flex items-center gap-2 text-slate-500 text-sm py-4">
              <Loader2 size={14} className="animate-spin" /> Loading handover officer accounts...
            </div>
          ) : officers.length === 0 ? (
            <p className="text-sm text-slate-500 py-4 text-center">
              No handover officer accounts yet. Create one above.
            </p>
          ) : (
            <div className="divide-y divide-slate-700">
              {officers.map(officer => (
                <div key={officer.id} className="py-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-slate-200">{officer.name}</span>
                        <StatusBadge status={officer.status} />
                        <PinBadge officerId={officer.id} />
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{officer.email}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        title="Reset password"
                        onClick={() => { setResetFor(officer.id); setNewPassword(''); setResetError(null); }}
                        className="text-slate-500 hover:text-orange-400"
                      >
                        <KeyRound size={14} />
                      </button>
                      <button
                        title="Reset PIN (officer will set a new one on next login)"
                        disabled={resetPinMut.isPending}
                        onClick={() => {
                          if (confirm(`Reset PIN for ${officer.name}? They will need to set a new one on next login.`))
                            resetPinMut.mutate(officer.id);
                        }}
                        className="text-slate-500 hover:text-cyan-400 disabled:opacity-40"
                      >
                        <RotateCcw size={14} />
                      </button>
                      <button
                        title="Unlock PIN (if locked from too many attempts)"
                        disabled={unlockPinMut.isPending}
                        onClick={() => unlockPinMut.mutate(officer.id)}
                        className="text-slate-500 hover:text-green-400 disabled:opacity-40"
                      >
                        <Unlock size={14} />
                      </button>
                      <button
                        title="Delete account"
                        disabled={deleteMut.isPending}
                        onClick={() => { if (confirm(`Remove handover officer account for ${officer.name}?`)) deleteMut.mutate(officer.id); }}
                        className="text-slate-500 hover:text-red-400 disabled:opacity-40"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Reset password inline */}
                  {resetFor === officer.id && (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2 bg-slate-900 rounded p-2">
                        <input
                          placeholder="New password"
                          type="password"
                          value={newPassword}
                          onChange={e => setNewPassword(e.target.value)}
                          className="flex-1 bg-transparent border border-slate-700 rounded px-2 py-1 text-sm focus:outline-none focus:border-orange-500"
                        />
                        <button
                          onClick={() => resetPasswordMut.mutate({ id: officer.id, password: newPassword })}
                          disabled={resetPasswordMut.isPending || !newPassword}
                          className={BTN_PRIMARY}
                        >
                          {resetPasswordMut.isPending ? 'Saving...' : 'Save'}
                        </button>
                        <button onClick={() => { setResetFor(null); setResetError(null); }} className={BTN_GHOST}>Cancel</button>
                      </div>
                      {resetError && <p className="text-red-400 text-xs">{resetError}</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
