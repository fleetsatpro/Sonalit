import { useState, useEffect } from 'react';
import { reportApi } from '../api/reportApi';
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

interface HistoryScreenProps {
  navigate: (screen: string) => void;
  auth: AuthState | null;
}

interface BadgeInfo {
  label: string;
  color: string;
  bg: string;
  icon: string;
}

function getBadge(report: ConvoyReport): BadgeInfo {
  if (report.status === 'eod_complete') {
    // Check for PDF failure: eod submitted but no pdf_url
    if (report.eod_submitted_at && !report.pdf_url) {
      return { label: 'PDF Failed', color: T.red, bg: T.redBg, icon: '⚠' };
    }
    return { label: 'Complete', color: T.green, bg: T.greenBg, icon: '✓' };
  }
  if (report.status === 'sod_complete') {
    return { label: 'In Progress', color: T.orange, bg: T.orangeBg, icon: '→' };
  }
  if (report.status === 'in_progress') {
    return { label: 'In Progress', color: T.orange, bg: T.orangeBg, icon: '→' };
  }
  return { label: 'Unknown', color: T.sub, bg: T.surface, icon: '?' };
}

function getIconBg(report: ConvoyReport): string {
  if (report.status === 'eod_complete' && report.pdf_url) return T.greenBg;
  if (report.status === 'eod_complete' && !report.pdf_url) return T.redBg;
  if (report.status === 'sod_complete') return T.orangeBg;
  return T.surface;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function SkeletonCard() {
  return (
    <div style={{
      background: T.card, border: `1px solid ${T.rim}`,
      borderRadius: 14, padding: '16px 16px', marginBottom: 12,
      display: 'flex', gap: 14, alignItems: 'center',
    }}>
      <div style={{ width: 44, height: 44, borderRadius: 10, background: T.raised }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ height: 14, width: '60%', background: T.raised, borderRadius: 4 }} />
        <div style={{ height: 10, width: '80%', background: T.raised, borderRadius: 4 }} />
        <div style={{ height: 10, width: '40%', background: T.raised, borderRadius: 4 }} />
      </div>
    </div>
  );
}

export function HistoryScreen({ navigate, auth }: HistoryScreenProps) {
  const [history, setHistory] = useState<ConvoyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!auth) return;
    reportApi.getHistory(auth.token)
      .then(data => setHistory(data))
      .catch(() => setError('Failed to load trip history. Pull to retry.'))
      .finally(() => setLoading(false));
  }, [auth]);

  if (!auth) return null;

  // Derive origin/destination from auth.convoy for current report fallback
  const currentConvoy = auth.convoy;

  return (
    <div style={{ minHeight: '100dvh', background: T.void, display: 'flex', flexDirection: 'column' }}>
      {/* Sub-header */}
      <div style={{
        background: T.deep, borderBottom: `1px solid ${T.rim}`,
        padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button onClick={() => navigate('home')} style={{
          background: T.raised, border: `1px solid ${T.rim}`, borderRadius: 8,
          padding: '8px 12px', fontFamily: T.cond, fontSize: 14, color: T.body,
          cursor: 'pointer', letterSpacing: 1,
        }}>← BACK</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: T.cond, fontSize: 20, fontWeight: 900, color: T.white, letterSpacing: 2 }}>
            TRIP HISTORY
          </div>
          <div style={{ fontFamily: T.mono, fontSize: 9, color: T.sub }}>Previous convoy reports</div>
        </div>
        {!loading && (
          <div style={{
            background: T.limeBg, border: `1px solid ${T.limeRim}`,
            borderRadius: 6, padding: '4px 10px',
            fontFamily: T.cond, fontSize: 12, fontWeight: 700, color: T.lime, letterSpacing: 1,
          }}>{history.length} TRIPS</div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 32px' }}>

        {/* Stats strip */}
        {!loading && history.length > 0 && (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16,
          }}>
            {[
              {
                label: 'COMPLETE',
                value: history.filter(r => r.status === 'eod_complete' && r.pdf_url).length,
                color: T.green,
              },
              {
                label: 'IN PROGRESS',
                value: history.filter(r => r.status === 'in_progress' || r.status === 'sod_complete').length,
                color: T.orange,
              },
              {
                label: 'PDF FAILED',
                value: history.filter(r => r.eod_submitted_at && !r.pdf_url).length,
                color: T.red,
              },
            ].map(stat => (
              <div key={stat.label} style={{
                background: T.card, border: `1px solid ${T.rim}`,
                borderRadius: 10, padding: '12px 10px', textAlign: 'center',
              }}>
                <div style={{ fontFamily: T.cond, fontSize: 22, fontWeight: 900, color: stat.color }}>
                  {stat.value}
                </div>
                <div style={{ fontFamily: T.mono, fontSize: 8, color: T.muted, letterSpacing: 1, marginTop: 2 }}>
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Loading skeletons */}
        {loading && (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        )}

        {/* Error state */}
        {error && !loading && (
          <div style={{
            background: T.redBg, border: `1px solid ${T.red}55`,
            borderRadius: 12, padding: '20px 16px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
            <div style={{ fontFamily: T.cond, fontSize: 16, color: T.red, letterSpacing: 1, marginBottom: 6 }}>
              LOAD FAILED
            </div>
            <div style={{ fontFamily: T.mono, fontSize: 11, color: T.body, marginBottom: 14 }}>{error}</div>
            <button
              onClick={() => {
                setLoading(true);
                setError(null);
                reportApi.getHistory(auth.token)
                  .then(setHistory)
                  .catch(() => setError('Still unable to load. Check connection.'))
                  .finally(() => setLoading(false));
              }}
              style={{
                background: T.raised, border: `1px solid ${T.rim}`, borderRadius: 8,
                padding: '10px 20px', fontFamily: T.cond, fontSize: 14, color: T.body,
                cursor: 'pointer', letterSpacing: 2,
              }}
            >RETRY</button>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && history.length === 0 && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            padding: '48px 20px', gap: 12,
          }}>
            <div style={{ fontSize: 48, opacity: 0.4 }}>📋</div>
            <div style={{ fontFamily: T.cond, fontSize: 18, color: T.muted, letterSpacing: 2 }}>NO TRIPS YET</div>
            <div style={{ fontFamily: T.mono, fontSize: 11, color: T.muted, textAlign: 'center' }}>
              Completed convoy reports will appear here
            </div>
          </div>
        )}

        {/* History cards */}
        {!loading && !error && history.map(report => {
          const badge   = getBadge(report);
          const iconBg  = getIconBg(report);
          const isPdf   = report.status === 'eod_complete' && report.pdf_url;

          return (
            <div key={report.id} style={{
              background: T.card, border: `1px solid ${T.rim}`,
              borderRadius: 14, padding: '16px', marginBottom: 12,
              display: 'flex', gap: 14, alignItems: 'flex-start',
            }}>
              {/* Icon */}
              <div style={{
                width: 44, height: 44, borderRadius: 10, background: iconBg,
                border: `1px solid ${badge.color}33`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, fontSize: 20,
              }}>
                {report.status === 'eod_complete' && report.pdf_url ? '✅'
                  : report.status === 'eod_complete' ? '⚠️'
                  : report.status === 'sod_complete' ? '🚛'
                  : '📋'}
              </div>

              {/* Details */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div style={{ fontFamily: T.mono, fontSize: 12, color: T.text, letterSpacing: 1 }}>
                    {report.convoy_id}
                  </div>
                  <div style={{
                    background: badge.bg, border: `1px solid ${badge.color}44`,
                    borderRadius: 12, padding: '2px 8px', flexShrink: 0,
                    fontFamily: T.cond, fontSize: 11, fontWeight: 700,
                    color: badge.color, letterSpacing: 1,
                  }}>
                    {badge.icon} {badge.label}
                  </div>
                </div>

                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6,
                  fontFamily: T.cond, fontSize: 13, color: T.body,
                }}>
                  <span>{currentConvoy.origin}</span>
                  <span style={{ color: T.lime }}>→</span>
                  <span>{currentConvoy.destination}</span>
                </div>

                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <div style={{ fontFamily: T.mono, fontSize: 10, color: T.sub }}>
                    {formatDate(report.date)}
                  </div>
                  {report.sod_submitted_at && (
                    <div style={{ fontFamily: T.mono, fontSize: 9, color: T.muted }}>
                      SOD {new Date(report.sod_submitted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                  {report.eod_submitted_at && (
                    <div style={{ fontFamily: T.mono, fontSize: 9, color: T.muted }}>
                      EOD {new Date(report.eod_submitted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                </div>

                {isPdf && report.pdf_url && (
                  <a
                    href={report.pdf_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 8,
                      fontFamily: T.mono, fontSize: 10, color: T.lime, textDecoration: 'none',
                      background: T.limeBg, border: `1px solid ${T.limeRim}`,
                      borderRadius: 6, padding: '4px 10px',
                    }}
                  >
                    📄 VIEW PDF REPORT
                  </a>
                )}

                {report.eod_submitted_at && !report.pdf_url && (
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 8,
                    fontFamily: T.mono, fontSize: 10, color: T.orange,
                    background: T.orangeBg, border: `1px solid ${T.orange}33`,
                    borderRadius: 6, padding: '4px 10px',
                  }}>
                    ⏳ PDF generating…
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
