import React, { useState, useRef } from 'react';
import { uploadApi } from '../api/uploadApi';
import { reportApi } from '../api/reportApi';
import { useGPSStamp } from '../hooks/useGPSStamp';
import type { AuthState, PhotoType, PhotoUpload } from '../types/ConvoyReport';

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

const SOD_TYPES: { key: PhotoType; label: string }[] = [
  { key: 'vehicle_front',    label: 'Vehicle Front' },
  { key: 'cargo_seal',       label: 'Cargo Seal' },
  { key: 'cargo_interior',   label: 'Cargo Interior' },
  { key: 'cfo_identity',     label: 'CFO Identity' },
  { key: 'tyres_under',      label: 'Tyres & Under' },
];

interface SODUploadScreenProps {
  navigate: (screen: string) => void;
  auth: AuthState | null;
}

interface ConfirmOverlayProps {
  count: number;
  gps: { lat: number; lng: number; accuracy: number } | null;
  onClose: () => void;
}

function ConfirmOverlay({ count, gps, onClose }: ConfirmOverlayProps) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(6,10,8,0.92)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, zIndex: 100,
    }}>
      <div style={{
        background: T.card, border: `1px solid ${T.limeRim}`,
        borderRadius: 18, padding: '28px 24px', width: '100%', maxWidth: 380,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
          <div style={{ fontFamily: T.cond, fontSize: 26, fontWeight: 900, color: T.lime, letterSpacing: 2 }}>
            SOD SUBMITTED
          </div>
          <div style={{ fontFamily: T.mono, fontSize: 11, color: T.sub, marginTop: 4 }}>
            Start-of-Day report lodged
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: T.surface, borderRadius: 8 }}>
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.sub }}>PHOTOS</span>
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.lime }}>{count} uploaded</span>
          </div>
          {gps && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: T.surface, borderRadius: 8 }}>
              <span style={{ fontFamily: T.mono, fontSize: 11, color: T.sub }}>GPS STAMP</span>
              <span style={{ fontFamily: T.mono, fontSize: 10, color: T.lime }}>
                {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}
              </span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: T.surface, borderRadius: 8 }}>
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.sub }}>TIMESTAMP</span>
            <span style={{ fontFamily: T.mono, fontSize: 10, color: T.body }}>
              {new Date().toLocaleTimeString()}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: T.greenBg, borderRadius: 8, border: `1px solid ${T.green}44` }}>
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.sub }}>SYNC STATUS</span>
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.green }}>SYNCED ✓</span>
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            width: '100%', background: T.lime, color: T.void,
            border: 'none', borderRadius: 10, padding: '14px 0',
            fontFamily: T.cond, fontSize: 16, fontWeight: 900, letterSpacing: 3, cursor: 'pointer',
          }}
        >BACK TO HOME</button>
      </div>
    </div>
  );
}

export function SODUploadScreen({ navigate, auth }: SODUploadScreenProps) {
  const [selectedType, setSelectedType]     = useState<PhotoType>('vehicle_front');
  const [uploadedPhotos, setUploadedPhotos] = useState<PhotoUpload[]>([]);
  const [submitting, setSubmitting]         = useState(false);
  const [showConfirm, setShowConfirm]       = useState(false);
  const [uploading, setUploading]           = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const [sodAlreadyDone, setSodAlreadyDone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { gps, loading: gpsLoading } = useGPSStamp();

  const safeAuth = auth!;
  const currentPlate = safeAuth.convoy.trucks[0]?.plate ?? 'TRUCK-1';

  React.useEffect(() => {
    reportApi.getReport(safeAuth.convoy.id, safeAuth.token).then(report => {
      if (report?.status && report.status !== 'in_progress') setSodAlreadyDone(true);
    }).catch(() => {});
  }, [safeAuth.convoy.id, safeAuth.token]);

  if (!auth) return null;

  async function handleFileCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!gps) { setError('GPS lock required before capturing photo.'); return; }
    setUploading(true);
    setError(null);
    try {
      const committed = await uploadApi.uploadPhoto(
        file, selectedType, safeAuth.convoy.id, 'sod',
        gps.lat, gps.lng, gps.accuracy, currentPlate, safeAuth.token,
      );
      setUploadedPhotos(prev => [...prev.filter(p => p.photo_type !== selectedType), committed]);
      const idx = SOD_TYPES.findIndex(t => t.key === selectedType);
      if (idx < SOD_TYPES.length - 1) setSelectedType(SOD_TYPES[idx + 1].key);
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Upload failed';
      setError(`Upload failed: ${msg}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleSubmitSOD() {
    if (!gps) { setError('GPS lock required.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const photoIds = uploadedPhotos.map(p => p.photo_id);
      const report = await reportApi.getReport(safeAuth.convoy.id, safeAuth.token);
      await reportApi.submitSOD(report.id, photoIds, gps, safeAuth.token);
      setShowConfirm(true);
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Submit failed';
      setError(`Submit failed: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: '100dvh', background: T.void, display: 'flex', flexDirection: 'column' }}>
      {showConfirm && (
        <ConfirmOverlay
          count={uploadedPhotos.length}
          gps={gps}
          onClose={() => navigate('home')}
        />
      )}

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
          <div style={{ fontFamily: T.cond, fontSize: 20, fontWeight: 900, color: T.white, letterSpacing: 2 }}>SOD PHOTOS</div>
          <div style={{ fontFamily: T.mono, fontSize: 9, color: T.sub }}>Start-of-Day Documentation</div>
        </div>
        <div style={{
          background: T.limeBg, border: `1px solid ${T.limeRim}`,
          borderRadius: 6, padding: '4px 10px',
          fontFamily: T.cond, fontSize: 12, fontWeight: 700, color: T.lime, letterSpacing: 2,
        }}>SOD</div>
      </div>

      {sodAlreadyDone && (
        <div style={{
          background: T.greenBg, border: `1px solid ${T.green}44`,
          margin: '12px 16px 0', borderRadius: 12, padding: '14px 16px',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 20 }}>✅</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: T.cond, fontSize: 14, fontWeight: 900, color: T.green, letterSpacing: 1 }}>
              SOD ALREADY SUBMITTED TODAY
            </div>
            <div style={{ fontFamily: T.mono, fontSize: 10, color: T.body, marginTop: 2 }}>
              Start-of-day report was submitted for this convoy
            </div>
          </div>
          <button
            onClick={() => navigate('eod')}
            style={{
              background: T.green, color: T.void, border: 'none', borderRadius: 8,
              padding: '8px 14px', fontFamily: T.cond, fontSize: 13, fontWeight: 900,
              letterSpacing: 1, cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >GO TO EOD</button>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 100px' }}>

        {/* Photo type pills */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontFamily: T.cond, fontSize: 11, color: T.sub, letterSpacing: 2, marginBottom: 8 }}>SELECT PHOTO TYPE</div>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
            {SOD_TYPES.map(type => {
              const done = uploadedPhotos.some(p => p.photo_type === type.key);
              const active = selectedType === type.key;
              return (
                <button
                  key={type.key}
                  onClick={() => setSelectedType(type.key)}
                  style={{
                    flexShrink: 0, border: `1.5px solid ${active ? T.lime : done ? T.green + '66' : T.rim}`,
                    background: active ? T.limeBg : done ? T.greenBg : T.card,
                    borderRadius: 20, padding: '7px 14px', cursor: 'pointer',
                    fontFamily: T.cond, fontSize: 12, fontWeight: 700,
                    color: active ? T.lime : done ? T.green : T.body, letterSpacing: 1,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {done && '✓ '}{type.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Camera frame */}
        <div style={{
          background: T.card, border: `2px dashed ${T.limeRim}`,
          borderRadius: 14, height: 220, marginBottom: 14,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 12, cursor: uploading ? 'not-allowed' : 'pointer',
          position: 'relative', overflow: 'hidden',
        }}
          onClick={() => !uploading && fileInputRef.current?.click()}
        >
          <input
            type="file" accept="image/*" capture="environment"
            style={{ display: 'none' }} ref={fileInputRef}
            onChange={handleFileCapture}
          />
          {uploading ? (
            <>
              <div style={{ fontSize: 32 }}>⏳</div>
              <div style={{ fontFamily: T.mono, fontSize: 12, color: T.lime }}>UPLOADING…</div>
            </>
          ) : (
            <>
              <div style={{
                width: 56, height: 56, borderRadius: '50%',
                background: T.limeBg, border: `1.5px solid ${T.limeRim}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26,
              }}>📷</div>
              <div style={{ fontFamily: T.cond, fontSize: 16, fontWeight: 700, color: T.text, letterSpacing: 1 }}>
                TAP TO CAPTURE
              </div>
              <div style={{ fontFamily: T.mono, fontSize: 10, color: T.sub }}>
                {SOD_TYPES.find(t => t.key === selectedType)?.label}
              </div>
            </>
          )}
          {/* Corner brackets */}
          {['tl','tr','bl','br'].map(c => (
            <div key={c} style={{
              position: 'absolute',
              top: c.startsWith('t') ? 10 : undefined, bottom: c.startsWith('b') ? 10 : undefined,
              left: c.endsWith('l') ? 10 : undefined, right: c.endsWith('r') ? 10 : undefined,
              width: 16, height: 16,
              borderTop: c.startsWith('t') ? `2px solid ${T.lime}` : undefined,
              borderBottom: c.startsWith('b') ? `2px solid ${T.lime}` : undefined,
              borderLeft: c.endsWith('l') ? `2px solid ${T.lime}` : undefined,
              borderRight: c.endsWith('r') ? `2px solid ${T.lime}` : undefined,
            }} />
          ))}
        </div>

        {/* GPS Block */}
        <div style={{
          background: T.card, border: `1px solid ${T.rim}`, borderRadius: 10,
          padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14,
        }}>
          <span style={{ fontSize: 16 }}>📍</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: T.cond, fontSize: 10, color: T.sub, letterSpacing: 2, marginBottom: 2 }}>GPS STAMP</div>
            {gpsLoading && <div style={{ fontFamily: T.mono, fontSize: 11, color: T.body }}>Acquiring…</div>}
            {gps && <div style={{ fontFamily: T.mono, fontSize: 11, color: T.lime }}>{gps.lat.toFixed(6)}, {gps.lng.toFixed(6)}</div>}
          </div>
          <div style={{
            fontFamily: T.mono, fontSize: 9, letterSpacing: 1,
            color: gps ? T.lime : T.muted,
            border: `1px solid ${gps ? T.limeRim : T.rim}`, borderRadius: 4, padding: '2px 6px',
          }}>{gps ? 'LOCK' : 'NO FIX'}</div>
        </div>

        {/* Photo grid */}
        {uploadedPhotos.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: T.cond, fontSize: 11, color: T.sub, letterSpacing: 2, marginBottom: 8 }}>CAPTURED</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {uploadedPhotos.map(photo => (
                <div key={photo.photo_id} style={{
                  aspectRatio: '1', background: T.greenBg,
                  border: `1px solid ${T.green}44`, borderRadius: 8,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 4,
                }}>
                  <span style={{ fontSize: 20 }}>✅</span>
                  <span style={{ fontFamily: T.mono, fontSize: 8, color: T.green, textAlign: 'center', padding: '0 4px' }}>
                    {SOD_TYPES.find(t => t.key === photo.photo_type)?.label}
                  </span>
                </div>
              ))}
              {SOD_TYPES.filter(t => !uploadedPhotos.some(p => p.photo_type === t.key)).map(type => (
                <div key={type.key} style={{
                  aspectRatio: '1', background: T.card,
                  border: `1px dashed ${T.rim}`, borderRadius: 8,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 4,
                }}>
                  <span style={{ fontSize: 16, opacity: 0.3 }}>📷</span>
                  <span style={{ fontFamily: T.mono, fontSize: 7, color: T.muted, textAlign: 'center', padding: '0 4px' }}>
                    {type.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div style={{
            background: T.redBg, border: `1px solid ${T.red}55`,
            borderRadius: 8, padding: '10px 14px', marginBottom: 14,
            fontFamily: T.mono, fontSize: 12, color: T.red,
          }}>{error}</div>
        )}
      </div>

      {/* Submit button */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        padding: '12px 16px 24px', background: T.deep, borderTop: `1px solid ${T.rim}`,
      }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, fontFamily: T.mono, fontSize: 10, color: T.sub, lineHeight: 1.4 }}>
            <div>{uploadedPhotos.length}/{SOD_TYPES.length} photos</div>
            <div>{!gps ? 'Waiting for GPS…' : 'GPS ready'}</div>
          </div>
          <button
            onClick={sodAlreadyDone ? () => navigate('eod') : handleSubmitSOD}
            disabled={submitting || (uploadedPhotos.length === 0 && !sodAlreadyDone)}
            style={{
              background: sodAlreadyDone ? T.green : uploadedPhotos.length === 0 ? T.muted : T.lime,
              color: T.void, border: 'none', borderRadius: 10,
              padding: '14px 24px', cursor: (uploadedPhotos.length === 0 && !sodAlreadyDone) ? 'not-allowed' : 'pointer',
              fontFamily: T.cond, fontSize: 16, fontWeight: 900, letterSpacing: 3,
            }}
          >
            {submitting ? 'SUBMITTING…' : sodAlreadyDone ? 'GO TO EOD →' : 'SUBMIT SOD'}
          </button>
        </div>
      </div>
    </div>
  );
}
