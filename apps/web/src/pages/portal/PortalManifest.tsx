import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { AlertTriangle, ArrowLeft, Loader2, Package } from 'lucide-react';

const API_BASE = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '/api/v1';

interface ManifestItem {
  id: string;
  description: string;
  quantity: number;
  weight_kg: number | null;
  value: number | null;
  currency: string | null;
  handling: string;
}

interface ShipmentManifest {
  shipment_id: string;
  reference: string;
  cargo_description: string | null;
  total_weight_kg: number | null;
  declared_value: number | null;
  customs_ref: string | null;
  items: ManifestItem[];
}

interface ManifestResponse {
  data: ShipmentManifest[];
  show_value: boolean;
}

const CARD_STYLE: React.CSSProperties = { background: 'rgba(13,20,38,0.7)' };

const HANDLING_LABELS: Record<string, string> = {
  standard: 'Standard',
  fragile: 'Fragile',
  hazmat: 'Hazmat',
  cold_chain: 'Cold Chain',
  high_value: 'High Value',
};

const HANDLING_COLORS: Record<string, string> = {
  standard: 'text-gray-400 border-gray-600',
  fragile: 'text-yellow-400 border-yellow-700',
  hazmat: 'text-red-400 border-red-700',
  cold_chain: 'text-blue-400 border-blue-700',
  high_value: 'text-purple-400 border-purple-700',
};

function HandlingBadge({ handling }: { handling: string }): React.ReactElement {
  const colors = HANDLING_COLORS[handling] ?? HANDLING_COLORS['standard'];
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${colors}`}>
      {HANDLING_LABELS[handling] ?? handling}
    </span>
  );
}

function fmtWeight(kg: number | null): string {
  if (kg == null) return '—';
  return kg < 1000 ? `${kg} kg` : `${(kg / 1000).toFixed(2)} t`;
}

function fmtValue(value: number, currency: string | null): string {
  const prefix = currency ? `${currency} ` : '';
  return `${prefix}${value.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

export default function PortalManifest(): React.ReactElement {
  const navigate = useNavigate();
  const { convoy_id } = useParams({ strict: false }) as { convoy_id?: string };

  const [manifest, setManifest] = useState<ManifestResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!convoy_id) {
      setErrorMsg('No convoy ID provided');
      setLoading(false);
      return;
    }
    fetch(`${API_BASE}/portal/convoy/${convoy_id}/manifest`, { credentials: 'include' })
      .then(async (res) => {
        if (res.status === 401) { void navigate({ to: '/portal/login' }); return null; }
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? `Failed (${res.status})`);
        }
        return res.json() as Promise<ManifestResponse>;
      })
      .then((json) => { if (json) setManifest(json); })
      .catch((err: Error) => setErrorMsg(err.message))
      .finally(() => setLoading(false));
  }, [convoy_id, navigate]);

  const allItems = manifest?.data.flatMap(s => s.items) ?? [];
  const totalQty = allItems.reduce((sum, i) => sum + i.quantity, 0);
  const totalWeight = allItems.reduce((sum, i) => sum + (i.weight_kg ?? 0) * i.quantity, 0) || null;

  return (
    <div className="min-h-screen" style={{ background: '#050813' }}>

      {/* Header */}
      <div className="border-b border-white/[0.06] px-4 sm:px-6 py-4 flex items-center gap-3">
        <button
          onClick={() => void navigate({ to: '/portal/dashboard' })}
          className="text-gray-400 hover:text-white transition-colors"
          aria-label="Back to dashboard"
        >
          <ArrowLeft size={18} />
        </button>
        <Package size={18} className="text-orange-400 shrink-0" />
        <span
          className="font-black text-base tracking-wider uppercase"
          style={{
            fontFamily: "'Barlow Condensed','Arial Narrow',sans-serif",
            background: 'linear-gradient(90deg,#ff9040,#f07020)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          SONALIT
        </span>
        <span className="text-xs text-gray-500">/ Cargo Manifest</span>
      </div>

      <div className="max-w-3xl mx-auto px-4 pt-6 pb-12">

        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={28} className="animate-spin text-orange-400" />
          </div>
        )}

        {errorMsg && (
          <div className="flex items-start gap-3 rounded-xl border border-red-700/50 bg-red-900/20 px-4 py-3">
            <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
            <p className="text-red-300 text-sm">{errorMsg}</p>
          </div>
        )}

        {!loading && !errorMsg && manifest && (
          <>
            {/* Summary bar */}
            {manifest.data.length > 0 && (
              <div className="flex flex-wrap items-center gap-4 mb-6 text-sm text-white/50">
                <span>{manifest.data.length} shipment{manifest.data.length !== 1 ? 's' : ''}</span>
                <span className="text-white/20">·</span>
                <span>{totalQty} item{totalQty !== 1 ? 's' : ''}</span>
                {totalWeight != null && (
                  <>
                    <span className="text-white/20">·</span>
                    <span>Total weight: <span className="text-white/80">{fmtWeight(totalWeight)}</span></span>
                  </>
                )}
              </div>
            )}

            {manifest.data.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20">
                <Package size={40} className="text-white/10 mb-4" />
                <p className="text-white/40 text-sm">No manifest items for this convoy.</p>
              </div>
            )}

            {/* Per-shipment sections */}
            {manifest.data.map((shipment) => (
              <div key={shipment.shipment_id} className="mb-8">

                {/* Shipment header card */}
                <div className="rounded-xl border border-white/[0.07] px-5 py-4 mb-3" style={CARD_STYLE}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-bold text-white">{shipment.reference}</p>
                      {shipment.cargo_description && (
                        <p className="text-xs text-white/50 mt-0.5">{shipment.cargo_description}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0 space-y-0.5">
                      {shipment.total_weight_kg != null && (
                        <p className="text-xs text-white/50">
                          Weight: <span className="text-white/70">{fmtWeight(shipment.total_weight_kg)}</span>
                        </p>
                      )}
                      {manifest.show_value && shipment.declared_value != null && (
                        <p className="text-xs text-white/50">
                          Value: <span className="text-white/70">{fmtValue(shipment.declared_value, null)}</span>
                        </p>
                      )}
                      {shipment.customs_ref && (
                        <p className="text-xs text-white/50">
                          Customs: <span className="text-white/70">{shipment.customs_ref}</span>
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Items table */}
                {shipment.items.length > 0 ? (
                  <div className="rounded-xl border border-white/[0.07] overflow-hidden" style={CARD_STYLE}>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-white/[0.06]">
                          <th className="text-left px-4 py-3 text-white/40 font-medium">Description</th>
                          <th className="text-right px-3 py-3 text-white/40 font-medium w-14">Qty</th>
                          <th className="text-right px-3 py-3 text-white/40 font-medium w-24">Weight</th>
                          {manifest.show_value && (
                            <th className="text-right px-3 py-3 text-white/40 font-medium w-28">Value</th>
                          )}
                          <th className="text-right px-4 py-3 text-white/40 font-medium w-28">Handling</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shipment.items.map((item, idx) => (
                          <tr
                            key={item.id}
                            className={idx < shipment.items.length - 1 ? 'border-b border-white/[0.04]' : ''}
                          >
                            <td className="px-4 py-3 text-white/80">{item.description}</td>
                            <td className="px-3 py-3 text-white/60 text-right">{item.quantity}</td>
                            <td className="px-3 py-3 text-white/60 text-right">
                              {fmtWeight(item.weight_kg != null ? item.weight_kg * item.quantity : null)}
                            </td>
                            {manifest.show_value && (
                              <td className="px-3 py-3 text-white/60 text-right">
                                {item.value != null ? fmtValue(item.value * item.quantity, item.currency) : '—'}
                              </td>
                            )}
                            <td className="px-4 py-3 text-right">
                              <HandlingBadge handling={item.handling} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-white/30 px-1">No line items on this shipment's manifest.</p>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
