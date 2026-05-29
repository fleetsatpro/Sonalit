import React, { useEffect, useState } from 'react';
import { Package, Download, Loader2, AlertTriangle, MapPin, Clock, Truck } from 'lucide-react';

interface ConvoyView {
  convoy_id: string;
  reference: string;
  status: string;
  origin: string;
  destination: string;
  departed_at: string | null;
  arrived_at: string | null;
  estimated_arrival_at: string | null;
  vehicle_count: number;
  last_known_lat: number | null;
  last_known_lng: number | null;
  last_location_at: string | null;
  seal_intact: boolean | null;
  cargo_owner_ref: string | null;
}

const API_BASE = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '/api/v1';

function fmt(val: string | null): string {
  if (!val) return '—';
  return new Date(val).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' });
}

function statusColor(status: string): string {
  if (status === 'in_transit') return 'bg-green-900/40 text-green-400 border-green-700';
  if (status === 'completed') return 'bg-blue-900/40 text-blue-400 border-blue-700';
  if (status === 'cancelled') return 'bg-red-900/40 text-red-400 border-red-700';
  return 'bg-gray-700/40 text-gray-400 border-gray-600';
}

function statusLabel(status: string): string {
  return status.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function PortalView(): React.ReactElement {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') ?? '';

  const [convoy, setConvoy] = useState<ConvoyView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('No portal token provided in URL.');
      setLoading(false);
      return;
    }
    fetch(`${API_BASE}/portal/convoy`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? `Error ${res.status}`);
        }
        return res.json() as Promise<{ data: ConvoyView }>;
      })
      .then(json => setConvoy(json.data))
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [token]);

  const downloadPdf = async () => {
    setPdfLoading(true);
    try {
      const res = await fetch(`${API_BASE}/portal/convoy/custody-pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `custody-${convoy?.reference ?? 'report'}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`PDF download failed: ${(err as Error).message}`);
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <div className="min-h-screen" style={{ background: 'rgba(5,8,19,1)' }}>
      {/* Header */}
      <div className="border-b border-white/[0.06] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package size={20} className="text-orange-400" />
          <span
            className="font-black text-lg tracking-wider uppercase"
            style={{
              fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
              background: 'linear-gradient(90deg, #ff9040, #f07020)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            SONALIT
          </span>
          <span className="text-xs text-gray-500 ml-2">Cargo Portal</span>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-10">
        {loading && (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <Loader2 size={20} className="animate-spin mr-2" /> Loading shipment…
          </div>
        )}

        {!loading && error && (
          <div className="rounded-xl border border-red-700 bg-red-900/20 p-6 flex items-start gap-3">
            <AlertTriangle size={20} className="text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-red-300 font-semibold">Access denied</p>
              <p className="text-red-400/80 text-sm mt-1">{error}</p>
              <p className="text-gray-500 text-xs mt-3">This link may have expired or been revoked. Contact the fleet operator for a new link.</p>
            </div>
          </div>
        )}

        {!loading && convoy && (
          <div className="space-y-6">
            {/* Title */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-white">{convoy.reference}</h1>
                {convoy.cargo_owner_ref && (
                  <p className="text-sm text-gray-400 mt-0.5">{convoy.cargo_owner_ref}</p>
                )}
              </div>
              <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${statusColor(convoy.status)}`}>
                {statusLabel(convoy.status)}
              </span>
            </div>

            {/* Route */}
            <div className="rounded-xl border border-white/[0.07] p-5 space-y-4" style={{ background: 'rgba(13,20,38,0.7)' }}>
              <h2 className="text-sm font-semibold text-white/70 uppercase tracking-wider">Route</h2>
              <div className="flex items-center gap-3">
                <div className="flex flex-col items-center gap-1">
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                  <div className="w-px h-8 bg-white/10" />
                  <div className="w-2.5 h-2.5 rounded-full bg-orange-500" />
                </div>
                <div className="flex flex-col gap-4">
                  <div>
                    <p className="text-xs text-gray-500">Origin</p>
                    <p className="text-white text-sm font-medium">{convoy.origin || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Destination</p>
                    <p className="text-white text-sm font-medium">{convoy.destination || '—'}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Timeline */}
            <div className="rounded-xl border border-white/[0.07] p-5" style={{ background: 'rgba(13,20,38,0.7)' }}>
              <h2 className="text-sm font-semibold text-white/70 uppercase tracking-wider mb-4">Timeline</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><Clock size={10} /> Departed</p>
                  <p className="text-sm text-white">{fmt(convoy.departed_at)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><Clock size={10} /> Est. Arrival</p>
                  <p className="text-sm text-white">{fmt(convoy.estimated_arrival_at)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><Clock size={10} /> Arrived</p>
                  <p className="text-sm text-white">{fmt(convoy.arrived_at)}</p>
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-white/[0.07] p-4 text-center" style={{ background: 'rgba(13,20,38,0.7)' }}>
                <Truck size={16} className="text-orange-400 mx-auto mb-1" />
                <p className="text-xl font-bold text-white">{convoy.vehicle_count}</p>
                <p className="text-xs text-gray-500">Vehicles</p>
              </div>
              <div className="rounded-xl border border-white/[0.07] p-4 text-center" style={{ background: 'rgba(13,20,38,0.7)' }}>
                <MapPin size={16} className={convoy.last_known_lat ? 'text-green-400 mx-auto mb-1' : 'text-gray-600 mx-auto mb-1'} />
                <p className="text-xs text-gray-500 mt-2">Last ping</p>
                <p className="text-xs text-white">{fmt(convoy.last_location_at)}</p>
              </div>
              <div className="rounded-xl border border-white/[0.07] p-4 text-center" style={{ background: 'rgba(13,20,38,0.7)' }}>
                <div className={`w-3 h-3 rounded-full mx-auto mb-2 mt-1 ${convoy.seal_intact === true ? 'bg-green-500' : convoy.seal_intact === false ? 'bg-red-500' : 'bg-gray-600'}`} />
                <p className="text-xs text-gray-500">Seal</p>
                <p className="text-xs text-white">{convoy.seal_intact == null ? '—' : convoy.seal_intact ? 'Intact' : 'Broken'}</p>
              </div>
            </div>

            {/* PDF Download */}
            <button
              onClick={downloadPdf}
              disabled={pdfLoading}
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-orange-500/30 bg-orange-600/10 hover:bg-orange-600/20 disabled:opacity-50 px-4 py-3 text-sm font-semibold text-orange-400 transition-colors"
            >
              {pdfLoading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              Download Custody Chain PDF
            </button>

            <p className="text-center text-xs text-gray-600">
              This is a read-only view. Powered by SONALIT Fleet Operations.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
