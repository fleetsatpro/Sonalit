import { useState, useEffect } from 'react';
import { MapPin, Battery, Signal, ChevronRight, AlertOctagon, Phone, Clock, Activity } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import socketService from '../services/socket';

const C = {
  bg:'#080C14', surf:'#0D1420', panel:'#111827', border:'#1E2D40', border2:'#243650',
  gold:'#F0B429', green:'#22c55e', red:'#ef4444', amber:'#f59e0b', blue:'#3b82f6',
  cyan:'#06b6d4', purple:'#a855f7', dim:'#374151', muted:'#4b5563', sub:'#6b7280',
  mid:'#94a3b8', txt:'#cbd5e1', hi:'#f1f5f9',
};

const STATUS_COLOR = { available: C.green, on_mission: C.amber, sos: C.red, offline: C.dim, never_seen: C.purple, knox_session: C.cyan };
const STATUS_ORDER = { sos: 0, on_mission: 1, available: 2, offline: 3 };

function fmtRel(ts) {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

function StatusPill({ status }) {
  const c = STATUS_COLOR[status] || C.sub;
  return (
    <span style={{ background: `${c}20`, border: `1px solid ${c}50`, borderRadius: 3, padding: '2px 7px', fontSize: 9, fontFamily: 'JetBrains Mono', fontWeight: 700, color: c, letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
      {status?.replace('_', ' ') || 'unknown'}
    </span>
  );
}

function HealthBars({ battery, signal, gpsLocked }) {
  const bars = [
    { label: 'BAT', val: battery, color: battery < 20 ? C.red : battery < 50 ? C.amber : C.green },
    { label: 'SIG', val: signal, color: signal < 30 ? C.red : C.green },
    { label: 'GPS', val: gpsLocked ? 100 : 0, color: gpsLocked ? C.green : C.sub },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: 70 }}>
      {bars.map(({ label, val, color }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontFamily: 'JetBrains Mono', fontSize: 8, color: C.sub, width: 22, flexShrink: 0 }}>{label}</span>
          <div style={{ flex: 1, height: 4, background: C.panel, borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${val ?? 0}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.3s' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function SosStrip({ officers }) {
  const sos = officers.filter(o => o.status === 'sos');
  if (!sos.length) return null;
  const top = sos[0];
  return (
    <div style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 6, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.red, animation: 'sosPulse 1s infinite', flexShrink: 0 }} />
      <span style={{ fontFamily: 'JetBrains Mono', fontSize: 11, fontWeight: 700, color: C.red, letterSpacing: '0.1em' }}>
        SOS — {top.name} · {top.badge_number || top.badge || '—'}
      </span>
      {top.gps_lat && <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: C.mid }}>{Number(top.gps_lat).toFixed(4)}, {Number(top.gps_lng).toFixed(4)}</span>}
      {top.battery_pct != null && <span style={{ color: C.amber, fontSize: 10, fontFamily: 'JetBrains Mono' }}>BAT {top.battery_pct}%</span>}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button style={{ background: C.red, color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'JetBrains Mono', letterSpacing: '0.08em' }}>CALL NOW</button>
        <button style={{ background: 'rgba(239,68,68,0.15)', color: C.red, border: `1px solid ${C.red}40`, borderRadius: 4, padding: '4px 12px', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'JetBrains Mono' }}>TRACK</button>
        <button style={{ background: 'rgba(239,68,68,0.15)', color: C.red, border: `1px solid ${C.red}40`, borderRadius: 4, padding: '4px 12px', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'JetBrains Mono' }}>DISPATCH</button>
      </div>
      {sos.length > 1 && <span style={{ fontSize: 10, color: C.red, fontFamily: 'JetBrains Mono' }}>+{sos.length - 1} more</span>}
    </div>
  );
}

function MapPanel({ officers }) {
  const active = officers.filter(o => o.gps_lat && o.gps_lng);
  return (
    <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 6, height: 160, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #0a1628 0%, #0d1f3c 100%)', opacity: 0.9 }} />
      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
        <MapPin size={20} style={{ color: C.gold, marginBottom: 6 }} />
        <div style={{ fontFamily: 'Barlow Condensed', fontWeight: 700, fontSize: 11, color: C.gold, letterSpacing: '0.1em' }}>GPS MAP</div>
        <div style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: C.sub, marginTop: 2 }}>{active.length} officers with GPS fix</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          {active.slice(0, 6).map(o => {
            const c = STATUS_COLOR[o.status] || C.sub;
            return (
              <div key={o.id} style={{ background: `${c}20`, border: `1px solid ${c}50`, borderRadius: 3, padding: '2px 6px', fontSize: 9, fontFamily: 'JetBrains Mono', color: c }}>
                {o.badge_number || o.name?.split(' ')[0] || '—'}
              </div>
            );
          })}
          {active.length > 6 && <span style={{ fontSize: 9, color: C.sub, fontFamily: 'JetBrains Mono' }}>+{active.length - 6}</span>}
        </div>
      </div>
    </div>
  );
}

function ActivityFeed() {
  const [events, setEvents] = useState([]);
  useEffect(() => {
    const handler = (ev) => setEvents(prev => [{ ...ev, receivedAt: new Date().toISOString() }, ...prev].slice(0, 20));
    socketService.on('officer:activity', handler);
    return () => socketService.off('officer:activity', handler);
  }, []);
  const iconColor = { sos: C.red, checkin: C.green, photo: C.amber, seal: C.green, geofence: C.blue };
  return (
    <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12 }}>
      <div style={{ fontFamily: 'Barlow Condensed', fontWeight: 700, fontSize: 12, color: C.gold, letterSpacing: '0.08em', marginBottom: 8 }}>LIVE ACTIVITY</div>
      {events.length === 0 ? (
        <div style={{ color: C.sub, fontSize: 10, fontFamily: 'Inter' }}>Waiting for events…</div>
      ) : events.map((ev, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'flex-start' }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: iconColor[ev.type] || C.mid, marginTop: 3, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: C.txt, fontSize: 10, fontFamily: 'Inter', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.label || ev.message || ev.type}</div>
            <div style={{ color: C.sub, fontSize: 9, fontFamily: 'JetBrains Mono' }}>{fmtRel(ev.receivedAt)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ExpandedRow({ officer, onRefresh }) {
  const [activity, setActivity] = useState([]);
  useEffect(() => {
    api.get(`/field-officers/${officer.id}/activity`, { params: { limit: 5 } })
      .then(r => setActivity(r.data?.data || r.data || []))
      .catch(() => {});
  }, [officer.id]);

  return (
    <tr>
      <td colSpan={8} style={{ background: C.panel, padding: '12px 16px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
          <div>
            <div style={{ fontFamily: 'Barlow Condensed', fontWeight: 700, fontSize: 10, color: C.gold, letterSpacing: '0.08em', marginBottom: 6 }}>PROFILE</div>
            {[['Badge', officer.badge_number || officer.badge || '—'],
              ['Phone', officer.phone || '—'],
              ['Zone', officer.zone || '—'],
              ['Route', officer.route || '—'],
              ['Rank', officer.rank || '—'],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: C.sub, fontSize: 10, fontFamily: 'Inter' }}>{k}</span>
                <span style={{ color: C.txt, fontSize: 10, fontFamily: 'JetBrains Mono' }}>{v}</span>
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontFamily: 'Barlow Condensed', fontWeight: 700, fontSize: 10, color: C.gold, letterSpacing: '0.08em', marginBottom: 6 }}>DEVICE</div>
            {[['Model', officer.device_model || '—'],
              ['IMEI', officer.device_imei ? `${officer.device_imei.slice(0,4)}…${officer.device_imei.slice(-4)}` : '—'],
              ['App Ver', officer.app_version || '—'],
              ['Android', officer.android_version || '—'],
              ['Knox', officer.knox_version || '—'],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: C.sub, fontSize: 10, fontFamily: 'Inter' }}>{k}</span>
                <span style={{ color: C.txt, fontSize: 10, fontFamily: 'JetBrains Mono' }}>{v}</span>
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontFamily: 'Barlow Condensed', fontWeight: 700, fontSize: 10, color: C.gold, letterSpacing: '0.08em', marginBottom: 6 }}>PERFORMANCE</div>
            {[['Missions', officer.missions_total ?? '—'],
              ['Check-in Rate', officer.checkin_rate != null ? `${officer.checkin_rate}%` : '—'],
              ['SOS Events', officer.sos_events_total ?? 0],
              ['Seals Verified', officer.seals_verified ?? 0],
              ['Shift Start', officer.shift_start ? fmtRel(officer.shift_start) : '—'],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: C.sub, fontSize: 10, fontFamily: 'Inter' }}>{k}</span>
                <span style={{ color: C.txt, fontSize: 10, fontFamily: 'JetBrains Mono' }}>{v}</span>
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontFamily: 'Barlow Condensed', fontWeight: 700, fontSize: 10, color: C.gold, letterSpacing: '0.08em', marginBottom: 6 }}>RECENT ACTIVITY</div>
            {activity.length === 0 ? (
              <div style={{ color: C.sub, fontSize: 10, fontFamily: 'Inter' }}>No recent events</div>
            ) : activity.slice(0, 5).map((ev, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 5 }}>
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: C.blue, marginTop: 4, flexShrink: 0 }} />
                <div>
                  <div style={{ color: C.txt, fontSize: 10, fontFamily: 'Inter' }}>{ev.type || ev.event}</div>
                  <div style={{ color: C.sub, fontSize: 9, fontFamily: 'JetBrains Mono' }}>{fmtRel(ev.created_at || ev.ts)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </td>
    </tr>
  );
}

function OfficerRow({ officer, expanded, onToggle, onRefresh }) {
  const sc = STATUS_COLOR[officer.status] || C.sub;
  const actionsByStatus = {
    sos:        [['CALL NOW', C.red, true], ['TRACK', C.amber, false], ['DISPATCH', C.gold, false]],
    on_mission: [['TRACK LIVE', C.gold, false], ['MESSAGE', C.blue, false], ['REPORT', C.mid, false]],
    available:  [['ASSIGN', C.gold, false], ['MESSAGE', C.blue, false], ['PROFILE', C.mid, false]],
    offline:    [['PING', C.amber, false], ['MESSAGE', C.blue, false], ['PROFILE', C.mid, false]],
  };
  const actions = actionsByStatus[officer.status] || actionsByStatus.offline;

  return (
    <>
      <tr style={{ borderBottom: `1px solid ${C.border}`, background: expanded ? C.panel : 'transparent', cursor: 'pointer' }}
        onClick={() => onToggle(officer.id)}>
        <td style={{ padding: '8px 10px', width: 24 }}>
          <ChevronRight size={12} style={{ color: C.sub, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
        </td>
        <td style={{ padding: '8px 10px', minWidth: 160 }}>
          <div style={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 600, color: C.hi, lineHeight: 1.2 }}>{officer.name || '—'}</div>
          <div style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: C.sub, marginTop: 1 }}>{officer.badge_number || officer.badge || '—'}</div>
          {officer.device_model && <div style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: C.muted, marginTop: 1 }}>{officer.device_model}</div>}
        </td>
        <td style={{ padding: '8px 10px' }}><StatusPill status={officer.status} /></td>
        <td style={{ padding: '8px 10px' }}>
          <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: C.mid }}>{officer.zone || '—'}</div>
          {officer.route && <div style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: C.sub }}>{officer.route}</div>}
        </td>
        <td style={{ padding: '8px 10px' }}>
          {officer.gps_lat ? (
            <>
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: C.txt }}>{Number(officer.gps_lat).toFixed(4)}, {Number(officer.gps_lng).toFixed(4)}</div>
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: C.sub, marginTop: 1 }}>{fmtRel(officer.last_gps_at || officer.last_seen_at)}</div>
            </>
          ) : <span style={{ color: C.sub, fontSize: 10 }}>—</span>}
        </td>
        <td style={{ padding: '8px 10px' }}>
          <HealthBars battery={officer.battery_pct} signal={officer.signal_pct} gpsLocked={officer.gps_locked} />
        </td>
        <td style={{ padding: '8px 10px', textAlign: 'center' }}>
          <span style={{ fontFamily: 'JetBrains Mono', fontSize: 11, fontWeight: 700, color: C.blue }}>{officer.missions_total ?? 0}</span>
        </td>
        <td style={{ padding: '8px 10px' }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', gap: 4 }}>
            {actions.map(([label, color, primary]) => (
              <button key={label} style={{ background: primary ? color : `${color}18`, border: `1px solid ${color}${primary ? '' : '40'}`, borderRadius: 3, padding: '3px 7px', fontSize: 9, fontFamily: 'JetBrains Mono', fontWeight: 700, color: primary ? '#fff' : color, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                {label}
              </button>
            ))}
          </div>
        </td>
      </tr>
      {expanded && <ExpandedRow officer={officer} onRefresh={onRefresh} />}
    </>
  );
}

function OfficerTable({ officers, expandedId, setExpandedId, onRefresh }) {
  const thStyle = { padding: '6px 10px', fontFamily: 'Barlow Condensed', fontWeight: 700, fontSize: 10, color: C.sub, textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: `1px solid ${C.border}`, textAlign: 'left', whiteSpace: 'nowrap' };
  if (!officers.length) return (
    <div style={{ textAlign: 'center', padding: '32px 0', color: C.sub, fontFamily: 'JetBrains Mono', fontSize: 11 }}>No officers match filters</div>
  );
  return (
    <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: C.panel }}>
            <th style={{ ...thStyle, width: 24 }} />
            <th style={thStyle}>Officer</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Zone / Route</th>
            <th style={thStyle}>Last GPS</th>
            <th style={thStyle}>Health</th>
            <th style={{ ...thStyle, textAlign: 'center' }}>Missions</th>
            <th style={thStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {officers.map(o => (
            <OfficerRow key={o.id} officer={o} expanded={expandedId === o.id}
              onToggle={id => setExpandedId(prev => prev === id ? null : id)} onRefresh={onRefresh} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function FieldOfficersPage() {
  const [officers, setOfficers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: '', zone: '', search: '' });
  const [expandedId, setExpandedId] = useState(null);

  function loadOfficers() {
    setLoading(true);
    const params = {};
    if (filters.status) params.status = filters.status;
    if (filters.zone) params.zone = filters.zone;
    api.get('/field-officers', { params })
      .then(r => setOfficers(r.data?.data || r.data || []))
      .catch(() => toast.error('Failed to load officers'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadOfficers(); }, [filters.status, filters.zone]);

  useEffect(() => {
    const handler = () => loadOfficers();
    socketService.on('officer:updated', handler);
    return () => socketService.off('officer:updated', handler);
  }, []);

  const sorted = [...officers].sort((a, b) => (STATUS_ORDER[a.status] ?? 4) - (STATUS_ORDER[b.status] ?? 4));

  const filtered = sorted.filter(o => {
    if (filters.search) {
      const q = filters.search.toLowerCase();
      return o.name?.toLowerCase().includes(q) || o.badge_number?.toLowerCase().includes(q) || o.phone?.includes(q);
    }
    return true;
  });

  return (
    <div style={{ padding: 16, background: C.bg, minHeight: '100vh', fontFamily: 'Inter, sans-serif', fontSize: 12 }}>
      <style>{`@keyframes sosPulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(1.3)} }`}</style>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontFamily: 'Barlow Condensed', fontWeight: 800, fontSize: 20, color: C.gold, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>FIELD OFFICERS</h1>
          <p style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: C.sub, margin: '2px 0 0' }}>
            {officers.length} OFFICERS TOTAL · {officers.filter(o => o.status === 'available').length} AVAILABLE · {officers.filter(o => o.status === 'sos').length} SOS
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[['AVAILABLE', officers.filter(o => o.status === 'available').length, C.green],
            ['ON MISSION', officers.filter(o => o.status === 'on_mission').length, C.amber],
            ['SOS', officers.filter(o => o.status === 'sos').length, C.red],
            ['OFFLINE', officers.filter(o => o.status === 'offline').length, C.dim],
          ].map(([label, count, color]) => (
            <div key={label} style={{ background: `${color}18`, border: `1px solid ${color}40`, borderRadius: 4, padding: '4px 10px', textAlign: 'center' }}>
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: 14, fontWeight: 700, color, lineHeight: 1 }}>{count}</div>
              <div style={{ fontFamily: 'Barlow Condensed', fontSize: 9, color: C.sub, letterSpacing: '0.08em' }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      <SosStrip officers={officers} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 12 }}>
        <div>
          <MapPanel officers={officers} />

          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {['', 'available', 'on_mission', 'sos', 'offline'].map(s => (
              <button key={s} onClick={() => setFilters(f => ({ ...f, status: s }))}
                style={{ padding: '4px 10px', borderRadius: 3, border: `1px solid ${filters.status === s ? C.gold + '60' : C.border}`, background: filters.status === s ? `${C.gold}14` : C.surf, color: filters.status === s ? C.gold : C.mid, fontSize: 10, fontFamily: 'JetBrains Mono', cursor: 'pointer', fontWeight: 600 }}>
                {s || 'ALL'}
              </button>
            ))}
            <input value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
              placeholder="Search name / badge / phone…"
              style={{ marginLeft: 'auto', background: C.surf, border: `1px solid ${C.border}`, borderRadius: 4, padding: '4px 10px', fontSize: 11, color: C.txt, outline: 'none', width: 200, fontFamily: 'Inter' }} />
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: C.sub, fontFamily: 'JetBrains Mono', fontSize: 11 }}>Loading…</div>
          ) : (
            <OfficerTable officers={filtered} expandedId={expandedId} setExpandedId={setExpandedId} onRefresh={loadOfficers} />
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <ActivityFeed />
          <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12 }}>
            <div style={{ fontFamily: 'Barlow Condensed', fontSize: 12, fontWeight: 700, color: C.gold, letterSpacing: '0.08em', marginBottom: 8 }}>SHIFT STATS</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[['Missions Today', officers.reduce((s, o) => s + (o.missions_total || 0), 0), C.blue],
                ['Check-in Rate', officers.length ? Math.round(officers.reduce((s, o) => s + (o.checkin_rate || 0), 0) / officers.length) + '%' : '—', C.green],
                ['SOS Events', officers.reduce((s, o) => s + (o.sos_events_total || 0), 0), C.red],
                ['Seals Verified', officers.reduce((s, o) => s + (o.seals_verified || 0), 0), C.amber],
              ].map(([label, val, color]) => (
                <div key={label} style={{ background: C.panel, borderRadius: 4, padding: '8px 10px' }}>
                  <div style={{ fontFamily: 'JetBrains Mono', fontSize: 16, fontWeight: 700, color, lineHeight: 1 }}>{val}</div>
                  <div style={{ fontFamily: 'Inter', fontSize: 10, color: C.sub, marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
