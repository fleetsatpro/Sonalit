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

const EOD_TYPES: { key: PhotoType; label: string }[] = [
  { key: 'vehicle_arrival',      label: 'Vehicle Arrival' },
  { key: 'seals_eod',            label: 'Seals EOD' },
  { key: 'offload_docs',         label: 'Offload Docs' },
  { key: 'delivery_point',       label: 'Delivery Point' },
  { key: 'receiver_signature',   label: 'Receiver Signature' },
];

interface EODUploadScreenProps {
  navigate: (screen: string) => void;
  auth: AuthState | null;
}

function ConfirmOverlay({ count, gps, onClose }: { count: number; gps: any; onClose: () => void }) {
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
          <div style={{ fontSize: 44, marginBottom: 8 }}>🎉</div>
          <div style={{ fontFamily: T.cond, fontSize: 26, fontWeight: 900, color: T.lime, letterSpacing: 2 }}>
            MISSION COMPLETE
          </div>
          <div style={{ fontFamily: T.mono, fontSize: 11, color: T.sub, marginTop: 4 }}>
            End-of-Day report submitted · PDF generating
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: T.surface, borderRadius: 8 }}>
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.sub }}>EOD PHOTOS</span>
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.lime }}>{count} uploaded</span>
          </div>
          {gps && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: T.surface, borderRadius: 8 }}>
              <span style={{ fontFamily: T.mono, fontSize: 11, color: T.sub }}>ARRIVAL GPS</span>
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
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.sub }}>PDF REPORT</span>
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.orange }}>GENERATING…</span>
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            width: '100%', background: T.lime, color: T.void,
            border: 'none', borderRadius: 10, padding: '14px 0',
            fontFamily: T.cond, fontSize: 16, fontWeight: 900, letterSpacing: 3, cursor: 'pointer',
          }}
        >VIEW HISTORY</button>
      </div>
    </div>
  );
}

export function EODUploadScreen({ navigate, auth }: EODUploadScreenProps) {
  const [arrivalConfirmed, setArrivalConfirmed] = useState(false);
  const [confirmingArrival, setConfirmingArrival] = useState(false);
  const [selectedType, setSelectedType]           = useState<PhotoType>('vehicle_arrival');
  const [uploadedPhotos, setUploadedPhotos]       = useState<PhotoUpload[]>([]);
  const [uploading, setUploading]                 = useState(false);
  const [submitting, setSubmitting]               = useState(false);
  const [showConfirm, setShowConfirm]             = useState(false);
  const [error, setError]                         = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { gps, loading: gpsLoading } = useGPSStamp();

  if (!auth) return null;
  const safeAuth = auth;
  const currentPlate = safeAuth.convoy.trucks[0]?.plate ?? 'TRUCK-1';

  async function handleConfirmArrival() {
    if (!gps) { setError('GPS lock required to confirm arrival.'); return; }
    setConfirmingArrival(true);
    setError(null);
    try {
      const report = await reportApi.getReport(safeAuth.convoy.id, safeAuth.token);
      await reportApi.submitArrival(report.id, gps, safeAuth.token);
      setArrivalConfirmed(true);
    } catch {
      setError('Could not confirm arrival. Please try again.');
    } finally {
      setConfirmingArrival(false);
    }
  }

  async function handleFileCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !arrivalConfirmed) return;
    if (!gps) { setError('GPS lock required.'); return; }
    setUploading(true);
    setError(null);
    try {
      const urlRes = await uploadApi.getUploadUrl(selectedType, safeAuth.convoy.id, 'eod', currentPlate, safeAuth.token);
      await uploadApi.uploadToR2(urlRes.upload_url, file);
      const committed = await uploadApi.commitPhoto(
        urlRes.photo_id, selectedType, safeAuth.convoy.id, 'eod',
        gps.lat, gps.lng, gps.accuracy, currentPlate, safeAuth.token,
      );
      setUploadedPhotos(prev => [...prev.filter(p => p.photo_type !== selectedType), committed]);
      const idx = EOD_TYPES.findIndex(t => t.key === selectedType);
      if (idx < EOD_TYPES.length - 1) setSelectedType(EOD_TYPES[idx + 1].key);
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Upload failed';
      setError(`Upload failed: ${msg}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleSubmitEOD() {
    if (!gps || !arrivalConfirmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const photoIds = uploadedPhotos.map(p => p.photo_id);
      const report = await reportApi.getReport(safeAuth.convoy.id, safeAuth.token);
      await reportApi.submitEOD(report.id, photoIds, gps, safeAuth.token);
      setShowConfirm(true);
    } catch {
      setError('EOD submission failed. Please retry.');
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
          onClose={() => navigate('history')}
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
          <div style={{ fontFamily: T.cond, fontSize: 20, fontWeight: 900, color: T.white, letterSpacing: 2 }}>EOD PHOTOS</div>
          <div style={{ fontFamily: T.mono, fontSize: 9, color: T.sub }}>End-of-Day Documentation</div>
        </div>
        <div style={{
          background: T.orangeBg, border: `1px solid ${T.orange}55`,
          borderRadius: 6, padding: '4px 10px',
          fontFamily: T.cond, fontSize: 12, fontWeight: 700, color: T.orange, letterSpacing: 2,
        }}>EOD</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 100px' }}>

        {/* Arrival confirmation card */}
        {!arrivalConfirmed && (
          <div style={{
            background: T.orangeBg, border: `1px solid ${T.orange}55`,
            borderRadius: 14, padding: '18px 18px', marginBottom: 16,
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <span style={{ fontSize: 24, flexShrink: 0 }}>🏁</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: T.cond, fontSize: 16, fontWeight: 900, color: T.orange, letterSpacing: 2, marginBottom: 4 }}>
                  CONFIRM ARRIVAL FIRST
                </div>
                <div style={{ fontFamily: T.mono, fontSize: 11, color: T.body, marginBottom: 12 }}>
                  Destination: <span style={{ color: T.text }}>{auth.convoy.destination}</span>
                </div>
                <button
                  onClick={handleConfirmArrival}
                  disabled={confirmingArrival || !gps}
                  style={{
                    background: gps ? T.orange : T.muted, color: T.void,
                    border: 'none', borderRadius: 8, padding: '10px 20px',
                    fontFamily: T.cond, fontSize: 14, fontWeight: 900, letterSpacing: 2,
                    cursor: gps ? 'pointer' : 'not-allowed',
                  }}
                >
                  {confirmingArrival ? 'CONFIRMING…' : gps ? 'CONFIRM ARRIVAL' : 'WAITING FOR GPS…'}
                </button>
              </div>
            </div>
          </div>
        )}

        {arrivalConfirmed && (
          <div style={{
            background: T.greenBg, border: `1px solid ${T.green}44`,
            borderRadius: 10, padding: '10px 14px', marginBottom: 14,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span>✅</span>
            <span style={{ fontFamily: T.cond, fontSize: 13, fontWeight: 700, color: T.green, letterSpacing: 1 }}>
              ARRIVAL CONFIRMED — cameras unlocked
            </span>
          </div>
        )}

        {/* Photo type pills */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontFamily: T.cond, fontSize: 11, color: T.sub, letterSpacing: 2, marginBottom: 8 }}>SELECT PHOTO TYPE</div>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
            {EOD_TYPES.map(type => {
              const done   = uploadedPhotos.some(p => p.photo_type === type.key);
              const active = selectedType === type.key;
              return (
                <button
                  key={type.key}
                  onClick={() => arrivalConfirmed && setSelectedType(type.key)}
                  style={{
                    flexShrink: 0,
                    border: `1.5px solid ${!arrivalConfirmed ? T.rim : active ? T.orange : done ? T.green + '66' : T.rim}`,
                    background: !arrivalConfirmed ? T.card : active ? T.orangeBg : done ? T.greenBg : T.card,
                    borderRadius: 20, padding: '7px 14px', cursor: arrivalConfirmed ? 'pointer' : 'not-allowed',
                    fontFamily: T.cond, fontSize: 12, fontWeight: 700,
                    color: !arrivalConfirmed ? T.muted : active ? T.orange : done ? T.green : T.body,
                    letterSpacing: 1, whiteSpace: 'nowrap', opacity: arrivalConfirmed ? 1 : 0.5,
                  }}
                >
                  {done && '✓ '}{type.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Camera frame */}
        <div
          style={{
            background: T.card,
            border: `2px dashed ${arrivalConfirmed ? T.orange + '88' : T.rim}`,
            borderRadius: 14, height: 220, marginBottom: 14,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 12, cursor: arrivalConfirmed && !uploading ? 'pointer' : 'not-allowed',
            opacity: arrivalConfirmed ? 1 : 0.45,
          }}
          onClick={() => arrivalConfirmed && !uploading && fileInputRef.current?.click()}
        >
          <input
            type="file" accept="image/*" capture="environment"
            style={{ display: 'none' }} ref={fileInputRef}
            onChange={handleFileCapture}
          />
          {uploading ? (
            <>
              <div style={{ fontSize: 32 }}>⏳</div>
              <div style={{ fontFamily: T.mono, fontSize: 12, color: T.orange }}>UPLOADING…</div>
            </>
          ) : (
            <>
              <div style={{
                width: 56, height: 56, borderRadius: '50%',
                background: arrivalConfirmed ? T.orangeBg : T.card,
                border: `1.5px solid ${arrivalConfirmed ? T.orange + '55' : T.rim}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26,
              }}>📷</div>
              <div style={{ fontFamily: T.cond, fontSize: 16, fontWeight: 700, color: arrivalConfirmed ? T.text : T.muted, letterSpacing: 1 }}>
                {arrivalConfirmed ? 'TAP TO CAPTURE' : 'LOCKED'}
              </div>
              <div style={{ fontFamily: T.mono, fontSize: 10, color: T.sub }}>
                {arrivalConfirmed ? EOD_TYPES.find(t => t.key === selectedType)?.label : 'Confirm arrival to unlock'}
              </div>
            </>
          )}
          {arrivalConfirmed && ['tl','tr','bl','br'].map(c => (
            <div key={c} style={{
              position: 'absolute',
              top: c.startsWith('t') ? 10 : undefined, bottom: c.startsWith('b') ? 10 : undefined,
              left: c.endsWith('l') ? 10 : undefined, right: c.endsWith('r') ? 10 : undefined,
              width: 16, height: 16,
              borderTop: c.startsWith('t') ? `2px solid ${T.orange}` : undefined,
              borderBottom: c.startsWith('b') ? `2px solid ${T.orange}` : undefined,
              borderLeft: c.endsWith('l') ? `2px solid ${T.orange}` : undefined,
              borderRight: c.endsWith('r') ? `2px solid ${T.orange}` : undefined,
            }} />
          ))}
        </div>

        {/* GPS block */}
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
            fontFamily: T.mono, fontSize: 9, color: gps ? T.lime : T.muted,
            border: `1px solid ${gps ? T.limeRim : T.rim}`, borderRadius: 4, padding: '2px 6px', letterSpacing: 1,
          }}>{gps ? 'LOCK' : 'NO FIX'}</div>
        </div>

        {/* Photo grid */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontFamily: T.cond, fontSize: 11, color: T.sub, letterSpacing: 2, marginBottom: 8 }}>
            PHOTO CHECKLIST — {uploadedPhotos.length}/{EOD_TYPES.length}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {EOD_TYPES.map(type => {
              const photo = uploadedPhotos.find(p => p.photo_type === type.key);
              return (
                <div key={type.key} style={{
                  aspectRatio: '1',
                  background: photo ? T.greenBg : T.card,
                  border: `1.5px ${photo ? 'solid' : 'dashed'} ${photo ? T.green + '44' : T.orange + '55'}`,
                  borderRadius: 8,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 4,
                }}>
                  <span style={{ fontSize: 20 }}>{photo ? '✅' : '⏳'}</span>
                  <span style={{ fontFamily: T.mono, fontSize: 7, color: photo ? T.green : T.muted, textAlign: 'center', padding: '0 4px' }}>
                    {type.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

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
        <button
          onClick={handleSubmitEOD}
          disabled={submitting || !arrivalConfirmed || uploadedPhotos.length === 0}
          style={{
            width: '100%',
            background: !arrivalConfirmed ? T.muted : uploadedPhotos.length === 0 ? T.muted : T.orange,
            color: T.void, border: 'none', borderRadius: 10,
            padding: '15px 0', cursor: (!arrivalConfirmed || uploadedPhotos.length === 0) ? 'not-allowed' : 'pointer',
            fontFamily: T.cond, fontSize: 16, fontWeight: 900, letterSpacing: 3,
          }}
        >
          {!arrivalConfirmed ? '⏳ ARRIVE AT DESTINATION FIRST'
            : submitting ? 'SUBMITTING EOD…'
            : `SUBMIT EOD (${uploadedPhotos.length}/${EOD_TYPES.length})`}
        </button>
      </div>
    </div>
  );
}
