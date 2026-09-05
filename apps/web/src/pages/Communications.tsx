import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCircle2, Clock3, Mail, Plus, Radio, RefreshCw, Search, Send, Shield, Users, XCircle, Zap } from 'lucide-react';
import { api } from '../lib/api.js';

interface Recipient {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  enabled: boolean;
  sonalit_operational: boolean;
  sonalit_security: boolean;
  cds_client_pulse: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CHANNELS = [
  { key: 'sonalit_operational', label: 'Operational', icon: Bell, tone: 'cyan' },
  { key: 'sonalit_security', label: 'Security', icon: Shield, tone: 'red' },
  { key: 'cds_client_pulse', label: 'Client Pulse', icon: Radio, tone: 'orange' },
] as const;

type ChannelKey = typeof CHANNELS[number]['key'];

const tone = {
  cyan: { text: 'text-cyan-300', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
  red: { text: 'text-red-300', bg: 'bg-red-500/10', border: 'border-red-500/20' },
  orange: { text: 'text-orange-300', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
};

function Metric({ label, value, detail, icon: Icon }: { label: string; value: string | number; detail: string; icon: typeof Users }) {
  return <div className="rounded-xl border border-white/[.07] bg-slate-900/60 p-4"><div className="flex items-center justify-between"><span className="text-[10px] font-mono uppercase tracking-[.16em] text-slate-500">{label}</span><Icon size={14} className="text-slate-500" /></div><div className="mt-2 text-2xl font-semibold text-white">{value}</div><div className="mt-1 text-[10px] text-slate-500">{detail}</div></div>;
}

export default function Communications() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | ChannelKey>('all');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ email: '', name: '', company: '' });
  const [notice, setNotice] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [sending, setSending] = useState(false);

  const { data, isLoading, isFetching, refetch } = useQuery<{ data: Recipient[] }>({
    queryKey: ['communications-recipients'],
    queryFn: () => api.get('/settings/email-recipients').then(r => r.data),
  });
  const rows = data?.data ?? [];

  const visible = useMemo(() => rows.filter(row => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || [row.email, row.name, row.company].filter(Boolean).some(v => String(v).toLowerCase().includes(q));
    const matchesFilter = filter === 'all' || row[filter];
    return matchesSearch && matchesFilter;
  }), [rows, search, filter]);

  const active = rows.filter(r => r.enabled).length;
  const pulse = rows.filter(r => r.enabled && r.cds_client_pulse).length;
  const security = rows.filter(r => r.enabled && r.sonalit_security).length;
  const operational = rows.filter(r => r.enabled && r.sonalit_operational).length;

  const add = useMutation({
    mutationFn: () => api.post('/settings/email-recipients', {
      email: form.email.trim().toLowerCase(), name: form.name.trim() || null, company: form.company.trim() || null,
      enabled: true, sonalit_operational: true, sonalit_security: false, cds_client_pulse: true,
    }),
    onSuccess: () => { setForm({ email: '', name: '', company: '' }); setShowAdd(false); setNotice({ type: 'ok', text: 'Recipient provisioned and Client Pulse enabled.' }); void qc.invalidateQueries({ queryKey: ['communications-recipients'] }); },
    onError: (e: any) => setNotice({ type: 'error', text: e?.response?.data?.error ?? 'Recipient provisioning failed.' }),
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Recipient> }) => api.put(`/settings/email-recipients/${id}`, patch),
    onSuccess: () => { setNotice({ type: 'ok', text: 'Routing policy updated.' }); void qc.invalidateQueries({ queryKey: ['communications-recipients'] }); },
    onError: (e: any) => setNotice({ type: 'error', text: e?.response?.data?.error ?? 'Routing update failed.' }),
  });

  const sendPulse = async () => {
    setSending(true); setNotice(null);
    try {
      const response = await api.post<{ data: { skipped?: boolean; queued?: number; reason?: string } }>('/settings/cds-client-pulse/send', {});
      const result = response.data.data;
      setNotice({ type: result.skipped ? 'error' : 'ok', text: result.skipped ? `Pulse not sent: ${result.reason ?? 'no active bookings'}.` : `Client Pulse queued for ${result.queued ?? pulse} recipient(s).` });
    } catch (e: any) { setNotice({ type: 'error', text: e?.response?.data?.error ?? 'Client Pulse dispatch failed.' }); }
    finally { setSending(false); }
  };

  const submitAdd = () => {
    const email = form.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) { setNotice({ type: 'error', text: 'Enter a valid client email address.' }); return; }
    setNotice(null); add.mutate();
  };

  return <div className="min-h-full max-w-[1600px] space-y-6">
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[.2em] text-orange-400"><Radio size={12} /> Communications Control Plane</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">Client communications, centrally orchestrated.</h1>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">One authoritative control surface for client recipients and Sonalit delivery policies. CDS Client Pulse consumes this routing layer; CDS Settings remains untouched.</p>
      </div>
      <div className="flex gap-2">
        <button onClick={() => void refetch()} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[.03] px-3 py-2 text-xs text-slate-300 hover:bg-white/[.06]"><RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} /> Refresh</button>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 rounded-lg bg-orange-600 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-500"><Plus size={13} /> Add Client</button>
      </div>
    </header>

    {notice && <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${notice.type === 'ok' ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300' : 'border-red-500/20 bg-red-500/5 text-red-300'}`}>{notice.type === 'ok' ? <CheckCircle2 size={13} /> : <XCircle size={13} />}{notice.text}<button className="ml-auto opacity-60" onClick={() => setNotice(null)}><XCircle size={13} /></button></div>}

    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <Metric label="Recipients" value={rows.length} detail={`${active} active delivery profiles`} icon={Users} />
      <Metric label="Operational" value={operational} detail="active client routing" icon={Bell} />
      <Metric label="Security" value={security} detail="security-aware recipients" icon={Shield} />
      <Metric label="Client Pulse" value={pulse} detail="active manifest recipients" icon={Zap} />
    </div>

    <section className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <div className="rounded-xl border border-white/[.07] bg-slate-900/40">
        <div className="flex flex-col gap-3 border-b border-white/[.07] p-4 md:flex-row md:items-center">
          <div className="relative flex-1"><Search size={14} className="absolute left-3 top-2.5 text-slate-600" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search contact, company or email…" className="w-full rounded-lg border border-white/[.08] bg-black/20 py-2 pl-9 pr-3 text-xs text-white outline-none focus:border-orange-500/40" /></div>
          <div className="flex gap-1 overflow-x-auto">{(['all', ...CHANNELS.map(c => c.key)] as const).map(key => { const label = key === 'all' ? 'All' : CHANNELS.find(c => c.key === key)?.label; return <button key={key} onClick={() => setFilter(key as any)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-[10px] font-semibold ${filter === key ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'}`}>{label}</button>; })}</div>
        </div>
        {isLoading ? <div className="p-10 text-center text-xs text-slate-500">Loading communications registry…</div> : visible.length === 0 ? <div className="p-12 text-center"><Mail size={24} className="mx-auto text-slate-700" /><p className="mt-3 text-xs text-slate-500">No recipients match this view.</p></div> : <div className="divide-y divide-white/[.05]">{visible.map(row => <RecipientRow key={row.id} row={row} saving={update.isPending} onToggle={(field, value) => update.mutate({ id: row.id, patch: { [field]: value } })} />)}</div>}
      </div>

      <aside className="space-y-4">
        <div className="rounded-xl border border-orange-500/20 bg-orange-500/[.04] p-5">
          <div className="flex items-center justify-between"><div><div className="text-[10px] font-mono uppercase tracking-[.16em] text-orange-300">Client Pulse</div><div className="mt-1 text-lg font-semibold text-white">Dispatch console</div></div><div className="rounded-lg bg-orange-500/10 p-2 text-orange-300"><Send size={15} /></div></div>
          <p className="mt-3 text-xs leading-5 text-slate-400">Trigger the existing production Client Pulse routing path. The backend decides whether there is an eligible active-booking manifest.</p>
          <button onClick={() => void sendPulse()} disabled={sending || pulse === 0} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-orange-600 py-2.5 text-xs font-semibold text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-40">{sending ? <><RefreshCw size={13} className="animate-spin" /> Queueing…</> : <><Send size={13} /> Send Client Pulse Now</>}</button>
          {pulse === 0 && <div className="mt-2 text-center text-[10px] text-slate-600">No active Client Pulse recipients.</div>}
        </div>
        <div className="rounded-xl border border-white/[.07] bg-slate-900/40 p-5">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[.16em] text-slate-500"><Clock3 size={12} /> Routing model</div>
          <div className="mt-4 space-y-3">{CHANNELS.map(channel => { const Icon = channel.icon; const c = tone[channel.tone]; return <div key={channel.key} className={`rounded-lg border ${c.border} ${c.bg} p-3`}><div className="flex items-center gap-2"><Icon size={13} className={c.text} /><span className={`text-xs font-semibold ${c.text}`}>{channel.label}</span></div><p className="mt-1 text-[10px] leading-4 text-slate-500">{channel.key === 'cds_client_pulse' ? 'Booking Manifest / Client Pulse' : channel.key === 'sonalit_security' ? 'Security incidents and security communications' : 'Operational events and service communications'}</p></div>; })}</div>
        </div>
      </aside>
    </section>

    <div className="flex items-center gap-2 rounded-lg border border-blue-500/10 bg-blue-500/[.03] px-4 py-3 text-[10px] leading-4 text-slate-500"><CheckCircle2 size={12} className="text-blue-300" /> Recipient records are intentionally independent from Sonalit portal login accounts. This control plane changes delivery policy only; it does not grant portal access.</div>

    {showAdd && <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"><div className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-950 p-6 shadow-2xl"><div className="flex items-start justify-between"><div><div className="text-[10px] font-mono uppercase tracking-[.18em] text-orange-400">Recipient provisioning</div><h2 className="mt-1 text-lg font-semibold text-white">Add client contact</h2></div><button onClick={() => setShowAdd(false)} className="text-slate-500 hover:text-white"><XCircle size={16} /></button></div><div className="mt-5 grid gap-3"><input autoFocus type="email" placeholder="client@example.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="rounded-lg border border-white/10 bg-white/[.04] px-3 py-2.5 text-xs text-white outline-none focus:border-orange-500/40" /><input placeholder="Contact name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="rounded-lg border border-white/10 bg-white/[.04] px-3 py-2.5 text-xs text-white outline-none focus:border-orange-500/40" /><input placeholder="Company (optional)" value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} className="rounded-lg border border-white/10 bg-white/[.04] px-3 py-2.5 text-xs text-white outline-none focus:border-orange-500/40" /></div><p className="mt-3 text-[10px] leading-4 text-slate-500">New contacts default to Operational + Client Pulse. Security delivery remains opt-in.</p><div className="mt-5 flex justify-end gap-2"><button onClick={() => setShowAdd(false)} className="rounded-lg border border-white/10 px-4 py-2 text-xs text-slate-400">Cancel</button><button onClick={submitAdd} disabled={add.isPending} className="rounded-lg bg-orange-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{add.isPending ? 'Provisioning…' : 'Provision Recipient'}</button></div></div></div>}
  </div>;
}

function RecipientRow({ row, saving, onToggle }: { row: Recipient; saving: boolean; onToggle: (field: ChannelKey | 'enabled', value: boolean) => void }) {
  return <div className="p-4 hover:bg-white/[.015]"><div className="flex items-start gap-3"><div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-orange-500/20 bg-orange-500/10 text-xs font-bold text-orange-300">{(row.name?.[0] ?? row.email[0] ?? '?').toUpperCase()}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-white">{row.name || row.email}</span><span className={`rounded-full px-2 py-0.5 text-[9px] font-mono ${row.enabled ? 'bg-emerald-500/10 text-emerald-300' : 'bg-white/5 text-slate-600'}`}>{row.enabled ? 'ACTIVE' : 'DISABLED'}</span></div><div className="mt-0.5 text-[10px] text-slate-500">{row.email}{row.company ? ` · ${row.company}` : ''}</div><div className="mt-3 flex flex-wrap gap-1.5">{CHANNELS.map(channel => { const Icon = channel.icon; const enabled = row[channel.key]; const c = tone[channel.tone]; return <button key={channel.key} disabled={saving} onClick={() => onToggle(channel.key, !enabled)} className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[9px] font-semibold transition ${enabled ? `${c.bg} ${c.border} ${c.text}` : 'border-white/[.06] bg-white/[.02] text-slate-600'} disabled:opacity-50`}><Icon size={10} />{channel.label}</button>; })}<button disabled={saving} onClick={() => onToggle('enabled', !row.enabled)} className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[9px] font-semibold ${row.enabled ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' : 'border-white/[.06] bg-white/[.02] text-slate-600'}`}>{row.enabled ? 'Disable recipient' : 'Enable recipient'}</button></div></div></div></div>;
}
