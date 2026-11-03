import { useState, useEffect } from 'react';
import { Smartphone, ChevronRight, Bell, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import socketService from '../services/socket';
import { useNavigate } from 'react-router-dom';

const C = {
  bg:'#080C14', surf:'#0D1420', panel:'#111827', border:'#1E2D40', border2:'#243650',
  gold:'#F0B429', green:'#22c55e', red:'#ef4444', amber:'#f59e0b', blue:'#3b82f6',
  cyan:'#06b6d4', purple:'#a855f7', dim:'#374151', muted:'#4b5563', sub:'#6b7280',
  mid:'#94a3b8', txt:'#cbd5e1', hi:'#f1f5f9',
};

const DEVICE_STATUS_COLOR = { active: C.green, inactive: C.sub, offline: C.dim, enrolled: C.amber };

function fmtRel(ts) {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

function StatusPill({ status }) {
  const c = DEVICE_STATUS_COLOR[status] || C.sub;
  return (
    <span style={{ background: `${c}20`, border: `1px solid ${c}50`, borderRadius: 3, padding: '2px 7px', fontSize: 9, fontFamily: 'JetBrains Mono', fontWeight: 700, color: c, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
      {status || 'unknown'}
    </span>
  );
}

function HealthBars({ battery, signal }) {
  const bars = [
    { label: 'BAT', val: battery, color: battery < 20 ? C.red : battery < 50 ? C.amber : C.green },
    { label: 'SIG', val: signal, color: signal < 30 ? C.red : C.green },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: 60 }}>
      {bars.map(({ label, val, color }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontFamily: 'JetBrains Mono', fontSize: 8, color: C.sub, width: 22, flexShrink: 0 }}>{label}</span>
          <div style={{ flex: 1, height: 4, background: C.panel, borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${val ?? 0}%`, height: '100%', background: color, borderRadius: 2 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function DeviceExpandedRow({ device }) {
  const batLabel = device.battery_pct > 50 ? 'Good' : device.battery_pct > 20 ? 'Low' : 'Critical';
  const batColor = device.battery_pct > 50 ? C.green : device.battery_pct > 20 ? C.amber : C.red;
  const cmds = device.device_commands || [];
  const maskedImei = device.imei ? `${device.imei.slice(0, 2)}${'*'.repeat(device.imei.length - 6)}${device.imei.slice(-4)}` : '—';
  return (
    <tr>
      <td colSpan={7} style={{ background: C.panel, padding: '12px 16px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div>
            <div style={{ fontFamily: 'Barlow Condensed', fontWeight: 700, fontSize: 10, color: C.gold, letterSpacing: '0.08em', marginBottom: 6 }}>DEVICE INFO</div>
            {[['IMEI', maskedImei], ['Model', device.model || '—'], ['Android', device.android_version || '—'], ['Knox', device.knox_version || '—'], ['App', device.app_version || '—']].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: C.sub, fontSize: 10, fontFamily: 'Inter' }}>{k}</span>
                <span style={{ color: C.txt, fontSize: 10, fontFamily: 'JetBrains Mono' }}>{v}</span>
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontFamily: 'Barlow Condensed', fontWeight: 700, fontSize: 10, color: C.gold, letterSpacing: '0.08em', marginBottom: 6 }}>TELEMETRY</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: C.sub, fontSize: 10, fontFamily: 'Inter' }}>Battery</span>
              <span style={{ color: batColor, fontSize: 10, fontFamily: 'JetBrains Mono', fontWeight: 700 }}>{device.battery_pct ?? '—'}% ({batLabel})</span>
            </div>
            {[['Signal', `${device.signal_pct ?? '—'}%`], ['GPS', device.gps_locked ? 'Locked' : 'Searching'], ['Last Seen', fmtRel(device.last_seen_at)]].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: C.sub, fontSize: 10, fontFamily: 'Inter' }}>{k}</span>
                <span style={{ color: C.txt, fontSize: 10, fontFamily: 'JetBrains Mono' }}>{v}</span>
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontFamily: 'Barlow Condensed', fontWeight: 700, fontSize: 10, color: C.gold, letterSpacing: '0.08em', marginBottom: 6 }}>COMMAND HISTORY</div>
            {cmds.length === 0 ? <div style={{ color: C.sub, fontSize: 10 }}>No commands issued</div> : cmds.slice(0, 5).map((c, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: C.txt }}>{c.command || c.type}</div>
                  <div style={{ fontFamily: 'JetBrains Mono', fontSize: 8, color: C.sub }}>{fmtRel(c.created_at)}</div>
                </div>
                <span style={{ fontSize: 9, fontFamily: 'JetBrains Mono', color: c.status === 'executed' ? C.green : c.status === 'failed' ? C.red : C.amber }}>{c.status}</span>
              </div>
            ))}
          </div>
        </div>
      </td>
    </tr>
  );
}

function DeviceMatrix({ devices }) {
  const [expandedId, setExpandedId] = useState(null);
  const navigate = useNavigate();
  const thStyle = { padding: '6px 10px', fontFamily: 'Barlow Condensed', fontWeight: 700, fontSize: 10, color: C.sub, textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: `1px solid ${C.border}`, textAlign: 'left', whiteSpace: 'nowrap' };

  return (
    <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'auto', maxHeight: '80vh' }}>
      <div style={{ padding: '10px 12px', borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontFamily: 'Barlow Condensed', fontWeight: 700, fontSize: 13, color: C.gold, letterSpacing: '0.08em' }}>DEVICE MATRIX</span>
        <span style={{ marginLeft: 8, fontFamily: 'JetBrains Mono', fontSize: 10, color: C.sub }}>{devices.length} enrolled</span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: C.panel }}>
            <th style={{ ...thStyle, width: 24 }} />
            <th style={thStyle}>Device / Officer</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Health</th>
            <th style={thStyle}>Last Seen</th>
            <th style={thStyle}>App Ver</th>
            <th style={thStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {devices.map(d => {
            const expanded = expandedId === d.id;
            return (
              <>
                <tr key={d.id} style={{ borderBottom: `1px solid ${C.border}`, background: expanded ? C.panel : 'transparent', cursor: 'pointer' }}
                  onClick={() => setExpandedId(prev => prev === d.id ? null : d.id)}>
                  <td style={{ padding: '8px 10px' }}>
                    <ChevronRight size={12} style={{ color: C.sub, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <div style={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 600, color: C.hi }}>{d.officer_name || d.assigned_to || '—'}</div>
                    <div style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: C.sub }}>{d.model || d.device_model || '—'}</div>
                  </td>
                  <td style={{ padding: '8px 10px' }}><StatusPill status={d.status} /></td>
                  <td style={{ padding: '8px 10px' }}><HealthBars battery={d.battery_pct} signal={d.signal_pct} /></td>
                  <td style={{ padding: '8px 10px', fontFamily: 'JetBrains Mono', fontSize: 10, color: C.mid }}>{fmtRel(d.last_seen_at)}</td>
                  <td style={{ padding: '8px 10px', fontFamily: 'JetBrains Mono', fontSize: 10, color: C.mid }}>{d.app_version || '—'}</td>
                  <td style={{ padding: '8px 10px' }} onClick={e => e.stopPropagation()}>
                    {d.knox_do_enrolled && (
                      <button onClick={() => navigate(`/guardian/devices/${d.id}/remote`)}
                        style={{ background: `${C.cyan}18`, border: `1px solid ${C.cyan}40`, borderRadius: 3, padding: '3px 8px', color: C.cyan, fontSize: 9, fontFamily: 'JetBrains Mono', fontWeight: 700, cursor: 'pointer' }}>
                        REMOTE
                      </button>
                    )}
                  </td>
                </tr>
                {expanded && <DeviceExpandedRow key={`exp-${d.id}`} device={d} />}
              </>
            );
          })}
          {devices.length === 0 && (
            <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: C.sub, fontFamily: 'JetBrains Mono', fontSize: 11 }}>No devices enrolled</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const COMMANDS = [
  { id: 'request_location', label: 'Request Location', desc: 'Get current GPS fix', color: C.gold },
  { id: 'trigger_siren', label: 'Trigger Siren', desc: 'Sound alarm on device', color: C.red, confirm: true },
  { id: 'lock_screen', label: 'Lock Screen', desc: 'Lock device screen', color: C.blue, confirm: true },
  { id: 'force_checkin', label: 'Force Check-In', desc: 'Request field check-in', color: C.amber },
  { id: 'restart_app', label: 'Restart App', desc: 'Restart Guardian service', color: C.green },
  { id: 'remote_wipe', label: 'Remote Wipe', desc: 'Factory wipe device', color: C.red, confirm: true, dangerous: true },
];

function CommandTerminal({ devices }) {
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [selectedCommand, setSelectedCommand] = useState(null);
  const [sending, setSending] = useState(false);

  async function issueCommand() {
    if (!selectedDeviceId || !selectedCommand) return;
    if (selectedCommand.confirm && !window.confirm(`Execute ${selectedCommand.label}?`)) return;
    setSending(true);
    try {
      if (selectedDeviceId === 'all_active') {
        await api.post('/guardian/commands/broadcast', { command: selectedCommand.id });
        toast.success(`Broadcast: ${selectedCommand.label}`);
      } else {
        await api.post(`/guardian/devices/${selectedDeviceId}/commands`, { command: selectedCommand.id });
        toast.success(`Command issued: ${selectedCommand.label}`);
      }
      setSelectedCommand(null);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Command failed');
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12 }}>
      <div style={{ fontFamily: 'Barlow Condensed', fontWeight: 700, fontSize: 13, color: C.gold, letterSpacing: '0.08em', marginBottom: 10 }}>COMMAND TERMINAL</div>
      <select value={selectedDeviceId} onChange={e => setSelectedDeviceId(e.target.value)}
        style={{ width: '100%', background: C.panel, border: `1px solid ${C.border}`, borderRadius: 4, padding: '6px 10px', fontSize: 11, color: C.txt, outline: 'none', marginBottom: 10, fontFamily: 'Inter' }}>
        <option value="">— Select Device —</option>
        <option value="all_active">ALL ACTIVE DEVICES (broadcast)</option>
        {devices.map(d => <option key={d.id} value={d.id}>{d.officer_name || d.assigned_to || d.id} — {d.model || '?'}</option>)}
      </select>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
        {COMMANDS.filter(c => !(selectedDeviceId === 'all_active' && c.dangerous)).map(cmd => (
          <button key={cmd.id} onClick={() => setSelectedCommand(prev => prev?.id === cmd.id ? null : cmd)}
            style={{ background: selectedCommand?.id === cmd.id ? `${cmd.color}25` : `${cmd.color}10`, border: `1px solid ${selectedCommand?.id === cmd.id ? cmd.color + '70' : cmd.color + '30'}`, borderRadius: 4, padding: '6px 8px', textAlign: 'left', cursor: 'pointer' }}>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, fontWeight: 700, color: cmd.color }}>{cmd.label}</div>
            <div style={{ fontFamily: 'Inter', fontSize: 9, color: C.sub, marginTop: 1 }}>{cmd.desc}</div>
          </button>
        ))}
      </div>
      <button onClick={issueCommand} disabled={!selectedDeviceId || !selectedCommand || sending}
        style={{ width: '100%', background: selectedDeviceId && selectedCommand ? C.gold : C.dim, border: 'none', borderRadius: 4, padding: '8px', fontFamily: 'Barlow Condensed', fontWeight: 800, fontSize: 13, letterSpacing: '0.08em', color: selectedDeviceId && selectedCommand ? '#000' : C.sub, cursor: selectedDeviceId && selectedCommand ? 'pointer' : 'not-allowed' }}>
        {sending ? 'SENDING…' : 'EXECUTE COMMAND'}
      </button>
    </div>
  );
}

function CommandQueue() {
  const [commands, setCommands] = useState([]);
  useEffect(() => {
    api.get('/guardian/command-queue').then(r => setCommands(r.data?.data || r.data || [])).catch(() => {});
    const handler = (data) => setCommands(prev => [data, ...prev].slice(0, 30));
    socketService.on('command:queued', handler);
    return () => socketService.off('command:queued', handler);
  }, []);

  function cancelCmd(cid) {
    api.delete(`/guardian/command-queue/${cid}`)
      .then(() => { setCommands(prev => prev.filter(c => c.id !== cid)); toast.success('Command cancelled'); })
      .catch(() => toast.error('Failed to cancel'));
  }

  const statusColor = { pending: C.amber, executed: C.green, expired: C.sub, failed: C.red };

  return (
    <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12 }}>
      <div style={{ fontFamily: 'Barlow Condensed', fontWeight: 700, fontSize: 13, color: C.gold, letterSpacing: '0.08em', marginBottom: 8 }}>COMMAND QUEUE</div>
      {commands.length === 0 ? (
        <div style={{ color: C.sub, fontSize: 10, fontFamily: 'Inter' }}>No pending commands</div>
      ) : commands.slice(0, 10).map((cmd, i) => {
        const sc = statusColor[cmd.status] || C.mid;
        return (
          <div key={cmd.id || i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: `1px solid ${C.border}` }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: sc, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: C.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cmd.command || cmd.type}</div>
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: C.sub }}>{cmd.device_name || cmd.device_id?.slice(0, 8)}</div>
            </div>
            <span style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: sc, fontWeight: 700 }}>{cmd.status}</span>
            {cmd.status === 'pending' && (
              <button onClick={() => cancelCmd(cmd.id)} style={{ background: `${C.red}15`, border: `1px solid ${C.red}30`, borderRadius: 2, padding: '2px 6px', color: C.red, fontSize: 8, fontFamily: 'JetBrains Mono', cursor: 'pointer' }}>✕</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AlertRules() {
  const [rules, setRules] = useState([]);
  useEffect(() => {
    api.get('/guardian/alert-rules').then(r => setRules(r.data?.data || r.data || [])).catch(() => {});
  }, []);

  function toggle(rule) {
    const prev = rule.enabled;
    setRules(rs => rs.map(r => r.id === rule.id ? { ...r, enabled: !prev } : r));
    api.put(`/guardian/alert-rules/${rule.id}`, { enabled: !prev })
      .catch(() => {
        setRules(rs => rs.map(r => r.id === rule.id ? { ...r, enabled: prev } : r));
        toast.error('Failed to update rule');
      });
  }

  return (
    <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12 }}>
      <div style={{ fontFamily: 'Barlow Condensed', fontWeight: 700, fontSize: 13, color: C.gold, letterSpacing: '0.08em', marginBottom: 8 }}>ALERT RULES</div>
      {rules.length === 0 ? (
        <div style={{ color: C.sub, fontSize: 10, fontFamily: 'Inter' }}>No alert rules configured</div>
      ) : rules.map((rule, i) => (
        <div key={rule.id || i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: `1px solid ${C.border}` }}>
          <Bell size={11} style={{ color: rule.enabled ? C.amber : C.sub, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'Inter', fontSize: 10, color: C.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rule.name || rule.type}</div>
            {rule.description && <div style={{ fontFamily: 'Inter', fontSize: 9, color: C.sub }}>{rule.description}</div>}
          </div>
          <button onClick={() => toggle(rule)}
            style={{ width: 32, height: 16, borderRadius: 8, background: rule.enabled ? `${C.green}40` : C.panel, border: `1px solid ${rule.enabled ? C.green : C.border}`, cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: rule.enabled ? C.green : C.sub, position: 'absolute', top: 2, left: rule.enabled ? 18 : 2, transition: 'left 0.2s' }} />
          </button>
        </div>
      ))}
    </div>
  );
}

function SystemAuditFeed() {
  const [events, setEvents] = useState([]);
  useEffect(() => {
    const handler = (ev) => setEvents(prev => [{ ...ev, ts: new Date().toISOString() }, ...prev].slice(0, 20));
    socketService.on('guardian:audit', handler);
    socketService.on('system:audit', handler);
    return () => { socketService.off('guardian:audit', handler); socketService.off('system:audit', handler); };
  }, []);

  return (
    <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12, flex: 1 }}>
      <div style={{ fontFamily: 'Barlow Condensed', fontWeight: 700, fontSize: 13, color: C.gold, letterSpacing: '0.08em', marginBottom: 8 }}>SYSTEM AUDIT</div>
      {events.length === 0 ? (
        <div style={{ color: C.sub, fontSize: 10, fontFamily: 'Inter' }}>Listening for audit events…</div>
      ) : events.map((ev, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          <div style={{ width: 4, height: 4, borderRadius: '50%', background: C.purple, marginTop: 4, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'Inter', fontSize: 10, color: C.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.action || ev.message || ev.type}</div>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: C.sub }}>{ev.ts ? new Date(ev.ts).toLocaleTimeString() : '—'}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function GuardianManagementPage() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/guardian/devices')
      .then(r => setDevices(r.data?.data || r.data || []))
      .catch(() => toast.error('Failed to load devices'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handler = (data) => setDevices(prev => prev.map(d => d.id === data.device_id ? { ...d, ...data } : d));
    socketService.on('device:telemetry', handler);
    return () => socketService.off('device:telemetry', handler);
  }, []);

  const stats = {
    total: devices.length,
    active: devices.filter(d => d.status === 'active').length,
    offline: devices.filter(d => d.status !== 'active').length,
    knox: devices.filter(d => d.knox_do_enrolled).length,
  };

  return (
    <div style={{ padding: 16, background: C.bg, minHeight: '100vh', fontFamily: 'Inter, sans-serif', fontSize: 12 }}>
      <div style={{ marginBottom: 12 }}>
        <h1 style={{ fontFamily: 'Barlow Condensed', fontWeight: 800, fontSize: 20, color: C.gold, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>GUARDIAN COMMAND</h1>
        <p style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: C.sub, margin: '2px 0 0' }}>
          {stats.total} ENROLLED · {stats.active} ACTIVE · {stats.knox} KNOX ENROLLED
        </p>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: C.sub, fontFamily: 'JetBrains Mono', fontSize: 11 }}>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 280px', gap: 12 }}>
          <DeviceMatrix devices={devices} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <CommandTerminal devices={devices} />
            <CommandQueue />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <AlertRules />
            <SystemAuditFeed />
          </div>
        </div>
      )}
    </div>
  );
}
