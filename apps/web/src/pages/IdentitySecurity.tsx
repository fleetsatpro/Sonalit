import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  CheckCircle2,
  ChevronRight,
  CircleUserRound,
  Clock3,
  KeyRound,
  LockKeyhole,
  MonitorSmartphone,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldAlert,
  UserCheck,
  UserCog,
  UserX,
  Users,
  XCircle,
} from 'lucide-react';
import { api } from '../lib/api.js';

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

interface IdentityRole {
  id: string;
  label: string;
  posture: string;
  permissions: string[];
}

interface IdentitySession {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string | null;
  ip_address: string | null;
  user_agent: string | null;
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
  reviewed_at: string | null;
  created_at: string;
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrator',
  dispatcher: 'Dispatcher',
  operator: 'Operator',
  analyst: 'Analyst',
  cfo: 'CFO',
  response_crew: 'Response Crew',
  handover_officer: 'Handover Officer',
  yard_agent: 'Yard Agent',
  port_agent: 'Port Agent',
};

const panel: React.CSSProperties = {
  background: 'linear-gradient(180deg, rgba(17,27,37,.98), rgba(11,18,26,.98))',
  border: '1px solid rgba(255,255,255,.08)',
  borderRadius: 16,
  boxShadow: '0 18px 55px rgba(0,0,0,.18)',
};

const input: React.CSSProperties = {
  width: '100%',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,.10)',
  background: 'rgba(3,10,16,.72)',
  color: '#e7eef6',
  padding: '10px 12px',
  outline: 'none',
  fontSize: 13,
};

const mono: React.CSSProperties = {
  fontFamily: 'IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace',
};

function fmtDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function roleLabel(role: string) {
  return ROLE_LABELS[role] || role.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function toneForStatus(status: string) {
  if (status === 'active') return { fg: '#4ade80', bg: 'rgba(74,222,128,.10)', border: 'rgba(74,222,128,.24)' };
  if (status === 'suspended') return { fg: '#fb7185', bg: 'rgba(251,113,133,.10)', border: 'rgba(251,113,133,.24)' };
  return { fg: '#fbbf24', bg: 'rgba(251,191,36,.10)', border: 'rgba(251,191,36,.22)' };
}

function Metric({ label, value, hint, icon: Icon, accent = '#ff9345' }: { label: string; value: string | number; hint: string; icon: typeof Users; accent?: string }) {
  return (
    <div style={{ ...panel, padding: 18, minHeight: 118 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14 }}>
        <div>
          <div style={{ color: '#7e8d9d', fontSize: 10, letterSpacing: '.13em', textTransform: 'uppercase', ...mono }}>{label}</div>
          <div style={{ color: '#f4f7fb', fontSize: 29, fontWeight: 700, marginTop: 8, letterSpacing: '-.02em' }}>{value}</div>
          <div style={{ color: '#8391a1', fontSize: 11, marginTop: 5 }}>{hint}</div>
        </div>
        <div style={{ width: 38, height: 38, borderRadius: 12, display: 'grid', placeItems: 'center', color: accent, background: `${accent}14`, border: `1px solid ${accent}33` }}>
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}

export default function IdentitySecurity() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'people' | 'sessions' | 'roles' | 'requests'>('people');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [role, setRole] = useState('all');
  const [showProvision, setShowProvision] = useState(false);
  const [selectedUser, setSelectedUser] = useState<IdentityUser | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'operator' });

  const overviewQ = useQuery<{ data: any }>({
    queryKey: ['identity-overview'],
    queryFn: () => api.get('/auth/identity/overview').then((r) => r.data),
    refetchInterval: 30_000,
  });

  const rolesQ = useQuery<{ data: IdentityRole[] }>({
    queryKey: ['identity-roles'],
    queryFn: () => api.get('/auth/identity/roles').then((r) => r.data),
  });

  const usersQ = useQuery<{ data: IdentityUser[]; meta: { total: number } }>({
    queryKey: ['identity-users', search, status, role],
    queryFn: () => api.get('/auth/identity/users', {
      params: {
        search: search || undefined,
        status: status === 'all' ? undefined : status,
        role: role === 'all' ? undefined : role,
        limit: 100,
      },
    }).then((r) => r.data),
  });

  const sessionsQ = useQuery<{ data: IdentitySession[] }>({
    queryKey: ['identity-sessions'],
    queryFn: () => api.get('/auth/identity/sessions').then((r) => r.data),
    refetchInterval: 30_000,
  });

  const requestsQ = useQuery<{ data: AccessRequest[] }>({
    queryKey: ['identity-access-requests'],
    queryFn: () => api.get('/auth/identity/access-requests').then((r) => r.data),
  });

  const provisionM = useMutation({
    mutationFn: (payload: typeof form) => api.post('/auth/users', payload),
    onSuccess: () => {
      setForm({ name: '', email: '', password: '', role: 'operator' });
      setShowProvision(false);
      setNotice('Account provisioned and assigned to this organisation.');
      qc.invalidateQueries({ queryKey: ['identity-users'] });
      qc.invalidateQueries({ queryKey: ['identity-overview'] });
    },
  });

  const updateUserM = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<IdentityUser> }) => api.patch(`/auth/identity/users/${id}`, patch),
    onSuccess: () => {
      setNotice('Identity policy updated.');
      setSelectedUser(null);
      qc.invalidateQueries({ queryKey: ['identity-users'] });
      qc.invalidateQueries({ queryKey: ['identity-overview'] });
    },
  });

  const revokeSessionM = useMutation({
    mutationFn: (id: string) => api.delete(`/auth/identity/sessions/${id}`),
    onSuccess: () => {
      setNotice('Session revoked.');
      qc.invalidateQueries({ queryKey: ['identity-sessions'] });
      qc.invalidateQueries({ queryKey: ['identity-overview'] });
    },
  });

  const revokeAllM = useMutation({
    mutationFn: () => api.post('/auth/identity/sessions/revoke-all'),
    onSuccess: (res) => {
      setNotice(`${res.data?.data?.revoked ?? 0} active sessions revoked. Sign in again on trusted devices.`);
      qc.invalidateQueries({ queryKey: ['identity-sessions'] });
      qc.invalidateQueries({ queryKey: ['identity-overview'] });
    },
  });

  const requestM = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/auth/identity/access-requests/${id}`, { status }),
    onSuccess: () => {
      setNotice('Access request reviewed.');
      qc.invalidateQueries({ queryKey: ['identity-access-requests'] });
    },
  });

  const users = usersQ.data?.data ?? [];
  const sessions = sessionsQ.data?.data ?? [];
  const requests = requestsQ.data?.data ?? [];
  const roles = rolesQ.data?.data ?? [];
  const overview = overviewQ.data?.data;
  const pendingRequests = requests.filter((x) => x.status === 'pending').length;
  const activeSessions = sessions.filter((x) => x.state === 'active').length;
  const mfaCoverage = overview?.mfa?.coverage_pct ?? 0;

  const roleCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const user of users) map[user.role] = (map[user.role] || 0) + 1;
    return map;
  }, [users]);

  return (
    <div style={{ minHeight: '100%', color: '#e7eef6', paddingBottom: 36 }}>
      <div style={{ padding: '22px 24px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <div style={{ ...mono, color: '#ff9345', fontSize: 10, letterSpacing: '.18em', fontWeight: 700 }}>SONALIT / TRUST FABRIC</div>
            <h1 style={{ margin: '8px 0 4px', fontSize: 31, letterSpacing: '-.03em', fontWeight: 700 }}>Identity &amp; Security Centre</h1>
            <p style={{ margin: 0, color: '#8492a3', maxWidth: 840, fontSize: 13 }}>
              Control identity, role scope, tenant boundaries, authentication posture and live session exposure from one operator-grade security surface.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="button" onClick={() => { overviewQ.refetch(); usersQ.refetch(); sessionsQ.refetch(); requestsQ.refetch(); }} style={{ border: '1px solid rgba(255,255,255,.10)', background: 'rgba(255,255,255,.03)', color: '#b9c4cf', padding: '9px 11px', borderRadius: 10, display: 'flex', gap: 7, alignItems: 'center', cursor: 'pointer' }}>
              <RefreshCw size={14} /> Refresh
            </button>
            <button type="button" onClick={() => setShowProvision(true)} style={{ border: '1px solid rgba(255,147,69,.35)', background: 'linear-gradient(135deg,#ff974b,#d96b22)', color: '#fff', padding: '9px 13px', borderRadius: 10, display: 'flex', gap: 7, alignItems: 'center', cursor: 'pointer', fontWeight: 700 }}>
              <Plus size={14} /> Provision account
            </button>
          </div>
        </div>

        {notice && (
          <div style={{ marginTop: 16, padding: '10px 12px', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', borderRadius: 11, border: '1px solid rgba(45,212,168,.2)', background: 'rgba(45,212,168,.07)', color: '#a7f3d0', fontSize: 12 }}>
            <span style={{ display: 'flex', gap: 7, alignItems: 'center' }}><CheckCircle2 size={14} /> {notice}</span>
            <button type="button" onClick={() => setNotice(null)} style={{ border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer' }}><XCircle size={14} /></button>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 12, marginTop: 18 }}>
          <Metric label="IDENTITIES" value={overview?.users?.total ?? '—'} hint={`${overview?.users?.active ?? 0} active / ${overview?.users?.suspended ?? 0} suspended`} icon={Users} />
          <Metric label="ACTIVE SESSIONS" value={activeSessions || overview?.sessions?.active_sessions || 0} hint="Refresh credentials currently valid" icon={MonitorSmartphone} accent="#59d6ff" />
          <Metric label="MFA COVERAGE" value={`${mfaCoverage}%`} hint={`${overview?.mfa?.totp_enabled ?? 0} identities with TOTP`} icon={ShieldCheck} accent="#6ee7b7" />
          <Metric label="ACCESS QUEUE" value={pendingRequests} hint="Pending access requests" icon={UserCheck} accent="#f3c76b" />
        </div>

        <div style={{ ...panel, marginTop: 16, overflow: 'hidden' }}>
          <div style={{ display: 'flex', gap: 2, padding: 5, borderBottom: '1px solid rgba(255,255,255,.07)', background: 'rgba(255,255,255,.02)', overflowX: 'auto' }}>
            {[
              ['people', 'PEOPLE', Users],
              ['sessions', 'SESSIONS', Activity],
              ['roles', 'ROLE CATALOG', UserCog],
              ['requests', 'ACCESS QUEUE', KeyRound],
            ].map(([id, label, Icon]) => {
              const active = tab === id;
              return (
                <button key={String(id)} type="button" onClick={() => setTab(id as typeof tab)} style={{ border: 0, borderRadius: 9, padding: '10px 14px', background: active ? 'rgba(255,147,69,.12)' : 'transparent', color: active ? '#ffb06d' : '#8492a3', cursor: 'pointer', fontSize: 11, fontWeight: 700, letterSpacing: '.08em', display: 'flex', gap: 7, alignItems: 'center', whiteSpace: 'nowrap' }}>
                  <Icon size={14} /> {label}
                </button>
              );
            })}
          </div>

          {tab === 'people' && (
            <div style={{ padding: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px,1fr) 170px 170px auto', gap: 9, marginBottom: 13 }}>
                <label style={{ position: 'relative' }}>
                  <Search size={14} style={{ position: 'absolute', left: 11, top: 11, color: '#718094' }} />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or email" style={{ ...input, paddingLeft: 34 }} />
                </label>
                <select value={status} onChange={(e) => setStatus(e.target.value)} style={input}>
                  <option value="all">All status</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="suspended">Suspended</option>
                </select>
                <select value={role} onChange={(e) => setRole(e.target.value)} style={input}>
                  <option value="all">All roles</option>
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
                <div style={{ ...mono, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', color: '#718094', fontSize: 10 }}>{usersQ.data?.meta?.total ?? 0} identities</div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                  <thead><tr>{['IDENTITY','ROLE / SCOPE','POSTURE','MFA','CREATED',''].map((h) => <th key={h} style={{ textAlign: 'left', color: '#617183', fontSize: 9, letterSpacing: '.12em', padding: '9px 10px', borderBottom: '1px solid rgba(255,255,255,.07)', ...mono }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {users.map((u) => {
                      const tone = toneForStatus(u.status);
                      return (
                        <tr key={u.id} onClick={() => setSelectedUser(u)} style={{ cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                          <td style={{ padding: '13px 10px' }}>
                            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                              <div style={{ width: 34, height: 34, borderRadius: 9, display: 'grid', placeItems: 'center', background: 'rgba(255,147,69,.10)', color: '#ffb06d', border: '1px solid rgba(255,147,69,.18)' }}><CircleUserRound size={16} /></div>
                              <div><div style={{ fontWeight: 700, fontSize: 13 }}>{u.name}</div><div style={{ color: '#718094', fontSize: 11 }}>{u.email}</div></div>
                            </div>
                          </td>
                          <td style={{ padding: '13px 10px' }}><div style={{ color: '#d4dde8', fontSize: 12, fontWeight: 600 }}>{roleLabel(u.role)}</div><div style={{ color: '#657488', fontSize: 10, marginTop: 3 }}>{roleCounts[u.role] || 0} in tenant</div></td>
                          <td style={{ padding: '13px 10px' }}><span style={{ color: tone.fg, background: tone.bg, border: `1px solid ${tone.border}`, borderRadius: 999, padding: '4px 8px', fontSize: 10, textTransform: 'uppercase', ...mono }}>{u.status}</span></td>
                          <td style={{ padding: '13px 10px' }}><span style={{ color: u.totp_enabled ? '#6ee7b7' : '#7f8b9a', display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 11 }}>{u.totp_enabled ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />}{u.totp_enabled ? 'TOTP' : 'Not enabled'}</span></td>
                          <td style={{ padding: '13px 10px', color: '#758497', fontSize: 11 }}>{fmtDate(u.created_at)}</td>
                          <td style={{ padding: '13px 10px', textAlign: 'right' }}><ChevronRight size={15} color="#546274" /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!usersQ.isLoading && users.length === 0 && <div style={{ padding: 42, textAlign: 'center', color: '#718094', fontSize: 13 }}>No identities match the current filters.</div>}
            </div>
          )}

          {tab === 'sessions' && (
            <div style={{ padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 13 }}>
                <div><div style={{ fontWeight: 700, fontSize: 15 }}>Session exposure</div><div style={{ color: '#718094', fontSize: 11, marginTop: 3 }}>Every row is a refresh credential. Tokens themselves are never exposed.</div></div>
                <button type="button" onClick={() => { if (window.confirm('Revoke every currently active operator session in this organisation?')) revokeAllM.mutate(); }} disabled={revokeAllM.isPending || activeSessions === 0} style={{ border: '1px solid rgba(251,113,133,.25)', background: 'rgba(251,113,133,.07)', color: '#fb7185', padding: '8px 11px', borderRadius: 9, cursor: 'pointer', display: 'flex', gap: 7, alignItems: 'center', fontSize: 11 }}><LockKeyhole size={13} /> Revoke all sessions</button>
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {sessions.map((s) => {
                  const active = s.state === 'active';
                  return <div key={s.id} style={{ border: '1px solid rgba(255,255,255,.07)', borderRadius: 12, padding: 13, background: active ? 'rgba(255,255,255,.015)' : 'rgba(255,255,255,.008)', display: 'grid', gridTemplateColumns: 'minmax(220px,1.4fr) minmax(170px,1fr) auto', gap: 12, alignItems: 'center' }}>
                    <div><div style={{ fontWeight: 700, fontSize: 12 }}>{s.name} <span style={{ color: '#677789', fontWeight: 500 }}>· {roleLabel(s.role)}</span></div><div style={{ color: '#748295', fontSize: 10, marginTop: 4 }}>{s.email}</div><div style={{ ...mono, color: '#5d6c7d', fontSize: 9, marginTop: 5 }}>{s.token_fingerprint} · {s.ip_address || 'IP unavailable'}</div></div>
                    <div style={{ color: '#748295', fontSize: 10 }}><div>Created {fmtDate(s.created_at)}</div><div style={{ marginTop: 4 }}>Last seen {fmtDate(s.last_seen_at)}</div><div style={{ marginTop: 4 }}>Expires {fmtDate(s.expires_at)}</div></div>
                    <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}><span style={{ color: active ? '#4ade80' : '#7f8b9a', fontSize: 9, textTransform: 'uppercase', ...mono }}>{s.state}</span>{active && <button type="button" onClick={() => revokeSessionM.mutate(s.id)} title="Revoke session" style={{ border: 0, background: 'transparent', color: '#fb7185', cursor: 'pointer' }}><UserX size={15} /></button>}</div>
                  </div>;
                })}
              </div>
              {sessions.length === 0 && <div style={{ padding: 42, textAlign: 'center', color: '#718094' }}>No session credentials are visible.</div>}
            </div>
          )}

          {tab === 'roles' && (
            <div style={{ padding: 16 }}>
              <div style={{ marginBottom: 14 }}><div style={{ fontWeight: 700, fontSize: 15 }}>Canonical role catalogue</div><div style={{ color: '#718094', fontSize: 11, marginTop: 3 }}>Role meaning stays explicit. Operational permissions are never inferred from UI labels.</div></div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10 }}>
                {roles.map((r) => <div key={r.id} style={{ border: '1px solid rgba(255,255,255,.07)', borderRadius: 12, padding: 14, background: 'rgba(255,255,255,.012)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}><div><div style={{ fontWeight: 700, fontSize: 13 }}>{r.label}</div><div style={{ ...mono, color: '#5f6e80', fontSize: 9, marginTop: 4 }}>{r.id}</div></div><span style={{ ...mono, color: '#65d6ff', fontSize: 9 }}>{roleCounts[r.id] || 0} USERS</span></div>
                  <div style={{ color: '#8795a5', fontSize: 11, marginTop: 10 }}>{r.posture}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>{r.permissions.map((p) => <span key={p} style={{ border: '1px solid rgba(89,214,255,.15)', background: 'rgba(89,214,255,.05)', color: '#8fdff7', padding: '4px 7px', borderRadius: 7, fontSize: 9, ...mono }}>{p}</span>)}</div>
                </div>)}
              </div>
            </div>
          )}

          {tab === 'requests' && (
            <div style={{ padding: 16 }}>
              <div style={{ marginBottom: 14 }}><div style={{ fontWeight: 700, fontSize: 15 }}>Access request queue</div><div style={{ color: '#718094', fontSize: 11, marginTop: 3 }}>Requests are tenant-scoped and can be dispositioned without silently granting privileges.</div></div>
              <div style={{ display: 'grid', gap: 8 }}>
                {requests.map((r) => <div key={r.id} style={{ border: '1px solid rgba(255,255,255,.07)', borderRadius: 12, padding: 13, display: 'grid', gridTemplateColumns: 'minmax(220px,1.4fr) minmax(180px,1fr) auto', gap: 12, alignItems: 'center' }}>
                  <div><div style={{ fontWeight: 700, fontSize: 12 }}>{r.name}</div><div style={{ color: '#748295', fontSize: 10, marginTop: 4 }}>{r.email}{r.organization ? ` · ${r.organization}` : ''}</div>{r.reason && <div style={{ color: '#667688', fontSize: 10, marginTop: 6 }}>{r.reason}</div>}</div>
                  <div style={{ fontSize: 10, color: '#748295' }}><div><span style={{ color: '#d4dde8' }}>{roleLabel(r.role_requested)}</span> requested</div><div style={{ marginTop: 4 }}>Submitted {fmtDate(r.created_at)}</div></div>
                  <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>{r.status === 'pending' ? <><button type="button" onClick={() => requestM.mutate({ id: r.id, status: 'approved' })} style={{ border: '1px solid rgba(74,222,128,.25)', background: 'rgba(74,222,128,.07)', color: '#4ade80', padding: '6px 8px', borderRadius: 8, cursor: 'pointer', fontSize: 10 }}>Approve</button><button type="button" onClick={() => requestM.mutate({ id: r.id, status: 'rejected' })} style={{ border: '1px solid rgba(251,113,133,.22)', background: 'rgba(251,113,133,.07)', color: '#fb7185', padding: '6px 8px', borderRadius: 8, cursor: 'pointer', fontSize: 10 }}>Reject</button></> : <span style={{ ...mono, color: '#718094', fontSize: 9 }}>{r.status}</span>}</div>
                </div>)}
              </div>
              {requests.length === 0 && <div style={{ padding: 42, textAlign: 'center', color: '#718094' }}>No access requests are currently recorded.</div>}
            </div>
          )}
        </div>

        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10 }}>
          {[
            ['SESSION REVOCATION', overview?.controls?.session_revocation || '—', 'Operator session kill-switch is available.'],
            ['PASSKEYS', overview?.controls?.passkeys || '—', 'Native WebAuthn support stays upstream of this console.'],
            ['TENANT ISOLATION', overview?.controls?.tenant_isolation || '—', 'Identity reads and mutations are constrained to the authenticated organisation.'],
          ].map(([label, value, hint]) => <div key={String(label)} style={{ borderRadius: 11, border: '1px solid rgba(255,255,255,.06)', background: 'rgba(255,255,255,.015)', padding: 12 }}><div style={{ ...mono, color: '#627083', fontSize: 9, letterSpacing: '.12em' }}>{label}</div><div style={{ color: '#b8c5d2', fontSize: 11, marginTop: 5, fontWeight: 700 }}>{value}</div><div style={{ color: '#5f6f80', fontSize: 10, marginTop: 3 }}>{hint}</div></div>)}
        </div>
      </div>

      {showProvision && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(3,8,13,.72)', backdropFilter: 'blur(5px)', zIndex: 999, display: 'grid', placeItems: 'center', padding: 20 }}>
          <div style={{ ...panel, width: 'min(560px,100%)', padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}><div><div style={{ ...mono, color: '#ff9345', fontSize: 9, letterSpacing: '.15em' }}>IDENTITY PROVISIONING</div><div style={{ fontSize: 19, fontWeight: 700, marginTop: 5 }}>Create operator account</div><div style={{ color: '#718094', fontSize: 11, marginTop: 4 }}>Account is created directly inside the current tenant. No cross-tenant provisioning is permitted.</div></div><button type="button" onClick={() => setShowProvision(false)} style={{ border: 0, background: 'transparent', color: '#788697', cursor: 'pointer' }}><XCircle size={18} /></button></div>
            <div style={{ display: 'grid', gap: 10, marginTop: 18 }}>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Full name" style={input} />
              <input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="Work email" type="email" style={input} />
              <input value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder="Temporary password (min 6 chars)" type="password" style={input} />
              <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} style={input}>{roles.filter((r) => !['yard_agent','port_agent'].includes(r.id)).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
            </div>
            {provisionM.isError && <div style={{ marginTop: 10, color: '#fb7185', fontSize: 11 }}>Provisioning failed. Check the email, role and database response.</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}><button type="button" onClick={() => setShowProvision(false)} style={{ border: '1px solid rgba(255,255,255,.09)', background: 'transparent', color: '#8795a5', padding: '9px 11px', borderRadius: 9, cursor: 'pointer' }}>Cancel</button><button type="button" onClick={() => provisionM.mutate(form)} disabled={provisionM.isPending || !form.name.trim() || !form.email.trim() || form.password.length < 6} style={{ border: 0, background: 'linear-gradient(135deg,#ff974b,#d96b22)', color: '#fff', padding: '9px 12px', borderRadius: 9, cursor: 'pointer', fontWeight: 700 }}>{provisionM.isPending ? 'Creating…' : 'Create account'}</button></div>
          </div>
        </div>
      )}

      {selectedUser && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 998, background: 'rgba(3,8,13,.62)', backdropFilter: 'blur(4px)' }} onClick={() => setSelectedUser(null)}>
          <aside onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 0, right: 0, height: '100%', width: 'min(470px,100%)', background: '#0b131c', borderLeft: '1px solid rgba(255,255,255,.09)', padding: 20, overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}><div><div style={{ ...mono, color: '#ff9345', fontSize: 9, letterSpacing: '.15em' }}>IDENTITY DETAIL</div><div style={{ fontSize: 20, fontWeight: 700, marginTop: 6 }}>{selectedUser.name}</div><div style={{ color: '#718094', fontSize: 11, marginTop: 3 }}>{selectedUser.email}</div></div><button type="button" onClick={() => setSelectedUser(null)} style={{ border: 0, background: 'transparent', color: '#788697', cursor: 'pointer' }}><XCircle size={18} /></button></div>
            <div style={{ ...panel, padding: 14, marginTop: 16 }}>
              <div style={{ display: 'grid', gap: 11 }}>
                <div><div style={{ ...mono, color: '#5f6f80', fontSize: 9 }}>ROLE</div><select defaultValue={selectedUser.role} onChange={(e) => setSelectedUser({ ...selectedUser, role: e.target.value })} style={{ ...input, marginTop: 5 }}>{roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></div>
                <div><div style={{ ...mono, color: '#5f6f80', fontSize: 9 }}>ACCOUNT STATUS</div><select defaultValue={selectedUser.status} onChange={(e) => setSelectedUser({ ...selectedUser, status: e.target.value })} style={{ ...input, marginTop: 5 }}><option value="active">Active</option><option value="inactive">Inactive</option><option value="suspended">Suspended</option></select></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}><div style={{ border: '1px solid rgba(255,255,255,.06)', borderRadius: 9, padding: 10 }}><div style={{ ...mono, color: '#5f6f80', fontSize: 9 }}>MFA</div><div style={{ color: selectedUser.totp_enabled ? '#6ee7b7' : '#8391a1', fontSize: 11, marginTop: 4 }}>{selectedUser.totp_enabled ? 'TOTP enabled' : 'Not enabled'}</div></div><div style={{ border: '1px solid rgba(255,255,255,.06)', borderRadius: 9, padding: 10 }}><div style={{ ...mono, color: '#5f6f80', fontSize: 9 }}>CREATED</div><div style={{ color: '#8391a1', fontSize: 11, marginTop: 4 }}>{fmtDate(selectedUser.created_at)}</div></div></div>
              </div>
            </div>
            <div style={{ marginTop: 14, padding: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,.06)', background: 'rgba(255,255,255,.015)', color: '#718094', fontSize: 11, lineHeight: 1.6 }}><b style={{ color: '#b5c1cd' }}>Security boundary:</b> changing a role changes future authorisation checks. It does not rewrite historical audit records or operational evidence.</div>
            {updateUserM.isError && <div style={{ color: '#fb7185', fontSize: 11, marginTop: 10 }}>Update failed. The backend rejected the identity change.</div>}
            <button type="button" onClick={() => updateUserM.mutate({ id: selectedUser.id, patch: { role: selectedUser.role, status: selectedUser.status } })} disabled={updateUserM.isPending} style={{ width: '100%', marginTop: 14, border: 0, background: 'linear-gradient(135deg,#ff974b,#d96b22)', color: '#fff', padding: 11, borderRadius: 10, cursor: 'pointer', fontWeight: 700 }}>{updateUserM.isPending ? 'Applying…' : 'Apply identity policy'}</button>
          </aside>
        </div>
      )}
    </div>
  );
}
