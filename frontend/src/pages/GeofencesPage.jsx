import { useState, useEffect, useCallback } from 'react';
import {
  MapPin, Plus, Trash2, Bell, MessageSquare, Mail, Smartphone,
  ToggleLeft, ToggleRight, Shield, AlertTriangle, X, Route,
  ChevronRight, Edit2, Wifi, Navigation,
} from 'lucide-react';
import api, { geofenceAPI } from '../services/api';
import socketService from '../services/socket';
import toast from 'react-hot-toast';

// ── Theme tokens ─────────────────────────────────────────────────────────────
const T = {
  bg:      '#080C14',
  card:    'rgba(255,255,255,0.025)',
  border:  'rgba(255,255,255,0.07)',
  amber:   '#F0B429',
  amberBg: 'rgba(240,180,41,0.08)',
  amberBd: 'rgba(240,180,41,0.2)',
  cyan:    '#22D3A0',
  cyanBg:  'rgba(34,211,160,0.08)',
  red:     '#ef4444',
  redBg:   'rgba(239,68,68,0.08)',
  redBd:   'rgba(239,68,68,0.2)',
  text:    '#e2e8f0',
  muted:   '#94a3b8',
  low:     '#475569',
  purple:  '#a78bfa',
};

const ACTION_META = {
  sms:       { label: 'SMS',        icon: Smartphone,   color: T.cyan,   ph: '+254712345678'       },
  whatsapp:  { label: 'WhatsApp',   icon: MessageSquare,color: '#25D366',ph: '+254712345678'       },
  email:     { label: 'Email',      icon: Mail,         color: T.purple, ph: 'ops@company.com'     },
  map_alert: { label: 'Map Flash',  icon: Wifi,         color: T.amber,  ph: null                  },
};

function StatCard({ label, value, color = T.amber }) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '14px 18px', minWidth: 0 }}>
      <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: 'monospace' }}>{value}</div>
      <div style={{ fontSize: 9, color: T.low, letterSpacing: '0.12em', marginTop: 2 }}>{label}</div>
    </div>
  );
}

function TypeBadge({ type }) {
  const corridor = type === 'corridor';
  return (
    <span style={{
      fontSize: 8, fontWeight: 800, letterSpacing: '0.14em', padding: '2px 7px',
      borderRadius: 20, fontFamily: 'monospace',
      background: corridor ? T.amberBg : T.cyanBg,
      border: `1px solid ${corridor ? T.amberBd : 'rgba(34,211,160,0.25)'}`,
      color: corridor ? T.amber : T.cyan,
    }}>
      {corridor ? '⬡ CORRIDOR' : '⭕ CIRCLE'}
    </span>
  );
}

// ── Action row ────────────────────────────────────────────────────────────────
function ActionRow({ action, geofenceId, onDelete, onToggle }) {
  const meta = ACTION_META[action.action_type] || ACTION_META.sms;
  const Icon = meta.icon;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
      background: T.card, border: `1px solid ${T.border}`, borderRadius: 10,
    }}>
      <div style={{ width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${meta.color}18`, flexShrink: 0 }}>
        <Icon size={13} color={meta.color} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.text }}>{meta.label}</div>
        {action.recipient && <div style={{ fontSize: 9, color: T.muted, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{action.recipient}</div>}
        {action.message_template && <div style={{ fontSize: 9, color: T.low, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{action.message_template}</div>}
      </div>
      <button
        onClick={() => onToggle(action)}
        title={action.enabled ? 'Disable' : 'Enable'}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: action.enabled ? T.cyan : T.low, flexShrink: 0 }}>
        {action.enabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
      </button>
      <button
        onClick={() => onDelete(action.id)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: T.low, flexShrink: 0 }}>
        <Trash2 size={13} />
      </button>
    </div>
  );
}

// ── Actions panel (slide-in drawer) ──────────────────────────────────────────
function ActionsPanel({ fence, onClose, onUpdated }) {
  const [actions, setActions]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [type,    setType]      = useState('sms');
  const [recipient, setRecipient] = useState('');
  const [template,  setTemplate]  = useState('Vehicle {vehicle} is off route {geofence}. Severity: {severity}. Distance: {distance}.');
  const [saving, setSaving]     = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await geofenceAPI.listActions(fence.id);
      setActions(r.data.data || []);
    } catch (_) {}
    setLoading(false);
  }, [fence.id]);

  useEffect(() => { load(); }, [load]);

  const addAction = async () => {
    if (!type) return;
    if (type !== 'map_alert' && !recipient.trim()) { toast.error('Recipient required'); return; }
    setSaving(true);
    try {
      await geofenceAPI.addAction(fence.id, {
        action_type: type,
        recipient: type === 'map_alert' ? null : recipient.trim(),
        message_template: template.trim(),
      });
      toast.success('Action added');
      setRecipient('');
      await load();
      onUpdated();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed');
    }
    setSaving(false);
  };

  const deleteAction = async (actionId) => {
    try {
      await geofenceAPI.removeAction(fence.id, actionId);
      setActions(a => a.filter(x => x.id !== actionId));
      onUpdated();
    } catch (_) { toast.error('Delete failed'); }
  };

  const toggleAction = async (action) => {
    try {
      await geofenceAPI.toggleAction(fence.id, action.id);
      setActions(a => a.map(x => x.id === action.id ? { ...x, enabled: !x.enabled } : x));
    } catch (_) {}
  };

  const meta = ACTION_META[type] || ACTION_META.sms;

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: Math.min(400, window.innerWidth),
      background: '#0D1220', borderLeft: `1px solid ${T.border}`,
      display: 'flex', flexDirection: 'column', zIndex: 500,
      boxShadow: '-20px 0 60px rgba(0,0,0,0.6)',
    }}>
      {/* Header */}
      <div style={{ padding: '16px 18px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <Shield size={14} color={T.amber} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: T.amber, fontFamily: 'monospace', letterSpacing: '0.1em' }}>VIOLATION ACTIONS</div>
          <div style={{ fontSize: 10, color: T.muted, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fence.name}</div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: T.low, cursor: 'pointer', padding: 4 }}>
          <X size={16} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Existing actions */}
        <div>
          <div style={{ fontSize: 9, color: T.low, letterSpacing: '0.12em', marginBottom: 8 }}>CONFIGURED ACTIONS ({actions.length})</div>
          {loading ? (
            <div style={{ color: T.low, fontSize: 11, textAlign: 'center', padding: 16 }}>Loading…</div>
          ) : actions.length === 0 ? (
            <div style={{ color: T.low, fontSize: 11, textAlign: 'center', padding: 16 }}>No actions yet — add one below</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {actions.map(a => (
                <ActionRow key={a.id} action={a} geofenceId={fence.id} onDelete={deleteAction} onToggle={toggleAction} />
              ))}
            </div>
          )}
        </div>

        {/* Add action form */}
        <div style={{ background: T.amberBg, border: `1px solid ${T.amberBd}`, borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 9, color: T.amber, fontWeight: 800, letterSpacing: '0.12em', marginBottom: 12 }}>+ ADD ACTION ON VIOLATION</div>

          {/* Type selector */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
            {Object.entries(ACTION_META).map(([key, m]) => {
              const Icon = m.icon;
              const active = type === key;
              return (
                <button key={key} onClick={() => setType(key)} style={{
                  display: 'flex', alignItems: 'center', gap: 7, padding: '8px 10px',
                  background: active ? `${m.color}18` : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${active ? m.color + '60' : T.border}`,
                  borderRadius: 8, cursor: 'pointer', minHeight: 38,
                }}>
                  <Icon size={12} color={active ? m.color : T.low} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: active ? m.color : T.muted, fontFamily: 'monospace' }}>{m.label}</span>
                </button>
              );
            })}
          </div>

          {/* Recipient */}
          {type !== 'map_alert' && (
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 9, color: T.muted, letterSpacing: '0.1em', display: 'block', marginBottom: 4 }}>RECIPIENT</label>
              <input
                value={recipient}
                onChange={e => setRecipient(e.target.value)}
                placeholder={meta.ph}
                style={{ width: '100%', background: 'rgba(10,15,26,0.8)', border: `1px solid ${T.border}`, borderRadius: 7, padding: '7px 10px', fontSize: 11, color: T.text, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
          )}

          {/* Message template */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 9, color: T.muted, letterSpacing: '0.1em', display: 'block', marginBottom: 4 }}>
              MESSAGE TEMPLATE
              <span style={{ color: T.low, marginLeft: 6 }}>{'→ {vehicle} {geofence} {severity} {distance}'}</span>
            </label>
            <textarea
              value={template}
              onChange={e => setTemplate(e.target.value)}
              rows={3}
              style={{ width: '100%', background: 'rgba(10,15,26,0.8)', border: `1px solid ${T.border}`, borderRadius: 7, padding: '7px 10px', fontSize: 10, color: T.text, outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'monospace' }}
            />
          </div>

          {type === 'map_alert' && (
            <div style={{ fontSize: 9, color: T.muted, marginBottom: 10, padding: '8px 10px', background: 'rgba(240,180,41,0.05)', borderRadius: 6, border: `1px solid ${T.amberBd}` }}>
              The GPS map will flash red and display a banner when this geofence is violated.
            </div>
          )}

          <button
            onClick={addAction}
            disabled={saving}
            style={{ width: '100%', background: T.amber, color: '#0A0F1A', border: 'none', borderRadius: 8, padding: '10px 0', fontSize: 11, fontWeight: 800, fontFamily: 'monospace', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1, minHeight: 40 }}>
            {saving ? 'SAVING…' : `SAVE ${ACTION_META[type]?.label?.toUpperCase() || 'ACTION'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Add geofence modal ────────────────────────────────────────────────────────
function AddModal({ onClose, onCreated }) {
  const [mode,     setMode]     = useState('circle'); // circle | corridor
  const [name,     setName]     = useState('');
  const [location, setLocation] = useState('');
  const [end,      setEnd]      = useState('');
  const [radius,   setRadius]   = useState(3000);
  const [buffer,   setBuffer]   = useState(300);
  const [saving,   setSaving]   = useState(false);

  const submit = async () => {
    if (!name.trim() || !location.trim()) { toast.error('Name and location required'); return; }
    if (mode === 'corridor' && !end.trim()) { toast.error('End location required for corridor'); return; }
    setSaving(true);
    try {
      if (mode === 'circle') {
        // Geocode then create via geofences API
        const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`);
        const geoData = await geo.json();
        if (!geoData.results?.length) throw new Error(`Location "${location}" not found`);
        const g = geoData.results[0];
        await geofenceAPI.create({
          name: name.trim(),
          type: 'circle',
          coordinates: { lat: g.latitude, lng: g.longitude },
          radius: parseInt(radius),
          region: g.admin1 || g.country,
        });
      } else {
        // Use AI dispatch to create corridor (leverages OSRM routing)
        await api.post('/ai/dispatch', {
          command: `Create a corridor geofence named "${name.trim()}" from "${location.trim()}" to "${end.trim()}" with ${buffer}m buffer`,
        });
      }
      toast.success(`Geofence "${name}" created`);
      onCreated();
      onClose();
    } catch (e) {
      toast.error(e.message || 'Failed to create geofence');
    }
    setSaving(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onClose}>
      <div style={{ width: '100%', maxWidth: 460, background: '#0D1220', border: `1px solid ${T.border}`, borderRadius: 16, padding: 24, boxShadow: '0 24px 80px rgba(0,0,0,0.7)' }}
        onClick={e => e.stopPropagation()}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: T.amber, fontFamily: 'monospace', letterSpacing: '0.1em' }}>NEW GEOFENCE ZONE</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: T.low, cursor: 'pointer' }}><X size={16} /></button>
        </div>

        {/* Mode toggle */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 18 }}>
          {[['circle', MapPin, 'CIRCLE ZONE'], ['corridor', Route, 'ROAD CORRIDOR']].map(([m, Icon, lbl]) => (
            <button key={m} onClick={() => setMode(m)} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 0',
              background: mode === m ? T.amberBg : 'transparent',
              border: `1px solid ${mode === m ? T.amberBd : T.border}`,
              borderRadius: 10, cursor: 'pointer', minHeight: 44,
            }}>
              <Icon size={14} color={mode === m ? T.amber : T.low} />
              <span style={{ fontSize: 10, fontWeight: 800, color: mode === m ? T.amber : T.muted, fontFamily: 'monospace' }}>{lbl}</span>
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="GEOFENCE NAME" value={name} onChange={setName} placeholder={mode === 'corridor' ? 'Thika Road Corridor' : 'Nairobi CBD Zone'} />
          <Field label={mode === 'corridor' ? 'START LOCATION' : 'LOCATION'} value={location} onChange={setLocation} placeholder={mode === 'corridor' ? 'Ngara, Nairobi' : 'Nairobi CBD'} />
          {mode === 'corridor' && (
            <Field label="END LOCATION" value={end} onChange={setEnd} placeholder="Juja, Kiambu" />
          )}
          {mode === 'circle' ? (
            <Field label="RADIUS (METRES)" value={radius} onChange={v => setRadius(v)} type="number" placeholder="3000" />
          ) : (
            <Field label="BUFFER WIDTH (METRES) — deviation alert threshold" value={buffer} onChange={v => setBuffer(v)} type="number" placeholder="300" />
          )}
        </div>

        <button
          onClick={submit}
          disabled={saving}
          style={{ width: '100%', marginTop: 20, background: T.amber, color: '#0A0F1A', border: 'none', borderRadius: 10, padding: '12px 0', fontSize: 12, fontWeight: 800, fontFamily: 'monospace', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1, minHeight: 44 }}>
          {saving ? 'CREATING…' : 'CREATE GEOFENCE'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      <label style={{ fontSize: 9, color: T.muted, letterSpacing: '0.1em', display: 'block', marginBottom: 4 }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(type === 'number' ? e.target.value : e.target.value)}
        placeholder={placeholder}
        style={{ width: '100%', background: 'rgba(10,15,26,0.8)', border: `1px solid ${T.border}`, borderRadius: 8, padding: '9px 12px', fontSize: 11, color: T.text, outline: 'none', boxSizing: 'border-box', minHeight: 40 }}
      />
    </div>
  );
}

// ── GeofenceCard ──────────────────────────────────────────────────────────────
function GeofenceCard({ fence, actionCount, onManageActions, onDelete }) {
  const isCorridor = fence.type === 'corridor';
  let meta = '';
  if (isCorridor) {
    try {
      const c = typeof fence.coordinates === 'string' ? JSON.parse(fence.coordinates) : fence.coordinates;
      const pts = c?.path?.length || 0;
      const buf = c?.buffer_m || 300;
      meta = `${pts} waypoints · ${buf}m deviation limit`;
    } catch (_) {}
  } else {
    meta = `${fence.radius || 500}m radius`;
  }

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Top row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: isCorridor ? T.amberBg : T.cyanBg, border: `1px solid ${isCorridor ? T.amberBd : 'rgba(34,211,160,0.2)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {isCorridor ? <Route size={16} color={T.amber} /> : <MapPin size={16} color={T.cyan} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: T.text }}>{fence.name}</span>
            <TypeBadge type={fence.type} />
          </div>
          {fence.region && <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>{fence.region}</div>}
        </div>
      </div>

      {/* Meta info */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 10, color: T.low }}>{meta}</div>
        {fence.created_at && (
          <div style={{ fontSize: 10, color: T.low }}>
            {new Date(fence.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          onClick={() => onManageActions(fence)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: actionCount > 0 ? T.amberBg : 'rgba(255,255,255,0.03)', border: `1px solid ${actionCount > 0 ? T.amberBd : T.border}`, borderRadius: 8, cursor: 'pointer', fontSize: 10, fontWeight: 700, color: actionCount > 0 ? T.amber : T.muted, fontFamily: 'monospace', minHeight: 34 }}>
          <Bell size={11} />
          ACTIONS {actionCount > 0 ? `(${actionCount})` : ''}
        </button>
        <a
          href="/gps"
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: 'rgba(255,255,255,0.03)', border: `1px solid ${T.border}`, borderRadius: 8, textDecoration: 'none', fontSize: 10, fontWeight: 700, color: T.muted, fontFamily: 'monospace', minHeight: 34 }}>
          <Navigation size={11} />
          MAP
        </a>
        <button
          onClick={() => onDelete(fence)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: T.redBg, border: `1px solid ${T.redBd}`, borderRadius: 8, cursor: 'pointer', fontSize: 10, fontWeight: 700, color: T.red, fontFamily: 'monospace', marginLeft: 'auto', minHeight: 34 }}>
          <Trash2 size={11} />
          DELETE
        </button>
      </div>
    </div>
  );
}

// ── Violation flash overlay ───────────────────────────────────────────────────
function ViolationFlash({ data, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2500);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999, pointerEvents: 'none',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      animation: 'violationFlash 2.5s ease-in-out forwards',
    }}>
      <style>{`@keyframes violationFlash{0%,100%{background:rgba(239,68,68,0)}20%,40%,60%,80%{background:rgba(239,68,68,0.18)}10%,30%,50%,70%,90%{background:rgba(239,68,68,0.06)}}`}</style>
      <div style={{ padding: '16px 28px', background: 'rgba(239,68,68,0.9)', backdropFilter: 'blur(8px)', borderRadius: 14, border: '1px solid rgba(239,68,68,0.5)', boxShadow: '0 0 40px rgba(239,68,68,0.5)', textAlign: 'center', pointerEvents: 'none' }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: '#fff', fontFamily: 'monospace', letterSpacing: '0.15em' }}>⚠ GEOFENCE VIOLATION</div>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', marginTop: 4 }}>{data?.geofenceName || 'Unknown Zone'}</div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.8)', marginTop: 2 }}>Vehicle {data?.vehicleId} · {(data?.severity || '').toUpperCase()}</div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function GeofencesPage() {
  const [geofences,   setGeofences]   = useState([]);
  const [actionCounts,setActionCounts]= useState({});
  const [loading,     setLoading]     = useState(true);
  const [activePanel, setActivePanel] = useState(null); // fence object
  const [showAdd,     setShowAdd]     = useState(false);
  const [violation,   setViolation]   = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await geofenceAPI.list();
      const fences = r.data.data || [];
      setGeofences(fences);

      // Load action counts for all fences in parallel
      const counts = {};
      await Promise.allSettled(fences.map(async f => {
        try {
          const ar = await geofenceAPI.listActions(f.id);
          counts[f.id] = (ar.data.data || []).length;
        } catch (_) { counts[f.id] = 0; }
      }));
      setActionCounts(counts);
    } catch (e) { toast.error('Failed to load geofences'); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Socket — violation flash
  useEffect(() => {
    socketService.connect();
    const handler = data => {
      setViolation(data);
      toast.error(`⚠ VIOLATION: ${data?.geofenceName || 'Unknown'} — Vehicle ${data?.vehicleId}`, { duration: 5000 });
    };
    // Use generic .on() if available (returns unsub fn), else fall back to socket directly
    if (typeof socketService.on === 'function') {
      const unsub = socketService.on('geofence:violation', handler);
      return () => { if (typeof unsub === 'function') unsub(); };
    } else {
      const sock = socketService.socket;
      if (!sock) return;
      sock.on('geofence:violation', handler);
      return () => sock.off('geofence:violation', handler);
    }
  }, []);

  const deleteGeofence = async (fence) => {
    if (!window.confirm(`Delete geofence "${fence.name}"?`)) return;
    try {
      await geofenceAPI.delete(fence.id);
      toast.success('Deleted');
      if (activePanel?.id === fence.id) setActivePanel(null);
      setGeofences(g => g.filter(x => x.id !== fence.id));
    } catch (_) { toast.error('Delete failed'); }
  };

  const corridors = geofences.filter(f => f.type === 'corridor');
  const circles   = geofences.filter(f => f.type !== 'corridor');
  const totalActions = Object.values(actionCounts).reduce((s, n) => s + n, 0);

  return (
    <div style={{ minHeight: '100%', background: T.bg, padding: 0 }}>

      {/* Violation flash overlay */}
      {violation && <ViolationFlash data={violation} onDone={() => setViolation(null)} />}

      {/* Actions panel (right drawer) */}
      {activePanel && (
        <>
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 499 }} onClick={() => setActivePanel(null)} />
          <ActionsPanel
            fence={activePanel}
            onClose={() => setActivePanel(null)}
            onUpdated={() => {
              // Refresh action count for this fence
              geofenceAPI.listActions(activePanel.id).then(r => {
                setActionCounts(c => ({ ...c, [activePanel.id]: (r.data.data || []).length }));
              }).catch(() => {});
            }}
          />
        </>
      )}

      {/* Add modal */}
      {showAdd && <AddModal onClose={() => setShowAdd(false)} onCreated={load} />}

      {/* Page content */}
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '20px 16px 60px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: T.text, margin: 0 }}>Geofence Zones</h1>
            <p style={{ fontSize: 11, color: T.muted, margin: '4px 0 0', fontFamily: 'monospace' }}>Manage zones, corridors, and violation actions</p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', background: T.amber, color: '#0A0F1A', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 11, fontWeight: 800, fontFamily: 'monospace', minHeight: 42 }}>
            <Plus size={14} />
            ADD ZONE
          </button>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 24 }}>
          <StatCard label="TOTAL ZONES" value={geofences.length} color={T.amber} />
          <StatCard label="CORRIDORS" value={corridors.length} color={T.amber} />
          <StatCard label="CIRCLES" value={circles.length} color={T.cyan} />
          <StatCard label="ACTIVE ACTIONS" value={totalActions} color={T.purple} />
        </div>

        {/* List */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: T.muted }}>
            <div style={{ width: 36, height: 36, border: `2px solid ${T.amberBd}`, borderTopColor: T.amber, borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
            Loading geofences…
          </div>
        ) : geofences.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: T.muted }}>
            <Shield size={40} color={T.low} style={{ marginBottom: 12 }} />
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 6 }}>No geofences yet</div>
            <div style={{ fontSize: 11, marginBottom: 20 }}>Create a circle zone or a road corridor. The AI can also create them — try asking the AI Dispatch.</div>
            <button onClick={() => setShowAdd(true)} style={{ padding: '10px 24px', background: T.amber, color: '#0A0F1A', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 11, fontWeight: 800, fontFamily: 'monospace', minHeight: 42 }}>
              <Plus size={13} style={{ display: 'inline', marginRight: 6 }} /> ADD FIRST ZONE
            </button>
          </div>
        ) : (
          <>
            {corridors.length > 0 && (
              <>
                <SectionLabel label={`ROAD CORRIDORS (${corridors.length})`} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                  {corridors.map(f => (
                    <GeofenceCard key={f.id} fence={f} actionCount={actionCounts[f.id] || 0}
                      onManageActions={setActivePanel} onDelete={deleteGeofence} />
                  ))}
                </div>
              </>
            )}
            {circles.length > 0 && (
              <>
                <SectionLabel label={`CIRCLE ZONES (${circles.length})`} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {circles.map(f => (
                    <GeofenceCard key={f.id} fence={f} actionCount={actionCounts[f.id] || 0}
                      onManageActions={setActivePanel} onDelete={deleteGeofence} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SectionLabel({ label }) {
  return (
    <div style={{ fontSize: 9, color: T.low, letterSpacing: '0.14em', fontFamily: 'monospace', marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${T.border}` }}>
      {label}
    </div>
  );
}
