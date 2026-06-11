import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { AlertTriangle, ArrowLeft, CheckCircle2, Link, ShieldCheck, XCircle } from 'lucide-react';
import { PortalShell, LedgerEvent } from '../../components/portal/PortalPrimitives.js';
const API = import.meta.env['VITE_API_BASE_URL'] ?? '/api/v1';
export default function PortalCustody() {
    const navigate = useNavigate();
    const { convoy_id = '' } = useParams({ strict: false });
    const [events, setEvents] = useState([]);
    const [meta, setMeta] = useState(null);
    const [loading, setLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState('');
    useEffect(() => {
        fetch(`${API}/portal/convoy/${encodeURIComponent(convoy_id)}/custody`, { credentials: 'include' })
            .then(async (res) => {
            if (res.status === 401) {
                void navigate({ to: '/portal/login' });
                return null;
            }
            if (res.status === 403)
                throw new Error('Not authorised for this convoy');
            if (!res.ok)
                throw new Error(`Error ${res.status}`);
            return res.json();
        })
            .then(json => {
            if (json) {
                setEvents(json.data);
                setMeta(json.meta);
            }
        })
            .catch((e) => setErrorMsg(e.message))
            .finally(() => setLoading(false));
    }, [convoy_id, navigate]);
    return (<PortalShell>
      <header className="sticky top-0 z-40 border-b border-white/[0.06] px-4 py-3 flex items-center gap-3" style={{ background: 'rgba(7,11,22,0.95)', backdropFilter: 'blur(16px)' }}>
        <button onClick={() => void navigate({ to: '/portal/convoy/$convoy_id/track', params: { convoy_id } })} className="p-1.5 rounded-lg text-white/40 hover:text-white/80 transition-colors">
          <ArrowLeft size={16}/>
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-white">Verifiable Custody</p>
          <p className="text-xs text-white/30 flex items-center gap-1">
            <Link size={10}/> Hash-chain ledger
          </p>
        </div>
        {meta && (<div className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${meta.chain_valid
                ? 'border-green-700/60 bg-green-900/30 text-green-400'
                : 'border-red-700/60 bg-red-900/30 text-red-400'}`}>
            {meta.chain_valid
                ? <><CheckCircle2 size={12}/> Chain Valid</>
                : <><XCircle size={12}/> Chain Broken</>}
          </div>)}
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-5 pb-16">
        {/* Chain integrity banner */}
        {meta && (<div className={`rounded-xl border p-4 mb-5 portal-reveal flex items-start gap-3 ${meta.chain_valid
                ? 'border-green-700/30 bg-green-900/10'
                : 'border-red-700/30 bg-red-900/10'}`}>
            {meta.chain_valid
                ? <ShieldCheck size={18} className="text-green-400 shrink-0 mt-0.5"/>
                : <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5"/>}
            <div>
              <p className={`text-sm font-semibold ${meta.chain_valid ? 'text-green-300' : 'text-red-300'}`}>
                {meta.chain_valid ? 'Chain integrity verified' : 'Chain integrity failure detected'}
              </p>
              <p className="mono text-xs text-white/40 mt-0.5">
                {meta.event_count} event{meta.event_count !== 1 ? 's' : ''} recorded
                {meta.chain_valid
                ? ' — every hash links back to origin'
                : ' — one or more events may have been tampered with'}
              </p>
            </div>
          </div>)}

        {/* Loading */}
        {loading && (<div className="space-y-3">
            {[0, 1, 2, 3].map(i => (<div key={i} className="h-20 rounded-xl border border-white/[0.07] animate-pulse" style={{ background: 'var(--p-surface)', animationDelay: `${i * 60}ms` }}/>))}
          </div>)}

        {/* Error */}
        {errorMsg && (<div className="flex gap-3 p-4 rounded-xl border border-red-700/40 bg-red-900/20">
            <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5"/>
            <p className="text-sm text-red-300">{errorMsg}</p>
          </div>)}

        {/* Ledger */}
        {!loading && !errorMsg && events.length > 0 && (<div className="rounded-xl border border-white/[0.07] p-4 portal-reveal portal-reveal-2" style={{ background: 'linear-gradient(145deg,var(--p-surface),var(--p-surface2))' }}>
            {events.map((evt, i) => (<div key={evt.event_id} className="hash-reveal" style={{ animationDelay: `${i * 40}ms` }}>
                <LedgerEvent seq={evt.seq} kind={evt.kind} location={evt.location} timestamp={evt.timestamp} officer={evt.officer} sealIntact={evt.seal_intact} hash={evt.hash} verified={evt.verified} isLast={i === events.length - 1}/>
              </div>))}
          </div>)}

        {/* Empty */}
        {!loading && !errorMsg && events.length === 0 && (<div className="flex flex-col items-center justify-center py-20 text-center">
            <Link size={32} className="text-white/10 mb-4"/>
            <p className="text-sm text-white/40">No custody events recorded yet.</p>
            <p className="text-xs text-white/25 mt-1">Events are added by your logistics operator.</p>
          </div>)}

        {/* Hash explanation */}
        {events.length > 0 && (<div className="mt-4 rounded-xl border border-white/[0.05] p-3 portal-reveal portal-reveal-5">
            <p className="mono text-[11px] text-white/25 leading-relaxed">
              Each event is SHA-256 hashed with the previous event's hash, creating a tamper-evident chain.
              A verification failure indicates the record may have been modified after logging.
            </p>
          </div>)}
      </main>
    </PortalShell>);
}
