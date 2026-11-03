import React from 'react';
import { FileDown, RefreshCw, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import { api } from '../../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PhotoRecord {
  id: string;
  convoy_truck_id: string;
  session: 'sod' | 'eod';
  photo_type: 'front' | 'rear' | 'seal';
  seal_position?: string;
  photo_url: string;
  taken_at: string;
  lat?: number;
  lng?: number;
  location_mismatch?: boolean;
}

export interface SealRecord {
  id: string;
  convoy_truck_id: string;
  seal_position: string;
  rfid_code: string;
  session: 'sod' | 'eod';
  status: 'intact' | 'broken' | 'missing' | 'replaced';
  photo_url?: string;
  notes?: string;
  scanned_at?: string;
}

export interface TruckRecord {
  id: string;
  plate_number: string;
  make: string;
  model: string;
  position: number;
  cfo_name?: string;
  photos: PhotoRecord[];
  seals: SealRecord[];
}

export interface WaypointRecord {
  lat: number;
  lng: number;
  speed_kmh?: number;
  heading?: number;
  recorded_at: string;
}

export interface DailyReportMeta {
  status: string;
  received_photo_count: number;
  required_photo_count: number;
  generated_at?: string;
  pdf_url?: string;
  generation_error?: string;
}

export interface CfoUpload {
  id: string;
  photo_type: string;
  photo_url: string;
  session: 'sod' | 'eod';
  plate_number: string;
  lat?: number;
  lng?: number;
  taken_at: string;
  cfo_name?: string;
}

export interface IntegrityFinding {
  severity: 'critical' | 'warning' | 'info';
  code: string;
  title: string;
  detail: string;
}
export interface IntegrityRoute {
  hasTrack: boolean;
  distanceKm: number;
  durationMin: number;
  avgSpeedKmh: number | null;
  maxSpeedKmh: number | null;
  stops: number;
  maxStopMin: number;
  overspeedCount: number;
  deviationKm: number | null;
  gpsPoints: number;
}
export interface Integrity {
  verdict: 'cleared' | 'review' | 'exceptions';
  score: number;
  coverage: { received: number; required: number; pct: number };
  findings: IntegrityFinding[];
  counts: { critical: number; warning: number; info: number };
  route: IntegrityRoute;
  seals: { total: number; anomalies: number };
  gpsMismatches: number;
  evidenceDigest: string;
}

export interface ReportDetail {
  convoy: {
    id: string;
    name: string;
    status: string;
    start_date: string;
    end_date: string;
    timezone: string;
    seal_count_per_truck: number;
    client_name?: string | null;
    client_company?: string | null;
  };
  report_date: string;
  daily_report: DailyReportMeta | null;
  integrity?: Integrity | null;
  trucks: TruckRecord[];
  waypoints: WaypointRecord[];
  cfo_uploads?: CfoUpload[];
}

// ── Sub-components ────────────────────────────────────────────────────────────

const SEAL_STATUS_COLOR: Record<string, string> = {
  intact: '#22c55e',
  broken: '#ef4444',
  missing: '#f59e0b',
  replaced: '#a78bfa',
  present: '#22c55e',
};

function PhotoBox({ url = undefined, label }: { url?: string | undefined; label: string }) {
  const hasUrl = url && url.startsWith('http');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{
        width: '100%', aspectRatio: '4/3', background: hasUrl ? 'transparent' : '#e5e7eb',
        borderRadius: 4, border: '1px solid #d1d5db', overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {hasUrl
          ? <img src={url} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; e.currentTarget.parentElement!.style.background = '#fee2e2'; }}
            />
          : <span style={{ fontSize: 10, color: '#9ca3af', fontFamily: 'JetBrains Mono, monospace' }}>NO PHOTO</span>
        }
      </div>
      <span style={{ fontSize: 9, color: '#6b7280', textTransform: 'uppercase',
        letterSpacing: '0.05em', fontFamily: 'JetBrains Mono, monospace' }}>{label}</span>
    </div>
  );
}

function TruckBlock({ truck, session }: { truck: TruckRecord; session: 'sod' | 'eod' }) {
  const photos = truck.photos.filter(p => p.session === session);
  const seals = truck.seals.filter(s => s.session === session);

  const front = photos.find(p => p.photo_type === 'front');
  const rear = photos.find(p => p.photo_type === 'rear');
  const sealPhoto = (pos: string) => photos.find(p => p.photo_type === 'seal' && p.seal_position === pos);
  const sealRecord = (pos: string) => seals.find(s => s.seal_position === pos);
  const sealPositions = Array.from(new Set([
    ...seals.map(s => s.seal_position),
    ...photos.filter(p => p.photo_type === 'seal').map(p => p.seal_position!),
  ])).sort();

  return (
    <div style={{
      border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 16, overflow: 'hidden',
    }}>
      <div style={{
        background: '#f8fafc', borderBottom: '1px solid #e5e7eb',
        padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, fontSize: 13, color: '#111827' }}>
          {truck.plate_number}
          <span style={{ fontWeight: 400, color: '#6b7280', marginLeft: 8 }}>
            {truck.make} {truck.model}
          </span>
        </span>
        {truck.cfo_name && (
          <span style={{ fontSize: 11, color: '#6b7280', fontFamily: 'Space Grotesk, sans-serif' }}>
            CFO: {truck.cfo_name}
          </span>
        )}
      </div>
      <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Vehicle photos */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: '#9ca3af', letterSpacing: '0.08em',
            textTransform: 'uppercase', marginBottom: 8, fontFamily: 'Space Grotesk, sans-serif' }}>
            Vehicle Photos
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <PhotoBox url={front?.photo_url ?? undefined} label="Front" />
            <PhotoBox url={rear?.photo_url ?? undefined} label="Rear" />
            {sealPositions.slice(0, 2).map(pos => (
              <PhotoBox key={pos} url={sealPhoto(pos)?.photo_url ?? undefined} label={`Seal ${pos}`} />
            ))}
          </div>
        </div>
        {/* Seal register */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: '#9ca3af', letterSpacing: '0.08em',
            textTransform: 'uppercase', marginBottom: 8, fontFamily: 'Space Grotesk, sans-serif' }}>
            Seal Register
          </div>
          {sealPositions.length === 0
            ? <span style={{ fontSize: 11, color: '#9ca3af', fontFamily: 'JetBrains Mono, monospace' }}>No seals recorded</span>
            : sealPositions.map(pos => {
              // convoy_seals (dedicated RFID scan-log records, with a
              // status of intact/broken/replaced) is a separate table from
              // convoy_truck_photos (what the Guardian app's seal capture
              // flow actually writes to) — the CFO app has no "scan this
              // seal" step, only "photograph this seal", so sealRecord(pos)
              // is empty for every convoy using just the photo flow. Fall
              // back to the photo itself as evidence the seal was checked,
              // instead of defaulting straight to "missing".
              const sr = sealRecord(pos);
              const hasPhoto = !!sealPhoto(pos);
              const status = sr?.status || (hasPhoto ? 'present' : 'missing');
              return (
                <div key={pos} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '6px 0', borderBottom: '1px solid #f3f4f6',
                }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#374151',
                      fontFamily: 'JetBrains Mono, monospace' }}>
                      {sr?.rfid_code || '—'}
                    </div>
                    <div style={{ fontSize: 10, color: '#9ca3af' }}>Position {pos}</div>
                  </div>
                  <span style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                    color: SEAL_STATUS_COLOR[status],
                    fontFamily: 'JetBrains Mono, monospace',
                  }}>
                    {status}
                  </span>
                </div>
              );
            })
          }
        </div>
      </div>
    </div>
  );
}

const CFO_PHOTO_LABELS: Record<string, string> = {
  vehicle_front: 'Vehicle Front', cargo_seal: 'Cargo Seal', cargo_interior: 'Cargo Interior',
  cfo_identity: 'CFO Identity', tyres_under: 'Tyres & Under', vehicle_arrival: 'Vehicle Arrival',
  seals_eod: 'Seals EOD', offload_docs: 'Offload Docs', delivery_point: 'Delivery Point',
  receiver_signature: 'Receiver Signature', handover_form: 'Handover Form',
};

function CfoUploadsSection({ uploads }: { uploads: CfoUpload[] }) {
  const bySession = { sod: uploads.filter(u => u.session === 'sod'), eod: uploads.filter(u => u.session === 'eod') };
  return (
    <>
      {(['sod', 'eod'] as const).map(phase => {
        const photos = bySession[phase];
        if (!photos.length) return null;
        return (
          <div key={phase} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', letterSpacing: '0.1em',
              textTransform: 'uppercase', fontFamily: 'JetBrains Mono, monospace', marginBottom: 10 }}>
              {phase === 'sod' ? 'Start of Day' : 'End of Day'}
              {photos[0]?.cfo_name && <span style={{ fontWeight: 400, marginLeft: 8 }}>— {photos[0].cfo_name}</span>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))', gap: 8 }}>
              {photos.map(p => (
                <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <a href={p.photo_url} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'block', aspectRatio: '4/3', background: '#f3f4f6',
                      borderRadius: 4, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                    <img src={p.photo_url} alt={p.photo_type}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </a>
                  <span style={{ fontSize: 8, color: '#6b7280', textTransform: 'uppercase',
                    letterSpacing: '0.05em', fontFamily: 'JetBrains Mono, monospace' }}>
                    {CFO_PHOTO_LABELS[p.photo_type] ?? p.photo_type}
                  </span>
                  {p.lat && p.lng && (
                    <span style={{ fontSize: 7, color: '#9ca3af', fontFamily: 'JetBrains Mono, monospace' }}>
                      {p.lat.toFixed(4)}, {p.lng.toFixed(4)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

const VERDICT_STYLE: Record<Integrity['verdict'], { label: string; fg: string; bg: string; border: string; blurb: string }> = {
  cleared: { label: 'CLEARED', fg: '#16a34a', bg: '#f0fdf4', border: '#86efac', blurb: 'Full evidence coverage; no anomalies detected.' },
  review: { label: 'UNDER REVIEW', fg: '#d97706', bg: '#fffbeb', border: '#fcd34d', blurb: 'Minor gaps or anomalies require dispatcher review.' },
  exceptions: { label: 'EXCEPTIONS', fg: '#dc2626', bg: '#fef2f2', border: '#fca5a5', blurb: 'Critical anomalies detected — escalate before sign-off.' },
};
const SEV_COLOR: Record<IntegrityFinding['severity'], string> = { critical: '#dc2626', warning: '#d97706', info: '#6b7280' };

function fmtDur(mins: number): string {
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function IntegritySection({ a }: { a: Integrity }) {
  const v = VERDICT_STYLE[a.verdict];
  const route = a.route;
  const stats: Array<{ label: string; value: string; danger?: boolean }> = route.hasTrack ? [
    { label: 'Distance', value: `${route.distanceKm} km` },
    { label: 'Duration', value: fmtDur(route.durationMin) },
    { label: 'Avg Speed', value: route.avgSpeedKmh != null ? `${route.avgSpeedKmh} km/h` : '—' },
    { label: 'Peak Speed', value: route.maxSpeedKmh != null ? `${route.maxSpeedKmh} km/h` : '—', danger: route.overspeedCount > 0 },
    { label: 'Stops', value: String(route.stops) },
    { label: 'Max Deviation', value: route.deviationKm != null ? `${route.deviationKm} km` : '—', danger: route.deviationKm != null && route.deviationKm > 8 },
  ] : [];

  return (
    <Section label="Integrity Assessment">
      {/* Verdict banner */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px', borderRadius: 8,
        background: v.bg, border: `1px solid ${v.border}`, borderLeft: `5px solid ${v.fg}`, marginBottom: 16,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: v.fg,
            fontFamily: 'JetBrains Mono, monospace' }}>CONVOY INTEGRITY VERDICT</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: v.fg, fontFamily: 'Syne, sans-serif', lineHeight: 1.1 }}>{v.label}</div>
          <div style={{ fontSize: 11, color: '#374151', marginTop: 4 }}>{v.blurb}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: '#9ca3af',
            fontFamily: 'JetBrains Mono, monospace' }}>INTEGRITY SCORE</div>
          <div style={{ fontSize: 34, fontWeight: 800, color: v.fg, fontFamily: 'Syne, sans-serif', lineHeight: 1 }}>
            {a.score}<span style={{ fontSize: 15, color: '#9ca3af' }}>/100</span>
          </div>
        </div>
      </div>

      {/* Findings register */}
      {a.findings.length === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#16a34a',
          fontWeight: 600 }}>
          <CheckCircle size={14} /> No exceptions — all coverage, seal, and route checks passed.
        </div>
      ) : (
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: '#6b7280',
            fontFamily: 'JetBrains Mono, monospace', marginBottom: 8 }}>
            FINDINGS REGISTER — {a.counts.critical} CRITICAL · {a.counts.warning} WARNING · {a.counts.info} INFO
          </div>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden' }}>
            {a.findings.map((f, i) => (
              <div key={i} style={{
                display: 'flex', gap: 10, padding: '8px 12px', alignItems: 'flex-start',
                background: i % 2 === 0 ? '#f8fafc' : '#fff', borderBottom: i < a.findings.length - 1 ? '1px solid #f3f4f6' : 'none',
              }}>
                <span style={{ marginTop: 4, width: 8, height: 8, borderRadius: 99, flexShrink: 0,
                  background: SEV_COLOR[f.severity] }} />
                <span style={{ width: 56, flexShrink: 0, fontSize: 8, fontWeight: 700, letterSpacing: '0.05em',
                  color: SEV_COLOR[f.severity], textTransform: 'uppercase', fontFamily: 'JetBrains Mono, monospace', marginTop: 2 }}>
                  {f.severity}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>{f.title}</div>
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 1 }}>{f.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Route analytics */}
      {stats.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: '#6b7280',
            fontFamily: 'JetBrains Mono, monospace', marginBottom: 8 }}>ROUTE ANALYTICS</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(92px, 1fr))', gap: 8 }}>
            {stats.map(s => (
              <div key={s.label} style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 10px' }}>
                <div style={{ fontSize: 8, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em',
                  fontFamily: 'JetBrains Mono, monospace', marginBottom: 3 }}>{s.label}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: s.danger ? '#dc2626' : '#111827',
                  fontFamily: 'Space Grotesk, sans-serif' }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
        paddingBottom: 8, borderBottom: '2px solid #111827',
      }}>
        <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 12,
          color: '#111827', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function ReportDoc({
  detail,
  onRegenerate,
  regenerating,
}: {
  detail: ReportDetail;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  const dr = detail.daily_report;
  // Math.min guards against any backend count mismatch still slipping
  // through (mismatched formulas, stale cached counts, orphaned photo rows)
  // — the UI must never claim >100% complete.
  const completePercent = dr && dr.required_photo_count > 0
    ? Math.min(100, Math.round((dr.received_photo_count / dr.required_photo_count) * 100))
    : 0;
  const [downloading, setDownloading] = React.useState(false);

  // dr.pdf_url is a public R2 link — safe to open directly. Without it, the
  // backend endpoint requires a Bearer token that a plain <a> can't send, so
  // fetch it through the authenticated api client and open the returned blob.
  const handleDownload = async () => {
    if (dr?.pdf_url) {
      window.open(dr.pdf_url, '_blank', 'noopener,noreferrer');
      return;
    }
    setDownloading(true);
    try {
      const res = await api.get(
        `/convoys/${detail.convoy.id}/reports/${detail.report_date}/download`,
        { responseType: 'blob' },
      );
      const blobUrl = URL.createObjectURL(res.data);
      window.open(blobUrl, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (err: any) {
      // responseType 'blob' means an error JSON body also arrives as a Blob —
      // parse it so the operator sees the real reason (e.g. "PDF not on
      // server — please regenerate") instead of a generic message.
      let message = 'Could not download the report PDF. Please try again.';
      const data = err?.response?.data;
      if (data instanceof Blob) {
        try {
          const text = await data.text();
          const parsed = JSON.parse(text);
          if (parsed?.error) message = parsed.error;
        } catch {
          // keep the generic message
        }
      } else if (err?.message) {
        message = err.message;
      }
      alert(message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div style={{
      background: '#ffffff', color: '#111827', fontFamily: 'Space Grotesk, sans-serif',
      maxWidth: 860, margin: '0 auto', padding: 'clamp(16px, 4vw, 40px) clamp(14px, 4vw, 48px)',
      boxShadow: '0 4px 24px rgba(0,0,0,0.12)', borderRadius: 4,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
        <div>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 24, color: '#111827' }}>
            CONVOY INTELLIGENCE REPORT
          </div>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: '#6b7280', marginTop: 4 }}>
            {detail.convoy.name} · {detail.report_date}
          </div>
          {detail.convoy.client_name && (
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#d97706', marginTop: 2 }}>
              Client: {detail.convoy.client_name}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'Fraunces, serif', fontWeight: 900, fontSize: 28, color: '#d97706' }}>
            SONALIT
          </div>
          <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: 'JetBrains Mono, monospace' }}>
            GUARDIAN CFO SYSTEM
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 32 }}>
        {dr?.status === 'generated' && (
          <button onClick={handleDownload} disabled={downloading}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
              background: '#111827', color: '#fff', borderRadius: 6, border: 'none',
              cursor: downloading ? 'not-allowed' : 'pointer', opacity: downloading ? 0.6 : 1,
              fontSize: 12, fontWeight: 600, fontFamily: 'Space Grotesk, sans-serif',
            }}>
            <FileDown size={14} /> {downloading ? 'Preparing…' : 'Download PDF'}
          </button>
        )}
        <button onClick={onRegenerate} disabled={regenerating}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
            background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db',
            borderRadius: 6, cursor: regenerating ? 'not-allowed' : 'pointer', opacity: regenerating ? 0.6 : 1,
            fontSize: 12, fontWeight: 600, fontFamily: 'Space Grotesk, sans-serif',
          }}>
          <RefreshCw size={14} style={{ animation: regenerating ? 'spin 1s linear infinite' : 'none' }} />
          {regenerating ? 'Regenerating…' : 'Regenerate'}
        </button>
      </div>

      {/* Integrity Assessment — the headline security read */}
      {detail.integrity && <IntegritySection a={detail.integrity} />}

      {/* A — Details */}
      <Section label="A — Convoy Details">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
          {[
            { label: 'Client', value: detail.convoy.client_name || '—' },
            { label: 'Status', value: detail.convoy.status.toUpperCase() },
            { label: 'Start Date', value: detail.convoy.start_date },
            { label: 'End Date', value: detail.convoy.end_date },
            { label: 'Timezone', value: detail.convoy.timezone },
            { label: 'Trucks', value: String(detail.trucks.length) },
            { label: 'Seals / Truck', value: String(detail.convoy.seal_count_per_truck) },
            { label: 'Photos Received', value: dr ? `${dr.received_photo_count}/${dr.required_photo_count}` : '—' },
            { label: 'Completeness', value: dr ? `${completePercent}%` : '—' },
          ].map(({ label, value }) => (
            <div key={label} style={{
              background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 6, padding: '10px 14px',
            }}>
              <div style={{ fontSize: 9, color: '#9ca3af', textTransform: 'uppercase',
                letterSpacing: '0.08em', fontFamily: 'JetBrains Mono, monospace', marginBottom: 4 }}>
                {label}
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', fontFamily: 'Space Grotesk, sans-serif' }}>
                {value}
              </div>
            </div>
          ))}
        </div>
        {dr && (
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            {dr.status === 'complete' || dr.status === 'generated'
              ? <CheckCircle size={14} color="#22c55e" />
              : dr.status === 'partial'
              ? <AlertTriangle size={14} color="#f59e0b" />
              : <Clock size={14} color="#9ca3af" />
            }
            <span style={{ fontSize: 12, color: '#6b7280', fontFamily: 'Space Grotesk, sans-serif' }}>
              Report status: <strong>{dr.status}</strong>
              {dr.generated_at ? ` · Generated ${new Date(dr.generated_at).toLocaleString()}` : ''}
            </span>
          </div>
        )}
      </Section>

      {/* B — Route */}
      {detail.waypoints.length > 0 && (
        <Section label="B — Route Waypoints">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11,
              fontFamily: 'JetBrains Mono, monospace' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  {['#', 'Time', 'Lat', 'Lng', 'Speed km/h', 'Heading'].map(h => (
                    <th key={h} style={{ padding: '6px 10px', textAlign: 'left',
                      fontWeight: 600, color: '#6b7280', borderBottom: '1px solid #e5e7eb',
                      fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detail.waypoints.slice(0, 20).map((wp, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '5px 10px', color: '#9ca3af' }}>{i + 1}</td>
                    <td style={{ padding: '5px 10px', color: '#374151' }}>
                      {new Date(wp.recorded_at).toLocaleTimeString()}
                    </td>
                    <td style={{ padding: '5px 10px', color: '#374151' }}>{wp.lat.toFixed(5)}</td>
                    <td style={{ padding: '5px 10px', color: '#374151' }}>{wp.lng.toFixed(5)}</td>
                    <td style={{ padding: '5px 10px', color: '#374151' }}>
                      {wp.speed_kmh != null ? wp.speed_kmh.toFixed(1) : '—'}
                    </td>
                    <td style={{ padding: '5px 10px', color: '#374151' }}>
                      {wp.heading != null ? `${wp.heading.toFixed(0)}°` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {detail.waypoints.length > 20 && (
              <div style={{ fontSize: 10, color: '#9ca3af', padding: '6px 10px',
                fontFamily: 'JetBrains Mono, monospace' }}>
                +{detail.waypoints.length - 20} more waypoints
              </div>
            )}
          </div>
        </Section>
      )}

      {/* C — CFO App Photos (Guardian Convoy app) */}
      {detail.cfo_uploads && detail.cfo_uploads.length > 0 && (
        <Section label="C — CFO App Photos">
          <CfoUploadsSection uploads={detail.cfo_uploads} />
        </Section>
      )}

      {/* D — SOD (legacy device photos) */}
      {detail.trucks.some(t => t.photos.some(p => p.session === 'sod')) && (
        <Section label="D — Start of Day (SOD)">
          {detail.trucks.map(t => <TruckBlock key={t.id} truck={t} session="sod" />)}
        </Section>
      )}

      {/* E — EOD (legacy device photos) */}
      {detail.trucks.some(t => t.photos.some(p => p.session === 'eod')) && (
        <Section label="E — End of Day (EOD)">
          {detail.trucks.map(t => <TruckBlock key={t.id} truck={t} session="eod" />)}
        </Section>
      )}

      {/* E — Summary */}
      <Section label="E — Summary & Certification">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          <div>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>
              Total photos received vs required:
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#111827',
              fontFamily: 'Syne, sans-serif' }}>
              {dr?.received_photo_count ?? 0} / {dr?.required_photo_count ?? '?'}
            </div>
            <div style={{ marginTop: 8, height: 6, background: '#e5e7eb', borderRadius: 99 }}>
              <div style={{
                height: '100%', width: `${completePercent}%`, borderRadius: 99,
                background: completePercent >= 100 ? '#22c55e' : completePercent >= 50 ? '#f59e0b' : '#ef4444',
              }} />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>
              Seals with anomalies:
            </div>
            <div style={{ fontSize: 20, fontWeight: 700,
              color: detail.trucks.flatMap(t => t.seals).filter(s => s.status !== 'intact').length > 0
                ? '#ef4444' : '#22c55e',
              fontFamily: 'Syne, sans-serif',
            }}>
              {detail.trucks.flatMap(t => t.seals).filter(s => s.status !== 'intact').length}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 40, borderTop: '1px solid #e5e7eb', paddingTop: 16,
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 32 }}>
          {['Dispatcher Signature', 'CFO Lead Signature', 'Date'].map(label => (
            <div key={label}>
              <div style={{ height: 32, borderBottom: '1px solid #374151', marginBottom: 6 }} />
              <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: 'Space Grotesk, sans-serif' }}>
                {label}
              </div>
            </div>
          ))}
        </div>

        {/* Chain-of-custody / tamper-evidence band */}
        {detail.integrity?.evidenceDigest && (
          <div style={{ marginTop: 24, borderRadius: 6, background: '#0b1220', borderLeft: '5px solid #f5a623',
            padding: '12px 16px' }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: '#f5a623',
              fontFamily: 'JetBrains Mono, monospace' }}>CHAIN OF CUSTODY — EVIDENCE ATTESTATION</div>
            <div style={{ fontSize: 10.5, color: '#c7ced9', marginTop: 5, lineHeight: 1.5 }}>
              Generated automatically by the Sonalit Guardian CFO system from field-captured evidence.
              Authenticity is verifiable against the evidence fingerprint below.
            </div>
            <div style={{ fontSize: 10, color: '#fff', marginTop: 6, fontFamily: 'JetBrains Mono, monospace',
              wordBreak: 'break-all' }}>
              SHA-256 {detail.integrity.evidenceDigest}
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}
