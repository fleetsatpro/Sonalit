import { useMemo, useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  CheckCircle2,
  ChevronRight,
  CircleUserRound,
  KeyRound,
  LockKeyhole,
  MonitorSmartphone,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserCog,
  UserX,
  Users,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { api } from '../lib/api.js';

type TabId = 'people' | 'sessions' | 'roles' | 'requests';

interface IdentityUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  totp_enabled: boolean;
  org_id: string;
  created_at: string;
  updated_at: string;
}
interface IdentityRole { id: string; label: string; posture: string; permissions: string[] }
interface IdentitySession {
  id: string;
  name: string;
  email: string;
  role: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string | null;
  ip_address: string | null;
  state: string;
  token_fingerprint: string;
}
interface AccessRequest {
  id: string;
  name: string;
  email: string;
  organization: string | null;
  role_requested: string;
  reason: string | null;
  status: string;
  created_at: string;
}
interface IdentityOverview {
  users: { total: number; active: number; suspended: number; created_30d: number };
  sessions: { active_sessions: number };
  mfa: { total: number; totp_enabled: number; coverage_pct: number };
  controls: { session_revocation: string; passkeys: string; tenant_isolation: string };
}

const tabs: { id: TabId; label: string; Icon: LucideIcon }[] = [
  { id: 'people', label: 'PEOPLE', Icon: Users },
  { id: 'sessions', label: 'SESSIONS', Icon: Activity },
  { id: 'roles', label: 'ROLE CATALOG', Icon: UserCog },
  { id: 'requests', label: 'ACCESS QUEUE', Icon: KeyRound },
];
const roleNames: Record<string, string> = {
  admin: 'Administrator', dispatcher: 'Dispatcher', operator: 'Operator', analyst: 'Analyst', cfo: 'CFO',
  response_crew: 'Response Crew', handover_officer: 'Handover Officer', yard_agent: 'Yard Agent', port_agent: 'Port Agent',
};
const panel: CSSProperties = {
  background: 'linear-gradient(180deg, rgba(17,27,37,.98), rgba(9,16,24,.98))',
  border: '1px solid rgba(255,255,255,.08)', borderRadius: 16, boxShadow: '0 18px 55px rgba(0,0,0,.18)',
};
const field: CSSProperties = {
  width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,.10)',
  background: 'rgba(3,10,16,.76)', color: '#e7eef6', padding: '10px 12px', outline: 'none', fontSize: 13,
};
const mono: CSSProperties = { fontFamily: 'IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace' };

function roleLabel(role: string) { return roleNames[role] || role.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()); }
function dateLabel(v: string | null) {
  if (!v) return '—';
  const d = new Date(v); if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}
function statusTone(status: string) {
  if (status === 'active') return { fg: '#4ade80', bg: 'rgba(74,222,128,.09)', bd: 'rgba(74,222,128,.22)' };
  if (status === 'suspended') return { fg: '#fb7185', bg: 'rgba(251,113,133,.09)', bd: 'rgba(251,113,133,.22)' };
  return { fg: '#fbbf24', bg: 'rgba(251,191,36,.09)', bd: 'rgba(251,191,36,.22)' };
}
function Metric({ label, value, hint, Icon, accent }: { label: string; value: string | number; hint: string; Icon: LucideIcon; accent: string }) {
  return <div style={{ ...panel, padding: 18, minHeight: 118 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14 }}>
      <div><div style={{ ...mono, color: '#7e8d9d', fontSize: 10, letterSpacing: '.13em' }}>{label}</div><div style={{ marginTop: 8, color: '#f4f7fb', fontSize: 29, fontWeight: 700 }}>{value}</div><div style={{ marginTop: 5, color: '#8391a1', fontSize: 11 }}>{hint}</div></div>
      <div style={{ width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center', color: accent, background: `${accent}13`, border: `1px solid ${accent}33` }}><Icon size={18}/></div>
    </div>
  </div>;
}

export default function IdentitySecurity() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabId>('people');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [role, setRole] = useState('all');
  const [selected, setSelected] = useState<IdentityUser | null>(null);
  const [provision, setProvision] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'operator' });

  const overviewQ = useQuery<{ data: IdentityOverview }>({ queryKey: ['identity-overview'], queryFn: () => api.get('/auth/identity/overview').then(r => r.data), refetchInterval: 30000 });
  const rolesQ = useQuery<{ data: IdentityRole[] }>({ queryKey: ['identity-roles'], queryFn: () => api.get('/auth/identity/roles').then(r => r.data) });
  const usersQ = useQuery<{ data: IdentityUser[]; meta: { total: number } }>({
    queryKey: ['identity-users', search, status, role],
    queryFn: () => api.get('/auth/identity/users', { params: { search: search || undefined, status: status === 'all' ? undefined : status, role: role === 'all' ? undefined : role, limit: 100 } }).then(r => r.data),
  });
  const sessionsQ = useQuery<{ data: IdentitySession[] }>({ queryKey: ['identity-sessions'], queryFn: () => api.get('/auth/identity/sessions').then(r => r.data), refetchInterval: 30000 });
  const requestsQ = useQuery<{ data: AccessRequest[] }>({ queryKey: ['identity-access-requests'], queryFn: () => api.get('/auth/identity/access-requests').then(r => r.data) });

  const provisionM = useMutation({ mutationFn: (p: typeof form) => api.post('/auth/users', p), onSuccess: () => { setProvision(false); setForm({ name: '', email: '', password: '', role: 'operator' }); setNotice('Account provisioned inside the current tenant.'); qc.invalidateQueries({ queryKey: ['identity-users'] }); qc.invalidateQueries({ queryKey: ['identity-overview'] }); } });
  const updateM = useMutation({ mutationFn: ({ id, patch }: { id: string; patch: { role?: string; status?: string } }) => api.patch(`/auth/identity/users/${id}`, patch), onSuccess: () => { setSelected(null); setNotice('Identity policy applied.'); qc.invalidateQueries({ queryKey: ['identity-users'] }); qc.invalidateQueries({ queryKey: ['identity-overview'] }); } });
  const revokeM = useMutation({ mutationFn: (id: string) => api.delete(`/auth/identity/sessions/${id}`), onSuccess: () => { setNotice('Session revoked.'); qc.invalidateQueries({ queryKey: ['identity-sessions'] }); qc.invalidateQueries({ queryKey: ['identity-overview'] }); } });
  const revokeAllM = useMutation({ mutationFn: () => api.post('/auth/identity/sessions/revoke-all'), onSuccess: (r) => { setNotice(`${r.data?.data?.revoked ?? 0} sessions revoked.`); qc.invalidateQueries({ queryKey: ['identity-sessions'] }); qc.invalidateQueries({ queryKey: ['identity-overview'] }); } });
  const requestM = useMutation({ mutationFn: ({ id, status: nextStatus }: { id: string; status: string }) => api.patch(`/auth/identity/access-requests/${id}`, { status: nextStatus }), onSuccess: () => { setNotice('Access request reviewed.'); qc.invalidateQueries({ queryKey: ['identity-access-requests'] }); } });

  const overview = overviewQ.data?.data;
  const users = usersQ.data?.data ?? [];
  const sessions = sessionsQ.data?.data ?? [];
  const requests = requestsQ.data?.data ?? [];
  const roles = rolesQ.data?.data ?? [];
  const activeSessions = sessions.filter(s => s.state === 'active').length;
  const pending = requests.filter(r => r.status === 'pending').length;
  const roleCounts = useMemo(() => users.reduce<Record<string, number>>((a, u) => { a[u.role] = (a[u.role] || 0) + 1; return a; }, {}), [users]);

  const refresh = () => { overviewQ.refetch(); usersQ.refetch(); sessionsQ.refetch(); requestsQ.refetch(); };

  return <div style={{ minHeight: '100%', color: '#e7eef6', padding: '22px 24px 36px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
      <div><div style={{ ...mono, color: '#ff9345', fontSize: 10, letterSpacing: '.18em', fontWeight: 700 }}>SONALIT / TRUST FABRIC</div><h1 style={{ margin: '8px 0 4px', fontSize: 31, letterSpacing: '-.03em' }}>Identity &amp; Security Centre</h1><p style={{ margin: 0, color: '#8492a3', maxWidth: 860, fontSize: 13 }}>Identity lifecycle, access posture, tenant boundaries and session exposure in one control plane.</p></div>
      <div style={{ display: 'flex', gap: 8 }}><button type="button" onClick={refresh} style={{ border: '1px solid rgba(255,255,255,.10)', background: 'rgba(255,255,255,.03)', color: '#b9c4cf', padding: '9px 11px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 7 }}><RefreshCw size={14}/>Refresh</button><button type="button" onClick={() => setProvision(true)} style={{ border: 0, background: 'linear-gradient(135deg,#ff974b,#d96b22)', color: '#fff', padding: '9px 13px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 7, fontWeight: 700 }}><Plus size={14}/>Provision account</button></div>
    </div>
    {notice && <div style={{ marginTop: 15, ...panel, padding: '10px 12px', background: 'rgba(45,212,168,.07)', borderColor: 'rgba(45,212,168,.20)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#a7f3d0', fontSize: 12 }}><span style={{ display: 'flex', gap: 7, alignItems: 'center' }}><CheckCircle2 size={14}/>{notice}</span><button type="button" onClick={() => setNotice(null)} style={{ border: 0, background: 'transparent', color: 'inherit' }}><XCircle size={14}/></button></div>}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 12, marginTop: 16 }}>
      <Metric label="IDENTITIES" value={overview?.users.total ?? '—'} hint={`${overview?.users.active ?? 0} active · ${overview?.users.suspended ?? 0} suspended`} Icon={Users} accent="#ff9345"/>
      <Metric label="ACTIVE SESSIONS" value={activeSessions || overview?.sessions.active_sessions || 0} hint="Non-expired refresh credentials" Icon={MonitorSmartphone} accent="#59d6ff"/>
      <Metric label="MFA COVERAGE" value={`${overview?.mfa.coverage_pct ?? 0}%`} hint={`${overview?.mfa.totp_enabled ?? 0} identities with TOTP`} Icon={ShieldCheck} accent="#6ee7b7"/>
      <Metric label="ACCESS QUEUE" value={pending} hint="Pending requests awaiting disposition" Icon={UserCheck} accent="#f3c76b"/>
    </div>

    <section style={{ ...panel, marginTop: 16, overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 2, padding: 5, borderBottom: '1px solid rgba(255,255,255,.07)', background: 'rgba(255,255,255,.02)', overflowX: 'auto' }}>
        {tabs.map(({ id, label, Icon }) => <button key={id} type="button" onClick={() => setTab(id)} style={{ border: 0, borderRadius: 9, padding: '10px 14px', background: tab === id ? 'rgba(255,147,69,.12)' : 'transparent', color: tab === id ? '#ffb06d' : '#8492a3', fontSize: 11, fontWeight: 700, letterSpacing: '.08em', display: 'flex', gap: 7, alignItems: 'center', whiteSpace: 'nowrap' }}><Icon size={14}/>{label}</button>)}
      </div>

      {tab === 'people' && <div style={{ padding: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,1fr) 170px 170px auto', gap: 9, marginBottom: 12 }}>
          <div style={{ position: 'relative' }}><Search size={14} style={{ position: 'absolute', left: 11, top: 11, color: '#718094' }}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or email" style={{ ...field, paddingLeft: 34 }}/></div>
          <select value={status} onChange={e => setStatus(e.target.value)} style={field}><option value="all">All status</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="suspended">Suspended</option></select>
          <select value={role} onChange={e => setRole(e.target.value)} style={field}><option value="all">All roles</option>{roles.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
          <div style={{ ...mono, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', color: '#677688', fontSize: 10 }}>{usersQ.data?.meta.total ?? 0} identities</div>
        </div>
        <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse' }}><thead><tr>{['IDENTITY','ROLE','POSTURE','MFA','CREATED',''].map(h => <th key={h} style={{ ...mono, textAlign: 'left', color: '#617183', fontSize: 9, letterSpacing: '.12em', padding: '9px 10px', borderBottom: '1px solid rgba(255,255,255,.07)' }}>{h}</th>)}</tr></thead><tbody>{users.map(u => { const t = statusTone(u.status); return <tr key={u.id} onClick={() => setSelected(u)} style={{ borderBottom: '1px solid rgba(255,255,255,.04)', cursor: 'pointer' }}><td style={{ padding: '12px 10px' }}><div style={{ display: 'flex', gap: 9, alignItems: 'center' }}><div style={{ width: 34, height: 34, borderRadius: 9, display: 'grid', placeItems: 'center', color: '#ffb06d', background: 'rgba(255,147,69,.09)', border: '1px solid rgba(255,147,69,.18)' }}><CircleUserRound size={16}/></div><div><div style={{ fontSize: 13, fontWeight: 700 }}>{u.name}</div><div style={{ fontSize: 11, color: '#718094' }}>{u.email}</div></div></div></td><td style={{ padding: '12px 10px' }}><div style={{ fontSize: 12, fontWeight: 600 }}>{roleLabel(u.role)}</div><div style={{ fontSize: 9, color: '#617183', marginTop: 3, ...mono }}>{roleCounts[u.role] || 0} TENANT</div></td><td style={{ padding: '12px 10px' }}><span style={{ ...mono, color: t.fg, background: t.bg, border: `1px solid ${t.bd}`, borderRadius: 999, padding: '4px 8px', fontSize: 9, textTransform: 'uppercase' }}>{u.status}</span></td><td style={{ padding: '12px 10px', color: u.totp_enabled ? '#6ee7b7' : '#7f8b9a', fontSize: 11, display: 'table-cell' }}>{u.totp_enabled ? <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><ShieldCheck size={13}/>TOTP</span> : <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><ShieldAlert size={13}/>Not enabled</span>}</td><td style={{ padding: '12px 10px', color: '#758497', fontSize: 11 }}>{dateLabel(u.created_at)}</td><td style={{ padding: '12px 10px', textAlign: 'right' }}><ChevronRight size={15} color="#546274"/></td></tr>; })}</tbody></table></div>
        {!usersQ.isLoading && users.length === 0 && <div style={{ padding: 38, textAlign: 'center', color: '#718094', fontSize: 13 }}>No identities match the current filters.</div>}
      </div>}

      {tab === 'sessions' && <div style={{ padding: 16 }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}><div><div style={{ fontWeight: 700, fontSize: 15 }}>Session exposure</div><div style={{ color: '#718094', fontSize: 11, marginTop: 3 }}>Raw refresh tokens are never rendered. Only metadata and fingerprints are visible.</div></div><button type="button" onClick={() => { if (window.confirm('Revoke all active operator sessions in this organisation?')) revokeAllM.mutate(); }} disabled={revokeAllM.isPending || activeSessions === 0} style={{ border: '1px solid rgba(251,113,133,.25)', background: 'rgba(251,113,133,.07)', color: '#fb7185', padding: '8px 11px', borderRadius: 9, display: 'flex', gap: 7, alignItems: 'center' }}><LockKeyhole size={13}/>Revoke all</button></div><div style={{ display: 'grid', gap: 8 }}>{sessions.map(s => <div key={s.id} style={{ border: '1px solid rgba(255,255,255,.07)', borderRadius: 12, padding: 13, display: 'grid', gridTemplateColumns: 'minmax(220px,1.4fr) minmax(180px,1fr) auto', gap: 12, alignItems: 'center' }}><div><div style={{ fontWeight: 700, fontSize: 12 }}>{s.name} <span style={{ color: '#677789', fontWeight: 500 }}>· {roleLabel(s.role)}</span></div><div style={{ color: '#748295', fontSize: 10, marginTop: 4 }}>{s.email}</div><div style={{ ...mono, color: '#5d6c7d', fontSize: 9, marginTop: 5 }}>{s.token_fingerprint} · {s.ip_address || 'IP unavailable'}</div></div><div style={{ color: '#748295', fontSize: 10 }}>Created {dateLabel(s.created_at)}<br/>Last seen {dateLabel(s.last_seen_at)}<br/>Expires {dateLabel(s.expires_at)}</div><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ ...mono, color: s.state === 'active' ? '#4ade80' : '#7f8b9a', fontSize: 9 }}>{s.state}</span>{s.state === 'active' && <button type="button" onClick={() => revokeM.mutate(s.id)} aria-label="Revoke session" style={{ border: 0, background: 'transparent', color: '#fb7185' }}><UserX size={15}/></button>}</div></div>)}</div>{sessions.length === 0 && <div style={{ padding: 38, textAlign: 'center', color: '#718094' }}>No session credentials are visible.</div>}</div>}

      {tab === 'roles' && <div style={{ padding: 16 }}><div style={{ marginBottom: 13 }}><div style={{ fontWeight: 700, fontSize: 15 }}>Canonical role catalogue</div><div style={{ color: '#718094', fontSize: 11, marginTop: 3 }}>A visible role definition layer. Existing backend authorisation remains authoritative.</div></div><div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10 }}>{roles.map(r => <div key={r.id} style={{ border: '1px solid rgba(255,255,255,.07)', borderRadius: 12, padding: 14 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><div><div style={{ fontWeight: 700, fontSize: 13 }}>{r.label}</div><div style={{ ...mono, color: '#5f6e80', fontSize: 9, marginTop: 4 }}>{r.id}</div></div><span style={{ ...mono, color: '#65d6ff', fontSize: 9 }}>{roleCounts[r.id] || 0} USERS</span></div><div style={{ color: '#8795a5', fontSize: 11, marginTop: 9 }}>{r.posture}</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>{r.permissions.map(p => <span key={p} style={{ ...mono, fontSize: 9, color: '#8fdff7', background: 'rgba(89,214,255,.05)', border: '1px solid rgba(89,214,255,.15)', padding: '4px 7px', borderRadius: 7 }}>{p}</span>)}</div></div>)}</div></div>}

      {tab === 'requests' && <div style={{ padding: 16 }}><div style={{ marginBottom: 13 }}><div style={{ fontWeight: 700, fontSize: 15 }}>Access request queue</div><div style={{ color: '#718094', fontSize: 11, marginTop: 3 }}>Every disposition is explicit and tenant-scoped.</div></div><div style={{ display: 'grid', gap: 8 }}>{requests.map(r => <div key={r.id} style={{ border: '1px solid rgba(255,255,255,.07)', borderRadius: 12, padding: 13, display: 'grid', gridTemplateColumns: 'minmax(220px,1.4fr) minmax(180px,1fr) auto', gap: 12, alignItems: 'center' }}><div><div style={{ fontWeight: 700, fontSize: 12 }}>{r.name}</div><div style={{ color: '#748295', fontSize: 10, marginTop: 4 }}>{r.email}{r.organization ? ` · ${r.organization}` : ''}</div>{r.reason && <div style={{ color: '#667688', fontSize: 10, marginTop: 6 }}>{r.reason}</div>}</div><div style={{ color: '#748295', fontSize: 10 }}><span style={{ color: '#d4dde8' }}>{roleLabel(r.role_requested)}</span> requested<br/>Submitted {dateLabel(r.created_at)}</div><div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>{r.status === 'pending' ? <><button type="button" onClick={() => requestM.mutate({ id: r.id, status: 'approved' })} style={{ border: '1px solid rgba(74,222,128,.25)', background: 'rgba(74,222,128,.07)', color: '#4ade80', padding: '6px 8px', borderRadius: 8 }}>Approve</button><button type="button" onClick={() => requestM.mutate({ id: r.id, status: 'rejected' })} style={{ border: '1px solid rgba(251,113,133,.22)', background: 'rgba(251,113,133,.07)', color: '#fb7185', padding: '6px 8px', borderRadius: 8 }}>Reject</button></> : <span style={{ ...mono, color: '#718094', fontSize: 9 }}>{r.status}</span>}</div></div>)}</div>{requests.length === 0 && <div style={{ padding: 38, textAlign: 'center', color: '#718094' }}>No access requests are currently recorded.</div>}</div>}
    </section>

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10, marginTop: 12 }}>
      {[
        ['SESSION REVOCATION', overview?.controls.session_revocation || '—'],
        ['PASSKEYS', overview?.controls.passkeys || '—'],
        ['TENANT ISOLATION', overview?.controls.tenant_isolation || '—'],
      ].map(([label, value]) => <div key={label} style={{ border: '1px solid rgba(255,255,255,.06)', borderRadius: 11, background: 'rgba(255,255,255,.015)', padding: 12 }}><div style={{ ...mono, color: '#627083', fontSize: 9, letterSpacing: '.12em' }}>{label}</div><div style={{ color: '#b8c5d2', fontSize: 11, marginTop: 5, fontWeight: 700 }}>{value}</div></div>)}
    </div>

    {provision && <div style={{ position: 'fixed', inset: 0, zIndex: 999, display: 'grid', placeItems: 'center', padding: 20, background: 'rgba(3,8,13,.72)', backdropFilter: 'blur(5px)' }}><div style={{ ...panel, width: 'min(560px,100%)', padding: 20 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><div><div style={{ ...mono, color: '#ff9345', fontSize: 9, letterSpacing: '.15em' }}>IDENTITY PROVISIONING</div><div style={{ marginTop: 5, fontWeight: 700, fontSize: 19 }}>Create operator account</div><div style={{ marginTop: 4, color: '#718094', fontSize: 11 }}>Account is created inside the authenticated organisation.</div></div><button type="button" onClick={() => setProvision(false)} style={{ border: 0, background: 'transparent', color: '#788697' }}><XCircle size={18}/></button></div><div style={{ display: 'grid', gap: 10, marginTop: 17 }}><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Full name" style={field}/><input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="Work email" type="email" style={field}/><input value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Temporary password (min 6 chars)" type="password" style={field}/><select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} style={field}>{roles.filter(r => !['yard_agent','port_agent'].includes(r.id)).map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></div>{provisionM.isError && <div style={{ color: '#fb7185', fontSize: 11, marginTop: 9 }}>Provisioning failed. Check the account payload and database response.</div>}<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}><button type="button" onClick={() => setProvision(false)} style={{ border: '1px solid rgba(255,255,255,.09)', background: 'transparent', color: '#8795a5', padding: '9px 11px', borderRadius: 9 }}>Cancel</button><button type="button" onClick={() => provisionM.mutate(form)} disabled={provisionM.isPending || !form.name.trim() || !form.email.trim() || form.password.length < 6} style={{ border: 0, background: 'linear-gradient(135deg,#ff974b,#d96b22)', color: '#fff', padding: '9px 12px', borderRadius: 9, fontWeight: 700 }}>{provisionM.isPending ? 'Creating…' : 'Create account'}</button></div></div></div>}

    {selected && <div style={{ position: 'fixed', inset: 0, zIndex: 998, background: 'rgba(3,8,13,.62)', backdropFilter: 'blur(4px)' }} onClick={() => setSelected(null)}><aside onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: 0, right: 0, width: 'min(470px,100%)', height: '100%', overflowY: 'auto', padding: 20, background: '#0b131c', borderLeft: '1px solid rgba(255,255,255,.09)' }}><div style={{ display: 'flex', justifyContent: 'space-between' }}><div><div style={{ ...mono, color: '#ff9345', fontSize: 9, letterSpacing: '.15em' }}>IDENTITY DETAIL</div><div style={{ marginTop: 6, fontWeight: 700, fontSize: 20 }}>{selected.name}</div><div style={{ marginTop: 3, color: '#718094', fontSize: 11 }}>{selected.email}</div></div><button type="button" onClick={() => setSelected(null)} style={{ border: 0, background: 'transparent', color: '#788697' }}><XCircle size={18}/></button></div><div style={{ ...panel, padding: 14, marginTop: 16 }}><div style={{ display: 'grid', gap: 11 }}><div><div style={{ ...mono, color: '#5f6f80', fontSize: 9 }}>ROLE</div><select value={selected.role} onChange={e => setSelected({ ...selected, role: e.target.value })} style={{ ...field, marginTop: 5 }}>{roles.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></div><div><div style={{ ...mono, color: '#5f6f80', fontSize: 9 }}>ACCOUNT STATUS</div><select value={selected.status} onChange={e => setSelected({ ...selected, status: e.target.value })} style={{ ...field, marginTop: 5 }}><option value="active">Active</option><option value="inactive">Inactive</option><option value="suspended">Suspended</option></select></div></div></div><div style={{ marginTop: 14, border: '1px solid rgba(255,255,255,.06)', borderRadius: 10, padding: 12, color: '#718094', fontSize: 11, lineHeight: 1.6 }}><b style={{ color: '#b5c1cd' }}>Security boundary:</b> identity changes affect future authorisation; historical evidence remains immutable.</div>{updateM.isError && <div style={{ color: '#fb7185', fontSize: 11, marginTop: 9 }}>Update failed. The backend rejected this identity change.</div>}<button type="button" onClick={() => updateM.mutate({ id: selected.id, patch: { role: selected.role, status: selected.status } })} disabled={updateM.isPending} style={{ width: '100%', marginTop: 14, border: 0, background: 'linear-gradient(135deg,#ff974b,#d96b22)', color: '#fff', padding: 11, borderRadius: 10, fontWeight: 700 }}>{updateM.isPending ? 'Applying…' : 'Apply identity policy'}</button></aside></div>}
  </div>;
}
