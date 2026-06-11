import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, Link, Loader2, Mail, Plus, Shield, Users } from 'lucide-react';
import { api } from '../lib/api.js';
function fmt(val) {
    if (!val)
        return 'Never';
    return new Date(val).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' });
}
// ── Create client modal ────────────────────────────────────────────────────────
function CreateClientModal({ onClose, onCreated }) {
    const [form, setForm] = useState({ email: '', name: '', company: '' });
    const [err, setErr] = useState('');
    const mutation = useMutation({
        mutationFn: () => api.post('/portal/clients', form),
        onSuccess: r => onCreated(r.data.data),
        onError: (e) => setErr(e.response?.data?.error ?? 'Failed'),
    });
    return (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-white/10 p-6" style={{ background: 'rgba(13,20,38,0.98)' }}>
        <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <Plus size={16} className="text-orange-400"/> New Cargo Client
        </h2>
        {err && <div className="mb-3 rounded border border-red-700 bg-red-900/30 px-3 py-2 text-xs text-red-400">{err}</div>}
        <div className="space-y-3">
          {['email', 'name', 'company'].map(f => (<div key={f}>
              <label className="block text-xs text-gray-400 mb-1 capitalize">{f}{f === 'company' ? ' (optional)' : ''}</label>
              <input type={f === 'email' ? 'email' : 'text'} value={form[f]} onChange={e => setForm(p => ({ ...p, [f]: e.target.value }))} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"/>
            </div>))}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 rounded-lg border border-white/10 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={!form.email || !form.name || mutation.isPending} className="flex-1 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-50 py-2 text-sm font-semibold text-white flex items-center justify-center gap-2">
            {mutation.isPending ? <Loader2 size={13} className="animate-spin"/> : <Plus size={13}/>} Create
          </button>
        </div>
      </div>
    </div>);
}
// ── Link client to convoy modal ────────────────────────────────────────────────
function LinkConvoyModal({ client, convoys, onClose, onLinked }) {
    const [convoyId, setConvoyId] = useState(convoys[0]?.id ?? '');
    const [showValue, setShowValue] = useState(false);
    const [err, setErr] = useState('');
    const mutation = useMutation({
        mutationFn: () => api.post(`/portal/clients/${client.id}/links`, { convoy_id: convoyId, show_value: showValue }),
        onSuccess: onLinked,
        onError: (e) => setErr(e.response?.data?.error ?? 'Failed'),
    });
    return (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-white/10 p-6" style={{ background: 'rgba(13,20,38,0.98)' }}>
        <h2 className="text-lg font-bold text-white mb-1">Link Convoy</h2>
        <p className="text-xs text-gray-500 mb-4">Grant <span className="text-white/80">{client.name}</span> access to a convoy</p>
        {err && <div className="mb-3 rounded border border-red-700 bg-red-900/30 px-3 py-2 text-xs text-red-400">{err}</div>}
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Convoy</label>
            <select value={convoyId} onChange={e => setConvoyId(e.target.value)} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white">
              {convoys.map(c => <option key={c.id} value={c.id}>{c.reference} — {c.origin} → {c.destination}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
            <input type="checkbox" checked={showValue} onChange={e => setShowValue(e.target.checked)} className="rounded border-white/20"/>
            Show declared cargo value in manifest
          </label>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 rounded-lg border border-white/10 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={!convoyId || mutation.isPending} className="flex-1 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-50 py-2 text-sm font-semibold text-white flex items-center justify-center gap-2">
            {mutation.isPending ? <Loader2 size={13} className="animate-spin"/> : null} Link
          </button>
        </div>
      </div>
    </div>);
}
// ── Client row ─────────────────────────────────────────────────────────────────
function ClientRow({ client, convoys }) {
    const [showLink, setShowLink] = useState(false);
    const [linkSent, setLinkSent] = useState(false);
    const [linkCopied, setLinkCopied] = useState(false);
    const [linkUrl, setLinkUrl] = useState(null);
    const qc = useQueryClient();
    const sendLink = useMutation({
        mutationFn: () => api.post('/portal/auth/request-link', { email: client.email }),
        onSuccess: () => { setLinkSent(true); setTimeout(() => setLinkSent(false), 5000); },
    });
    const copyLink = useMutation({
        mutationFn: () => api.post(`/portal/clients/${client.id}/magic-link`, {}),
        onSuccess: (res) => {
            const url = res.data.data.url;
            setLinkUrl(url);
            navigator.clipboard.writeText(url).then(() => {
                setLinkCopied(true);
                setTimeout(() => setLinkCopied(false), 4000);
            });
        },
    });
    return (<>
      <div className="px-5 py-4 flex items-start gap-4">
        <div className="w-8 h-8 rounded-full bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0 mt-0.5">
          <span className="text-xs font-bold text-orange-400">{client.name[0]?.toUpperCase()}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">{client.name}</p>
          <p className="text-xs text-gray-500">{client.email}{client.company ? ` · ${client.company}` : ''}</p>
          <p className="text-xs text-gray-600 mt-0.5">Last login: {fmt(client.last_login_at)}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <div className="flex items-center gap-1.5">
            <button onClick={() => setShowLink(true)} className="flex items-center gap-1 px-2 py-1 rounded-lg border border-white/10 text-xs text-gray-400 hover:text-orange-400 hover:border-orange-500/30 transition-all">
              <Shield size={11}/> Link Convoy
            </button>
            <button onClick={() => sendLink.mutate()} disabled={sendLink.isPending || linkSent} className="flex items-center gap-1 px-2 py-1 rounded-lg border border-white/10 text-xs text-gray-400 hover:text-blue-400 hover:border-blue-500/30 transition-all disabled:opacity-50" title="Send magic link email">
              {linkSent ? <CheckCircle2 size={11} className="text-green-400"/> : <Mail size={11}/>}
              {linkSent ? 'Sent' : 'Email'}
            </button>
          </div>
          <button onClick={() => copyLink.mutate()} disabled={copyLink.isPending} className="flex items-center gap-1 px-2 py-1 rounded-lg border text-xs transition-all disabled:opacity-50 w-full justify-center" style={linkCopied
            ? { borderColor: 'rgba(34,197,94,0.4)', color: '#4ade80', background: 'rgba(34,197,94,0.08)' }
            : { borderColor: 'rgba(249,115,22,0.3)', color: '#fb923c', background: 'rgba(249,115,22,0.08)' }} title="Generate a portal login link you can copy and send via WhatsApp, SMS, etc.">
            {copyLink.isPending ? <Loader2 size={11} className="animate-spin"/> :
            linkCopied ? <CheckCircle2 size={11}/> : <Copy size={11}/>}
            {linkCopied ? 'Copied!' : 'Copy Login Link'}
          </button>
        </div>
      </div>
      {/* Show the generated URL inline for manual sharing */}
      {linkUrl && linkCopied && (<div className="mx-5 mb-3 flex items-center gap-2 rounded-lg border border-orange-500/20 bg-orange-500/05 px-3 py-2">
          <Link size={11} className="text-orange-400 shrink-0"/>
          <code className="flex-1 text-[10px] text-orange-200 break-all">{linkUrl}</code>
        </div>)}
      {showLink && (<LinkConvoyModal client={client} convoys={convoys} onClose={() => setShowLink(false)} onLinked={() => { setShowLink(false); void qc.invalidateQueries({ queryKey: ['portal-clients'] }); }}/>)}
    </>);
}
// ── Main panel ─────────────────────────────────────────────────────────────────
export function CargoClientsPanel({ convoys }) {
    const [showCreate, setShowCreate] = useState(false);
    const qc = useQueryClient();
    const { data, isLoading } = useQuery({
        queryKey: ['portal-clients'],
        queryFn: () => api.get('/portal/clients').then(r => r.data),
    });
    const clients = data?.data ?? [];
    return (<div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Users size={15} className="text-orange-400"/>
          <p className="text-sm font-semibold text-white">Cargo Clients <span className="text-gray-600 font-normal">— V4 persistent accounts</span></p>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white">
          <Plus size={12}/> New Client
        </button>
      </div>

      <div className="rounded-xl border border-white/[0.07] overflow-hidden" style={{ background: 'rgba(13,20,38,0.5)' }}>
        {isLoading && <div className="p-6 text-center text-xs text-gray-500">Loading clients…</div>}
        {!isLoading && clients.length === 0 && (<div className="p-8 text-center">
            <Users size={28} className="text-gray-700 mx-auto mb-2"/>
            <p className="text-sm text-gray-500">No cargo clients yet</p>
            <p className="text-xs text-gray-600 mt-1">Create a client account and link it to a convoy to enable the V4 portal experience</p>
          </div>)}
        {clients.map((c, i) => (<div key={c.id} className={i > 0 ? 'border-t border-white/[0.05]' : ''}>
            <ClientRow client={c} convoys={convoys}/>
          </div>))}
      </div>

      <div className="mt-4 rounded-lg border border-blue-700/30 bg-blue-900/10 px-4 py-3 text-xs text-blue-300/70 space-y-1">
        <p className="font-semibold text-blue-300">How V4 client access works</p>
        <p>1. Create a client account with their email address.</p>
        <p>2. Link the client to one or more convoys.</p>
        <p>3. Click <strong>Send Link</strong> — they receive a magic-link email to log in at <code className="text-blue-200">/portal/login</code>.</p>
        <p>4. On login they land on the V4 Command Center dashboard with Live Security, Deep Track, Custody Ledger.</p>
      </div>

      {showCreate && (<CreateClientModal onClose={() => setShowCreate(false)} onCreated={() => {
                setShowCreate(false);
                void qc.invalidateQueries({ queryKey: ['portal-clients'] });
            }}/>)}
    </div>);
}
