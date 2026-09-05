import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Card, Button, Badge } from './components.js';
import FieldAccessPanel from './FieldAccessPanel.js';
import { useAuthStore } from '../../stores/auth.js';

type Recipient = {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  enabled: boolean;
  sonalit_operational: boolean;
  sonalit_security: boolean;
  cds_client_pulse: boolean;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type SettingsTab = 'profile' | 'field access' | 'client pulse';

export default function ClientPulseSettingsView() {
  const [tab, setTab] = useState<SettingsTab>('profile');
  const tabs: SettingsTab[] = ['profile', 'field access', 'client pulse'];
  return (
    <div className="p-5 max-w-[1600px] mx-auto">
      <div className="flex gap-4" style={{ minHeight: 400 }}>
        <div className="w-[180px] flex-none space-y-1">
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)} className={`w-full text-left px-4 py-2.5 rounded-lg text-xs font-semibold border-none cursor-pointer transition-colors capitalize ${tab === t ? 'bg-[rgba(255,255,255,.06)] text-cds-orange' : 'bg-transparent text-text-2 hover:text-text-1'}`}>
              {t}
            </button>
          ))}
        </div>
        {tab === 'field access' ? <FieldAccessPanel /> : tab === 'client pulse' ? <ClientPulsePanel /> : <ProfilePanel />}
      </div>
    </div>
  );
}

function ProfilePanel() {
  const user = useAuthStore(s => s.user);
  if (!user) return null;
  const rows = [
    { label: 'Full name', value: user.name ?? '—' },
    { label: 'Email', value: user.email ?? '—' },
    { label: 'Role', value: (user.role ?? '—').toUpperCase().replace('_', ' ') },
    { label: 'Organisation ID', value: user.org_id ?? '—' },
  ];
  return <Card className="flex-1 p-5"><div className="space-y-0">{rows.map((row, i) => <div key={row.label} className={`flex items-center justify-between py-3.5 ${i < rows.length - 1 ? 'border-b border-[rgba(255,255,255,.05)]' : ''}`}><div className="text-xs text-text-0">{row.label}</div><span className="text-xs font-mono text-text-1">{row.value}</span></div>)}</div></Card>;
}

function ClientPulsePanel() {
  const [rows, setRows] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const response = await api.get<{ data: Recipient[] }>('/settings/email-recipients');
      setRows(response.data.data ?? []);
    } catch (err) {
      setError((err as any)?.response?.data?.error ?? 'Failed to load client email recipients');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const addRecipient = async () => {
    const normalized = email.trim().toLowerCase();
    if (!EMAIL_RE.test(normalized)) { setError('Enter a valid client email address.'); return; }
    setError(''); setMessage(''); setSaving('new');
    try {
      await api.post('/settings/email-recipients', {
        email: normalized,
        name: name.trim() || null,
        company: company.trim() || null,
        enabled: true,
        sonalit_operational: true,
        sonalit_security: false,
        cds_client_pulse: true,
      });
      setEmail(''); setName(''); setCompany('');
      setMessage('Client recipient added.');
      await load();
    } catch (err) {
      setError((err as any)?.response?.data?.error ?? 'Failed to add client recipient');
    } finally { setSaving(null); }
  };

  const updateRecipient = async (row: Recipient, patch: Partial<Recipient>) => {
    setError(''); setMessage(''); setSaving(row.id);
    try {
      const response = await api.put<{ data: Recipient }>(`/settings/email-recipients/${row.id}`, patch);
      setRows(current => current.map(item => item.id === row.id ? response.data.data : item));
      setMessage('Recipient settings saved.');
    } catch (err) {
      setError((err as any)?.response?.data?.error ?? 'Failed to save recipient settings');
    } finally { setSaving(null); }
  };

  const sendPulse = async () => {
    setSending(true); setError(''); setMessage('');
    try {
      const response = await api.post<{ data: { skipped?: boolean; queued?: number; reason?: string } }>('/settings/cds-client-pulse/send', {});
      const result = response.data.data;
      setMessage(result.skipped ? `Client Pulse not sent: ${result.reason ?? 'no active bookings'}.` : `Client Pulse queued for ${result.queued ?? 0} recipient(s).`);
    } catch (err) {
      setError((err as any)?.response?.data?.error ?? 'Client Pulse send failed');
    } finally { setSending(false); }
  };

  return (
    <div className="flex-1 space-y-4">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-text-0">CDS Client Pulse</div>
            <p className="mt-1 max-w-2xl text-xs text-text-2">Client Pulse recipients are separate from Sonalit portal login accounts. These controls determine which client contacts receive the CDS operational manifest.</p>
          </div>
          <Button onClick={sendPulse} disabled={sending}>{sending ? 'Sending…' : 'Send Client Pulse Now'}</Button>
        </div>
        {message && <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300">{message}</div>}
        {error && <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
      </Card>

      <Card className="p-5">
        <div className="mb-4 text-xs font-mono tracking-wider text-text-2">ADD CLIENT RECIPIENT</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="client@example.com" className="w-full rounded-lg border border-[rgba(255,255,255,.1)] bg-ink-2 px-3 py-2 text-xs text-text-0 outline-none" />
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Contact name" className="w-full rounded-lg border border-[rgba(255,255,255,.1)] bg-ink-2 px-3 py-2 text-xs text-text-0 outline-none" />
          <input value={company} onChange={e => setCompany(e.target.value)} placeholder="Company (optional)" className="w-full rounded-lg border border-[rgba(255,255,255,.1)] bg-ink-2 px-3 py-2 text-xs text-text-0 outline-none" />
        </div>
        <div className="mt-3 flex justify-end"><Button onClick={addRecipient} disabled={saving === 'new' || !email.trim()}>{saving === 'new' ? 'Adding…' : 'Add Recipient'}</Button></div>
      </Card>

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between"><div className="text-xs font-mono tracking-wider text-text-2">CLIENT RECIPIENTS</div><span className="text-[10px] font-mono text-text-2">{rows.length} configured</span></div>
        {loading ? <div className="py-8 text-center text-xs text-text-2">Loading recipients…</div> : rows.length === 0 ? <div className="py-8 text-center text-xs text-text-2">No client email recipients configured.</div> : <div className="space-y-2">{rows.map(row => <div key={row.id} className="rounded-lg border border-[rgba(255,255,255,.07)] bg-ink-2 p-3"><div className="flex items-center justify-between gap-3"><div><div className="text-xs font-semibold text-text-0">{row.name || row.email}</div><div className="text-[10px] text-text-2">{row.email}{row.company ? ` · ${row.company}` : ''}</div></div><Badge variant={row.enabled ? 'ok' : 'neutral'}>{row.enabled ? 'ACTIVE' : 'OFF'}</Badge></div><div className="mt-3 grid grid-cols-1 sm:grid-cols-4 gap-2 text-[10px] text-text-2">{([['enabled','Email enabled'],['sonalit_operational','Sonalit operational'],['sonalit_security','Sonalit security'],['cds_client_pulse','CDS Client Pulse']] as const).map(([field,label]) => <label key={field} className="flex items-center gap-2"><input type="checkbox" checked={row[field]} onChange={e => void updateRecipient(row, { [field]: e.target.checked })} disabled={saving === row.id} />{label}</label>)}</div></div>)}</div>}
      </Card>

      <div className="text-[10px] leading-relaxed text-text-2">Client Pulse uses the existing production sender/routing path and is skipped when there are no active bookings. Recipient management is independent of portal login permissions.</div>
    </div>
  );
}
