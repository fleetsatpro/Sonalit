import { useState, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { ChevronRight, X } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { api } from '../lib/api.js';
import { subscribe } from '../lib/centrifuge.js';
import { useAuthStore } from '../stores/auth.js';

const C = {
  bg:'#080C14', surf:'#0D1420', panel:'#111827', border:'#1E2D40',
  gold:'#F0B429', green:'#22c55e', red:'#ef4444', amber:'#f59e0b', blue:'#3b82f6',
  cyan:'#06b6d4', purple:'#a855f7', sub:'#6b7280', mid:'#94a3b8', txt:'#cbd5e1', hi:'#f1f5f9', dim:'#374151',
};

interface GuardianDevice {
  id: string; name?: string; officer_name?: string; assigned_to?: string;
  assignment_type?: string; assignment_id?: string; device_id?: string;
  model?: string; device_model?: string; status: string;
  battery_pct?: number; signal_pct?: number; gps_locked?: boolean;
  app_version?: string; android_version?: string; knox_version?: string; imei?: string;
  knox_do_enrolled?: boolean; last_seen_at?: string; last_heartbeat_at?: string;
  device_commands?: DeviceCmd[];
}
interface DeviceCmd { id?: string; command_type?: string; command?: string; type?: string; status: string; created_at?: string; }
interface DevCommand { id: string; command_type?: string; command?: string; device_name?: string; device_id?: string; status: string; created_at?: string; }
interface AlertRule { id: string; name?: string; type?: string; enabled: boolean; }
interface AuditEvent { action?: string; message?: string; type?: string; ts?: string; }
interface FieldOfficer { id: string; name: string; badge_number?: string; }

function fmtRel(ts?: string | null): string {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const DEV_STATUS_COLOR: Record<string, string> = {
  active: C.green, inactive: C.sub, offline: C.dim, enrolled: C.amber, pending: C.purple,
};

function StatusPill({ status }: { status: string }) {
  const c = DEV_STATUS_COLOR[status] || C.sub;
  return <span style={{ background: `${c}20`, border: `1px solid ${c}50`, borderRadius: 3, padding: '2px 7px', fontSize: 9, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: c, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{status}</span>;
}

function HealthBars({ battery, signal }: { battery?: number | undefined; signal?: number | undefined }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: 60 }}>
      {(['BAT', 'SIG'] as const).map((label, i) => {
        const val = (i === 0 ? battery : signal) ?? 0;
        const color = i === 0 ? (val < 20 ? C.red : val < 50 ? C.amber : C.green) : (val < 30 ? C.red : C.green);
        return (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 8, color: C.sub, width: 22, flexShrink: 0 }}>{label}</span>
            <div style={{ flex: 1, height: 4, background: C.panel, borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${val}%`, height: '100%', background: color, borderRadius: 2 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

const COMMANDS = [
  { id: 'request_location', label: 'Request Location', desc: 'Get current GPS fix', color: C.gold },
  { id: 'trigger_siren', label: 'Capture Photo', desc: 'Take device photo/alert', color: C.red, confirm: true },
  { id: 'lock_screen', label: 'Lock Screen', desc: 'Lock device screen', color: C.blue, confirm: true },
  { id: 'force_checkin', label: 'Force Locate', desc: 'Force GPS locate update', color: C.amber },
  { id: 'restart_app', label: 'Restart App', desc: 'Restart Guardian service', color: C.green },
  { id: 'remote_wipe', label: 'Remote Wipe', desc: 'Factory reset device', color: C.red, confirm: true, dangerous: true },
];

const OVERLAY: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 };
const MBOX: CSSProperties = { background: C.surf, border: `1px solid ${C.border}`, borderRadius: 8, padding: 20, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' };

function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
      <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 800, fontSize: 16, color: C.gold, letterSpacing: '0.08em' }}>{title}</span>
      <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.sub, cursor: 'pointer', padding: 4 }}><X size={16} /></button>
    </div>
  );
}

function EnrollDeviceModal({ devices, onClose, onApproved }: { devices: GuardianDevice[]; onClose: () => void; onApproved: () => void }) {
  const pending = devices.filter(d => d.status === 'pending');
  const [approving, setApproving] = useState<string | null>(null);

  async function approve(id: string) {
    setApproving(id);
    try { await api.post(`/guardian/devices/${id}/approve`); onApproved(); }
    catch { } finally { setApproving(null); }
  }

  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={MBOX} onClick={e => e.stopPropagation()}>
        <ModalHeader title="ENROLL DEVICE" onClose={onClose} />
        <div style={{ background: C.panel, borderRadius: 6, padding: 12, marginBottom: 16, fontSize: 10, color: C.txt, lineHeight: 1.7 }}>
          <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 11, color: C.gold, marginBottom: 6 }}>APK ENROLLMENT STEPS</div>
          <div>1. Install the Guardian APK on the Android device</div>
          <div>2. Open the app and enter the <strong style={{ color: C.gold }}>Operator Code</strong> (= officer's badge number)</div>
          <div>3. Device appears below as <span style={{ color: C.purple, fontFamily: 'JetBrains Mono, monospace' }}>PENDING</span></div>
          <div>4. Click <strong style={{ color: C.green }}>APPROVE</strong> to activate the device</div>
        </div>
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 10, color: C.sub, letterSpacing: '0.08em', marginBottom: 8 }}>
          PENDING APPROVAL ({pending.length})
        </div>
        {pending.length === 0
          ? <div style={{ textAlign: 'center', padding: '20px 0', color: C.sub, fontFamily: 'JetBrains Mono, monospace', fontSize: 10 }}>No pending devices — enroll via APK first</div>
          : pending.map(d => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: C.panel, borderRadius: 4, marginBottom: 6 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: C.txt, overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.device_id || d.id.slice(0, 16)}</div>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: C.sub }}>{d.model || d.device_model || 'Unknown'} · {fmtRel(d.last_heartbeat_at || d.last_seen_at)}</div>
              </div>
              <StatusPill status={d.status} />
              <button onClick={() => approve(d.id)} disabled={approving === d.id}
                style={{ background: `${C.green}20`, border: `1px solid ${C.green}50`, borderRadius: 3, padding: '4px 10px', color: C.green, fontSize: 9, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, cursor: 'pointer' }}>
                {approving === d.id ? '…' : 'APPROVE'}
              </button>
            </div>
          ))}
      </div>
    </div>
  );
}

function LinkOfficerModal({ device, onClose, onLinked }: { device: GuardianDevice; onClose: () => void; onLinked: () => void }) {
  const [officers, setOfficers] = useState<FieldOfficer[]>([]);
  const [selOfficer, setSelOfficer] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get<{ data?: FieldOfficer[] } | FieldOfficer[]>('/field-officers')
      .then(r => { const d = r.data; setOfficers(Array.isArray(d) ? d : (d?.data ?? [])); })
      .catch(() => {});
  }, []);

  async function link() {
    if (!selOfficer) return;
    setSaving(true); setErr('');
    try {
      await api.patch(`/field-officers/${selOfficer}`, { device_id: device.id });
      onLinked(); onClose();
    } catch {
      setErr('Failed to link — try again');
    } finally { setSaving(false); }
  }

  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={{ ...MBOX, maxWidth: 380 }} onClick={e => e.stopPropagation()}>
        <ModalHeader title="LINK TO OFFICER" onClose={onClose} />
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: C.sub, marginBottom: 12 }}>
          Device: {device.name || device.device_id || device.id.slice(0, 16)}
        </div>
        <select value={selOfficer} onChange={e => setSelOfficer(e.target.value)}
          style={{ width: '100%', background: C.panel, border: `1px solid ${C.border}`, borderRadius: 4, padding: '8px 10px', fontSize: 11, color: selOfficer ? C.txt : C.sub, outline: 'none', marginBottom: 12 }}>
          <option value="">— Select Field Officer —</option>
          {officers.map(o => <option key={o.id} value={o.id}>{o.name}{o.badge_number ? ` · ${o.badge_number}` : ''}</option>)}
        </select>
        {err && <div style={{ color: C.red, fontSize: 10, fontFamily: 'JetBrains Mono, monospace', marginBottom: 8 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 4, padding: 8, color: C.mid, fontSize: 11, fontFamily: 'JetBrains Mono, monospace', cursor: 'pointer' }}>CANCEL</button>
          <button onClick={link} disabled={!selOfficer || saving}
            style={{ flex: 2, background: selOfficer ? C.gold : C.dim, border: 'none', borderRadius: 4, padding: 8, fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 800, fontSize: 13, letterSpacing: '0.08em', color: selOfficer ? '#000' : C.sub, cursor: selOfficer ? 'pointer' : 'not-allowed' }}>
            {saving ? 'LINKING…' : 'LINK OFFICER'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeviceMatrix({ devices, onLink, onApprove }: { devices: GuardianDevice[]; onLink: (d: GuardianDevice) => void; onApprove: () => void }) {
  const navigate = useNavigate();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const thS = { padding: '6px 10px', fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 10, color: C.sub, textTransform: 'uppercase' as const, letterSpacing: '0.08em', borderBottom: `1px solid ${C.border}`, textAlign: 'left' as const, whiteSpace: 'nowrap' as const };
  const pendingCount = devices.filter(d => d.status === 'pending').length;

  return (
    <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'auto' }}>
      <div style={{ padding: '10px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 13, color: C.gold, letterSpacing: '0.08em' }}>DEVICE MATRIX</span>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: C.sub, flex: 1 }}>{devices.length} enrolled</span>
        {pendingCount > 0 && (
          <button onClick={onApprove}
            style={{ background: `${C.purple}20`, border: `1px solid ${C.purple}50`, borderRadius: 3, padding: '3px 8px', color: C.purple, fontSize: 9, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, cursor: 'pointer' }}>
            {pendingCount} PENDING ▶ APPROVE
          </button>
        )}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr style={{ background: C.panel }}><th style={{ ...thS, width: 24 }} /><th style={thS}>Device / Officer</th><th style={thS}>Status</th><th style={thS}>Health</th><th style={thS}>Last Seen</th><th style={thS}>App Ver</th><th style={thS}>Actions</th></tr></thead>
        <tbody>
          {devices.map(d => {
            const exp = expandedId === d.id;
            const cmds = d.device_commands || [];
            const maskedImei = d.imei ? `${d.imei.slice(0, 2)}${'*'.repeat(Math.max(0, d.imei.length - 6))}${d.imei.slice(-4)}` : '—';
            return (
              <>
                <tr key={d.id} style={{ borderBottom: `1px solid ${C.border}`, background: exp ? C.panel : 'transparent', cursor: 'pointer' }}
                  onClick={() => setExpandedId(prev => prev === d.id ? null : d.id)}>
                  <td style={{ padding: '8px 10px' }}><ChevronRight size={12} style={{ color: C.sub, transform: exp ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} /></td>
                  <td style={{ padding: '8px 10px' }}>
                    <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: C.hi }}>{d.officer_name || d.assigned_to || d.name || '—'}</div>
                    <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: C.sub }}>{d.model || d.device_model || d.device_id?.slice(0, 12) || '—'}</div>
                  </td>
                  <td style={{ padding: '8px 10px' }}><StatusPill status={d.status} /></td>
                  <td style={{ padding: '8px 10px' }}><HealthBars battery={d.battery_pct} signal={d.signal_pct} /></td>
                  <td style={{ padding: '8px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: C.mid }}>{fmtRel(d.last_heartbeat_at || d.last_seen_at)}</td>
                  <td style={{ padding: '8px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: C.mid }}>{d.app_version || '—'}</td>
                  <td style={{ padding: '8px 10px' }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => onLink(d)}
                        style={{ background: `${C.blue}18`, border: `1px solid ${C.blue}40`, borderRadius: 3, padding: '3px 7px', color: C.blue, fontSize: 9, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, cursor: 'pointer' }}>
                        LINK
                      </button>
                      <button
                        onClick={() => d.knox_do_enrolled
                          ? navigate({ to: '/guardian/devices/$deviceId/remote', params: { deviceId: d.id } })
                          : alert('Knox enrollment required for remote session')
                        }
                        title={d.knox_do_enrolled ? 'Open Knox remote session' : 'Knox enrollment required'}
                        style={{ background: d.knox_do_enrolled ? `${C.cyan}18` : `${C.dim}20`, border: `1px solid ${d.knox_do_enrolled ? C.cyan + '40' : C.border}`, borderRadius: 3, padding: '3px 8px', color: d.knox_do_enrolled ? C.cyan : C.sub, fontSize: 9, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, cursor: d.knox_do_enrolled ? 'pointer' : 'default', opacity: d.knox_do_enrolled ? 1 : 0.5 }}>
                        REMOTE
                      </button>
                    </div>
                  </td>
                </tr>
                {exp && (
                  <tr key={`exp-${d.id}`}>
                    <td colSpan={7} style={{ background: C.panel, padding: '12px 16px', borderBottom: `1px solid ${C.border}` }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                        <div>
                          <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 10, color: C.gold, letterSpacing: '0.08em', marginBottom: 6 }}>DEVICE INFO</div>
                          {([['IMEI', maskedImei], ['Model', d.model || '—'], ['Android', d.android_version || '—'], ['Knox', d.knox_version || '—'], ['App', d.app_version || '—']] as [string, string][]).map(([k, v]) => (
                            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                              <span style={{ color: C.sub, fontSize: 10 }}>{k}</span>
                              <span style={{ color: C.txt, fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}>{v}</span>
                            </div>
                          ))}
                        </div>
                        <div>
                          <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 10, color: C.gold, letterSpacing: '0.08em', marginBottom: 6 }}>TELEMETRY</div>
                          {([['Battery', `${d.battery_pct ?? '—'}%`], ['Signal', `${d.signal_pct ?? '—'}%`], ['GPS', d.gps_locked ? 'Locked' : 'Searching'], ['Last Seen', fmtRel(d.last_heartbeat_at || d.last_seen_at)]] as [string, string][]).map(([k, v]) => (
                            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                              <span style={{ color: C.sub, fontSize: 10 }}>{k}</span>
                              <span style={{ color: C.txt, fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}>{v}</span>
                            </div>
                          ))}
                        </div>
                        <div>
                          <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 10, color: C.gold, letterSpacing: '0.08em', marginBottom: 6 }}>COMMAND HISTORY</div>
                          {cmds.length === 0 ? <div style={{ color: C.sub, fontSize: 10 }}>No commands issued</div> : cmds.slice(0, 5).map((c, i) => (
                            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: C.txt }}>{c.command_type || c.command || c.type}</div>
                                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 8, color: C.sub }}>{fmtRel(c.created_at)}</div>
                              </div>
                              <span style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: c.status === 'acknowledged' ? C.green : c.status === 'failed' ? C.red : C.amber }}>{c.status}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            );
          })}
          {!devices.length && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: C.sub, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>No devices enrolled — install APK and enroll via operator code</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function CommandTerminal({ devices }: { devices: GuardianDevice[] }) {
  const [selDevice, setSelDevice] = useState('');
  const [selCmd, setSelCmd] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function issue() {
    const cmd = COMMANDS.find(c => c.id === selCmd);
    if (!selDevice || !cmd) return;
    if (cmd.confirm && !window.confirm(`Execute "${cmd.label}" on this device?`)) return;
    setSending(true); setMsg(null);
    try {
      await api.post(`/guardian/devices/${selDevice}/commands`, { command: cmd.id, confirm: cmd.dangerous === true });
      setMsg({ text: `✓ Command issued: ${cmd.label}`, ok: true });
      setSelCmd(null);
    } catch (ex: unknown) {
      const detail = ex && typeof ex === 'object' && 'response' in ex
        ? (ex as { response?: { data?: { message?: string } } }).response?.data?.message
        : undefined;
      setMsg({ text: detail || 'Command failed — check device status and try again', ok: false });
    } finally { setSending(false); }
  }

  return (
    <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12 }}>
      <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 13, color: C.gold, letterSpacing: '0.08em', marginBottom: 10 }}>COMMAND TERMINAL</div>
      <select value={selDevice} onChange={e => setSelDevice(e.target.value)}
        style={{ width: '100%', background: C.panel, border: `1px solid ${C.border}`, borderRadius: 4, padding: '6px 10px', fontSize: 11, color: selDevice ? C.txt : C.sub, outline: 'none', marginBottom: 10 }}>
        <option value="">— Select Device —</option>
        {devices.map(d => <option key={d.id} value={d.id}>{d.officer_name || d.assigned_to || d.name || d.id} — {d.model || '?'}</option>)}
      </select>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
        {COMMANDS.map(cmd => (
          <button key={cmd.id} onClick={() => setSelCmd(prev => prev === cmd.id ? null : cmd.id)}
            style={{ background: selCmd === cmd.id ? `${cmd.color}25` : `${cmd.color}10`, border: `1px solid ${selCmd === cmd.id ? cmd.color + '70' : cmd.color + '30'}`, borderRadius: 4, padding: '6px 8px', textAlign: 'left', cursor: 'pointer' }}>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700, color: cmd.color }}>{cmd.label}</div>
            <div style={{ fontSize: 9, color: C.sub, marginTop: 1 }}>{cmd.desc}</div>
          </button>
        ))}
      </div>
      {msg && <div style={{ marginBottom: 8, fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: msg.ok ? C.green : C.red, wordBreak: 'break-word' }}>{msg.text}</div>}
      <button onClick={issue} disabled={!selDevice || !selCmd || sending}
        style={{ width: '100%', background: selDevice && selCmd ? C.gold : C.dim, border: 'none', borderRadius: 4, padding: '8px', fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 800, fontSize: 13, letterSpacing: '0.08em', color: selDevice && selCmd ? '#000' : C.sub, cursor: selDevice && selCmd ? 'pointer' : 'not-allowed' }}>
        {sending ? 'SENDING…' : 'EXECUTE COMMAND'}
      </button>
    </div>
  );
}

export default function Guardian() {
  const user = useAuthStore(s => s.user);
  const [devices, setDevices] = useState<GuardianDevice[]>([]);
  const [commands, setCommands] = useState<DevCommand[]>([]);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEnroll, setShowEnroll] = useState(false);
  const [linkDevice, setLinkDevice] = useState<GuardianDevice | null>(null);

  const loadDevices = useCallback(() => {
    api.get<{ data?: GuardianDevice[] } | GuardianDevice[]>('/guardian/devices')
      .then(r => { const d = r.data; setDevices(Array.isArray(d) ? d : (d?.data ?? [])); })
      .catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadDevices();
    api.get<{ data?: DevCommand[] } | DevCommand[]>('/guardian/command-queue')
      .then(r => { const d = r.data; setCommands(Array.isArray(d) ? d : (d?.data ?? [])); }).catch(() => {});
    api.get<{ data?: AlertRule[] } | AlertRule[]>('/guardian/alert-rules')
      .then(r => { const d = r.data; setRules(Array.isArray(d) ? d : (d?.data ?? [])); }).catch(() => {});
  }, [loadDevices]);

  useEffect(() => {
    if (!user?.org_id) return;
    return subscribe<{ type?: string; device_id?: string; action?: string; message?: string }>(`org#${user.org_id}`, (msg) => {
      if (msg.type === 'device:telemetry' && msg.device_id) {
        setDevices(prev => prev.map(d => d.id === msg.device_id ? { ...d, ...(msg as Partial<GuardianDevice>) } : d));
      }
      if (msg.type === 'command:queued') setCommands(prev => [msg as DevCommand, ...prev].slice(0, 30));
      if (msg.action || msg.message) setAuditEvents(prev => [{ ...msg, ts: new Date().toISOString() }, ...prev].slice(0, 20));
    });
  }, [user?.org_id]);

  function toggleRule(rule: AlertRule) {
    const next = !rule.enabled;
    setRules(rs => rs.map(r => r.id === rule.id ? { ...r, enabled: next } : r));
    api.put(`/guardian/alert-rules/${rule.id}`, { enabled: next }).catch(() => {
      setRules(rs => rs.map(r => r.id === rule.id ? { ...r, enabled: rule.enabled } : r));
    });
  }

  const stats = { total: devices.length, active: devices.filter(d => d.status === 'active' || d.status === 'enrolled').length, knox: devices.filter(d => d.knox_do_enrolled).length };

  return (
    <div style={{ padding: 16, background: C.bg, minHeight: '100vh', fontFamily: 'Inter, sans-serif', fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 800, fontSize: 20, color: C.gold, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>GUARDIAN COMMAND</h1>
          <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: C.sub, margin: '2px 0 0' }}>
            {stats.total} ENROLLED · {stats.active} ACTIVE · {stats.knox} KNOX
          </p>
        </div>
        <button onClick={() => setShowEnroll(true)}
          style={{ background: `${C.gold}18`, border: `1px solid ${C.gold}50`, borderRadius: 4, padding: '7px 16px', color: C.gold, fontSize: 11, fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, letterSpacing: '0.08em', cursor: 'pointer' }}>
          + ENROLL DEVICE
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: C.sub, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <DeviceMatrix devices={devices} onLink={setLinkDevice} onApprove={() => setShowEnroll(true)} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            <CommandTerminal devices={devices} />
            <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12 }}>
              <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 13, color: C.gold, letterSpacing: '0.08em', marginBottom: 8 }}>COMMAND QUEUE</div>
              {commands.length === 0
                ? <div style={{ color: C.sub, fontSize: 10 }}>No pending commands</div>
                : commands.slice(0, 10).map((cmd, i) => {
                    const sc = ({ pending: C.amber, acknowledged: C.green, expired: C.sub, failed: C.red } as Record<string, string>)[cmd.status] || C.mid;
                    return (
                      <div key={cmd.id || i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: `1px solid ${C.border}` }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: sc, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: C.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cmd.command_type || cmd.command}</div>
                          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: C.sub }}>{cmd.device_name || cmd.device_id?.slice(0, 8)}</div>
                        </div>
                        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: sc, fontWeight: 700 }}>{cmd.status}</span>
                      </div>
                    );
                  })}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12 }}>
                <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 13, color: C.gold, letterSpacing: '0.08em', marginBottom: 8 }}>ALERT RULES</div>
                {rules.length === 0
                  ? <div style={{ color: C.sub, fontSize: 10 }}>No alert rules configured</div>
                  : rules.map((rule, i) => (
                    <div key={rule.id || i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: `1px solid ${C.border}` }}>
                      <div style={{ flex: 1, minWidth: 0, fontSize: 10, color: C.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rule.name || rule.type}</div>
                      <button onClick={() => toggleRule(rule)}
                        style={{ width: 32, height: 16, borderRadius: 8, background: rule.enabled ? `${C.green}40` : C.panel, border: `1px solid ${rule.enabled ? C.green : C.border}`, cursor: 'pointer', position: 'relative', flexShrink: 0 }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: rule.enabled ? C.green : C.sub, position: 'absolute', top: 2, left: rule.enabled ? 18 : 2, transition: 'left 0.2s' }} />
                      </button>
                    </div>
                  ))}
              </div>
              <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12 }}>
                <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 13, color: C.gold, letterSpacing: '0.08em', marginBottom: 8 }}>SYSTEM AUDIT</div>
                {auditEvents.length === 0
                  ? <div style={{ color: C.sub, fontSize: 10 }}>Listening for audit events…</div>
                  : auditEvents.map((ev, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                      <div style={{ width: 4, height: 4, borderRadius: '50%', background: C.purple, marginTop: 4, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 10, color: C.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.action || ev.message || ev.type}</div>
                        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: C.sub }}>{ev.ts ? new Date(ev.ts).toLocaleTimeString() : '—'}</div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {showEnroll && <EnrollDeviceModal devices={devices} onClose={() => setShowEnroll(false)} onApproved={loadDevices} />}
      {linkDevice && <LinkOfficerModal device={linkDevice} onClose={() => setLinkDevice(null)} onLinked={loadDevices} />}
    </div>
  );
}
