import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { AlertTriangle, ArrowLeft, Loader2, Package } from 'lucide-react';

const API_BASE = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '/api/v1';

interface PortalException {
  id: string;
  convoy_id: string;
  type: 'delay' | 'route_deviation' | 'incident' | 'no_signal' | 'seal_discrepancy';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  occurred_at: string;
}

const TYPE_LABELS: Record<string, string> = {
  delay: 'Delay', route_deviation: 'Route Deviation',
  incident: 'Incident', no_signal: 'No Signal', seal_discrepancy: 'Seal Discrepancy',
};

const SEVERITY_STYLES: Record<string, { badge: string; dot: string; border: string; bg: string }> = {
  info:     { badge: 'text-blue-400 border-blue-700',   dot: 'bg-blue-400',   border: 'border-blue-700/30',  bg: 'bg-blue-900/10' },
  warning:  { badge: 'text-yellow-400 border-yellow-700', dot: 'bg-yellow-400', border: 'border-yellow-700/30', bg: 'bg-yellow-900/10' },
  critical: { badge: 'text-red-400 border-red-700',     dot: 'bg-red-400',    border: 'border-red-700/30',   bg: 'bg-red-900/10' },
};

function fmtDate(val: string): string {
  return new Date(val).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' });
}

function ExceptionRow({ exc }: { exc: PortalException }): React.ReactElement {
  const s = SEVERITY_STYLES[exc.severity] ?? SEVERITY_STYLES['info']!;
  return (
    <div className={`flex items-start gap-4 px-5 py-4 rounded-xl border ${s.border} ${s.bg} mb-3`}>
      <div className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${s.dot}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className={`text-xs px-2 py-0.5 rounded-full border ${s.badge}`}>
            {TYPE_LABELS[exc.type] ?? exc.type}
          </span>
          <span className="text-xs text-white/40">{fmtDate(exc.occurred_at)}</span>
        </div>
        <p className="text-sm text-white/80 leading-snug">{exc.message}</p>
      </div>
    </div>
  );
}

export default function PortalExceptions(): React.ReactElement {
  const navigate = useNavigate();
  const { convoy_id } = useParams({ strict: false }) as { convoy_id?: string };

  const [exceptions, setExceptions] = useState<PortalException[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!convoy_id) { setErrorMsg('No convoy ID'); setLoading(false); return; }
    fetch(`${API_BASE}/portal/convoy/${convoy_id}/exceptions`, { credentials: 'include' })
      .then(async (res) => {
        if (res.status === 401) { void navigate({ to: '/portal/login' }); return null; }
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? `Failed (${res.status})`);
        }
        return res.json() as Promise<{ data: PortalException[] }>;
      })
      .then((json) => { if (json) setExceptions(json.data); })
      .catch((err: Error) => setErrorMsg(err.message))
      .finally(() => setLoading(false));
  }, [convoy_id, navigate]);

  const critical = exceptions.filter(e => e.severity === 'critical').length;
  const warnings = exceptions.filter(e => e.severity === 'warning').length;

  return (
    <div className="min-h-screen" style={{ background: '#050813' }}>
      <div className="border-b border-white/[0.06] px-4 sm:px-6 py-4 flex items-center gap-3">
        <button onClick={() => void navigate({ to: '/portal/dashboard' })} className="text-gray-400 hover:text-white transition-colors">
          <ArrowLeft size={18} />
        </button>
        <Package size={18} className="text-orange-400 shrink-0" />
        <span
          className="font-black text-base tracking-wider uppercase"
          style={{ fontFamily: "'Barlow Condensed','Arial Narrow',sans-serif", background: 'linear-gradient(90deg,#ff9040,#f07020)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
        >
          SONALIT
        </span>
        <span className="text-xs text-gray-500">/ Exceptions</span>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-6 pb-12">
        {loading && <div className="flex justify-center py-20"><Loader2 size={28} className="animate-spin text-orange-400" /></div>}

        {errorMsg && (
          <div className="flex items-start gap-3 rounded-xl border border-red-700/50 bg-red-900/20 px-4 py-3">
            <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
            <p className="text-red-300 text-sm">{errorMsg}</p>
          </div>
        )}

        {!loading && !errorMsg && (
          <>
            {/* Summary */}
            {exceptions.length > 0 && (
              <div className="flex gap-4 mb-6 text-sm">
                <span className="text-white/50">{exceptions.length} total</span>
                {critical > 0 && <span className="text-red-400 font-medium">{critical} critical</span>}
                {warnings > 0 && <span className="text-yellow-400">{warnings} warning{warnings !== 1 ? 's' : ''}</span>}
              </div>
            )}

            {exceptions.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20">
                <Package size={40} className="text-white/10 mb-4" />
                <p className="text-white/40 text-sm">No exceptions recorded for this convoy.</p>
              </div>
            )}

            {exceptions.map(exc => <ExceptionRow key={exc.id} exc={exc} />)}
          </>
        )}
      </div>
    </div>
  );
}
