import { useState, useEffect, useCallback } from 'react';
import { MapPin, ChevronRight, AlertOctagon } from 'lucide-react';
import { api } from '../lib/api.js';
import { subscribe } from '../lib/centrifuge.js';
import { useAuthStore } from '../stores/auth.js';

const C = {
  bg:'#080C14', surf:'#0D1420', panel:'#111827', border:'#1E2D40',
  gold:'#F0B429', green:'#22c55e', red:'#ef4444', amber:'#f59e0b', blue:'#3b82f6',
  cyan:'#06b6d4', dim:'#374151', sub:'#6b7280', mid:'#94a3b8', txt:'#cbd5e1', hi:'#f1f5f9',
};

const STATUS_COLOR: Record<string, string> = {
  available: C.green, on_mission: C.amber, sos: C.red, offline: C.dim,
};
const STATUS_ORDER: Record<string, number> = { sos: 0, on_mission: 1, available: 2, offline: 3 };

interface FieldOfficer {
  id: string; name: string; badge_number?: string; badge?: string; phone?: string;
  zone?: string; route?: string; rank?: string; status: string;
  gps_lat?: number; gps_lng?: number; gps_locked?: boolean;
  battery_pct?: number; signal_pct?: number;
  missions_total?: number; checkin_rate?: number; sos_events_total?: number; seals_verified?: number;
  shift_start?: string; last_seen_at?: string; last_gps_at?: string;
  device_model?: string; device_imei?: string; app_version?: string;
  android_version?: string; knox_version?: string;
}

interface ActivityEvent { id?: string; type?: string; event?: string; created_at?: string; ts?: string; }

function fmtRel(ts?: string | null): string {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function StatusPill({ status }: { status: string }) {
  const c = STATUS_COLOR[status] || C.sub;
  return (
    <span style={{ background: `${c}20`, border: `1px solid ${c}50`, borderRadius: 3, padding: '2px 7px', fontSize: 9, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: c, letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
      {status?.replace('_', ' ') || 'unknown'}
    </span>
  );
}

function HealthBars({ battery, signal, gpsLocked }: { battery?: number; signal?: number; gpsLocked?: boolean }) {
  const bars = [
    { label: 'BAT', val: battery ?? 0, color: (battery ?? 0) < 20 ? C.red : (battery ?? 0) < 50 ? C.amber : C.green },
    { label: 'SIG', val: signal ?? 0, color: (signal ?? 0) < 30 ? C.red : C.green },
    { label: 'GPS', val: gpsLocked ? 100 : 0, color: gpsLocked ? C.green : C.sub },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: 70 }}>
      {bars.map(({ label, val, color }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 8, color: C.sub, width: 22, flexShrink: 0 }}>{label}</span>
          <div style={{ flex: 1, height: 4, background: C.panel, borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${val}%`, height: '100%', background: color, borderRadius: 2 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function SosStrip({ officers }: { officers: FieldOfficer[] }) {
  const sos = officers.filter(o => o.status === 'sos');
  if (!sos.length) return null;
  const top = sos[0];
  return (
    <div style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 6, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.red, animation: 'sosPulse 1s infinite', flexShrink: 0 }} />
      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 700, color: C.red, letterSpacing: '0.1em' }}>
        SOS — {top.name} · {top.badge_number || top.badge || '—'}
      </span>
      {top.gps_lat != null && <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: C.mid }}>{Number(top.gps_lat).toFixed(4)}, {Number(top.gps_lng).toFixed(4)}</span>}
      {top.battery_pct != null && <span style={{ color: C.amber, fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}>BAT {top.battery_pct}%</span>}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
        <button style={{ background: C.red, color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace' }}>CALL NOW</button>
        <button style={{ background: 'rgba(239,68,68,0.15)', color: C.red, border: `1px solid ${C.red}40`, borderRadius: 4, padding: '4px 12px', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace' }}>DISPATCH</button>
      </div>
      {sos.length > 1 && <span style={{ fontSize: 10, color: C.red, fontFamily: 'JetBrains Mono, monospace' }}>+{sos.length - 1} more</span>}
    </div>
  );
}

function ExpandedRow({ officer }: { officer: FieldOfficer }) {
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  useEffect(() => {
    api.get<{ data?: ActivityEvent[] } | ActivityEvent[]>(`/field-officers/${officer.id}/activity`, { params: { limit: 5 } })
      .then(r => { const d = r.data; setActivity(Array.isArray(d) ? d : (d?.data ?? [])); })
      .catch(() => {});
  }, [officer.id]);
  const badge = officer.badge_number || officer.badge || '—';
  const imei = officer.device_imei ? `${officer.device_imei.slice(0, 4)}…${officer.device_imei.slice(-4)}` : '—';
  return (
    <tr>
      <td colSpan={8} style={{ background: C.panel, padding: '12px 16px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
          {[
            ['PROFILE', [['Badge', badge], ['Phone', officer.phone || '—'], ['Zone', officer.zone || '—'], ['Route', officer.route || '—'], ['Rank', officer.rank || '—']]],
            ['DEVICE', [['Model', officer.device_model || '—'], ['IMEI', imei], ['App Ver', officer.app_version || '—'], ['Android', officer.android_version || '—'], ['Knox', officer.knox_version || '—']]],
            ['PERFORMANCE', [['Missions', String(officer.missions_total ?? '—')], ['Check-in Rate', officer.checkin_rate != null ? `${officer.checkin_rate}%` : '—'], ['SOS Events', String(officer.sos_events_total ?? 0)], ['Seals Verified', String(officer.seals_verified ?? 0)], ['Shift Start', officer.shift_start ? fmtRel(officer.shift_start) : '—']]],
          ].map(([title, rows]) => (
            <div key={String(title)}>
              <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 10, color: C.gold, letterSpacing: '0.08em', marginBottom: 6, textTransform: 'uppercase' }}>{String(title)}</div>
              {(rows as [string, string][]).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: C.sub, fontSize: 10 }}>{k}</span>
                  <span style={{ color: C.txt, fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}>{v}</span>
                </div>
              ))}
            </div>
          ))}
          <div>
            <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 10, color: C.gold, letterSpacing: '0.08em', marginBottom: 6 }}>RECENT ACTIVITY</div>
            {activity.length === 0
              ? <div style={{ color: C.sub, fontSize: 10 }}>No recent events</div>
              : activity.slice(0, 5).map((ev, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 5 }}>
                  <div style={{ width: 4, height: 4, borderRadius: '50%', background: C.blue, marginTop: 4, flexShrink: 0 }} />
                  <div>
                    <div style={{ color: C.txt, fontSize: 10 }}>{ev.type || ev.event}</div>
                    <div style={{ color: C.sub, fontSize: 9, fontFamily: 'JetBrains Mono, monospace' }}>{fmtRel(ev.created_at || ev.ts)}</div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </td>
    </tr>
  );
}

const ACTION_MAP: Record<string, [string, string, boolean][]> = {
  sos:        [['CALL NOW', C.red, true], ['TRACK', C.amber, false], ['DISPATCH', C.gold, false]],
  on_mission: [['TRACK LIVE', C.gold, false], ['MESSAGE', C.blue, false], ['REPORT', C.mid, false]],
  available:  [['ASSIGN', C.gold, false], ['MESSAGE', C.blue, false], ['PROFILE', C.mid, false]],
  offline:    [['PING', C.amber, false], ['MESSAGE', C.blue, false], ['PROFILE', C.mid, false]],
};

export default function FieldOfficers() {
  const user = useAuthStore(s => s.user);
  const [officers, setOfficers] = useState<FieldOfficer[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: '', search: '' });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<{ label: string; ts: string }[]>([]);

  const load = useCallback(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (filters.status) params['status'] = filters.status;
    api.get<{ data?: FieldOfficer[] } | FieldOfficer[]>('/field-officers', { params })
      .then(r => { const d = r.data; setOfficers(Array.isArray(d) ? d : (d?.data ?? [])); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filters.status]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!user?.org_id) return;
    return subscribe<{ type?: string; officer_id?: string; label?: string }>(`org#${user.org_id}`, (msg) => {
      if (msg.type === 'officer:updated') load();
      if (msg.label) setLiveEvents(prev => [{ label: msg.label!, ts: new Date().toISOString() }, ...prev].slice(0, 20));
    });
  }, [user?.org_id, load]);

  const sorted = [...officers].sort((a, b) => (STATUS_ORDER[a.status] ?? 4) - (STATUS_ORDER[b.status] ?? 4));
  const filtered = filters.search
    ? sorted.filter(o => {
        const q = filters.search.toLowerCase();
        return o.name?.toLowerCase().includes(q) || o.badge_number?.toLowerCase().includes(q) || o.phone?.includes(q);
      })
    : sorted;

  const thS = { padding: '6px 10px', fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 10, color: C.sub, textTransform: 'uppercase' as const, letterSpacing: '0.08em', borderBottom: `1px solid ${C.border}`, textAlign: 'left' as const, whiteSpace: 'nowrap' as const };

  return (
    <div style={{ padding: 16, background: C.bg, minHeight: '100vh', fontFamily: 'Inter, sans-serif', fontSize: 12 }}>
      <style>{`@keyframes sosPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.3)}}`}</style>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 800, fontSize: 20, color: C.gold, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>FIELD OFFICERS</h1>
          <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: C.sub, margin: '2px 0 0' }}>
            {officers.length} OFFICERS · {officers.filter(o => o.status === 'available').length} AVAILABLE · {officers.filter(o => o.status === 'sos').length} SOS
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {([['AVAILABLE', C.green], ['ON MISSION', C.amber], ['SOS', C.red], ['OFFLINE', C.dim]] as [string, string][]).map(([label, color]) => {
            const count = officers.filter(o => o.status === label.toLowerCase().replace(' ', '_')).length;
            return (
              <div key={label} style={{ background: `${color}18`, border: `1px solid ${color}40`, borderRadius: 4, padding: '4px 10px', textAlign: 'center' }}>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 14, fontWeight: 700, color, lineHeight: 1 }}>{count}</div>
                <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: 9, color: C.sub, letterSpacing: '0.08em' }}>{label}</div>
              </div>
            );
          })}
        </div>
      </div>

      <SosStrip officers={officers} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 12 }}>
        <div>
          <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 6, height: 120, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <MapPin size={18} style={{ color: C.gold, marginBottom: 4 }} />
              <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 11, color: C.gold, letterSpacing: '0.1em' }}>GPS MAP</div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: C.sub, marginTop: 2 }}>{officers.filter(o => o.gps_lat).length} officers with GPS fix</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {['', 'available', 'on_mission', 'sos', 'offline'].map(s => (
              <button key={s} onClick={() => setFilters(f => ({ ...f, status: s }))}
                style={{ padding: '4px 10px', borderRadius: 3, border: `1px solid ${filters.status === s ? C.gold + '60' : C.border}`, background: filters.status === s ? `${C.gold}14` : C.surf, color: filters.status === s ? C.gold : C.mid, fontSize: 10, fontFamily: 'JetBrains Mono, monospace', cursor: 'pointer', fontWeight: 600 }}>
                {s || 'ALL'}
              </button>
            ))}
            <input value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
              placeholder="Search name / badge…"
              style={{ marginLeft: 'auto', background: C.surf, border: `1px solid ${C.border}`, borderRadius: 4, padding: '4px 10px', fontSize: 11, color: C.txt, outline: 'none', width: 180, fontFamily: 'Inter, sans-serif' }} />
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: C.sub, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>Loading…</div>
          ) : (
            <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: C.panel }}>
                    <th style={{ ...thS, width: 24 }} /><th style={thS}>Officer</th><th style={thS}>Status</th>
                    <th style={thS}>Zone</th><th style={thS}>Last GPS</th><th style={thS}>Health</th>
                    <th style={{ ...thS, textAlign: 'center' }}>Missions</th><th style={thS}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(o => {
                    const exp = expandedId === o.id;
                    const sc = STATUS_COLOR[o.status] || C.sub;
                    const actions = ACTION_MAP[o.status] || ACTION_MAP['offline'];
                    return (
                      <>
                        <tr key={o.id} style={{ borderBottom: `1px solid ${C.border}`, background: exp ? C.panel : 'transparent', cursor: 'pointer' }}
                          onClick={() => setExpandedId(prev => prev === o.id ? null : o.id)}>
                          <td style={{ padding: '8px 10px' }}><ChevronRight size={12} style={{ color: C.sub, transform: exp ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} /></td>
                          <td style={{ padding: '8px 10px' }}>
                            <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: C.hi }}>{o.name || '—'}</div>
                            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: C.sub }}>{o.badge_number || o.badge || '—'}</div>
                          </td>
                          <td style={{ padding: '8px 10px' }}><StatusPill status={o.status} /></td>
                          <td style={{ padding: '8px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: C.mid }}>{o.zone || '—'}</td>
                          <td style={{ padding: '8px 10px' }}>
                            {o.gps_lat != null
                              ? <><div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: C.txt }}>{Number(o.gps_lat).toFixed(4)}, {Number(o.gps_lng).toFixed(4)}</div><div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: C.sub }}>{fmtRel(o.last_gps_at || o.last_seen_at)}</div></>
                              : <span style={{ color: C.sub, fontSize: 10 }}>—</span>}
                          </td>
                          <td style={{ padding: '8px 10px' }}><HealthBars battery={o.battery_pct} signal={o.signal_pct} gpsLocked={o.gps_locked} /></td>
                          <td style={{ padding: '8px 10px', textAlign: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 700, color: C.blue }}>{o.missions_total ?? 0}</td>
                          <td style={{ padding: '8px 10px' }} onClick={e => e.stopPropagation()}>
                            <div style={{ display: 'flex', gap: 4 }}>
                              {actions.map(([label, color, primary]) => (
                                <button key={label} style={{ background: primary ? color : `${color}18`, border: `1px solid ${primary ? color : color + '40'}`, borderRadius: 3, padding: '3px 7px', fontSize: 9, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: primary ? '#fff' : color, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                  {label}
                                </button>
                              ))}
                            </div>
                          </td>
                        </tr>
                        {exp && <ExpandedRow key={`exp-${o.id}`} officer={o} />}
                      </>
                    );
                  })}
                  {!filtered.length && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24, color: C.sub, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>No officers match filters</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12 }}>
            <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 12, color: C.gold, letterSpacing: '0.08em', marginBottom: 8 }}>LIVE ACTIVITY</div>
            {liveEvents.length === 0
              ? <div style={{ color: C.sub, fontSize: 10 }}>Waiting for events…</div>
              : liveEvents.map((ev, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: C.gold, marginTop: 3, flexShrink: 0 }} />
                  <div>
                    <div style={{ color: C.txt, fontSize: 10 }}>{ev.label}</div>
                    <div style={{ color: C.sub, fontSize: 9, fontFamily: 'JetBrains Mono, monospace' }}>{fmtRel(ev.ts)}</div>
                  </div>
                </div>
              ))}
          </div>
          <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12 }}>
            <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: 12, fontWeight: 700, color: C.gold, letterSpacing: '0.08em', marginBottom: 8 }}>SHIFT STATS</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {([
                ['Missions Today', officers.reduce((s, o) => s + (o.missions_total || 0), 0), C.blue],
                ['Avg Check-in', officers.length ? Math.round(officers.reduce((s, o) => s + (o.checkin_rate || 0), 0) / officers.length) + '%' : '—', C.green],
                ['SOS Events', officers.reduce((s, o) => s + (o.sos_events_total || 0), 0), C.red],
                ['Seals Verified', officers.reduce((s, o) => s + (o.seals_verified || 0), 0), C.amber],
              ] as [string, number | string, string][]).map(([label, val, color]) => (
                <div key={label} style={{ background: C.panel, borderRadius: 4, padding: '8px 10px' }}>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 16, fontWeight: 700, color, lineHeight: 1 }}>{val}</div>
                  <div style={{ fontSize: 10, color: C.sub, marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
