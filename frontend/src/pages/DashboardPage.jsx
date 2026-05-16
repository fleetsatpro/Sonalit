import 'leaflet/dist/leaflet.css';
import { useEffect, useState, useRef, useCallback } from 'react';
import {
  Truck, Shield, Bell, Activity, AlertTriangle,
  Navigation, Target, RefreshCw, X, CheckCircle2,
} from 'lucide-react';
import { analyticsAPI, vehiclesAPI, convoysAPI, alertsAPI } from '../services/api';
import { useAlertStore } from '../store';
import socketService from '../services/socket';
import { Modal, Button, Input, Select, Spinner } from '../components/UI';
import { useInterval } from '../hooks';

// ── Colour palette ─────────────────────────────────────────────────────────────
const C = {
  bg:      '#060e1a',
  panel:   '#0b1829',
  surface: '#0d2240',
  cyan:    '#00d4ff',
  cyanBg:  'rgba(0,212,255,0.07)',
  cyanBd:  'rgba(0,212,255,0.18)',
  blue:    '#0066ff',
  success: '#00ff88',
  warning: '#ffaa00',
  danger:  '#ff3355',
  muted:   '#4a7090',
  body:    '#c8ddf0',
  bright:  '#e8f4ff',
};

// ── Feed event config ──────────────────────────────────────────────────────────
const FEED_CONFIG = {
  gps:    { color: 'text-success', icon: Navigation },
  alert:  { color: 'text-danger',  icon: AlertTriangle },
  convoy: { color: 'text-gold',    icon: Shield },
};

// ── Global dashboard CSS (injected once) ───────────────────────────────────────
const DASH_CSS = `
@keyframes livePulse { 0%,100%{opacity:1} 50%{opacity:0.55} }
@keyframes ping { 0%{transform:scale(1);opacity:0.8} 70%{transform:scale(2.2);opacity:0} 100%{transform:scale(2.2);opacity:0} }
@keyframes tickerScroll { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }

.live-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: #00ff88;
  box-shadow: 0 0 6px #00ff88;
  flex-shrink: 0;
  animation: livePulse 2s infinite;
}

.event-ticker { overflow: hidden; }
.event-ticker-inner {
  display: flex;
  align-items: center;
  gap: 32px;
  white-space: nowrap;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  animation: tickerScroll 40s linear infinite;
}
.event-ticker-inner:hover { animation-play-state: paused; }

.terminal-feed { font-family: 'IBM Plex Mono', monospace; padding: 6px; }
.terminal-line {
  display: flex; align-items: flex-start; gap: 6px;
  padding: 4px 6px; border-bottom: 1px solid rgba(0,212,255,0.04);
  font-size: 10px;
}
.terminal-ts { color: #4a7090; font-size: 9px; flex-shrink: 0; }

.mlos-popup .leaflet-popup-content-wrapper {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  padding: 0 !important;
}
.mlos-popup .leaflet-popup-tip { background: #0b1829; }
`;

function injectDashCSS() {
  if (document.getElementById('mlos-dash-css')) return;
  const el = document.createElement('style');
  el.id = 'mlos-dash-css';
  el.textContent = DASH_CSS;
  document.head.appendChild(el);
}

// ── KPITile ────────────────────────────────────────────────────────────────────
function KPITile({ label, value, color, pulse }) {
  return (
    <div style={{
      background: 'rgba(13,34,64,0.7)',
      border: '1px solid rgba(0,212,255,0.1)',
      borderRadius: 4,
      padding: '10px 12px',
      borderTop: `2px solid ${color}`,
    }}>
      <div style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: '#4a7090', letterSpacing: '0.14em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{
        fontSize: 20,
        fontFamily: 'IBM Plex Mono, monospace',
        fontWeight: 700,
        color,
        lineHeight: 1,
        fontVariantNumeric: 'tabular-nums',
        ...(pulse ? { animation: 'livePulse 2s infinite' } : {}),
      }}>
        {value ?? '—'}
      </div>
    </div>
  );
}

// ── MissionCard ────────────────────────────────────────────────────────────────
function MissionCard({ mission }) {
  const progress = mission.progress ?? 0;
  const statusColor = mission.status === 'delayed' ? '#ffaa00' : mission.status === 'incident' ? '#ff3355' : '#00d4ff';
  return (
    <div style={{
      padding: '8px 10px',
      background: 'rgba(13,34,64,0.5)',
      border: '1px solid rgba(0,212,255,0.08)',
      borderRadius: 4,
      marginBottom: 6,
      borderLeft: `2px solid ${statusColor}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 5 }}>
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, fontWeight: 700, color: '#e8f4ff' }}>
          {mission.name}
        </span>
        <span style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: statusColor, letterSpacing: '0.1em' }}>
          {mission.status?.toUpperCase()}
        </span>
      </div>
      <div style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: '#4a7090', marginBottom: 6 }}>
        {mission.origin} → {mission.destination}
      </div>
      <div style={{ height: 2, background: 'rgba(0,212,255,0.08)', borderRadius: 1 }}>
        <div style={{
          height: '100%',
          borderRadius: 1,
          background: `linear-gradient(90deg, ${statusColor}, transparent)`,
          width: `${progress}%`,
          boxShadow: `0 0 6px ${statusColor}60`,
        }} />
      </div>
    </div>
  );
}

// ── Toast ──────────────────────────────────────────────────────────────────────
function Toast({ msg, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 3500); return () => clearTimeout(t); }, []);
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 16, zIndex: 1200,
      display: 'flex', alignItems: 'center', gap: 10,
      background: '#0b1829', border: '1px solid rgba(0,255,136,0.3)',
      borderRadius: 8, padding: '10px 14px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    }}>
      <CheckCircle2 size={15} style={{ color: '#00ff88', flexShrink: 0 }} />
      <span style={{ fontSize: 13, color: '#c8ddf0' }}>{msg}</span>
      <button onClick={onDone} style={{ background: 'none', border: 'none', color: '#4a7090', cursor: 'pointer', padding: 2, display: 'flex' }}>
        <X size={13} />
      </button>
    </div>
  );
}

// ── New Convoy Modal ───────────────────────────────────────────────────────────
function NewConvoyModal({ open, onClose, onSuccess }) {
  const [form, setForm] = useState({ name: '', origin: '', destination: '', scheduled_start: '', risk_level: 'low' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name || !form.origin || !form.destination) { setError('Name, origin and destination are required'); return; }
    setLoading(true); setError('');
    try {
      await convoysAPI.create(form);
      onSuccess('Convoy created successfully');
      onClose();
      setForm({ name: '', origin: '', destination: '', scheduled_start: '', risk_level: 'low' });
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to create convoy');
    } finally { setLoading(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="New Convoy Mission"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={loading} onClick={submit}>Create Convoy</Button></>}>
      {error && <div className="mb-4 px-3 py-2 bg-danger/10 border border-danger/20 rounded-lg text-xs text-danger">{error}</div>}
      <div className="space-y-4">
        <Input label="Convoy Name" placeholder="e.g. CONVOY-DELTA" value={form.name} onChange={e => set('name', e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Origin" placeholder="e.g. Nairobi" value={form.origin} onChange={e => set('origin', e.target.value)} />
          <Input label="Destination" placeholder="e.g. Mombasa" value={form.destination} onChange={e => set('destination', e.target.value)} />
        </div>
        <Input label="Scheduled Start" type="datetime-local" value={form.scheduled_start} onChange={e => set('scheduled_start', e.target.value)} />
        <Select label="Risk Level" value={form.risk_level} onChange={e => set('risk_level', e.target.value)}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </Select>
      </div>
    </Modal>
  );
}

// ── Add Vehicle Modal ──────────────────────────────────────────────────────────
function AddVehicleModal({ open, onClose, onSuccess }) {
  const [form, setForm] = useState({ registration: '', type: 'truck', make: '', model: '', year: '', region: 'Kenya' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.registration) { setError('Registration is required'); return; }
    setLoading(true); setError('');
    try {
      await vehiclesAPI.create(form);
      onSuccess('Vehicle added successfully');
      onClose();
      setForm({ registration: '', type: 'truck', make: '', model: '', year: '', region: 'Kenya' });
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to add vehicle');
    } finally { setLoading(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add Vehicle"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={loading} onClick={submit}>Add Vehicle</Button></>}>
      {error && <div className="mb-4 px-3 py-2 bg-danger/10 border border-danger/20 rounded-lg text-xs text-danger">{error}</div>}
      <div className="space-y-4">
        <Input label="Registration Plate" placeholder="e.g. KEN-001" value={form.registration} onChange={e => set('registration', e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Type" value={form.type} onChange={e => set('type', e.target.value)}>
            <option value="truck">Truck</option>
            <option value="van">Van</option>
            <option value="suv">SUV</option>
            <option value="motorcycle">Motorcycle</option>
            <option value="armored">Armored</option>
          </Select>
          <Select label="Region" value={form.region} onChange={e => set('region', e.target.value)}>
            <option>Kenya</option>
            <option>Tanzania</option>
            <option>DRC</option>
            <option>Mali</option>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Make" placeholder="e.g. Toyota" value={form.make} onChange={e => set('make', e.target.value)} />
          <Input label="Model" placeholder="e.g. Land Cruiser" value={form.model} onChange={e => set('model', e.target.value)} />
        </div>
        <Input label="Year" placeholder="e.g. 2022" type="number" value={form.year} onChange={e => set('year', e.target.value)} />
      </div>
    </Modal>
  );
}

// ── Log Alert Modal ────────────────────────────────────────────────────────────
function LogAlertModal({ open, onClose, onSuccess }) {
  const [form, setForm] = useState({ type: 'security', severity: 'medium', message: '', location: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.message) { setError('Message is required'); return; }
    setLoading(true); setError('');
    try {
      await alertsAPI.create(form);
      onSuccess('Alert logged successfully');
      onClose();
      setForm({ type: 'security', severity: 'medium', message: '', location: '' });
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to log alert');
    } finally { setLoading(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Log Alert / Incident"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" loading={loading} onClick={submit}>Log Alert</Button></>}>
      {error && <div className="mb-4 px-3 py-2 bg-danger/10 border border-danger/20 rounded-lg text-xs text-danger">{error}</div>}
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Select label="Type" value={form.type} onChange={e => set('type', e.target.value)}>
            <option value="security">Security</option>
            <option value="mechanical">Mechanical</option>
            <option value="route_deviation">Route Deviation</option>
            <option value="accident">Accident</option>
            <option value="checkpoint">Checkpoint</option>
            <option value="other">Other</option>
          </Select>
          <Select label="Severity" value={form.severity} onChange={e => set('severity', e.target.value)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </Select>
        </div>
        <Input label="Location" placeholder="e.g. Nairobi Highway KM 45" value={form.location} onChange={e => set('location', e.target.value)} />
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Message</label>
          <textarea
            rows={3}
            placeholder="Describe the incident..."
            value={form.message}
            onChange={e => set('message', e.target.value)}
            className="bg-navy-800 border border-white/10 focus:border-gold/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 outline-none transition-colors resize-none"
          />
        </div>
      </div>
    </Modal>
  );
}

// ── Dispatch Modal ─────────────────────────────────────────────────────────────
function DispatchModal({ open, onClose, onSuccess }) {
  const [convoys, setConvoys] = useState([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (open) {
      setFetching(true);
      convoysAPI.list({ status: 'planned' })
        .then(r => setConvoys(r.data.data || []))
        .catch(() => {})
        .finally(() => setFetching(false));
    }
  }, [open]);

  const submit = async () => {
    if (!selected) return;
    setLoading(true);
    try {
      await convoysAPI.updateStatus(selected, 'active');
      onSuccess('Convoy dispatched successfully');
      onClose();
    } catch (e) {
      onSuccess('Dispatch failed — check convoy status');
    } finally { setLoading(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Dispatch Convoy"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="success" loading={loading} onClick={submit} className="bg-success text-navy-950">Dispatch</Button></>}>
      <div className="space-y-4">
        <p className="text-sm text-slate-400">Select a planned convoy to dispatch immediately.</p>
        {fetching ? <Spinner /> : convoys.length === 0 ? (
          <div className="text-center py-6 text-slate-600 text-sm font-mono">NO PLANNED CONVOYS</div>
        ) : (
          <div className="space-y-2">
            {convoys.map(c => (
              <button key={c.id} onClick={() => setSelected(c.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border transition-all text-left ${selected === c.id ? 'border-gold/40 bg-gold/5' : 'border-white/5 hover:border-white/10'}`}>
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${selected === c.id ? 'bg-gold' : 'bg-slate-600'}`} />
                <div>
                  <p className="text-sm font-medium text-slate-200">{c.name}</p>
                  <p className="text-xs text-slate-500 font-mono">{c.origin} → {c.destination}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [kpis, setKpis] = useState(null);
  const [activeConvoys, setActiveConvoys] = useState([]);
  const [feed, setFeed] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState('');
  const [modal, setModal] = useState(null); // 'convoy'|'vehicle'|'alert'|'dispatch'
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const { alerts, fetchAlerts } = useAlertStore();

  // Map refs
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const vehicleLayerRef = useRef(null);

  // Inject CSS once
  useEffect(() => { injectDashCSS(); }, []);

  // Track mobile
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ── Data loading ─────────────────────────────────────────────────────────────
  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const [dash, convoys] = await Promise.all([
        analyticsAPI.dashboard(),
        convoysAPI.list({ status: 'active', limit: 5 }),
      ]);
      setKpis(dash.data.data);
      setActiveConvoys(convoys.data.data || []);
    } catch (e) {
      console.error('Dashboard load error:', e);
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  // ── Socket subscriptions ─────────────────────────────────────────────────────
  useEffect(() => {
    loadData();
    fetchAlerts({ resolved: 'false', limit: 5 });

    const unsubVehicle = socketService.onVehicleUpdate(data =>
      setFeed(f => [{ type: 'gps',    ...data, ts: new Date() }, ...f].slice(0, 30))
    );
    const unsubAlert   = socketService.onAlertNew(data =>
      setFeed(f => [{ type: 'alert',  ...data, ts: new Date() }, ...f].slice(0, 30))
    );
    const unsubConvoy  = socketService.onConvoyUpdate(data =>
      setFeed(f => [{ type: 'convoy', ...data, ts: new Date() }, ...f].slice(0, 30))
    );
    return () => { unsubVehicle(); unsubAlert(); unsubConvoy(); };
  }, []);

  useInterval(() => loadData(), 30000);

  const showToast = msg => { setToast(msg); loadData(true); fetchAlerts({ resolved: 'false', limit: 5 }); };

  // ── Leaflet init ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    import('leaflet').then(mod => {
      if (!mounted || !mapRef.current || mapInstanceRef.current) return;
      const L = mod.default;

      // Fix default icons
      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({ iconRetinaUrl: null, iconUrl: null, shadowUrl: null });

      const map = L.map(mapRef.current, {
        center: [0, 20],
        zoom: 3,
        zoomControl: false,
        attributionControl: false,
      });

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
      }).addTo(map);

      L.control.zoom({ position: 'bottomright' }).addTo(map);

      vehicleLayerRef.current = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;
    });

    return () => {
      mounted = false;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        vehicleLayerRef.current = null;
      }
    };
  }, []);

  // ── Update vehicle markers ───────────────────────────────────────────────────
  useEffect(() => {
    if (!mapInstanceRef.current || !vehicleLayerRef.current) return;
    import('leaflet').then(mod => {
      const L = mod.default;
      vehicleLayerRef.current.clearLayers();

      const positions = [
        { lat: -1.2921, lng: 36.8219, status: 'active',   id: 'V001' },
        { lat: -4.0435, lng: 39.6682, status: 'delayed',   id: 'V002' },
        { lat:  0.3476, lng: 32.5825, status: 'active',    id: 'V003' },
        { lat: -6.7924, lng: 39.2083, status: 'incident',  id: 'V004' },
      ];

      positions.forEach(({ lat, lng, status, id }) => {
        const color = status === 'active' ? '#00ff88' : status === 'delayed' ? '#ffaa00' : '#ff3355';
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:10px;height:10px;border-radius:50%;background:${color};border:2px solid rgba(0,0,0,0.5);box-shadow:0 0 8px ${color};position:relative">
            <div style="position:absolute;inset:-4px;border-radius:50%;border:1.5px solid ${color};opacity:0.4;animation:ping 2s infinite"></div>
          </div>`,
          iconSize: [10, 10],
          iconAnchor: [5, 5],
        });
        L.marker([lat, lng], { icon })
          .bindPopup(
            `<div style="background:#0b1829;color:#c8ddf0;border:1px solid rgba(0,212,255,0.2);border-radius:4px;padding:10px;font-family:'IBM Plex Mono',monospace;font-size:11px">
              <strong style="color:#00d4ff">${id}</strong><br>
              Status: ${status}<br>
              Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}
            </div>`,
            { className: 'mlos-popup' }
          )
          .addTo(vehicleLayerRef.current);
      });
    });
  }, [activeConvoys]);

  // ── Derived threat values ────────────────────────────────────────────────────
  const threatLevel = kpis?.openAlerts > 10 ? 5 : kpis?.openAlerts > 5 ? 4 : kpis?.openAlerts > 2 ? 3 : kpis?.openAlerts > 0 ? 2 : 1;
  const threatLabel = kpis?.openAlerts > 10 ? 'CRITICAL' : kpis?.openAlerts > 5 ? 'HIGH' : kpis?.openAlerts > 2 ? 'ELEVATED' : kpis?.openAlerts > 0 ? 'GUARDED' : 'CLEAR';
  const threatPipColors = ['#00ff88', '#00ff88', '#ffaa00', '#ffaa00', '#ff3355'];

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    /*
     * Escape the Layout's padding: `padding: 16px 24px; paddingBottom: 80px` (mobile)
     * and `lg:pb-6` (desktop). Use negative margins to bleed edge-to-edge.
     * height: calc(100vh - 48px) = full viewport minus topbar.
     */
    <div style={{
      margin: isMobile ? '-16px -24px -80px' : '-16px -24px -80px',
      height: isMobile ? 'auto' : 'calc(100vh - 48px)',
      minHeight: isMobile ? 'calc(100vh - 48px)' : undefined,
      display: 'flex',
      flexDirection: 'column',
      overflow: isMobile ? 'auto' : 'hidden',
      background: C.bg,
    }} className="lg:!-mx-6 lg:!-mt-4 lg:!-mb-6">

      {/* Toast */}
      {toast && <Toast msg={toast} onDone={() => setToast('')} />}

      {/* Modals */}
      <NewConvoyModal  open={modal === 'convoy'}   onClose={() => setModal(null)} onSuccess={showToast} />
      <AddVehicleModal open={modal === 'vehicle'}  onClose={() => setModal(null)} onSuccess={showToast} />
      <LogAlertModal   open={modal === 'alert'}    onClose={() => setModal(null)} onSuccess={showToast} />
      <DispatchModal   open={modal === 'dispatch'} onClose={() => setModal(null)} onSuccess={showToast} />

      {/* ── Top header strip ────────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        padding: '10px 16px',
        borderBottom: '1px solid rgba(0,212,255,0.06)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'rgba(6,14,26,0.5)',
      }}>
        {/* Left: title */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <div className="live-dot" />
            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, color: '#4a7090', letterSpacing: '0.2em' }}>
              FLEETOPS PRO · COMMAND CENTER · {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: 18, fontWeight: 800, color: '#e8f4ff', letterSpacing: '0.12em', margin: 0 }}>
            OPERATIONAL <span style={{ color: '#00d4ff' }}>OVERVIEW</span>
          </h1>
        </div>

        {/* Right: threat level + refresh */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            background: 'rgba(6,14,26,0.8)',
            border: '1px solid rgba(0,212,255,0.12)',
            borderRadius: 4,
            padding: '7px 12px',
          }}>
            <div style={{ fontSize: 8, fontFamily: 'IBM Plex Mono, monospace', color: '#4a7090', letterSpacing: '0.18em', marginBottom: 5 }}>
              THREAT LEVEL
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {threatPipColors.map((c, i) => {
                const on = i < threatLevel;
                return (
                  <div key={i} style={{
                    width: 10, height: 10, borderRadius: 2,
                    background: on ? c : 'rgba(0,212,255,0.08)',
                    boxShadow: on ? `0 0 8px ${c}` : 'none',
                    transition: 'all 0.4s',
                  }} />
                );
              })}
              <span style={{ marginLeft: 4, fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: '#c8ddf0' }}>
                {threatLabel}
              </span>
            </div>
          </div>

          <button
            onClick={() => loadData(true)}
            disabled={refreshing}
            style={{
              background: 'none',
              border: '1px solid rgba(0,212,255,0.1)',
              borderRadius: 4,
              padding: '7px 10px',
              color: '#4a7090',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: 'IBM Plex Mono, monospace',
              fontSize: 10,
              opacity: refreshing ? 0.5 : 1,
            }}
          >
            <RefreshCw size={12} style={{ ...(refreshing ? { animation: 'spin 1s linear infinite' } : {}) }} />
            REFRESH
          </button>
        </div>
      </div>

      {/* ── Map + KPI row ────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: isMobile ? 'column' : 'row', overflow: isMobile ? 'auto' : 'hidden', position: 'relative' }}>

        {/* Map pane — 60% desktop / 45vh mobile */}
        <div style={isMobile ? { height: '45vh', flexShrink: 0, position: 'relative', overflow: 'hidden' } : { flex: '0 0 60%', position: 'relative', overflow: 'hidden' }}>
          {/* Leaflet container */}
          <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

          {/* ── Map overlays ─────────────────────────────────────────────── */}

          {/* Top-left: threat + legend */}
          <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 8 }}>

            {/* Threat level overlay */}
            <div style={{
              background: 'rgba(6,14,26,0.9)',
              border: '1px solid rgba(0,212,255,0.15)',
              borderRadius: 4,
              padding: '8px 12px',
              backdropFilter: 'blur(8px)',
            }}>
              <div style={{ fontSize: 8, fontFamily: 'IBM Plex Mono, monospace', color: '#4a7090', letterSpacing: '0.18em', marginBottom: 6 }}>
                THREAT LEVEL
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {threatPipColors.map((c, i) => {
                  const on = i < threatLevel;
                  return (
                    <div key={i} style={{
                      width: 10, height: 10, borderRadius: 2,
                      background: on ? c : 'rgba(0,212,255,0.08)',
                      boxShadow: on ? `0 0 8px ${c}` : 'none',
                      transition: 'all 0.4s',
                    }} />
                  );
                })}
                <span style={{ marginLeft: 4, fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: '#c8ddf0' }}>
                  {threatLabel}
                </span>
              </div>
            </div>

            {/* Asset status legend */}
            <div style={{
              background: 'rgba(6,14,26,0.9)',
              border: '1px solid rgba(0,212,255,0.15)',
              borderRadius: 4,
              padding: '8px 12px',
              backdropFilter: 'blur(8px)',
            }}>
              <div style={{ fontSize: 8, fontFamily: 'IBM Plex Mono, monospace', color: '#4a7090', letterSpacing: '0.15em', marginBottom: 5 }}>
                ASSET STATUS
              </div>
              {[['#00ff88', 'ON TIME'], ['#ffaa00', 'DELAYED'], ['#ff3355', 'INCIDENT']].map(([c, l]) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: c, boxShadow: `0 0 5px ${c}` }} />
                  <span style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: '#c8ddf0' }}>{l}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom: LIVE time strip */}
          <div style={{ position: 'absolute', bottom: 12, left: 12, right: 12, zIndex: 1000 }}>
            <div style={{
              background: 'rgba(6,14,26,0.88)',
              border: '1px solid rgba(0,212,255,0.12)',
              borderRadius: 4,
              padding: '6px 12px',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div className="live-dot" />
                <span style={{ fontSize: 10, fontFamily: 'IBM Plex Mono, monospace', color: '#00d4ff', fontWeight: 700 }}>LIVE</span>
              </div>
              <div style={{ flex: 1, height: 2, background: 'rgba(0,212,255,0.1)', borderRadius: 1, position: 'relative' }}>
                <div style={{
                  position: 'absolute', right: 0, top: '50%',
                  width: 8, height: 8, borderRadius: '50%',
                  background: '#00d4ff', transform: 'translateY(-50%)',
                  boxShadow: '0 0 6px rgba(0,212,255,0.7)',
                }} />
              </div>
              <span style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: '#4a7090' }}>-72H</span>
            </div>
          </div>
        </div>

        {/* ── KPI pane — 40% desktop / full-width mobile ────────────────── */}
        <div style={{
          width: isMobile ? '100%' : '40%',
          flexShrink: 0,
          background: '#0b1829',
          borderLeft: isMobile ? 'none' : '1px solid rgba(0,212,255,0.1)',
          borderTop: isMobile ? '1px solid rgba(0,212,255,0.1)' : 'none',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minHeight: isMobile ? 'auto' : undefined,
        }}>
          {/* KPI panel header */}
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid rgba(0,212,255,0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}>
            <span style={{ fontFamily: 'Syne, sans-serif', fontSize: 11, fontWeight: 700, color: '#00d4ff', letterSpacing: '0.18em' }}>
              NETWORK STATUS
            </span>
            <button onClick={() => loadData(true)} style={{ background: 'none', border: 'none', color: '#4a7090', cursor: 'pointer', display: 'flex', padding: 4 }}>
              <RefreshCw size={12} style={{ ...(refreshing ? { animation: 'spin 1s linear infinite' } : {}) }} />
            </button>
          </div>

          {/* Scrollable KPI content */}
          <div style={{ flex: 1, overflowY: isMobile ? 'visible' : 'auto', padding: '12px' }}>

            {/* 6 KPI tiles — 2-col grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              <KPITile label="ACTIVE SHIPMENTS"  value={kpis?.activeConvoys ?? '—'}                  color="#00d4ff" />
              <KPITile label="ON-TIME %"          value={kpis ? `${kpis.onTimeRate}%` : '—'}          color="#00ff88" />
              <KPITile label="OPEN INCIDENTS"     value={kpis?.openAlerts ?? '—'}                     color={kpis?.openAlerts > 0 ? '#ff3355' : '#00ff88'} pulse={kpis?.openAlerts > 0} />
              <KPITile label="FLEET UTIL %"       value={kpis ? `${kpis.fleetUtilisation}%` : '—'}   color="#00d4ff" />
              <KPITile label="RISK SCORE"         value={kpis?.openAlerts > 10 ? 'HIGH' : kpis?.openAlerts > 3 ? 'MED' : 'LOW'} color={kpis?.openAlerts > 5 ? '#ff3355' : kpis?.openAlerts > 2 ? '#ffaa00' : '#00ff88'} />
              <KPITile label="VEHICLES ACTIVE"    value={kpis?.activeVehicles ?? '—'}                 color="#00d4ff" />
            </div>

            {/* Active Missions */}
            <div style={{ marginBottom: 12 }}>
              <div style={{
                fontFamily: 'IBM Plex Mono, monospace',
                fontSize: 8,
                color: '#4a7090',
                letterSpacing: '0.18em',
                marginBottom: 8,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <span>ACTIVE MISSIONS</span>
                <a href="/convoys" style={{ color: 'rgba(0,212,255,0.6)', textDecoration: 'none', fontSize: 8 }}>VIEW ALL →</a>
              </div>
              {activeConvoys.length === 0 && !loading && (
                <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, color: '#4a7090', textAlign: 'center', padding: '20px 0' }}>
                  NO ACTIVE MISSIONS
                </div>
              )}
              {activeConvoys.slice(0, 4).map(c => (
                <MissionCard key={c.id} mission={c} />
              ))}
            </div>

            {/* Live Event Feed (mini terminal) */}
            <div style={{ marginBottom: 12 }}>
              <div style={{
                fontFamily: 'IBM Plex Mono, monospace',
                fontSize: 8,
                color: '#4a7090',
                letterSpacing: '0.18em',
                marginBottom: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}>
                <div className="live-dot" style={{ width: 5, height: 5 }} />
                <span>LIVE EVENTS</span>
              </div>
              <div className="terminal-feed" style={{
                maxHeight: 160,
                overflowY: 'auto',
                background: 'rgba(13,34,64,0.5)',
                border: '1px solid rgba(0,212,255,0.08)',
                borderRadius: 4,
              }}>
                {feed.length === 0 ? (
                  <div style={{ padding: '16px', textAlign: 'center', color: '#4a7090', fontSize: 10, fontFamily: 'IBM Plex Mono, monospace' }}>
                    AWAITING EVENTS…
                  </div>
                ) : feed.slice(0, 15).map((ev, i) => {
                  const cfg = FEED_CONFIG[ev.type] || FEED_CONFIG.gps;
                  const Icon = cfg.icon;
                  const ts = new Date(ev.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                  return (
                    <div key={i} className="terminal-line">
                      <span className="terminal-ts">{ts}</span>
                      <Icon size={9} className={`flex-shrink-0 mt-0.5 ${cfg.color}`} />
                      <span style={{ color: '#c8ddf0', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ev.type === 'gps'    && `V/${String(ev.vehicleId || '').slice(-5)} · ${ev.speed?.toFixed(0) || '?'}km/h`}
                        {ev.type === 'alert'  && `${ev.severity?.toUpperCase()} · ${(ev.message || '').slice(0, 28)}`}
                        {ev.type === 'convoy' && `CNV/${String(ev.convoyId || '').slice(-5)} → ${ev.status}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Quick Actions */}
            <div>
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 8, color: '#4a7090', letterSpacing: '0.18em', marginBottom: 8 }}>
                QUICK ACTIONS
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {[
                  { icon: Shield, label: 'NEW CONVOY',  color: '#00d4ff', onClick: () => setModal('convoy')  },
                  { icon: Truck,  label: 'ADD VEHICLE', color: '#0066ff', onClick: () => setModal('vehicle') },
                  { icon: Bell,   label: 'LOG ALERT',   color: '#ff3355', onClick: () => setModal('alert')   },
                  { icon: Target, label: 'DISPATCH',    color: '#00ff88', onClick: () => setModal('dispatch') },
                ].map(({ icon: Icon, label, color, onClick }) => (
                  <button
                    key={label}
                    onClick={onClick}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 10px',
                      background: 'rgba(13,34,64,0.6)',
                      border: '1px solid rgba(0,212,255,0.1)',
                      borderRadius: 4,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      color: '#c8ddf0',
                      fontFamily: 'IBM Plex Mono, monospace',
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.borderColor = `${color}40`;
                      e.currentTarget.style.background = `${color}08`;
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.borderColor = 'rgba(0,212,255,0.1)';
                      e.currentTarget.style.background = 'rgba(13,34,64,0.6)';
                    }}
                  >
                    <Icon size={13} style={{ color }} />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Event Ticker (bottom 36px strip) ─────────────────────────────────── */}
      <div style={{
        height: 36,
        flexShrink: 0,
        background: 'rgba(6,14,26,0.98)',
        borderTop: '1px solid rgba(0,212,255,0.08)',
        display: 'flex',
        alignItems: 'center',
        overflow: 'hidden',
      }}>
        {/* Label */}
        <div style={{
          padding: '0 12px',
          flexShrink: 0,
          borderRight: '1px solid rgba(0,212,255,0.1)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          height: '100%',
        }}>
          <div className="live-dot" style={{ width: 6, height: 6 }} />
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, color: '#00d4ff', fontWeight: 700, letterSpacing: '0.12em', whiteSpace: 'nowrap' }}>
            LIVE DATA
          </span>
        </div>

        {/* Scrolling feed */}
        <div className="event-ticker" style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'center', paddingLeft: 16 }}>
          <div className="event-ticker-inner">
            {feed.length === 0 ? (
              <span style={{ color: '#4a7090', fontSize: 10, fontFamily: 'IBM Plex Mono, monospace' }}>
                AWAITING LIVE DATA · CONNECT YOUR VEHICLES AND CONVOYS TO SEE REAL-TIME EVENTS
              </span>
            ) : (
              [...feed, ...feed].map((ev, i) => {
                const dot = ev.type === 'alert' ? '#ff3355' : ev.type === 'convoy' ? '#00d4ff' : '#00ff88';
                return (
                  <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#c8ddf0', fontSize: 10 }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: dot, flexShrink: 0, display: 'inline-block' }} />
                    {ev.type === 'alert'  && `${ev.severity?.toUpperCase()}: ${(ev.message || '').slice(0, 40)}`}
                    {ev.type === 'gps'    && `V/${String(ev.vehicleId || '').slice(-6).toUpperCase()} — ${ev.speed?.toFixed(0) || '?'}km/h`}
                    {ev.type === 'convoy' && `CNV/${String(ev.convoyId || '').slice(-5).toUpperCase()} → ${ev.status?.toUpperCase()}`}
                    <span style={{ color: '#4a7090', marginLeft: 8 }}>·</span>
                  </span>
                );
              })
            )}
          </div>
        </div>

        {/* Latency badge */}
        <div style={{ padding: '0 12px', borderLeft: '1px solid rgba(0,212,255,0.1)', flexShrink: 0 }}>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, color: '#4a7090' }}>847ms</span>
        </div>
      </div>
    </div>
  );
}
