import { useState, useEffect } from 'react';
import { sosApi } from '../api/sosApi';
import { useGPSStamp } from '../hooks/useGPSStamp';
import type { AuthState } from '../types/ConvoyReport';
import type { IncidentType } from '../types/SOSEvent';

const T = {
  void: '#060a08', deep: '#0c1410', surface: '#111d16',
  card: '#162019', raised: '#1d2c21',
  rim: 'rgba(255,255,255,0.07)', rim2: 'rgba(255,255,255,0.12)',
  lime: '#a8e63d', limeBg: 'rgba(168,230,61,0.10)', limeRim: 'rgba(168,230,61,0.25)',
  green: '#22c55e', greenBg: 'rgba(34,197,94,0.10)',
  orange: '#f97316', orangeBg: 'rgba(249,115,22,0.10)',
  red: '#ef4444', redBg: 'rgba(239,68,68,0.10)',
  text: '#d4e8d6', body: '#8aaa8e', sub: '#5a7a5e', muted: '#3d5442', white: '#f0f8f2',
  cond: "'Barlow Condensed', sans-serif",
  mono: "'Share Tech Mono', monospace",
  sans: "'Barlow', sans-serif",
};

const KF = `
@keyframes pulseRing1 {
  0%   { transform: scale(0.85); opacity: 0.7; }
  100% { transform: scale(1.9);  opacity: 0; }
}
@keyframes pulseRing2 {
  0%   { transform: scale(0.85); opacity: 0.5; }
  100% { transform: scale(2.4);  opacity: 0; }
}
@keyframes redBlink {
  0%,100% { opacity: 1; }
  50%      { opacity: 0.3; }
}
`;

const INCIDENT_TYPES: { key: IncidentType; label: string; icon: string; color: string }[] = [
  { key: 'armed_attack',   label: 'Armed Attack',    icon: '🔫', color: '#ef4444' },
  { key: 'robbery_hijack', label: 'Robbery/Hijack',  icon: '🚨', color: '#f97316' },
  { key: 'breakdown',      label: 'Breakdown',       icon: '🔧', color: '#f59e0b' },
  { key: 'medical',        label: 'Medical',         icon: '🏥', color: '#3b82f6' },
  { key: 'unspecified',    label: 'Unspecified',     icon: '❓', color: '#8aaa8e' },
];

interface SOSScreenProps {
  navigate: (screen: string) => void;
  auth: AuthState | null;
}

function SOSConfirmOverlay({ event, onClose }: { event: any; onClose: () => void }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(6,10,8,0.95)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, zIndex: 100,
    }}>
      <div style={{
        background: T.card, border: `1.5px solid ${T.red}`,
        borderRadius: 18, padding: '28px 24px', width: '100%', maxWidth: 380,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>🆘</div>
          <div style={{ fontFamily: T.cond, fontSize: 26, fontWeight: 900, color: T.red, letterSpacing: 2 }}>
            PANIC ALERT SENT
          </div>
          <div style={{ fontFamily: T.mono, fontSize: 11, color: T.sub, marginTop: 4 }}>
            Control room has been notified
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: T.surface, borderRadius: 8 }}>
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.sub }}>EVENT ID</span>
            <span style={{ fontFamily: T.mono, fontSize: 10, color: T.text }}>{event?.id ?? '—'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: T.surface, borderRadius: 8 }}>
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.sub }}>INCIDENT</span>
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.red }}>
              {INCIDENT_TYPES.find(i => i.key === event?.incident_type)?.label ?? event?.incident_type}
            </span>
          </div>
          {(event?.lat != null) && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: T.surface, borderRadius: 8 }}>
              <span style={{ fontFamily: T.mono, fontSize: 11, color: T.sub }}>GPS</span>
              <span style={{ fontFamily: T.mono, fontSize: 10, color: T.lime }}>
                {Number(event.lat).toFixed(5)}, {Number(event.lng).toFixed(5)}
              </span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: T.redBg, borderRadius: 8, border: `1px solid ${T.red}44` }}>
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.sub }}>STATUS</span>
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.red }}>BROADCASTING ●</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, background: T.raised, color: T.body,
              border: `1px solid ${T.rim}`, borderRadius: 10, padding: '13px 0',
              fontFamily: T.cond, fontSize: 14, fontWeight: 700, letterSpacing: 2, cursor: 'pointer',
            }}
          >STAY</button>
          <button
            onClick={() => { onClose(); }}
            style={{
              flex: 2, background: T.redBg, color: T.red,
              border: `1.5px solid ${T.red}55`, borderRadius: 10, padding: '13px 0',
              fontFamily: T.cond, fontSize: 14, fontWeight: 900, letterSpacing: 2, cursor: 'pointer',
            }}
          >HOME</button>
        </div>
      </div>
    </div>
  );
}

export function SOSScreen({ navigate, auth }: SOSScreenProps) {
  const [selectedIncident, setSelectedIncident] = useState<IncidentType>('unspecified');
  const [sending, setSending]                   = useState(false);
  const [showConfirm, setShowConfirm]           = useState(false);
  const [sentEvent, setSentEvent]               = useState<any>(null);
  const [error, setError]                       = useState<string | null>(null);
  const { gps } = useGPSStamp();

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = KF;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  if (!auth) return null;

  async function handleSendPanic() {
    setSending(true);
    setError(null);
    try {
      const event = await sosApi.sendPanic(
        auth!.convoy.id,
        auth!.cfo.id,
        selectedIncident,
        gps?.lat ?? null,
        gps?.lng ?? null,
        gps?.accuracy ?? null,
        auth!.token,
      );
      setSentEvent(event);
      setShowConfirm(true);
    } catch {
      setError('Alert failed to send. Please call the control room directly.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ minHeight: '100dvh', background: T.void, display: 'flex', flexDirection: 'column' }}>
      {showConfirm && sentEvent && (
        <SOSConfirmOverlay event={sentEvent} onClose={() => navigate('home')} />
      )}

      {/* Sub-header */}
      <div style={{
        background: T.deep, borderBottom: `1px solid ${T.red}44`,
        padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button onClick={() => navigate('home')} style={{
          background: T.raised, border: `1px solid ${T.rim}`, borderRadius: 8,
          padding: '8px 12px', fontFamily: T.cond, fontSize: 14, color: T.body,
          cursor: 'pointer', letterSpacing: 1,
        }}>← BACK</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: T.cond, fontSize: 20, fontWeight: 900, color: T.red, letterSpacing: 2 }}>EMERGENCY</div>
          <div style={{ fontFamily: T.mono, fontSize: 9, color: T.sub }}>Panic alert & SOS broadcast</div>
        </div>
        <div style={{
          background: T.redBg, border: `1px solid ${T.red}55`,
          borderRadius: 6, padding: '4px 10px',
          fontFamily: T.cond, fontSize: 12, fontWeight: 700, color: T.red, letterSpacing: 2,
        }}>SOS</div>
      </div>

      {/* GPS broadcasting status bar */}
      <div style={{
        background: T.redBg, borderBottom: `1px solid ${T.red}33`,
        padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%', background: T.red, flexShrink: 0,
          animation: 'redBlink 1s ease-in-out infinite',
        }} />
        <span style={{ fontFamily: T.mono, fontSize: 10, color: T.red, letterSpacing: 2, flex: 1 }}>
          GPS TRACKING BROADCASTING
        </span>
        {gps ? (
          <span style={{ fontFamily: T.mono, fontSize: 9, color: T.body }}>
            {gps.lat.toFixed(4)}, {gps.lng.toFixed(4)}
          </span>
        ) : (
          <span style={{ fontFamily: T.mono, fontSize: 9, color: T.muted }}>NO FIX</span>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 16px 100px' }}>

        {/* SOS hero block with pulse rings */}
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          marginBottom: 32, paddingTop: 16,
        }}>
          <div style={{ position: 'relative', width: 100, height: 100, marginBottom: 20 }}>
            {/* Pulse ring 2 */}
            <div style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              border: `2px solid ${T.red}`,
              animation: 'pulseRing2 2s ease-out infinite 0.4s',
              transformOrigin: 'center',
            }} />
            {/* Pulse ring 1 */}
            <div style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              border: `2px solid ${T.red}`,
              animation: 'pulseRing1 2s ease-out infinite',
              transformOrigin: 'center',
            }} />
            {/* SOS icon */}
            <div style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              background: T.redBg, border: `2px solid ${T.red}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 40,
            }}>🆘</div>
          </div>

          <div style={{ fontFamily: T.cond, fontSize: 28, fontWeight: 900, color: T.red, letterSpacing: 3, textAlign: 'center' }}>
            PANIC ALERT
          </div>
          <div style={{ fontFamily: T.mono, fontSize: 11, color: T.sub, marginTop: 4, textAlign: 'center' }}>
            Sends GPS, convoy ID and CFO identity to control room
          </div>
        </div>

        {/* Incident type grid */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: T.cond, fontSize: 11, color: T.sub, letterSpacing: 2, marginBottom: 10 }}>
            INCIDENT TYPE
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {INCIDENT_TYPES.map(type => {
              const active = selectedIncident === type.key;
              return (
                <button
                  key={type.key}
                  onClick={() => setSelectedIncident(type.key)}
                  style={{
                    background: active ? type.color + '22' : T.card,
                    border: `1.5px solid ${active ? type.color : T.rim}`,
                    borderRadius: 12, padding: '14px 10px',
                    cursor: 'pointer', textAlign: 'center',
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ fontSize: 24, marginBottom: 6 }}>{type.icon}</div>
                  <div style={{
                    fontFamily: T.cond, fontSize: 13, fontWeight: 700,
                    color: active ? type.color : T.body, letterSpacing: 1,
                  }}>{type.label}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* GPS block */}
        <div style={{
          background: T.card, border: `1px solid ${T.rim}`, borderRadius: 10,
          padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20,
        }}>
          <span style={{ fontSize: 16 }}>📍</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: T.cond, fontSize: 10, color: T.sub, letterSpacing: 2, marginBottom: 2 }}>GPS STAMP</div>
            {!gps && <div style={{ fontFamily: T.mono, fontSize: 11, color: T.muted }}>No fix — alert will send without GPS</div>}
            {gps && (
              <div style={{ fontFamily: T.mono, fontSize: 11, color: T.lime }}>
                {gps.lat.toFixed(6)}, {gps.lng.toFixed(6)}
                <span style={{ color: T.sub, fontSize: 9, marginLeft: 8 }}>±{Math.round(gps.accuracy)}m</span>
              </div>
            )}
          </div>
          <div style={{
            fontFamily: T.mono, fontSize: 9, letterSpacing: 1,
            color: gps ? T.lime : T.muted,
            border: `1px solid ${gps ? T.limeRim : T.rim}`, borderRadius: 4, padding: '2px 6px',
          }}>{gps ? 'LOCK' : 'NO FIX'}</div>
        </div>

        {error && (
          <div style={{
            background: T.redBg, border: `1px solid ${T.red}55`,
            borderRadius: 8, padding: '10px 14px', marginBottom: 16,
            fontFamily: T.mono, fontSize: 12, color: T.red,
          }}>{error}</div>
        )}
      </div>

      {/* Send Panic button */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        padding: '12px 16px 24px', background: T.deep, borderTop: `1px solid ${T.red}33`,
      }}>
        <button
          onClick={handleSendPanic}
          disabled={sending}
          style={{
            width: '100%',
            background: sending ? T.muted : T.red,
            color: T.white, border: 'none', borderRadius: 12,
            padding: '18px 0', cursor: sending ? 'not-allowed' : 'pointer',
            fontFamily: T.cond, fontSize: 20, fontWeight: 900, letterSpacing: 4,
            boxShadow: sending ? 'none' : `0 0 24px ${T.red}55`,
            transition: 'all 0.2s',
          }}
        >
          {sending ? 'SENDING ALERT…' : '⚡ SEND PANIC ALERT'}
        </button>
      </div>
    </div>
  );
}
