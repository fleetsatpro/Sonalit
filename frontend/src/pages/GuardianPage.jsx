import { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import {
  Smartphone, Battery, Signal, MapPin, Navigation, Lock, Volume2,
  Trash2, RefreshCw, ShieldAlert, MessageSquare, X, QrCode,
  Download, Plus, AlertOctagon, Clock, Wifi, WifiOff, ChevronRight,
  NavigationOff, Shield, User, Truck, Package
} from 'lucide-react';
import { guardianAPI } from '../services/api';
import socketService from '../services/socket';

const G = {
  bg: '#080C14', card: 'rgba(255,255,255,0.025)', border: 'rgba(255,255,255,0.07)',
  gold: '#F0B429', goldBg: 'rgba(240,180,41,0.08)',
  green: '#22c55e', greenBg: 'rgba(34,197,94,0.08)',
  red: '#ef4444', redBg: 'rgba(239,68,68,0.08)', redBd: 'rgba(239,68,68,0.25)',
  amber: '#f59e0b', amberBg: 'rgba(245,158,11,0.08)',
  cyan: '#22D3A0', cyanBg: 'rgba(34,211,160,0.08)',
  text: '#e2e8f0', muted: '#94a3b8', low: '#475569',
};

const ORG_TOKEN = import.meta.env.VITE_GUARDIAN_TOKEN || 'fleet-guardian-2024';

function fmtRelative(ts) {
  if (!ts) return 'Never';
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function StatusBadge({ status }) {
  const map = {
    active:    { label: 'ACTIVE',    color: G.green, bg: G.greenBg },
    pending:   { label: 'PENDING',   color: G.amber, bg: G.amberBg },
    suspended: { label: 'SUSPENDED', color: G.muted, bg: 'rgba(148,163,184,0.08)' },
    revoked:   { label: 'REVOKED',   color: G.red,   bg: G.redBg },
  };
  const s = map[status] || map.pending;
  return (
    <span style={{
      background: s.bg, color: s.color, border: `1px solid ${s.color}30`,
      borderRadius: 6, padding: '1px 7px', fontSize: 9, fontWeight: 700,
      letterSpacing: '0.1em', fontFamily: 'monospace',
    }}>
      {s.label}
    </span>
  );
}

function BatteryBar({ level }) {
  const pct = Math.max(0, Math.min(100, level ?? 0));
  const color = pct > 50 ? G.green : pct > 20 ? G.amber : G.red;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Battery size={13} style={{ color }} />
      <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99, transition: 'width 0.5s' }} />
      </div>
      <span style={{ fontSize: 10, color: color, fontFamily: 'monospace', minWidth: 28, textAlign: 'right' }}>{pct}%</span>
    </div>
  );
}

function SignalBars({ level, network }) {
  const bars = Math.max(0, Math.min(4, Math.round((level ?? 0) / 25)));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 14 }}>
        {[1, 2, 3, 4].map(i => (
          <div key={i} style={{
            width: 3, height: 3 + i * 2.5, borderRadius: 2,
            background: i <= bars ? G.cyan : 'rgba(255,255,255,0.1)',
          }} />
        ))}
      </div>
      {network && <span style={{ fontSize: 9, color: G.muted, fontFamily: 'monospace' }}>{network}</span>}
    </div>
  );
}

function AssignmentBadge({ device }) {
  if (device.driver_name) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <User size={10} style={{ color: G.muted }} />
      <span style={{ fontSize: 10, color: G.muted }}>{device.driver_name}</span>
    </div>
  );
  if (device.convoy_name) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <Truck size={10} style={{ color: G.muted }} />
      <span style={{ fontSize: 10, color: G.muted }}>{device.convoy_name}</span>
    </div>
  );
  if (device.vehicle_name) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <Package size={10} style={{ color: G.muted }} />
      <span style={{ fontSize: 10, color: G.muted }}>{device.vehicle_name}</span>
    </div>
  );
  return <span style={{ fontSize: 10, color: G.low }}>Unassigned</span>;
}

function DeviceCard({ device, onCommand, onLocate, onRevoke }) {
  const isPanic = device.panic_active;
  return (
    <div style={{
      background: G.card,
      border: `1px solid ${isPanic ? G.redBd : G.border}`,
      borderRadius: 14,
      padding: '16px 18px',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      position: 'relative',
      boxShadow: isPanic ? `0 0 20px ${G.redBg}` : undefined,
      animation: isPanic ? 'panicPulse 2s ease-in-out infinite' : undefined,
    }}>
      {isPanic && (
        <div style={{
          position: 'absolute', top: 10, right: 10,
          background: G.red, borderRadius: 99,
          padding: '2px 8px', fontSize: 9, fontWeight: 700,
          color: '#fff', fontFamily: 'monospace', letterSpacing: '0.1em',
          animation: 'pulse 1s ease-in-out infinite',
        }}>
          PANIC
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
            <Smartphone size={13} style={{ color: G.gold, flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: G.text, truncate: true, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {device.name || device.device_id || 'Unknown Device'}
            </span>
          </div>
          {device.model && (
            <span style={{ fontSize: 10, color: G.muted }}>{device.model}</span>
          )}
        </div>
        <StatusBadge status={device.status} />
      </div>

      {/* Battery + Signal */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <BatteryBar level={device.battery_level} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <SignalBars level={device.signal_level} network={device.network_type} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Clock size={10} style={{ color: G.low }} />
            <span style={{ fontSize: 10, color: G.low }}>{fmtRelative(device.last_seen)}</span>
          </div>
        </div>
      </div>

      {/* Assignment */}
      <div style={{ paddingTop: 4, borderTop: `1px solid ${G.border}` }}>
        <AssignmentBadge device={device} />
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={() => onCommand(device)}
          style={{
            flex: 1, background: G.goldBg, border: `1px solid ${G.gold}30`,
            borderRadius: 8, padding: '6px 0', fontSize: 10, fontWeight: 700,
            color: G.gold, cursor: 'pointer', letterSpacing: '0.08em',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(240,180,41,0.15)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = G.goldBg; }}
        >
          COMMANDS
        </button>
        <button
          onClick={() => onLocate(device)}
          style={{
            flex: 1, background: G.cyanBg, border: `1px solid ${G.cyan}30`,
            borderRadius: 8, padding: '6px 0', fontSize: 10, fontWeight: 700,
            color: G.cyan, cursor: 'pointer', letterSpacing: '0.08em',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(34,211,160,0.15)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = G.cyanBg; }}
        >
          LOCATE
        </button>
        <button
          onClick={() => onRevoke(device)}
          style={{
            background: G.redBg, border: `1px solid ${G.red}25`,
            borderRadius: 8, padding: '6px 10px', fontSize: 10, fontWeight: 700,
            color: G.red, cursor: 'pointer', letterSpacing: '0.08em',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.15)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = G.redBg; }}
        >
          REVOKE
        </button>
      </div>
    </div>
  );
}

const COMMANDS = [
  { id: 'request_location',  icon: MapPin,       label: 'Request Location',  desc: 'Get current GPS fix' },
  { id: 'start_live_track',  icon: Navigation,   label: 'Start Live Track',  desc: 'Begin continuous tracking' },
  { id: 'stop_live_track',   icon: NavigationOff,label: 'Stop Live Track',   desc: 'End tracking session' },
  { id: 'push_message',      icon: MessageSquare,label: 'Push Message',      desc: 'Send text to device', hasInput: true },
  { id: 'lock_screen',       icon: Lock,         label: 'Lock Screen',       desc: 'Lock device screen' },
  { id: 'trigger_siren',     icon: Volume2,      label: 'Trigger Siren',     desc: 'Sound alarm on device' },
  { id: 'wipe_cache',        icon: Trash2,       label: 'Wipe Cache',        desc: 'Clear app cache' },
  { id: 'restart_agent',     icon: RefreshCw,    label: 'Restart Agent',     desc: 'Restart Guardian app' },
  { id: 'enable_lost_mode',  icon: ShieldAlert,  label: 'Enable Lost Mode',  desc: 'Full lockdown + beacon' },
];

function CommandStatusChip({ status }) {
  const map = {
    pending:  { color: G.amber, bg: G.amberBg },
    sent:     { color: G.cyan,  bg: G.cyanBg  },
    delivered:{ color: G.green, bg: G.greenBg },
    failed:   { color: G.red,   bg: G.redBg   },
    executed: { color: G.green, bg: G.greenBg },
  };
  const s = map[status] || map.pending;
  return (
    <span style={{
      background: s.bg, color: s.color, border: `1px solid ${s.color}30`,
      borderRadius: 5, padding: '1px 6px', fontSize: 9, fontWeight: 700,
      letterSpacing: '0.08em', fontFamily: 'monospace',
    }}>
      {(status || 'PENDING').toUpperCase()}
    </span>
  );
}

function CommandsPanel({ device, onClose }) {
  const [messageText, setMessageText] = useState('');
  const [activeInput, setActiveInput] = useState(null);
  const [recentCmds, setRecentCmds] = useState([]);
  const [sending, setSending] = useState(null);

  useEffect(() => {
    if (!device) return;
    guardianAPI.history(device._id || device.id, { limit: 5, type: 'command' })
      .then(r => setRecentCmds(r.data?.data || r.data?.commands || []))
      .catch(() => {});
  }, [device]);

  async function sendCommand(cmd) {
    if (cmd.hasInput && activeInput !== cmd.id) {
      setActiveInput(cmd.id);
      return;
    }
    const payload = { command: cmd.id };
    if (cmd.hasInput) payload.message = messageText;

    setSending(cmd.id);
    try {
      await guardianAPI.command(device._id || device.id, payload);
      toast.success(`Command sent: ${cmd.label}`);
      setRecentCmds(prev => [{
        command: cmd.id, label: cmd.label, status: 'sent', created_at: new Date().toISOString(),
      }, ...prev.slice(0, 4)]);
      setActiveInput(null);
      setMessageText('');
    } catch {
      toast.error(`Failed to send command`);
    } finally {
      setSending(null);
    }
  }

  if (!device) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          zIndex: 200, backdropFilter: 'blur(2px)',
        }}
      />
      {/* Panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(380px, 100vw)',
        background: '#0D1321',
        borderLeft: `1px solid ${G.border}`,
        zIndex: 201,
        display: 'flex', flexDirection: 'column',
        boxShadow: '-20px 0 60px rgba(0,0,0,0.6)',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 18px', borderBottom: `1px solid ${G.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: G.goldBg,
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Smartphone size={14} style={{ color: G.gold }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: G.gold, fontFamily: 'monospace', letterSpacing: '0.05em' }}>
                COMMANDS
              </span>
            </div>
            <p style={{ fontSize: 11, color: G.muted, marginTop: 2 }}>
              {device.name || device.device_id || 'Device'}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: 8, padding: 6, cursor: 'pointer', color: G.muted }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {/* Command grid */}
          <p style={{ fontSize: 9, fontFamily: 'monospace', color: G.low, letterSpacing: '0.15em', marginBottom: 10 }}>
            AVAILABLE COMMANDS
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {COMMANDS.map(cmd => {
              const Icon = cmd.icon;
              const isSending = sending === cmd.id;
              return (
                <div key={cmd.id}>
                  <button
                    onClick={() => sendCommand(cmd)}
                    disabled={isSending}
                    style={{
                      width: '100%',
                      background: activeInput === cmd.id ? G.goldBg : G.card,
                      border: `1px solid ${activeInput === cmd.id ? G.gold + '40' : G.border}`,
                      borderRadius: 10, padding: '10px 10px', cursor: 'pointer',
                      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 5,
                      transition: 'all 0.15s', opacity: isSending ? 0.6 : 1,
                    }}
                    onMouseEnter={e => { if (!isSending) e.currentTarget.style.border = `1px solid ${G.gold}30`; }}
                    onMouseLeave={e => { if (activeInput !== cmd.id) e.currentTarget.style.border = `1px solid ${G.border}`; }}
                  >
                    <Icon size={14} style={{ color: isSending ? G.muted : G.gold }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: isSending ? G.muted : G.text, textAlign: 'left', lineHeight: 1.3 }}>
                      {cmd.label}
                    </span>
                    <span style={{ fontSize: 9, color: G.low, textAlign: 'left', lineHeight: 1.3 }}>
                      {isSending ? 'Sending…' : cmd.desc}
                    </span>
                  </button>
                  {activeInput === cmd.id && (
                    <div style={{ marginTop: 4, display: 'flex', gap: 4 }}>
                      <input
                        autoFocus
                        value={messageText}
                        onChange={e => setMessageText(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') sendCommand(cmd); if (e.key === 'Escape') setActiveInput(null); }}
                        placeholder="Enter message…"
                        style={{
                          flex: 1, background: 'rgba(255,255,255,0.04)', border: `1px solid ${G.gold}30`,
                          borderRadius: 8, padding: '6px 10px', fontSize: 11, color: G.text,
                          outline: 'none',
                        }}
                      />
                      <button
                        onClick={() => sendCommand(cmd)}
                        style={{
                          background: G.gold, border: 'none', borderRadius: 8,
                          padding: '6px 10px', fontSize: 10, fontWeight: 700, color: '#0A0F1A', cursor: 'pointer',
                        }}
                      >
                        SEND
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Recent commands */}
          {recentCmds.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <p style={{ fontSize: 9, fontFamily: 'monospace', color: G.low, letterSpacing: '0.15em', marginBottom: 10 }}>
                RECENT COMMANDS
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {recentCmds.slice(0, 5).map((c, i) => (
                  <div key={i} style={{
                    background: G.card, border: `1px solid ${G.border}`,
                    borderRadius: 8, padding: '8px 12px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <div>
                      <p style={{ fontSize: 11, fontWeight: 600, color: G.text }}>
                        {c.label || c.command}
                      </p>
                      <p style={{ fontSize: 9, color: G.low }}>{fmtRelative(c.created_at)}</p>
                    </div>
                    <CommandStatusChip status={c.status} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function EnrollmentModal({ onClose }) {
  const enrollmentUrl = `fleetops://enroll?token=${ORG_TOKEN}&server=${window.location.origin}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(enrollmentUrl)}`;

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 300, backdropFilter: 'blur(4px)' }}
      />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        background: '#0D1321', border: `1px solid ${G.border}`, borderRadius: 18,
        padding: 28, width: 'min(460px, calc(100vw - 32px))', zIndex: 301,
        boxShadow: '0 30px 80px rgba(0,0,0,0.7)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Shield size={16} style={{ color: G.gold }} />
              <span style={{ fontSize: 14, fontWeight: 700, color: G.gold, fontFamily: 'monospace', letterSpacing: '0.1em' }}>
                ENROLL DEVICE
              </span>
            </div>
            <p style={{ fontSize: 11, color: G.muted, marginTop: 3 }}>Guardian Agent enrollment</p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: 8, padding: 6, cursor: 'pointer', color: G.muted }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Token */}
        <div style={{ background: G.goldBg, border: `1px solid ${G.gold}25`, borderRadius: 10, padding: '10px 14px', marginBottom: 18 }}>
          <p style={{ fontSize: 9, color: G.muted, fontFamily: 'monospace', letterSpacing: '0.12em', marginBottom: 4 }}>ORG TOKEN</p>
          <p style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 700, color: G.gold, letterSpacing: '0.06em' }}>{ORG_TOKEN}</p>
        </div>

        {/* QR Code */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
          <div style={{
            background: '#fff', borderRadius: 12, padding: 10,
            border: `3px solid ${G.gold}40`,
          }}>
            <img
              src={qrUrl}
              alt="Enrollment QR Code"
              width={200}
              height={200}
              style={{ display: 'block', borderRadius: 4 }}
            />
          </div>
        </div>

        {/* Download APK */}
        <a
          href="/guardian-agent.apk"
          download
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: G.gold, color: '#0A0F1A', borderRadius: 10, padding: '10px 0',
            fontWeight: 700, fontSize: 12, letterSpacing: '0.08em', textDecoration: 'none',
            marginBottom: 18, transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
        >
          <Download size={14} />
          DOWNLOAD APK
        </a>

        {/* Instructions */}
        <div style={{ background: G.card, border: `1px solid ${G.border}`, borderRadius: 10, padding: '12px 14px' }}>
          <p style={{ fontSize: 9, color: G.muted, fontFamily: 'monospace', letterSpacing: '0.12em', marginBottom: 10 }}>INSTRUCTIONS</p>
          {[
            'Install the Guardian Agent APK on the Android device',
            'Open the app and tap "Enroll Device"',
            'Scan the QR code above, or enter the org token manually',
          ].map((step, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, marginBottom: i < 2 ? 8 : 0 }}>
              <div style={{
                width: 18, height: 18, borderRadius: '50%', background: G.goldBg, border: `1px solid ${G.gold}30`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: G.gold }}>{i + 1}</span>
              </div>
              <p style={{ fontSize: 11, color: G.muted, lineHeight: 1.5 }}>{step}</p>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function StatCard({ label, value, color, pulse }) {
  return (
    <div style={{
      background: G.card, border: `1px solid ${G.border}`, borderRadius: 12,
      padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <p style={{ fontSize: 9, fontFamily: 'monospace', color: G.low, letterSpacing: '0.15em' }}>{label}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 26, fontWeight: 800, color: color || G.text, fontFamily: 'monospace', lineHeight: 1 }}>
          {value}
        </span>
        {pulse && value > 0 && (
          <div style={{
            width: 8, height: 8, borderRadius: '50%', background: G.red,
            animation: 'pulse 1s ease-in-out infinite',
          }} />
        )}
      </div>
    </div>
  );
}

export default function GuardianPage() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [showEnrollment, setShowEnrollment] = useState(false);
  const [filter, setFilter] = useState('all');
  const intervalRef = useRef(null);

  const loadDevices = useCallback(async () => {
    try {
      const res = await guardianAPI.devices();
      setDevices(res.data?.data || res.data?.devices || res.data || []);
    } catch (err) {
      if (loading) toast.error('Failed to load guardian devices');
    } finally {
      setLoading(false);
    }
  }, [loading]);

  useEffect(() => {
    loadDevices();
    intervalRef.current = setInterval(loadDevices, 30000);
    return () => clearInterval(intervalRef.current);
  }, []);

  useEffect(() => {
    const onLocation = (data) => {
      setDevices(prev => prev.map(d =>
        (d._id || d.id) === data.device_id
          ? { ...d, last_lat: data.lat, last_lng: data.lng, last_seen: data.timestamp || new Date().toISOString() }
          : d
      ));
    };
    const onPanic = (data) => {
      setDevices(prev => prev.map(d =>
        (d._id || d.id) === data.device_id ? { ...d, panic_active: true } : d
      ));
      toast.error(`PANIC ALERT — ${data.device_name || data.device_id}`, {
        icon: '🚨',
        duration: 8000,
        style: { background: '#1a0000', border: '1px solid rgba(239,68,68,0.4)', color: '#fca5a5' },
      });
    };
    const onHealth = (data) => {
      setDevices(prev => prev.map(d =>
        (d._id || d.id) === data.device_id
          ? { ...d, battery_level: data.battery ?? d.battery_level, signal_level: data.signal ?? d.signal_level }
          : d
      ));
    };

    socketService.on('device:location', onLocation);
    socketService.on('device:panic', onPanic);
    socketService.on('device:health', onHealth);
    return () => {
      socketService.off('device:location', onLocation);
      socketService.off('device:panic', onPanic);
      socketService.off('device:health', onHealth);
    };
  }, []);

  async function handleRevoke(device) {
    if (!window.confirm(`Revoke device "${device.name || device.device_id}"? This cannot be undone.`)) return;
    try {
      await guardianAPI.revokeDevice(device._id || device.id);
      setDevices(prev => prev.map(d =>
        (d._id || d.id) === (device._id || device.id) ? { ...d, status: 'revoked' } : d
      ));
      toast.success('Device revoked');
    } catch {
      toast.error('Failed to revoke device');
    }
  }

  function handleLocate(device) {
    if (device.last_lat && device.last_lng) {
      window.open(`https://maps.google.com/?q=${device.last_lat},${device.last_lng}`, '_blank');
    } else {
      toast('No location data yet — request location first', { icon: '📍' });
    }
  }

  const filtered = devices.filter(d => {
    if (filter === 'all') return true;
    if (filter === 'active') return d.status === 'active';
    if (filter === 'pending') return d.status === 'pending';
    if (filter === 'panic') return d.panic_active;
    return true;
  });

  const stats = {
    total: devices.length,
    active: devices.filter(d => d.status === 'active').length,
    pending: devices.filter(d => d.status === 'pending').length,
    panic: devices.filter(d => d.panic_active).length,
  };

  return (
    <div style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes panicPulse { 0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0.15)} 50%{box-shadow:0 0 24px 4px rgba(239,68,68,0.25)} }
      `}</style>

      {/* Panic Banner */}
      {stats.panic > 0 && (
        <div style={{
          background: G.redBg, border: `1px solid ${G.redBd}`,
          borderRadius: 12, padding: '12px 18px', marginBottom: 20,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          animation: 'panicPulse 2s ease-in-out infinite',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: G.red, animation: 'pulse 1s ease-in-out infinite' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: G.red, fontFamily: 'monospace', letterSpacing: '0.05em' }}>
              {stats.panic} ACTIVE PANIC ALERT{stats.panic > 1 ? 'S' : ''}
            </span>
          </div>
          <a
            href="/panic-center"
            style={{
              background: G.red, color: '#fff', borderRadius: 8, padding: '6px 14px',
              fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textDecoration: 'none',
            }}
          >
            GO TO PANIC CENTER
          </a>
        </div>
      )}

      {/* Page Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <Shield size={20} style={{ color: G.gold }} />
            <h1 style={{ fontSize: 20, fontWeight: 800, color: G.text, letterSpacing: '0.03em' }}>Guardian Devices</h1>
          </div>
          <p style={{ fontSize: 12, color: G.muted }}>Android field agent management</p>
        </div>
        <button
          onClick={() => setShowEnrollment(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 7,
            background: G.goldBg, border: `1px solid ${G.gold}30`,
            borderRadius: 10, padding: '9px 16px', fontSize: 11, fontWeight: 700,
            color: G.gold, cursor: 'pointer', letterSpacing: '0.08em',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(240,180,41,0.15)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = G.goldBg; }}
        >
          <Plus size={13} />
          ENROLL DEVICE
        </button>
      </div>

      {/* Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatCard label="TOTAL DEVICES" value={stats.total} color={G.text} />
        <StatCard label="ACTIVE"        value={stats.active} color={G.green} />
        <StatCard label="PENDING"       value={stats.pending} color={G.amber} />
        <StatCard label="PANIC ACTIVE"  value={stats.panic} color={G.red} pulse />
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
        {[
          { key: 'all',     label: 'ALL' },
          { key: 'active',  label: 'ACTIVE' },
          { key: 'pending', label: 'PENDING' },
          { key: 'panic',   label: 'PANIC' },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              background: filter === f.key ? G.goldBg : G.card,
              border: `1px solid ${filter === f.key ? G.gold + '40' : G.border}`,
              borderRadius: 8, padding: '5px 14px', fontSize: 10, fontWeight: 700,
              color: filter === f.key ? G.gold : G.muted, cursor: 'pointer',
              letterSpacing: '0.08em', transition: 'all 0.15s',
            }}
          >
            {f.label}
            {f.key !== 'all' && (
              <span style={{ marginLeft: 5, opacity: 0.6 }}>
                ({f.key === 'active' ? stats.active : f.key === 'pending' ? stats.pending : stats.panic})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Device grid */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
          <div style={{ width: 32, height: 32, border: `2px solid ${G.gold}30`, borderTopColor: G.gold, borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '60px 20px',
          background: G.card, border: `1px solid ${G.border}`, borderRadius: 14,
        }}>
          <Smartphone size={32} style={{ color: G.low, margin: '0 auto 12px' }} />
          <p style={{ fontSize: 14, fontWeight: 600, color: G.muted, marginBottom: 6 }}>No devices found</p>
          <p style={{ fontSize: 12, color: G.low }}>
            {filter === 'all' ? 'Enroll your first Guardian device to get started.' : `No ${filter} devices.`}
          </p>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 14,
        }}>
          {filtered.map(device => (
            <DeviceCard
              key={device._id || device.id || device.device_id}
              device={device}
              onCommand={setSelectedDevice}
              onLocate={handleLocate}
              onRevoke={handleRevoke}
            />
          ))}
        </div>
      )}

      {/* Commands Drawer */}
      {selectedDevice && (
        <CommandsPanel device={selectedDevice} onClose={() => setSelectedDevice(null)} />
      )}

      {/* Enrollment Modal */}
      {showEnrollment && <EnrollmentModal onClose={() => setShowEnrollment(false)} />}
    </div>
  );
}
