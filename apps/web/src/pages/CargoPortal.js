import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Package, Plus, Trash2, Copy, Download, CheckCircle2, Clock, AlertTriangle, Loader2, ExternalLink, RefreshCw, Users, } from 'lucide-react';
import { api } from '../lib/api.js';
import { CargoClientsPanel } from './CargoClientsPanel.js';
// ── Helpers ────────────────────────────────────────────────────────────────────
function fmt(val) {
    if (!val)
        return '—';
    return new Date(val).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' });
}
function isExpired(token) {
    return new Date(token.expires_at) < new Date();
}
function tokenStatus(token) {
    if (token.revoked_at)
        return { label: 'Revoked', cls: 'bg-red-900/40 text-red-400 border-red-700' };
    if (isExpired(token))
        return { label: 'Expired', cls: 'bg-gray-700/40 text-gray-400 border-gray-600' };
    return { label: 'Active', cls: 'bg-green-900/40 text-green-400 border-green-700' };
}
// ── Subcomponents ──────────────────────────────────────────────────────────────
function CopyButton({ text }) {
    const [copied, setCopied] = useState(false);
    const copy = () => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };
    return (<button onClick={copy} className="p-1 rounded text-gray-500 hover:text-orange-400 transition-colors" title="Copy token">
      {copied ? <CheckCircle2 size={14} className="text-green-400"/> : <Copy size={14}/>}
    </button>);
}
function IssueTokenModal({ convoys, onClose, onSuccess, }) {
    const [form, setForm] = useState({ convoy_id: convoys[0]?.id ?? '', cargo_owner_ref: '', ttl_hours: 24 });
    const [err, setErr] = useState('');
    const mutation = useMutation({
        mutationFn: (body) => api.post('/portal/tokens', body),
        onSuccess: (res) => {
            onSuccess(res.data.data.token, form.convoy_id);
        },
        onError: (e) => {
            const msg = e.response?.data?.error ?? 'Failed to issue token';
            setErr(msg);
        },
    });
    return (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-white/10 p-6" style={{ background: 'rgba(13,20,38,0.98)' }}>
        <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <Plus size={18} className="text-orange-400"/> Issue Portal Token
        </h2>

        {err && (<div className="mb-4 rounded-lg border border-red-700 bg-red-900/30 px-3 py-2 text-sm text-red-400">
            {err}
          </div>)}

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Convoy</label>
            <select value={form.convoy_id} onChange={e => setForm(f => ({ ...f, convoy_id: e.target.value }))} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white">
              {convoys.map(c => (<option key={c.id} value={c.id}>{c.reference} — {c.origin} → {c.destination}</option>))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Cargo Owner Reference <span className="text-gray-600">(optional)</span></label>
            <input type="text" maxLength={128} placeholder="e.g. ACME Corp / PO-12345" value={form.cargo_owner_ref} onChange={e => setForm(f => ({ ...f, cargo_owner_ref: e.target.value }))} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-600"/>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Token validity (hours)</label>
            <input type="number" min={1} max={168} value={form.ttl_hours} onChange={e => setForm(f => ({ ...f, ttl_hours: Math.min(168, Math.max(1, parseInt(e.target.value) || 24)) }))} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"/>
            <p className="mt-1 text-xs text-gray-600">1–168 hours (max 7 days)</p>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 rounded-lg border border-white/10 py-2 text-sm text-gray-400 hover:text-white transition-colors">
            Cancel
          </button>
          <button onClick={() => mutation.mutate(form)} disabled={!form.convoy_id || mutation.isPending} className="flex-1 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-50 py-2 text-sm font-semibold text-white transition-colors flex items-center justify-center gap-2">
            {mutation.isPending ? <Loader2 size={14} className="animate-spin"/> : <Plus size={14}/>}
            Issue Token
          </button>
        </div>
      </div>
    </div>);
}
function NewTokenBanner({ token, onDismiss }) {
    const portalUrl = `${window.location.origin}/portal-view?token=${token}`;
    return (<div className="rounded-xl border border-green-700 bg-green-900/20 p-4 mb-6">
      <div className="flex items-center gap-2 mb-2">
        <CheckCircle2 size={16} className="text-green-400"/>
        <span className="text-sm font-semibold text-green-400">Token issued — copy it now, it will not be shown again</span>
      </div>
      <div className="flex items-center gap-2 rounded-lg bg-black/40 border border-white/10 px-3 py-2 mb-3">
        <code className="flex-1 text-xs text-white/80 break-all font-mono">{token}</code>
        <CopyButton text={token}/>
      </div>
      <div className="flex items-center gap-2 rounded-lg bg-black/40 border border-white/10 px-3 py-2 mb-3">
        <span className="text-xs text-gray-400 flex-shrink-0">Portal URL:</span>
        <code className="flex-1 text-xs text-orange-300 break-all font-mono">{portalUrl}</code>
        <CopyButton text={portalUrl}/>
      </div>
      <button onClick={onDismiss} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
        Dismiss
      </button>
    </div>);
}
// ── Main Page ──────────────────────────────────────────────────────────────────
export default function CargoPortal() {
    const qc = useQueryClient();
    const [tab, setTab] = useState('tokens');
    const [selectedConvoy, setSelectedConvoy] = useState('');
    const [showIssue, setShowIssue] = useState(false);
    const [newToken, setNewToken] = useState(null);
    const { data: convoysData, isLoading: convoysLoading } = useQuery({
        queryKey: ['convoys-active'],
        queryFn: () => api.get('/convoys?status=active&limit=200').then(r => r.data),
    });
    const convoys = convoysData?.data ?? [];
    const activeConvoyId = selectedConvoy || convoys[0]?.id || '';
    const { data: tokensData, isLoading: tokensLoading, refetch } = useQuery({
        queryKey: ['portal-tokens', activeConvoyId],
        queryFn: () => api.get(`/portal/tokens?convoy_id=${activeConvoyId}`).then(r => r.data),
        enabled: !!activeConvoyId,
    });
    const tokens = tokensData?.data ?? [];
    const revokeMutation = useMutation({
        mutationFn: (id) => api.delete(`/portal/tokens/${id}`),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['portal-tokens', activeConvoyId] });
        },
    });
    const handleIssued = (token, convoyId) => {
        setNewToken({ token, convoyId });
        setShowIssue(false);
        qc.invalidateQueries({ queryKey: ['portal-tokens', convoyId] });
        setSelectedConvoy(convoyId);
    };
    return (<div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-orange-500/10 border border-orange-500/20 p-2">
            <Package size={20} className="text-orange-400"/>
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Cargo Owner Portal</h1>
            <p className="text-xs text-gray-500">Issue time-limited portal tokens for cargo owners to track their shipments</p>
          </div>
        </div>
        {tab === 'tokens' && (<button onClick={() => setShowIssue(true)} disabled={convoys.length === 0} className="flex items-center gap-2 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-50 px-4 py-2 text-sm font-semibold text-white transition-colors">
            <Plus size={15}/> Issue Token
          </button>)}
      </div>

      {/* Tab selector */}
      <div className="flex gap-1 mb-6 p-1 rounded-xl border border-white/[0.07]" style={{ background: 'rgba(13,20,38,0.5)', width: 'fit-content' }}>
        <button onClick={() => setTab('clients')} className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tab === 'clients' ? 'bg-orange-600 text-white' : 'text-gray-400 hover:text-white'}`}>
          <Users size={13}/> V4 Clients
        </button>
        <button onClick={() => setTab('tokens')} className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tab === 'tokens' ? 'bg-orange-600 text-white' : 'text-gray-400 hover:text-white'}`}>
          <Package size={13}/> Legacy Tokens
        </button>
      </div>

      {/* V4 Clients tab */}
      {tab === 'clients' && <CargoClientsPanel convoys={convoys}/>}

      {/* Legacy tokens tab */}
      {tab === 'tokens' && <>

      {/* New token banner */}
      {newToken && (<NewTokenBanner token={newToken.token} onDismiss={() => setNewToken(null)}/>)}

      {/* Convoy selector */}
      <div className="mb-6">
        <label className="block text-xs text-gray-400 mb-1">Filter by Convoy</label>
        {convoysLoading ? (<div className="h-9 w-64 rounded-lg bg-white/5 animate-pulse"/>) : (<select value={activeConvoyId} onChange={e => setSelectedConvoy(e.target.value)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white">
            {convoys.map(c => (<option key={c.id} value={c.id}>{c.reference} — {c.origin} → {c.destination}</option>))}
          </select>)}
      </div>

      {/* Token list */}
      <div className="rounded-xl border border-white/[0.07] overflow-hidden" style={{ background: 'rgba(13,20,38,0.7)' }}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.07]">
          <span className="text-sm font-semibold text-white/80">Portal Tokens</span>
          <button onClick={() => refetch()} className="p-1 text-gray-500 hover:text-orange-400 transition-colors" title="Refresh">
            <RefreshCw size={14}/>
          </button>
        </div>

        {tokensLoading || !activeConvoyId ? (<div className="py-12 flex justify-center">
            <Loader2 size={20} className="animate-spin text-orange-400"/>
          </div>) : tokens.length === 0 ? (<div className="py-12 flex flex-col items-center gap-2 text-gray-500">
            <Package size={28} className="opacity-30"/>
            <p className="text-sm">No tokens issued for this convoy yet</p>
          </div>) : (<div className="divide-y divide-white/[0.04]">
            {tokens.map(token => {
                    const { label, cls } = tokenStatus(token);
                    const canRevoke = !token.revoked_at && !isExpired(token);
                    return (<div key={token.id} className="px-5 py-4 flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${cls}`}>{label}</span>
                      {token.cargo_owner_ref && (<span className="text-xs text-gray-400">{token.cargo_owner_ref}</span>)}
                    </div>
                    <div className="grid grid-cols-2 gap-x-8 gap-y-0.5 text-xs text-gray-500 mt-1">
                      <span><Clock size={11} className="inline mr-1 opacity-60"/>Issued: {fmt(token.issued_at)}</span>
                      <span><Clock size={11} className="inline mr-1 opacity-60"/>Expires: {fmt(token.expires_at)}</span>
                      {token.last_used_at && (<span>Last used: {fmt(token.last_used_at)}</span>)}
                      {token.issued_by_name && (<span>By: {token.issued_by_name}</span>)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {canRevoke && (<button onClick={() => {
                                if (window.confirm('Revoke this portal token? The cargo owner will immediately lose access.')) {
                                    revokeMutation.mutate(token.id);
                                }
                            }} disabled={revokeMutation.isPending} className="flex items-center gap-1 px-2 py-1 rounded-lg border border-red-700/50 text-xs text-red-400 hover:bg-red-900/20 transition-colors disabled:opacity-50" title="Revoke token">
                        <Trash2 size={12}/> Revoke
                      </button>)}
                  </div>
                </div>);
                })}
          </div>)}
      </div>

      {/* How it works */}
      <div className="mt-8 rounded-xl border border-white/[0.07] p-5" style={{ background: 'rgba(13,20,38,0.5)' }}>
        <h3 className="text-sm font-semibold text-white/70 mb-3 flex items-center gap-2">
          <ExternalLink size={14} className="text-orange-400"/> How Portal Tokens Work
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-gray-500">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-orange-300 font-semibold mb-1">
              <span className="rounded-full bg-orange-500/20 text-orange-400 w-5 h-5 flex items-center justify-center text-[10px]">1</span>
              Issue Token
            </div>
            <p>Select the convoy and optionally add a cargo owner reference. Set how long the token is valid (up to 7 days).</p>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-orange-300 font-semibold mb-1">
              <span className="rounded-full bg-orange-500/20 text-orange-400 w-5 h-5 flex items-center justify-center text-[10px]">2</span>
              Share with Cargo Owner
            </div>
            <p>Copy the token or the portal URL. Send it to the cargo owner via secure channel. The token is shown only once.</p>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-orange-300 font-semibold mb-1">
              <span className="rounded-full bg-orange-500/20 text-orange-400 w-5 h-5 flex items-center justify-center text-[10px]">3</span>
              Cargo Owner Access
            </div>
            <p>The cargo owner visits the portal URL to see convoy status, location, and download the custody chain PDF.</p>
          </div>
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-900/20 border border-amber-700/40 px-3 py-2">
          <AlertTriangle size={13} className="text-amber-400 mt-0.5 shrink-0"/>
          <p className="text-xs text-amber-300/80">Tokens grant read-only access to a single convoy. They cannot be used to modify data. Revoke immediately if the token is compromised.</p>
        </div>
      </div>

      {/* Download custody PDF (for admin to preview) */}
      {activeConvoyId && (<div className="mt-4 flex justify-end">
          <a href={`/api/v1/portal/convoy/custody-pdf`} className="flex items-center gap-2 text-xs text-gray-500 hover:text-orange-400 transition-colors" title="Admin custody PDF preview requires portal token auth — use a portal URL">
            <Download size={13}/> Custody PDF (portal access required)
          </a>
        </div>)}

      {/* Issue token modal */}
      {showIssue && (<IssueTokenModal convoys={convoys} onClose={() => setShowIssue(false)} onSuccess={handleIssued}/>)}

      </> /* end legacy tokens tab */}
    </div>);
}
