import { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import {
  Smartphone, Battery, Signal, MapPin, Navigation, Lock, Volume2, VolumeX,
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
    active:    { label: 'ACTIVE',    color: '#22D3A0', bg: 'rgba(34,211,160,0.12)', border: 'rgba(34,211,160,0.25)' },
    pending:   { label: 'PENDING',   color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.25)' },
    suspended: { label: 'SUSPENDED', color: '#94a3b8', bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.2)' },
    revoked:   { label: 'REVOKED',   color: '#F25252', bg: 'rgba(242,82,82,0.12)',   border: 'rgba(242,82,82,0.25)' },
  };
  const s = map[status] || map.pending;
  return (
    <span style={{
      background: s.bg,
      color: s.color,
      border: `1px solid ${s.border}`,
      borderRadius: 6,
      padding: '2px 8px',
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: '0.12em',
      fontFamily: 'IBM Plex Mono, monospace',
    }}>
      {s.label}
    </span>
  );
}

function BatteryIndicator({ level }) {
  const color = level > 50 ? '#22D3A0' : level > 20 ? '#F59E0B' : '#F25252';
  const pct = Math.min(100, Math.max(0, level || 0));
  return (
    <div className="battery-wrap">
      <div className="battery-shell">
        <div className="battery-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span style={{ fontSize: 10, fontFamily: 'IBM Plex Mono, monospace', color, fontWeight: 700 }}>{pct}%</span>
    </div>
  );
}

function SignalBars({ strength }) {
  const bars = strength == null ? 0 : strength > 75 ? 4 : strength > 50 ? 3 : strength > 25 ? 2 : strength > 0 ? 1 : 0;
  return (
    <div className="signal-bars">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className={`signal-bar ${i < bars ? (bars >= 3 ? 'active' : 'partial') : 'inactive'}`} />
      ))}
    </div>
  );
}

function AssignmentBadge({ device }) {
  if (device.driver_name) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <User size={10} style={{ color: G.muted }} />
      <span style={{ fontSize: 10, color: G.muted, fontFamily: 'IBM Plex Mono, monospace' }}>{device.driver_name}</span>
    </div>
  );
  if (device.convoy_name) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <Truck size={10} style={{ color: G.muted }} />
      <span style={{ fontSize: 10, color: G.muted, fontFamily: 'IBM Plex Mono, monospace' }}>{device.convoy_name}</span>
    </div>
  );
  if (device.vehicle_name) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <Package size={10} style={{ color: G.muted }} />
      <span style={{ fontSize: 10, color: G.muted, fontFamily: 'IBM Plex Mono, monospace' }}>{device.vehicle_name}</span>
    </div>
  );
  return (
    <span style={{ fontSize: 10, color: G.low, fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0.05em' }}>
      UNASSIGNED
    </span>
  );
}

function DeviceCard({ device, onCommand, onLocate, onRevoke }) {
  const isPanic = device.panic_active;

  return (
    <div
      className={isPanic ? 'card-panic animate-panic-border' : 'card-glow'}
      style={{
        borderRadius: 16,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      {/* Panic banner */}
      {isPanic && (
        <div style={{
          background: 'rgba(242,82,82,0.15)',
          borderBottom: '1px solid rgba(242,82,82,0.3)',
          padding: '6px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: '#F25252',
            animation: 'pulse 1s infinite',
          }} />
          <span style={{
            fontSize: 9,
            fontFamily: 'IBM Plex Mono, monospace',
            fontWeight: 800,
            color: '#F25252',
            letterSpacing: '0.15em',
          }}>
            PANIC ACTIVE — SOS TRIGGERED
          </span>
        </div>
      )}

      <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Header row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0, paddingRight: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
              <Smartphone size={13} style={{ color: G.gold, flexShrink: 0 }} />
              <span style={{
                fontSize: 13,
                fontWeight: 700,
                color: '#cbd5e1',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontFamily: 'Space Grotesk, sans-serif',
              }}>
                {device.name || device.device_id || 'Unknown Device'}
              </span>
            </div>
            {device.model && (
              <span style={{ fontSize: 10, color: G.muted, fontFamily: 'IBM Plex Mono, monospace' }}>
                {device.model}
              </span>
            )}
          </div>
          <StatusBadge status={device.status} />
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: 'rgba(255,255,255,0.05)' }} />

        {/* Battery + Signal + Network row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 100 }}>
            <BatteryIndicator level={device.battery_level} />
          </div>
          <SignalBars strength={device.signal_level} />
          {device.network_type && (
            <span style={{
              fontSize: 9,
              fontFamily: 'IBM Plex Mono, monospace',
              color: G.muted,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 5,
              padding: '2px 6px',
              letterSpacing: '0.08em',
            }}>
              {device.network_type}
            </span>
          )}
        </div>

        {/* Assignment + Last seen row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <AssignmentBadge device={device} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Clock size={10} style={{ color: G.low }} />
            <span style={{ fontSize: 10, color: G.low, fontFamily: 'IBM Plex Mono, monospace' }}>
              {fmtRelative(device.last_seen)}
            </span>
          </div>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: 'rgba(255,255,255,0.05)' }} />

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => onCommand(device)}
            style={{
              flex: 1,
              background: 'rgba(240,180,41,0.08)',
              border: '1px solid rgba(240,180,41,0.22)',
              borderRadius: 9,
              padding: '8px 0',
              fontSize: 10,
              fontWeight: 700,
              color: G.gold,
              cursor: 'pointer',
              letterSpacing: '0.08em',
              fontFamily: 'IBM Plex Mono, monospace',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(240,180,41,0.16)';
              e.currentTarget.style.borderColor = 'rgba(240,180,41,0.4)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(240,180,41,0.08)';
              e.currentTarget.style.borderColor = 'rgba(240,180,41,0.22)';
            }}
          >
            COMMANDS
          </button>
          <button
            onClick={() => onLocate(device)}
            style={{
              flex: 1,
              background: 'rgba(34,211,160,0.08)',
              border: '1px solid rgba(34,211,160,0.22)',
              borderRadius: 9,
              padding: '8px 0',
              fontSize: 10,
              fontWeight: 700,
              color: '#22D3A0',
              cursor: 'pointer',
              letterSpacing: '0.08em',
              fontFamily: 'IBM Plex Mono, monospace',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(34,211,160,0.16)';
              e.currentTarget.style.borderColor = 'rgba(34,211,160,0.4)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(34,211,160,0.08)';
              e.currentTarget.style.borderColor = 'rgba(34,211,160,0.22)';
            }}
          >
            LOCATE
          </button>
          <button
            onClick={() => onRevoke(device)}
            style={{
              background: 'rgba(242,82,82,0.08)',
              border: '1px solid rgba(242,82,82,0.22)',
              borderRadius: 9,
              padding: '8px 12px',
              fontSize: 10,
              fontWeight: 700,
              color: '#F25252',
              cursor: 'pointer',
              letterSpacing: '0.08em',
              fontFamily: 'IBM Plex Mono, monospace',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(242,82,82,0.16)';
              e.currentTarget.style.borderColor = 'rgba(242,82,82,0.4)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(242,82,82,0.08)';
              e.currentTarget.style.borderColor = 'rgba(242,82,82,0.22)';
            }}
          >
            REVOKE
          </button>
        </div>
      </div>
    </div>
  );
}

// id values must exactly match backend validCommandTypes enum
const COMMANDS = [
  { id: 'request_location',   icon: MapPin,        label: 'Request Location',   desc: 'Get current GPS fix' },
  { id: 'start_live_tracking',icon: Navigation,    label: 'Start Live Track',   desc: 'Begin 5-second tracking' },
  { id: 'stop_live_tracking', icon: NavigationOff, label: 'Stop Live Track',    desc: 'Return to normal interval' },
  { id: 'push_message',       icon: MessageSquare, label: 'Push Message',       desc: 'Send text to device', hasInput: true },
  { id: 'lock_screen',        icon: Lock,          label: 'Lock Screen',        desc: 'Lock device screen' },
  { id: 'trigger_siren',      icon: Volume2,       label: 'Trigger Siren',      desc: 'Sound alarm on device' },
  { id: 'stop_siren',         icon: VolumeX,       label: 'Stop Siren',         desc: 'Cancel active alarm', danger: true },
  { id: 'force_sync',         icon: RefreshCw,     label: 'Force Sync',         desc: 'Flush offline queue now' },
  { id: 'restart_agent',      icon: RefreshCw,     label: 'Restart Agent',      desc: 'Restart Guardian service' },
  { id: 'enable_lost_mode',   icon: ShieldAlert,   label: 'Enable Lost Mode',   desc: 'Full lockdown + beacon' },
];

function CommandStatusChip({ status }) {
  const map = {
    pending:  { color: G.amber, bg: G.amberBg },
    sent:     { color: G.cyan,  bg: G.cyanBg  },
    delivered:{ color: G.green, bg: G.greenBg },
    failed:   { color: '#F25252', bg: 'rgba(242,82,82,0.08)' },
    executed: { color: G.green, bg: G.greenBg },
  };
  const s = map[status] || map.pending;
  return (
    <span style={{
      background: s.bg, color: s.color, border: `1px solid ${s.color}30`,
      borderRadius: 5, padding: '1px 6px', fontSize: 9, fontWeight: 700,
      letterSpacing: '0.08em', fontFamily: 'IBM Plex Mono, monospace',
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
  const [sirenActive, setSirenActive] = useState(false);

  useEffect(() => {
    if (!device) return;
    const devId = device._id || device.id;
    guardianAPI.commands(devId, { limit: 10 })
      .then(r => setRecentCmds(r.data?.commands || []))
      .catch(() => {
        // fallback: pull from device detail's recent_commands
        guardianAPI.device(devId)
          .then(r => setRecentCmds(r.data?.data?.recent_commands || r.data?.recent_commands || []))
          .catch(() => {});
      });
  }, [device]);

  async function sendCommand(cmd) {
    if (cmd.hasInput && activeInput !== cmd.id) {
      setActiveInput(cmd.id);
      return;
    }

    // Build body matching backend schema: { command_type, payload }
    const body = { command_type: cmd.id };
    if (cmd.id === 'push_message') {
      if (!messageText.trim()) {
        toast.error('Enter a message to send');
        return;
      }
      body.payload = { text: messageText.trim() };
    } else if (cmd.id === 'trigger_siren') {
      body.payload = { duration: 10 };
    } else if (cmd.id === 'lock_screen' || cmd.id === 'enable_lost_mode') {
      body.payload = { message: cmd.id === 'enable_lost_mode'
        ? 'DEVICE REPORTED LOST — PLEASE RETURN TO FLEET MANAGER'
        : 'DEVICE LOCKED BY FLEET MANAGER' };
    }

    setSending(cmd.id);
    try {
      const res = await guardianAPI.command(device._id || device.id, body);
      const cmdId = res.data?.command_id;
      toast.success(`Command sent: ${cmd.label}`);
      if (cmd.id === 'trigger_siren') setSirenActive(true);
      if (cmd.id === 'stop_siren')    setSirenActive(false);
      setRecentCmds(prev => [{
        id: cmdId,
        command_type: cmd.id,
        label: cmd.label,
        status: 'pending',
        issued_at: new Date().toISOString(),
      }, ...prev.slice(0, 9)]);
      setActiveInput(null);
      setMessageText('');
    } catch (err) {
      const detail = err?.response?.data?.error || err?.message || 'Unknown error';
      toast.error(`Command failed: ${detail}`);
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
        background: '#080C14',
        borderLeft: '1px solid rgba(255,255,255,0.07)',
        zIndex: 201,
        display: 'flex', flexDirection: 'column',
        boxShadow: '-20px 0 60px rgba(0,0,0,0.7)',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          background: 'rgba(255,255,255,0.02)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 8, fontFamily: 'IBM Plex Mono, monospace', color: '#475569', letterSpacing: '0.2em', marginBottom: 4 }}>
              REMOTE COMMANDS
            </div>
            <div style={{ fontSize: 14, fontFamily: 'Orbitron, sans-serif', fontWeight: 700, color: '#e2e8f0' }}>
              {device.name || device.device_id || 'Device'}
            </div>
            {device.model && (
              <div style={{ fontSize: 10, color: G.muted, fontFamily: 'IBM Plex Mono, monospace', marginTop: 2 }}>
                {device.model}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 8, padding: 7,
              cursor: 'pointer', color: G.muted,
              display: 'flex', alignItems: 'center',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.09)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {/* Siren active banner */}
          {sirenActive && (
            <div style={{
              background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.35)',
              borderRadius: 10,
              padding: '10px 14px',
              marginBottom: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: G.red, animation: 'pulse 0.8s infinite', flexShrink: 0,
                }} />
                <span style={{
                  fontSize: 10, fontFamily: 'IBM Plex Mono, monospace',
                  fontWeight: 700, color: G.red, letterSpacing: '0.1em',
                }}>
                  SIREN ACTIVE ON DEVICE
                </span>
              </div>
              <button
                onClick={() => sendCommand(COMMANDS.find(c => c.id === 'stop_siren'))}
                disabled={sending === 'stop_siren'}
                style={{
                  background: G.red, border: 'none', borderRadius: 7,
                  padding: '5px 12px', fontSize: 9, fontWeight: 800,
                  color: '#fff', cursor: 'pointer', letterSpacing: '0.1em',
                  fontFamily: 'IBM Plex Mono, monospace',
                  opacity: sending === 'stop_siren' ? 0.6 : 1,
                  display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                <VolumeX size={10} /> STOP NOW
              </button>
            </div>
          )}

          {/* Command grid */}
          <p style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: G.low, letterSpacing: '0.2em', marginBottom: 10, textTransform: 'uppercase' }}>
            Available Commands
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {COMMANDS.map(cmd => {
              const Icon = cmd.icon;
              const isSending = sending === cmd.id;
              const isDanger = cmd.danger;
              const accentColor = isDanger ? G.red : G.gold;
              const accentAlpha = isDanger ? 'rgba(239,68,68,' : 'rgba(240,180,41,';
              return (
                <div key={cmd.id}>
                  <button
                    onClick={() => sendCommand(cmd)}
                    disabled={isSending}
                    style={{
                      width: '100%',
                      background: activeInput === cmd.id
                        ? `${accentAlpha}0.07)`
                        : isDanger ? `${accentAlpha}0.05)` : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${activeInput === cmd.id
                        ? `${accentAlpha}0.3)`
                        : isDanger ? `${accentAlpha}0.2)` : 'rgba(255,255,255,0.06)'}`,
                      borderRadius: 10,
                      padding: '12px 8px',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                      cursor: isSending ? 'not-allowed' : 'pointer',
                      transition: 'all 0.15s',
                      opacity: isSending ? 0.6 : 1,
                    }}
                    onMouseEnter={e => {
                      if (!isSending) {
                        e.currentTarget.style.borderColor = `${accentAlpha}0.35)`;
                        e.currentTarget.style.background = `${accentAlpha}0.08)`;
                      }
                    }}
                    onMouseLeave={e => {
                      if (activeInput !== cmd.id) {
                        e.currentTarget.style.borderColor = isDanger ? `${accentAlpha}0.2)` : 'rgba(255,255,255,0.06)';
                        e.currentTarget.style.background = isDanger ? `${accentAlpha}0.05)` : 'rgba(255,255,255,0.03)';
                      }
                    }}
                  >
                    <Icon size={14} style={{ color: isSending ? G.muted : accentColor }} />
                    <span style={{
                      fontSize: 9, fontWeight: 700,
                      color: isSending ? G.muted : isDanger ? accentColor : G.text,
                      textAlign: 'center', lineHeight: 1.3,
                      fontFamily: 'IBM Plex Mono, monospace',
                      letterSpacing: '0.04em',
                    }}>
                      {isSending ? '…' : cmd.label}
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
                          outline: 'none', fontFamily: 'IBM Plex Mono, monospace',
                        }}
                      />
                      <button
                        onClick={() => sendCommand(cmd)}
                        style={{
                          background: G.gold, border: 'none', borderRadius: 8,
                          padding: '6px 10px', fontSize: 10, fontWeight: 700, color: '#0A0F1A', cursor: 'pointer',
                          fontFamily: 'IBM Plex Mono, monospace',
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
              <p style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: G.low, letterSpacing: '0.2em', marginBottom: 10, textTransform: 'uppercase' }}>
                Recent Commands
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {recentCmds.slice(0, 5).map((c, i) => (
                  <div key={i} style={{
                    background: 'rgba(255,255,255,0.025)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 8, padding: '8px 12px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <div>
                      <p style={{ fontSize: 11, fontWeight: 600, color: G.text, fontFamily: 'Space Grotesk, sans-serif' }}>
                        {c.label || (c.command_type || c.command || '').replace(/_/g, ' ')}
                      </p>
                      <p style={{ fontSize: 9, color: G.low, fontFamily: 'IBM Plex Mono, monospace' }}>
                        {fmtRelative(c.issued_at || c.created_at)}
                        {c.issued_by_name ? ` · ${c.issued_by_name}` : ''}
                      </p>
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

  // Build the APK URL pointing at the BACKEND, not the frontend static host.
  // VITE_API_URL is e.g. "https://api.sonalit.com/api/v1" — strip the path suffix
  // to get the backend root, then append the full route.
  const apiBase = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/api\/v1\/?$/, '');
  const apkUrl = `${apiBase}/api/v1/guardian/apk/download`;

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
        boxShadow: '0 30px 80px rgba(0,0,0,0.7)', maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Shield size={16} style={{ color: G.gold }} />
              <span style={{ fontSize: 14, fontWeight: 700, color: G.gold, fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0.1em' }}>
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
          <p style={{ fontSize: 9, color: G.muted, fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0.12em', marginBottom: 4 }}>ORG TOKEN</p>
          <p style={{ fontSize: 13, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, color: G.gold, letterSpacing: '0.06em' }}>{ORG_TOKEN}</p>
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

        {/* Download APK — plain anchor pointing directly at the backend.
            Using a real <a href> (not a fetch/click trick) so the browser
            treats it as a navigation and correctly handles Content-Disposition. */}
        <a
          href={apkUrl}
          download="FleetOps-Guardian.apk"
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
          <p style={{ fontSize: 9, color: G.muted, fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0.12em', marginBottom: 10 }}>INSTRUCTIONS</p>
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

function StatCard({ label, value, color = '#F0B429', glow }) {
  return (
    <div style={{
      background: '#0D1321',
      border: `1px solid ${color}22`,
      borderRadius: 14,
      padding: '14px 18px',
      boxShadow: glow ? `0 0 20px ${color}20` : 'none',
    }}>
      <div style={{ fontSize: 26, fontWeight: 900, color, fontFamily: 'Orbitron, sans-serif', lineHeight: 1, marginBottom: 4 }}>
        {value}
      </div>
      <div style={{ fontSize: 8, color: '#475569', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
        {label}
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
        @keyframes alertFlash { 0%,100%{box-shadow:0 0 0 0 rgba(242,82,82,0)} 50%{box-shadow:0 0 28px 4px rgba(242,82,82,0.15)} }
        @keyframes spin { to { transform: rotate(360deg) } }
      `}</style>

      {/* Panic Banner */}
      {devices.some(d => d.panic_active) && (
        <div style={{
          background: 'rgba(242,82,82,0.12)',
          border: '1px solid rgba(242,82,82,0.4)',
          borderRadius: 14,
          padding: '12px 20px',
          display: 'flex', alignItems: 'center', gap: 12,
          marginBottom: 20,
          animation: 'alertFlash 2s ease-in-out infinite',
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: '#F25252',
            boxShadow: '0 0 10px #F25252',
            animation: 'pulse 1s infinite',
          }} />
          <span style={{
            fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 800,
            color: '#F25252', letterSpacing: '0.12em', textTransform: 'uppercase',
          }}>
            {devices.filter(d => d.panic_active).length} ACTIVE PANIC EVENT{devices.filter(d => d.panic_active).length > 1 ? 'S' : ''} — IMMEDIATE RESPONSE REQUIRED
          </span>
          <a
            href="/panic-center"
            style={{
              marginLeft: 'auto', fontSize: 10, fontFamily: 'IBM Plex Mono, monospace',
              fontWeight: 700, color: '#F25252', letterSpacing: '0.1em',
              textDecoration: 'none', padding: '6px 12px',
              border: '1px solid rgba(242,82,82,0.4)', borderRadius: 8,
              transition: 'all 0.15s',
            }}
          >
            GO TO PANIC CENTER →
          </a>
        </div>
      )}

      {/* Page Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: '#475569', letterSpacing: '0.2em', marginBottom: 6 }}>
            FLEET MANAGEMENT
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <Shield size={20} style={{ color: G.gold }} />
            <h1 style={{ fontSize: 22, fontWeight: 800, color: G.text, letterSpacing: '0.05em', fontFamily: 'Orbitron, sans-serif', margin: 0 }}>
              GUARDIAN DEVICES
            </h1>
          </div>
          <p style={{ fontSize: 12, color: G.muted, margin: 0 }}>Android field agent management</p>
        </div>
        <button
          onClick={() => setShowEnrollment(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 7,
            background: 'rgba(240,180,41,0.08)', border: '1px solid rgba(240,180,41,0.25)',
            borderRadius: 10, padding: '9px 16px', fontSize: 11, fontWeight: 700,
            color: G.gold, cursor: 'pointer', letterSpacing: '0.08em',
            fontFamily: 'IBM Plex Mono, monospace',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'rgba(240,180,41,0.15)';
            e.currentTarget.style.borderColor = 'rgba(240,180,41,0.45)';
            e.currentTarget.style.boxShadow = '0 0 16px rgba(240,180,41,0.15)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'rgba(240,180,41,0.08)';
            e.currentTarget.style.borderColor = 'rgba(240,180,41,0.25)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          <Plus size={13} />
          ENROLL DEVICE
        </button>
      </div>

      {/* Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatCard label="Total Devices" value={stats.total} color="#e2e8f0" />
        <StatCard label="Active"        value={stats.active} color="#22D3A0" glow={stats.active > 0} />
        <StatCard label="Pending"       value={stats.pending} color="#F59E0B" glow={stats.pending > 0} />
        <StatCard label="Panic Active"  value={stats.panic} color="#F25252" glow={stats.panic > 0} />
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
              background: filter === f.key ? 'rgba(240,180,41,0.10)' : 'rgba(255,255,255,0.025)',
              border: `1px solid ${filter === f.key ? 'rgba(240,180,41,0.35)' : 'rgba(255,255,255,0.07)'}`,
              borderRadius: 8, padding: '5px 14px', fontSize: 10, fontWeight: 700,
              color: filter === f.key ? G.gold : G.muted, cursor: 'pointer',
              letterSpacing: '0.1em', transition: 'all 0.15s',
              fontFamily: 'IBM Plex Mono, monospace',
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
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '60px 20px',
          background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14,
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
          gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))',
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
