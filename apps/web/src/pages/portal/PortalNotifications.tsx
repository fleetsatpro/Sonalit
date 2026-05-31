import React, { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AlertTriangle, ArrowLeft, Loader2, Package, Save } from 'lucide-react';

const API_BASE = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '/api/v1';

type NotifEvent = 'departure' | 'checkpoint' | 'delay' | 'arrival' | 'incident' | 'delivered';
type NotifChannel = 'email' | 'sms' | 'whatsapp';

interface NotifPref {
  convoy_id: string | null;
  events: NotifEvent[];
  channels: NotifChannel[];
}

interface ShipmentSummary {
  convoy_id: string;
  reference: string;
}

const ALL_EVENTS: { key: NotifEvent; label: string }[] = [
  { key: 'departure', label: 'Departure' },
  { key: 'checkpoint', label: 'Checkpoint' },
  { key: 'delay', label: 'Delay' },
  { key: 'arrival', label: 'Arrival' },
  { key: 'incident', label: 'Incident' },
  { key: 'delivered', label: 'Delivered' },
];

const ALL_CHANNELS: { key: NotifChannel; label: string }[] = [
  { key: 'email', label: 'Email' },
  { key: 'sms', label: 'SMS' },
  { key: 'whatsapp', label: 'WhatsApp' },
];

const CARD: React.CSSProperties = { background: 'rgba(13,20,38,0.7)' };

function toggle<T>(arr: T[], item: T): T[] {
  return arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item];
}

function PrefEditor({
  label, pref, onChange, onSave, saving,
}: {
  label: string;
  pref: NotifPref;
  onChange: (p: NotifPref) => void;
  onSave: () => void;
  saving: boolean;
}): React.ReactElement {
  return (
    <div className="rounded-xl border border-white/[0.07] p-5 mb-4" style={CARD}>
      <p className="text-sm font-semibold text-white mb-4">{label}</p>

      <div className="mb-4">
        <p className="text-xs text-white/40 mb-2">Notify me on</p>
        <div className="flex flex-wrap gap-2">
          {ALL_EVENTS.map(({ key, label: l }) => {
            const active = pref.events.includes(key);
            return (
              <button
                key={key}
                onClick={() => onChange({ ...pref, events: toggle(pref.events, key) })}
                className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                  active
                    ? 'border-orange-500/60 bg-orange-500/20 text-orange-300'
                    : 'border-white/[0.10] text-white/40 hover:text-white/70'
                }`}
              >
                {l}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mb-5">
        <p className="text-xs text-white/40 mb-2">Via</p>
        <div className="flex gap-2">
          {ALL_CHANNELS.map(({ key, label: l }) => {
            const active = pref.channels.includes(key);
            return (
              <button
                key={key}
                onClick={() => onChange({ ...pref, channels: toggle(pref.channels, key) })}
                className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                  active
                    ? 'border-orange-500/60 bg-orange-500/20 text-orange-300'
                    : 'border-white/[0.10] text-white/40 hover:text-white/70'
                }`}
              >
                {l}
              </button>
            );
          })}
        </div>
      </div>

      <button
        onClick={onSave}
        disabled={saving}
        className="flex items-center gap-1.5 text-xs font-semibold text-white bg-orange-500 hover:bg-orange-400 disabled:opacity-50 px-4 py-2 rounded-lg transition-colors"
      >
        {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
        Save
      </button>
    </div>
  );
}

export default function PortalNotifications(): React.ReactElement {
  const navigate = useNavigate();

  const [shipments, setShipments] = useState<ShipmentSummary[]>([]);
  const [prefs, setPrefs] = useState<Record<string, NotifPref>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/portal/shipments`, { credentials: 'include' }),
      fetch(`${API_BASE}/portal/notifications`, { credentials: 'include' }),
    ])
      .then(async ([sRes, nRes]) => {
        if (sRes.status === 401 || nRes.status === 401) {
          void navigate({ to: '/portal/login' }); return;
        }
        const [sJson, nJson] = await Promise.all([
          sRes.json() as Promise<{ data: ShipmentSummary[] }>,
          nRes.json() as Promise<{ data: NotifPref[] }>,
        ]);
        setShipments(sJson.data ?? []);
        const map: Record<string, NotifPref> = {};
        for (const p of nJson.data ?? []) {
          map[p.convoy_id ?? '__global__'] = p;
        }
        // Seed missing prefs with empty defaults
        for (const s of sJson.data ?? []) {
          if (!map[s.convoy_id]) {
            map[s.convoy_id] = { convoy_id: s.convoy_id, events: [], channels: [] };
          }
        }
        if (!map['__global__']) {
          map['__global__'] = { convoy_id: null, events: [], channels: [] };
        }
        setPrefs(map);
      })
      .catch((err: Error) => setErrorMsg(err.message))
      .finally(() => setLoading(false));
  }, [navigate]);

  const handleSave = async (convoy_id: string | null) => {
    const key = convoy_id ?? '__global__';
    const pref = prefs[key];
    if (!pref) return;
    setSaving(key);
    try {
      const res = await fetch(`${API_BASE}/portal/notifications`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ convoy_id, events: pref.events, channels: pref.channels }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Save failed');
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSaving(null);
    }
  };

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
        <span className="text-xs text-gray-500">/ Notifications</span>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-6 pb-12">
        {loading && <div className="flex justify-center py-20"><Loader2 size={28} className="animate-spin text-orange-400" /></div>}

        {errorMsg && (
          <div className="flex items-start gap-3 rounded-xl border border-red-700/50 bg-red-900/20 px-4 py-3 mb-5">
            <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
            <p className="text-red-300 text-sm">{errorMsg}</p>
          </div>
        )}

        {!loading && (
          <>
            <h1 className="text-lg font-bold text-white mb-6">Notification Preferences</h1>

            <PrefEditor
              label="Global (all shipments)"
              pref={prefs['__global__'] ?? { convoy_id: null, events: [], channels: [] }}
              onChange={p => setPrefs(prev => ({ ...prev, __global__: p }))}
              onSave={() => void handleSave(null)}
              saving={saving === '__global__'}
            />

            {shipments.length > 0 && (
              <>
                <p className="text-xs text-white/40 uppercase tracking-wider mb-3 mt-6">Per shipment</p>
                {shipments.map(s => (
                  <PrefEditor
                    key={s.convoy_id}
                    label={s.reference}
                    pref={prefs[s.convoy_id] ?? { convoy_id: s.convoy_id, events: [], channels: [] }}
                    onChange={p => setPrefs(prev => ({ ...prev, [s.convoy_id]: p }))}
                    onSave={() => void handleSave(s.convoy_id)}
                    saving={saving === s.convoy_id}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
