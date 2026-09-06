import { useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, Send } from 'lucide-react';
import { api } from '../lib/api.js';
import OriginalCommandCenter from './NotificationCommandCenter.js';

export default function NotificationCommandCenterFixed() {
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sendGlobalPulse = async () => {
    setSending(true);
    setMessage(null);
    setError(null);
    try {
      const response = await api.post('/admin/cds-client-pulse/send', {});
      const data = response.data?.data;
      const queued = Number(data?.queued ?? 0);
      const globalQueued = Number(data?.global?.queued ?? 0);
      const customerCount = Array.isArray(data?.customers) ? data.customers.length : 0;
      setMessage(`Client Pulse dispatched: ${queued} email job(s) queued. Super Admin: ${globalQueued}; customer scopes: ${customerCount}.`);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Client Pulse dispatch failed.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="relative overflow-hidden rounded-2xl border border-orange-400/20 bg-gradient-to-r from-orange-500/[.08] via-slate-950 to-cyan-500/[.05] p-4 shadow-2xl">
        <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-orange-500/10 blur-3xl" />
        <div className="relative flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[.22em] text-orange-300">
              <AlertTriangle size={12} /> AUTHORITATIVE CLIENT PULSE CHANNEL
            </div>
            <div className="mt-1 text-sm font-semibold text-white">Super Admin Global Dispatch</div>
            <div className="mt-1 max-w-3xl text-[11px] leading-5 text-slate-500">
              Sends the global Client Pulse to the configured Super Admin authority and independently dispatches eligible customer-scoped pulses. No client data is broadened across customer boundaries.
            </div>
          </div>
          <button onClick={sendGlobalPulse} disabled={sending} className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-orange-600 px-5 py-3 text-xs font-semibold text-white shadow-lg shadow-orange-950/30 disabled:opacity-40">
            {sending ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
            {sending ? 'DISPATCHING…' : 'SEND CLIENT PULSE NOW'}
          </button>
        </div>
        {message && <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-400/15 bg-emerald-400/[.04] px-3 py-2 text-[11px] text-emerald-200"><CheckCircle2 size={13} />{message}</div>}
        {error && <div className="mt-3 rounded-lg border border-red-400/15 bg-red-400/[.04] px-3 py-2 text-[11px] text-red-200">{error}</div>}
      </section>
      <OriginalCommandCenter />
    </div>
  );
}
