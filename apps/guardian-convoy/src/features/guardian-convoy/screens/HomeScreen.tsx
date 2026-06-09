import React, { useState, useEffect } from 'react';
import { reportApi } from '../api/reportApi';
import { useGPSStamp } from '../hooks/useGPSStamp';
import type { AuthState, ConvoyReport } from '../types/ConvoyReport';

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

interface HomeScreenProps {
  navigate: (screen: string) => void;
  auth: AuthState | null;
}

interface ChecklistItem {
  key: string;
  label: string;
  sub: string;
  done: boolean;
  screen?: string;
  locked?: boolean;
}

function SignalBars({ strength = 3 }: { strength?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 14 }}>
      {[1, 2, 3, 4].map(i => (
        <div key={i} style={{
          width: 3, height: 3 + i * 2.5, borderRadius: 1,
          background: i <= strength ? T.lime : T.muted,
        }} />
      ))}
    </div>
  );
}

function GPSBlock({ gps, loading, error }: { gps: any; loading: boolean; error: string | null }) {
  return (
    <div style={{
      background: T.card, border: `1px solid ${T.rim}`, borderRadius: 10,
      padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{ fontSize: 18 }}>📍</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: T.cond, fontSize: 11, color: T.sub, letterSpacing: 2, marginBottom: 2 }}>GPS STAMP</div>
        {loading && <div style={{ fontFamily: T.mono, fontSize: 11, color: T.body }}>Acquiring lock…</div>}
        {error && <div style={{ fontFamily: T.mono, fontSize: 11, color: T.red }}>{error}</div>}
        {gps && !loading && (
          <div style={{ fontFamily: T.mono, fontSize: 12, color: T.lime }}>
            {gps.lat.toFixed(6)}, {gps.lng.toFixed(6)}
            <span style={{ color: T.sub, fontSize: 10, marginLeft: 8 }}>±{Math.round(gps.accuracy)}m</span>
          </div>
        )}
      </div>
      <div style={{
        fontFamily: T.mono, fontSize: 9, color: gps ? T.lime : T.muted,
        border: `1px solid ${gps ? T.limeRim : T.rim}`, borderRadius: 4,
        padding: '2px 6px', letterSpacing: 1,
      }}>{gps ? 'LOCK' : 'NO FIX'}</div>
    </div>
  );
}

export function HomeScreen({ navigate, auth }: HomeScreenProps) {
  const [report, setReport]   = useState<ConvoyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const { gps, loading: gpsLoading, error: gpsError } = useGPSStamp();

  useEffect(() => {
    if (!auth) return;
    reportApi.getReport(auth.convoy.id, auth.token)
      .then(setReport)
      .catch(() => setReport(null))
      .finally(() => setLoading(false));
  }, [auth]);

  if (!auth) return null;

  const checklist: ChecklistItem[] = [
    {
      key: 'sod',
      label: 'START-OF-DAY UPLOAD',
      sub: 'Vehicle & cargo photos at origin',
      done: !!report?.sod_submitted_at,
      screen: 'sod',
    },
    {
      key: 'departure',
      label: 'DEPARTURE CONFIRMED',
      sub: 'Convoy departs origin',
      done: !!report?.sod_submitted_at,
      locked: !report?.sod_submitted_at,
    },
    {
      key: 'transit',
      label: 'IN TRANSIT',
      sub: 'En route to destination',
      done: !!report?.arrival_at,
      locked: !report?.sod_submitted_at,
    },
    {
      key: 'arrival',
      label: 'ARRIVAL CONFIRMED',
      sub: 'Confirmed at destination',
      done: !!report?.arrival_at,
      locked: !report?.sod_submitted_at,
    },
    {
      key: 'eod',
      label: 'END-OF-DAY UPLOAD',
      sub: 'Arrival & delivery photos',
      done: !!report?.eod_submitted_at,
      screen: 'eod',
      locked: !report?.sod_submitted_at,
    },
  ];

  const completedCount = checklist.filter(c => c.done).length;
  const progress = Math.round((completedCount / 5) * 100);

  const statusLabel = loading ? 'LOADING…'
    : report?.status === 'eod_complete' ? 'COMPLETE'
    : report?.status === 'sod_complete' ? 'IN TRANSIT'
    : 'IN PROGRESS';

  const statusColor = report?.status === 'eod_complete' ? T.green
    : report?.status === 'sod_complete' ? T.lime
    : T.orange;

  return (
    <div style={{ minHeight: '100dvh', background: T.void, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        background: T.deep, borderBottom: `1px solid ${T.rim}`,
        padding: '12px 16px 0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 8,
              background: T.limeBg, border: `1px solid ${T.limeRim}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontFamily: T.cond, fontSize: 14, fontWeight: 900, color: T.void }}>G</span>
            </div>
            <div>
              <div style={{ fontFamily: T.cond, fontSize: 18, fontWeight: 900, color: T.white, letterSpacing: 2, lineHeight: 1 }}>
                GUARDIAN CONVOY
              </div>
              <div style={{ fontFamily: T.mono, fontSize: 9, color: T.sub, letterSpacing: 2 }}>FIELD OPERATIONS</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              background: T.greenBg, border: `1px solid ${T.green}`,
              borderRadius: 4, padding: '2px 7px',
              fontFamily: T.mono, fontSize: 9, color: T.green, letterSpacing: 2,
            }}>LIVE</div>
            <div style={{ fontSize: 18, cursor: 'pointer' }}>🔔</div>
          </div>
        </div>

        {/* CFO strip */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: T.surface, borderRadius: '8px 8px 0 0',
          padding: '10px 14px',
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            background: T.lime, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontFamily: T.cond, fontSize: 14, fontWeight: 900, color: T.void }}>{auth.cfo.initials}</span>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: T.cond, fontSize: 15, fontWeight: 700, color: T.white, letterSpacing: 1 }}>{auth.cfo.name}</div>
            <div style={{ fontFamily: T.mono, fontSize: 10, color: T.sub }}>{auth.cfo.id}</div>
          </div>
          <SignalBars strength={4} />
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 100px' }}>

        {/* Convoy Hero Card */}
        <div style={{
          background: T.card, border: `1px solid ${T.rim}`, borderRadius: 14,
          padding: '18px 18px', marginBottom: 14,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div style={{ fontFamily: T.mono, fontSize: 10, color: T.sub, letterSpacing: 2, marginBottom: 4 }}>CONVOY ID</div>
              <div style={{ fontFamily: T.cond, fontSize: 22, fontWeight: 900, color: T.white, letterSpacing: 2 }}>{auth.convoy.id}</div>
            </div>
            <div style={{
              background: statusColor + '22', border: `1px solid ${statusColor}55`,
              borderRadius: 6, padding: '4px 10px',
              fontFamily: T.cond, fontSize: 12, fontWeight: 700,
              color: statusColor, letterSpacing: 2,
            }}>{statusLabel}</div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <div style={{ fontFamily: T.cond, fontSize: 15, color: T.text, fontWeight: 600 }}>{auth.convoy.origin}</div>
            <div style={{ color: T.lime, fontSize: 12 }}>→</div>
            <div style={{ fontFamily: T.cond, fontSize: 15, color: T.text, fontWeight: 600 }}>{auth.convoy.destination}</div>
          </div>

          <div style={{ display: 'flex', gap: 16, marginBottom: 14 }}>
            <div>
              <div style={{ fontFamily: T.mono, fontSize: 9, color: T.muted, letterSpacing: 1 }}>TRUCKS</div>
              <div style={{ fontFamily: T.cond, fontSize: 18, fontWeight: 700, color: T.lime }}>{auth.convoy.trucks.length}</div>
            </div>
            <div>
              <div style={{ fontFamily: T.mono, fontSize: 9, color: T.muted, letterSpacing: 1 }}>SEALS</div>
              <div style={{ fontFamily: T.cond, fontSize: 18, fontWeight: 700, color: T.lime }}>{auth.convoy.seals.length}</div>
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ background: T.raised, borderRadius: 4, height: 6, overflow: 'hidden' }}>
            <div style={{
              width: `${progress}%`, height: '100%',
              background: `linear-gradient(90deg, ${T.lime}, ${T.green})`,
              borderRadius: 4, transition: 'width 0.6s ease',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontFamily: T.mono, fontSize: 9, color: T.sub }}>MISSION PROGRESS</span>
            <span style={{ fontFamily: T.mono, fontSize: 9, color: T.lime }}>{progress}%</span>
          </div>
        </div>

        {/* Upload Checklist */}
        <div style={{
          background: T.card, border: `1px solid ${T.rim}`, borderRadius: 14,
          padding: '16px', marginBottom: 14,
        }}>
          <div style={{ fontFamily: T.cond, fontSize: 13, fontWeight: 700, color: T.sub, letterSpacing: 3, marginBottom: 12 }}>
            MISSION CHECKLIST
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {checklist.map((item, idx) => (
              <div
                key={item.key}
                onClick={() => !item.locked && item.screen && navigate(item.screen)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  background: item.done ? T.greenBg : item.locked ? 'transparent' : T.raised,
                  border: `1px solid ${item.done ? T.green + '44' : item.locked ? T.rim : T.rim2}`,
                  borderRadius: 10, padding: '10px 14px',
                  cursor: item.locked || !item.screen ? 'default' : 'pointer',
                  opacity: item.locked ? 0.45 : 1,
                  transition: 'background 0.2s',
                }}
              >
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: item.done ? T.green : item.locked ? T.muted : T.raised,
                  border: `1.5px solid ${item.done ? T.green : T.rim}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: T.mono, fontSize: 11, color: item.done ? T.void : T.sub,
                  flexShrink: 0,
                }}>
                  {item.done ? '✓' : idx + 1}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: T.cond, fontSize: 14, fontWeight: 700, color: item.done ? T.green : T.text, letterSpacing: 1 }}>
                    {item.label}
                  </div>
                  <div style={{ fontFamily: T.mono, fontSize: 10, color: T.sub }}>{item.sub}</div>
                </div>
                {item.screen && !item.locked && !item.done && (
                  <span style={{ color: T.lime, fontSize: 14 }}>›</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Seal Quick View */}
        <div style={{
          background: T.card, border: `1px solid ${T.rim}`, borderRadius: 14,
          padding: '16px', marginBottom: 14,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontFamily: T.cond, fontSize: 13, fontWeight: 700, color: T.sub, letterSpacing: 3 }}>
              SEALS QUICK VIEW
            </div>
            <button
              onClick={() => navigate('seals')}
              style={{
                background: 'none', border: `1px solid ${T.rim}`, borderRadius: 6,
                padding: '4px 10px', fontFamily: T.cond, fontSize: 11, color: T.body,
                cursor: 'pointer', letterSpacing: 1,
              }}
            >ALL SEALS</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {auth.convoy.seals.slice(0, 4).map(seal => (
              <div key={seal.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px', background: T.surface, borderRadius: 8,
              }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%', background: T.lime, flexShrink: 0,
                }} />
                <div style={{ fontFamily: T.mono, fontSize: 12, color: T.text, flex: 1 }}>{seal.serial}</div>
                <div style={{ fontFamily: T.mono, fontSize: 10, color: T.sub }}>{seal.vehicle_plate}</div>
                <div style={{ fontFamily: T.mono, fontSize: 9, color: T.muted }}>{seal.position}</div>
              </div>
            ))}
            {auth.convoy.seals.length > 4 && (
              <div style={{ fontFamily: T.mono, fontSize: 10, color: T.muted, textAlign: 'center', padding: '4px 0' }}>
                +{auth.convoy.seals.length - 4} more seals
              </div>
            )}
          </div>
        </div>

        {/* GPS Block */}
        <GPSBlock gps={gps} loading={gpsLoading} error={gpsError} />

        {/* SOS Quick Button */}
        <button
          onClick={() => navigate('sos')}
          style={{
            marginTop: 14, width: '100%',
            background: T.redBg, border: `1px solid ${T.red}55`,
            borderRadius: 12, padding: '14px 0',
            fontFamily: T.cond, fontSize: 16, fontWeight: 900, color: T.red,
            letterSpacing: 3, cursor: 'pointer',
          }}
        >
          🆘 EMERGENCY / SOS
        </button>
      </div>

      {/* Bottom nav */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: T.deep, borderTop: `1px solid ${T.rim}`,
        display: 'flex', padding: '8px 0 16px',
      }}>
        {[
          { key: 'home', icon: '⊞', label: 'HOME' },
          { key: 'sod', icon: '📷', label: 'SOD' },
          { key: 'seals', icon: '🔒', label: 'SEALS' },
          { key: 'eod', icon: '📦', label: 'EOD' },
          { key: 'history', icon: '📋', label: 'HISTORY' },
        ].map(item => (
          <button
            key={item.key}
            onClick={() => navigate(item.key)}
            style={{
              flex: 1, background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              padding: '4px 0',
            }}
          >
            <span style={{ fontSize: 18 }}>{item.icon}</span>
            <span style={{
              fontFamily: T.mono, fontSize: 9, color: item.key === 'home' ? T.lime : T.muted,
              letterSpacing: 1,
            }}>{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
