import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, Loader2, Package } from 'lucide-react';
const API_BASE = import.meta.env['VITE_API_BASE_URL'] ?? '/api/v1';
const CARD = { background: 'var(--p-surface)' };
function fmtDate(val) {
    return new Date(val).toLocaleString('en-ZA', { dateStyle: 'long', timeStyle: 'short' });
}
function PortalHeader({ onBack }) {
    return (<div className="border-b border-white/[0.06] px-4 sm:px-6 py-4 flex items-center gap-3">
      <button onClick={onBack} className="text-gray-400 hover:text-white transition-colors" aria-label="Back">
        <ArrowLeft size={18}/>
      </button>
      <Package size={18} className="text-orange-400 shrink-0"/>
      <span className="font-black text-base tracking-wider uppercase" style={{
            fontFamily: 'var(--p-sans)',
            background: 'linear-gradient(90deg,#ff9040,#f07020)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
        }}>
        SONALIT
      </span>
      <span className="text-xs text-gray-500">/ Proof of Delivery</span>
    </div>);
}
function PODCard({ pod }) {
    return (<div className="rounded-xl border border-white/[0.07] overflow-hidden mb-6" style={CARD}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-white/[0.06]">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 size={16} className="text-green-400 shrink-0"/>
            <p className="text-sm font-bold text-white">Delivered</p>
          </div>
          <p className="text-xs text-white/50">{fmtDate(pod.delivered_at)}</p>
        </div>
        {pod.pod_pdf_url && (<a href={pod.pod_pdf_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-orange-400 hover:text-orange-300 transition-colors shrink-0">
            <Download size={13}/>
            Download PDF
          </a>)}
      </div>

      {/* Recipient */}
      <div className="px-5 py-3 border-b border-white/[0.06]">
        <p className="text-xs text-white/40 mb-0.5">Received by</p>
        <p className="text-sm font-semibold text-white">{pod.recipient_name}</p>
      </div>

      {/* Location */}
      {pod.location && (<div className="px-5 py-3 border-b border-white/[0.06]">
          <p className="text-xs text-white/40 mb-0.5">Delivery location</p>
          <p className="text-xs text-white/70">
            {pod.location.lat.toFixed(5)}, {pod.location.lng.toFixed(5)}
          </p>
        </div>)}

      {/* Notes */}
      {pod.notes && (<div className="px-5 py-3 border-b border-white/[0.06]">
          <p className="text-xs text-white/40 mb-1">Notes</p>
          <p className="text-xs text-white/70 leading-relaxed">{pod.notes}</p>
        </div>)}

      {/* Signature */}
      {pod.signature_url && (<div className="px-5 py-4 border-b border-white/[0.06]">
          <p className="text-xs text-white/40 mb-2">Signature</p>
          <img src={pod.signature_url} alt="Recipient signature" className="max-h-24 rounded border border-white/[0.10] bg-white/[0.03]"/>
        </div>)}

      {/* Photos */}
      {pod.photo_urls.length > 0 && (<div className="px-5 py-4">
          <p className="text-xs text-white/40 mb-3">Delivery photos</p>
          <div className="flex flex-wrap gap-2">
            {pod.photo_urls.map((url, idx) => (<a key={idx} href={url} target="_blank" rel="noopener noreferrer">
                <img src={url} alt={`Delivery photo ${idx + 1}`} className="w-24 h-24 object-cover rounded-lg border border-white/[0.10] hover:border-orange-500/40 transition-colors"/>
              </a>))}
          </div>
        </div>)}
    </div>);
}
export default function PortalPOD() {
    const navigate = useNavigate();
    const { convoy_id } = useParams({ strict: false });
    const [pods, setPods] = useState([]);
    const [loading, setLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState('');
    useEffect(() => {
        if (!convoy_id) {
            setErrorMsg('No convoy ID');
            setLoading(false);
            return;
        }
        fetch(`${API_BASE}/portal/convoy/${convoy_id}/pod`, { credentials: 'include' })
            .then(async (res) => {
            if (res.status === 401) {
                void navigate({ to: '/portal/login' });
                return null;
            }
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error ?? `Failed (${res.status})`);
            }
            return res.json();
        })
            .then((json) => { if (json)
            setPods(json.data); })
            .catch((err) => setErrorMsg(err.message))
            .finally(() => setLoading(false));
    }, [convoy_id, navigate]);
    return (<div className="portal-root" style={{ background: 'var(--p-bg)' }}>
      <PortalHeader onBack={() => void navigate({ to: '/portal/dashboard' })}/>

      <div className="max-w-2xl mx-auto px-4 pt-6 pb-12">
        {loading && (<div className="flex justify-center py-20">
            <Loader2 size={28} className="animate-spin text-orange-400"/>
          </div>)}

        {errorMsg && (<div className="flex items-start gap-3 rounded-xl border border-red-700/50 bg-red-900/20 px-4 py-3">
            <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5"/>
            <p className="text-red-300 text-sm">{errorMsg}</p>
          </div>)}

        {!loading && !errorMsg && pods.length === 0 && (<div className="flex flex-col items-center justify-center py-20">
            <Package size={40} className="text-white/10 mb-4"/>
            <p className="text-white/40 text-sm">No proof of delivery recorded yet.</p>
          </div>)}

        {pods.map(pod => <PODCard key={pod.id} pod={pod}/>)}
      </div>
    </div>);
}
