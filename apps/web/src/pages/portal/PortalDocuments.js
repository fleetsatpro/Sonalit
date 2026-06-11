import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { AlertTriangle, ArrowLeft, Download, FileText, Loader2, Package } from 'lucide-react';
const API_BASE = import.meta.env['VITE_API_BASE_URL'] ?? '/api/v1';
const CARD = { background: 'var(--p-surface)' };
const DOC_TYPE_LABELS = {
    custody_chain: 'Custody Chain',
    proof_of_delivery: 'Proof of Delivery',
    manifest: 'Manifest',
    customs: 'Customs',
    insurance: 'Insurance',
    seal_report: 'Seal Report',
};
const DOC_TYPE_COLORS = {
    custody_chain: 'text-purple-400 border-purple-700',
    proof_of_delivery: 'text-green-400 border-green-700',
    manifest: 'text-blue-400 border-blue-700',
    customs: 'text-yellow-400 border-yellow-700',
    insurance: 'text-orange-400 border-orange-700',
    seal_report: 'text-red-400 border-red-700',
};
function fmtDate(val) {
    return new Date(val).toLocaleDateString('en-ZA', { dateStyle: 'medium' });
}
export default function PortalDocuments() {
    const navigate = useNavigate();
    const { convoy_id } = useParams({ strict: false });
    const [docs, setDocs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState('');
    useEffect(() => {
        if (!convoy_id) {
            setErrorMsg('No convoy ID');
            setLoading(false);
            return;
        }
        fetch(`${API_BASE}/portal/convoy/${convoy_id}/documents`, { credentials: 'include' })
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
            .then(json => { if (json)
            setDocs(json.data); })
            .catch((err) => setErrorMsg(err.message))
            .finally(() => setLoading(false));
    }, [convoy_id, navigate]);
    return (<div className="portal-root" style={{ background: 'var(--p-bg)' }}>
      <div className="border-b border-white/[0.06] px-4 sm:px-6 py-4 flex items-center gap-3">
        <button onClick={() => void navigate({ to: '/portal/dashboard' })} className="text-gray-400 hover:text-white transition-colors">
          <ArrowLeft size={18}/>
        </button>
        <Package size={18} className="text-orange-400 shrink-0"/>
        <span className="font-black text-base tracking-wider uppercase" style={{ fontFamily: 'var(--p-sans)', background: 'linear-gradient(90deg,#ff9040,#f07020)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          SONALIT
        </span>
        <span className="text-xs text-gray-500">/ Documents</span>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-6 pb-12">
        {loading && <div className="flex justify-center py-20"><Loader2 size={28} className="animate-spin text-orange-400"/></div>}

        {errorMsg && (<div className="flex items-start gap-3 rounded-xl border border-red-700/50 bg-red-900/20 px-4 py-3">
            <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5"/>
            <p className="text-red-300 text-sm">{errorMsg}</p>
          </div>)}

        {!loading && !errorMsg && docs.length === 0 && (<div className="flex flex-col items-center justify-center py-20">
            <FileText size={40} className="text-white/10 mb-4"/>
            <p className="text-white/40 text-sm">No documents available for this convoy.</p>
          </div>)}

        {!loading && !errorMsg && docs.length > 0 && (<div className="rounded-xl border border-white/[0.07] overflow-hidden" style={CARD}>
            {docs.map((doc, idx) => {
                const typeColor = DOC_TYPE_COLORS[doc.type] ?? 'text-gray-400 border-gray-600';
                return (<div key={doc.id} className={`flex items-center gap-4 px-5 py-4 ${idx < docs.length - 1 ? 'border-b border-white/[0.05]' : ''}`}>
                  <FileText size={16} className="text-white/30 shrink-0"/>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white/90 font-medium truncate">{doc.label}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-xs px-1.5 py-0.5 rounded border ${typeColor}`}>
                        {DOC_TYPE_LABELS[doc.type] ?? doc.type}
                      </span>
                      <span className="text-xs text-white/30">{fmtDate(doc.created_at)}</span>
                    </div>
                  </div>
                  <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300 transition-colors shrink-0">
                    <Download size={13}/>
                    Download
                  </a>
                </div>);
            })}
          </div>)}
      </div>
    </div>);
}
