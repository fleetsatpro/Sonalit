/**
 * CDS → Settings → Field access.
 *
 * The admin side of the Field app's own login system: enrol tablets, issue and
 * reset the PINs crews sign in with, and cut off a device that has gone
 * missing. See backend/src/routes/field.js for the endpoints and
 * apps/web/src/pages/field/fieldAuth.ts for the other end of the flow.
 *
 * Two things here are deliberate and easy to get wrong later:
 *   - Creating a field account no longer asks for a password. Field roles are
 *     rejected at POST /auth/login outright, so a password on one of these
 *     accounts would be a credential that unlocks nothing and rots.
 *   - Pairing codes and PINs are shown exactly once, at the moment they are
 *     created. Nothing here can read one back, because nothing stores one.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Copy, KeyRound, Loader2, Plus, RefreshCw, Smartphone, Trash2, Unlock,
} from 'lucide-react';
import { useState } from 'react';

import { api } from '../../lib/api.js';
import { useAuthStore } from '../../stores/auth.js';

import { LoadingState } from './CDSDashboard.js';
import { Badge, Button, Card, StatusBadge } from './components.js';
import { useCDSStore } from './store.js';

type FieldRole = 'yard_agent' | 'port_agent' | 'response_crew';

interface Worker {
  id: string; name: string; email: string; role: FieldRole; status: string;
  has_pin: boolean; must_change: boolean | null; locked_until: string | null;
}

interface Device {
  id: string; label: string; site: string | null; scope: 'yard' | 'port' | null;
  status: 'pending' | 'active' | 'revoked';
  paired_at: string | null; last_seen_at: string | null;
  pairing_pending: boolean; pairing_expires_at: string | null;
  signed_in_name: string | null;
}

const errText = (err: unknown, fallback: string): string => {
  const e = err as { response?: { data?: { error?: string; message?: string } } };
  return e?.response?.data?.message ?? e?.response?.data?.error ?? fallback;
};

const when = (iso: string | null): string => {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

const inputCls =
  'h-9 px-3 rounded-lg bg-white/[.04] border border-white/[.08] text-text-0 text-[13px] outline-none focus:border-cds-orange/50';

/**
 * Destructive action behind a second tap. Revoking a device signs a whole crew
 * out mid-shift and deleting an account breaks the name on future custody
 * records, so neither should be one misclick away — and window.confirm is not
 * available to us (the app is also shipped inside a Capacitor WebView, where
 * it renders as a bare system dialog with no product context).
 */
function DangerButton({ armed, onArm, onConfirm, title, children }: {
  armed: boolean; onArm: () => void; onConfirm: () => void; title: string; children: React.ReactNode;
}) {
  if (armed) {
    return (
      <button onClick={onConfirm} title={title}
        className="h-7 px-2 rounded-lg text-[11px] font-bold bg-cds-red/15 border border-cds-red/40 text-cds-red flex items-center justify-center cursor-pointer">
        Confirm
      </button>
    );
  }
  return (
    <button onClick={onArm} title={title}
      className="w-7 h-7 rounded-lg bg-white/[.04] border border-white/[.08] text-text-2 hover:text-cds-red flex items-center justify-center cursor-pointer">
      {children}
    </button>
  );
}

/** A code or PIN the server will never show again — copy it now. */
function OneTimeSecret({ label, value, note }: { label: string; value: string; note: string }) {
  const { addToast } = useCDSStore();
  return (
    <div className="mt-3 p-3 rounded-lg" style={{ background: 'rgba(255,122,0,.08)', border: '1px solid rgba(255,122,0,.35)' }}>
      <div className="text-[10px] font-mono uppercase tracking-widest text-cds-orange">{label}</div>
      <div className="flex items-center gap-2 mt-1.5">
        <code className="text-[20px] font-mono tracking-[.2em] text-text-0">{value}</code>
        <button
          onClick={() => { void navigator.clipboard?.writeText(value); addToast('Copied'); }}
          title="Copy"
          className="w-7 h-7 rounded-lg bg-white/[.06] border border-white/[.1] text-text-1 flex items-center justify-center cursor-pointer"
        >
          <Copy size={13} />
        </button>
      </div>
      <p className="text-[11px] text-text-2 mt-2 leading-snug">{note}</p>
    </div>
  );
}

export default function FieldAccessPanel() {
  const myRole = useAuthStore(s => s.user?.role);
  const isAdmin = myRole === 'admin';
  const canView = isAdmin || myRole === 'dispatcher';

  if (!canView) {
    return (
      <Card className="flex-1 p-5">
        <p className="text-[12px] text-text-2 font-mono py-6 text-center">
          Only admins and dispatchers can manage field access.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex-1 space-y-4">
      <DevicesSection isAdmin={isAdmin} />
      <WorkersSection isAdmin={isAdmin} />
    </div>
  );
}

// ─── Devices ─────────────────────────────────────────────────────────────────

function DevicesSection({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { addToast } = useCDSStore();
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState('');
  const [site, setSite] = useState('');
  const [scope, setScope] = useState<'' | 'yard' | 'port'>('');
  const [error, setError] = useState('');
  const [armed, setArmed] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ code: string; label: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['field-devices'],
    queryFn: async () => (await api.get<{ data: Device[] }>('/field/admin/devices')).data.data,
  });
  const devices = data ?? [];

  const refresh = () => qc.invalidateQueries({ queryKey: ['field-devices'] });

  const createMut = useMutation({
    mutationFn: async () => (await api.post<{ data: Device & { pairing_code: string } }>(
      '/field/admin/devices',
      { label: label.trim(), site: site.trim() || null, scope: scope || null },
    )).data.data,
    onSuccess: (d) => {
      setIssued({ code: d.pairing_code, label: d.label });
      setShowForm(false); setLabel(''); setSite(''); setScope(''); setError('');
      void refresh();
    },
    onError: (err) => setError(errText(err, 'Could not enrol that device.')),
  });

  const rotateMut = useMutation({
    mutationFn: async (d: Device) => ({
      label: d.label,
      code: (await api.post<{ data: { pairing_code: string } }>(`/field/admin/devices/${d.id}/rotate`)).data.data.pairing_code,
    }),
    onSuccess: ({ code, label: l }) => { setIssued({ code, label: l }); void refresh(); },
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => api.delete(`/field/admin/devices/${id}`),
    onSuccess: () => { addToast('Device revoked'); void refresh(); },
  });

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-sm font-bold text-text-0">Paired field devices</div>
          <p className="text-[11px] text-text-2 mt-0.5 max-w-xl leading-snug">
            Tablets and phones running the Sonalit Field app. Each is enrolled once with a pairing
            code; after that crews sign in with a PIN. Revoking a device signs out everyone on it
            immediately.
          </p>
        </div>
        {isAdmin && (
          <Button size="sm" icon={<Plus size={13} />} onClick={() => setShowForm(v => !v)}>Enrol device</Button>
        )}
      </div>

      {showForm && isAdmin && (
        <form
          onSubmit={(e) => { e.preventDefault(); setError(''); if (label.trim()) createMut.mutate(); }}
          className="mb-4 p-3 rounded-lg border border-white/[.08] bg-white/[.02] space-y-2"
        >
          <div className="grid grid-cols-3 gap-2">
            <input required placeholder="Device label (e.g. Gate 3 tablet)" value={label}
              onChange={e => setLabel(e.target.value)} className={`${inputCls} col-span-2`} />
            <select value={scope} onChange={e => setScope(e.target.value as '' | 'yard' | 'port')}
              className={`${inputCls} cursor-pointer`}>
              <option value="">Any team</option>
              <option value="yard">Yard only</option>
              <option value="port">Port only</option>
            </select>
          </div>
          <input placeholder="Site (optional — e.g. ICD Embakasi)" value={site}
            onChange={e => setSite(e.target.value)} className={`${inputCls} w-full`} />
          {error && <p className="text-[11px] text-cds-red font-mono">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => { setShowForm(false); setError(''); }}>Cancel</Button>
            <Button type="submit" size="sm" disabled={createMut.isPending}>
              {createMut.isPending ? <Loader2 size={13} className="animate-spin" /> : 'Generate pairing code'}
            </Button>
          </div>
        </form>
      )}

      {issued && (
        <OneTimeSecret
          label={`Pairing code · ${issued.label}`}
          value={issued.code}
          note="Type this into the Field app on the device. It works once, expires in 24 hours, and cannot be looked up again — rotate the device to issue a new one."
        />
      )}

      {isLoading ? <LoadingState /> : devices.length === 0 ? (
        <p className="text-[12px] text-text-2 font-mono italic py-6 text-center">No devices enrolled yet.</p>
      ) : (
        <div className="divide-y divide-white/[.05] mt-3">
          {devices.map(d => (
            <div key={d.id} className="py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Smartphone size={13} className="text-text-2 flex-shrink-0" />
                  <span className="text-[13px] font-medium text-text-0 truncate">{d.label}</span>
                  {d.scope && <Badge variant={d.scope === 'yard' ? 'warn' : 'ok'}>{d.scope.toUpperCase()}</Badge>}
                  <StatusBadge status={d.status} />
                  {d.pairing_pending && <Badge variant="warn">AWAITING PAIRING</Badge>}
                </div>
                <p className="text-[11px] text-text-2 mt-0.5 truncate">
                  {d.site ? `${d.site} · ` : ''}
                  {d.status === 'active' ? `seen ${when(d.last_seen_at)}` : 'not paired yet'}
                  {d.signed_in_name ? ` · signed in: ${d.signed_in_name}` : ''}
                </p>
              </div>
              {isAdmin && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => rotateMut.mutate(d)} title="New pairing code"
                    className="w-7 h-7 rounded-lg bg-white/[.04] border border-white/[.08] text-text-2 hover:text-text-0 flex items-center justify-center cursor-pointer">
                    <RefreshCw size={13} />
                  </button>
                  <DangerButton
                    armed={armed === d.id}
                    onArm={() => setArmed(d.id)}
                    onConfirm={() => { revokeMut.mutate(d.id); setArmed(null); }}
                    title={`Revoke ${d.label} — signs out anyone using it`}
                  >
                    <Trash2 size={13} />
                  </DangerButton>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── Workers ─────────────────────────────────────────────────────────────────

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Same rules the server enforces — catch them before the round trip. */
function pinProblem(pin: string): string | null {
  if (!/^\d{4,8}$/.test(pin)) return 'PIN must be 4 to 8 digits.';
  if (/^(\d)\1+$/.test(pin)) return 'PIN cannot be a single repeated digit.';
  if ('0123456789'.includes(pin) || '9876543210'.includes(pin)) return 'PIN cannot be a run of consecutive digits.';
  return null;
}

function WorkersSection({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { addToast } = useCDSStore();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<FieldRole>('yard_agent');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [pinFor, setPinFor] = useState<string | null>(null);
  const [newPin, setNewPin] = useState('');
  const [armed, setArmed] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['field-workers'],
    queryFn: async () => (await api.get<{ data: Worker[] }>('/field/admin/workers')).data.data,
  });
  const workers = data ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ['field-workers'] });

  // Two calls, because the account and its field credential are separate
  // things by design: POST /auth/users creates the identity the custody chain
  // will name, and the PIN is a Field-only credential stored elsewhere.
  const createMut = useMutation({
    mutationFn: async () => {
      const { data: created } = await api.post<{ data: { id: string } }>('/auth/users', {
        name: name.trim(),
        email: email.trim(),
        role,
        // Field accounts cannot sign in with a password at all — the backend
        // rejects these roles at /auth/login — but the users table still
        // requires a hash, so this is a deliberately unusable one.
        password: crypto.randomUUID() + crypto.randomUUID(),
      });
      await api.put(`/field/admin/workers/${created.data.id}/pin`, { pin });
    },
    onSuccess: () => {
      const roleLabel = role === 'yard_agent' ? 'Yard' : role === 'port_agent' ? 'Port' : 'Response Crew';
      addToast(`${roleLabel} account created`);
      setShowForm(false); setName(''); setEmail(''); setPin(''); setError('');
      void refresh();
    },
    onError: (err) => setError(errText(err, 'Could not create the account.')),
  });

  const setPinMut = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) =>
      api.put(`/field/admin/workers/${id}/pin`, { pin: value }),
    onSuccess: () => {
      addToast('PIN reset — the worker will be asked to choose their own on next sign-in');
      setPinFor(null); setNewPin(''); void refresh();
    },
  });

  const unlockMut = useMutation({
    mutationFn: (id: string) => api.post(`/field/admin/workers/${id}/unlock`),
    onSuccess: () => { addToast('PIN unlocked'); void refresh(); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/auth/users/${id}`),
    onSuccess: () => { addToast('Account removed'); void refresh(); },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim() || !isValidEmail(email)) {
      setError('A name and a valid email are required.');
      return;
    }
    const problem = pinProblem(pin);
    if (problem) { setError(problem); return; }
    createMut.mutate();
  };

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-sm font-bold text-text-0">Field crew</div>
          <p className="text-[11px] text-text-2 mt-0.5 max-w-xl leading-snug">
            These accounts sign in only on a paired field device, with a PIN. They have no dashboard
            password — a Yard account can only clamp, a Port account can only unclamp, Response Crew
            receive intercept dispatches, and every action is recorded against the name here.
          </p>
        </div>
        {isAdmin && (
          <Button size="sm" icon={<Plus size={13} />} onClick={() => setShowForm(v => !v)}>New crew account</Button>
        )}
      </div>

      {showForm && isAdmin && (
        <form onSubmit={submit} className="mb-4 p-3 rounded-lg border border-white/[.08] bg-white/[.02] space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input required placeholder="Full name" value={name} onChange={e => setName(e.target.value)} className={inputCls} />
            <select value={role} onChange={e => setRole(e.target.value as FieldRole)} className={`${inputCls} cursor-pointer`}>
              <option value="yard_agent">Yard agent</option>
              <option value="port_agent">Port agent</option>
              <option value="response_crew">Response crew</option>
            </select>
          </div>
          <input required type="email" placeholder="Email (identity only — not used to sign in)"
            value={email} onChange={e => setEmail(e.target.value)} className={`${inputCls} w-full`} />
          <input required inputMode="numeric" placeholder="Starting PIN (4–8 digits)" value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} className={`${inputCls} w-full`} />
          <p className="text-[11px] text-text-2">
            Read this PIN to the worker once. They&apos;ll be asked to change it the first time they sign in.
          </p>
          {error && <p className="text-[11px] text-cds-red font-mono">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => { setShowForm(false); setError(''); }}>Cancel</Button>
            <Button type="submit" size="sm" disabled={createMut.isPending}>
              {createMut.isPending ? <Loader2 size={13} className="animate-spin" /> : 'Create account'}
            </Button>
          </div>
        </form>
      )}

      {isLoading ? <LoadingState /> : workers.length === 0 ? (
        <p className="text-[12px] text-text-2 font-mono italic py-6 text-center">No field crew accounts yet.</p>
      ) : (
        <div className="divide-y divide-white/[.05]">
          {workers.map(w => {
            const locked = Boolean(w.locked_until && new Date(w.locked_until) > new Date());
            return (
              <div key={w.id} className="py-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-medium text-text-0 truncate">{w.name}</span>
                      <Badge variant={w.role === 'yard_agent' ? 'warn' : 'ok'}>
                        {w.role === 'yard_agent' ? 'YARD' : 'PORT'}
                      </Badge>
                      <StatusBadge status={w.status} />
                      {!w.has_pin && <Badge variant="warn">NO PIN</Badge>}
                      {locked && <Badge variant="bad">LOCKED</Badge>}
                      {w.has_pin && w.must_change && <Badge variant="warn">MUST CHANGE PIN</Badge>}
                    </div>
                    <p className="text-[11px] text-text-2 mt-0.5 truncate">{w.email}</p>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {locked && (
                        <button onClick={() => unlockMut.mutate(w.id)} title="Unlock PIN"
                          className="w-7 h-7 rounded-lg bg-white/[.04] border border-white/[.08] text-cds-amber hover:text-text-0 flex items-center justify-center cursor-pointer">
                          <Unlock size={13} />
                        </button>
                      )}
                      <button onClick={() => { setPinFor(pinFor === w.id ? null : w.id); setNewPin(''); }}
                        title={w.has_pin ? 'Reset PIN' : 'Set PIN'}
                        className="w-7 h-7 rounded-lg bg-white/[.04] border border-white/[.08] text-text-2 hover:text-text-0 flex items-center justify-center cursor-pointer">
                        <KeyRound size={13} />
                      </button>
                      <DangerButton
                        armed={armed === w.id}
                        onArm={() => setArmed(w.id)}
                        onConfirm={() => { deleteMut.mutate(w.id); setArmed(null); }}
                        title={`Remove field account for ${w.name}`}
                      >
                        <Trash2 size={13} />
                      </DangerButton>
                    </div>
                  )}
                </div>
                {pinFor === w.id && (
                  <div className="flex items-center gap-2 pl-1">
                    <input inputMode="numeric" placeholder="New PIN (4–8 digits)" value={newPin}
                      onChange={e => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                      className={`${inputCls} h-8 flex-1`} />
                    <Button size="sm" disabled={Boolean(pinProblem(newPin)) || setPinMut.isPending}
                      onClick={() => setPinMut.mutate({ id: w.id, value: newPin })}>
                      Set
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
