import React, { useState, useRef, useEffect } from 'react';
import { sealApi } from '../api/sealApi';
import { uploadApi } from '../api/uploadApi';
import { useGPSStamp } from '../hooks/useGPSStamp';
import type { AuthState } from '../types/ConvoyReport';
import type { SealStatus } from '../types/SealEntry';

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

interface SealRegisterScreenProps {
  navigate: (screen: string) => void;
  auth: AuthState | null;
}

interface VehicleGroup {
  plate: string;
  position: number;
  seals: { id: string; serial: string; position: string }[];
}

const KF_BLINK = `@keyframes sealBlink { 0%,100%{opacity:1} 50%{opacity:0.35} }`;

export function SealRegisterScreen({ navigate, auth }: SealRegisterScreenProps) {
  const [sealStatuses, setSealStatuses] = useState<Record<string, SealStatus>>({});
  const [activeSealId, setActiveSealId] = useState<string | null>(null);
  const [uploading, setUploading]       = useState<string | null>(null);
  const [toast, setToast]               = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { gps } = useGPSStamp();

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = KF_BLINK;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2800);
  }

  if (!auth) return null;
  const safeAuth = auth;

  // Group seals by vehicle plate
  const groups: VehicleGroup[] = safeAuth.convoy.trucks.map(truck => ({
    plate: truck.plate,
    position: truck.position,
    seals: safeAuth.convoy.seals
      .filter(s => s.vehicle_plate === truck.plate)
      .map(s => ({ id: s.id, serial: s.serial, position: s.position })),
  }));

  // Include unassigned seals (plate not matching any truck)
  const truckPlates = new Set(safeAuth.convoy.trucks.map(t => t.plate));
  const orphanSeals = safeAuth.convoy.seals.filter(s => !truckPlates.has(s.vehicle_plate));
  if (orphanSeals.length > 0) {
    groups.push({
      plate: 'UNASSIGNED',
      position: 99,
      seals: orphanSeals.map(s => ({ id: s.id, serial: s.serial, position: s.position })),
    });
  }

  function onPhotoClick(sealId: string) {
    setActiveSealId(sealId);
    fileInputRef.current?.click();
  }

  async function handleFileCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !activeSealId) return;
    if (!gps) { showToast('GPS lock required to verify seal.'); return; }

    const seal = safeAuth.convoy.seals.find(s => s.id === activeSealId);
    if (!seal) return;

    const capturedSealId = activeSealId;
    setUploading(capturedSealId);
    try {
      const urlRes = await uploadApi.getUploadUrl(
        'cargo_seal', safeAuth.convoy.id, 'sod', seal.vehicle_plate, safeAuth.token,
      );
      await uploadApi.uploadToR2(urlRes.upload_url, file);

      await sealApi.submitVerification(
        capturedSealId, safeAuth.convoy.id, 'sod',
        urlRes.photo_id, 'ok',
        gps.lat, gps.lng, safeAuth.token,
      );
      setSealStatuses(prev => ({ ...prev, [capturedSealId]: 'ok' }));
      showToast(`Seal ${seal.serial} verified ✓`);
    } catch {
      setSealStatuses(prev => ({ ...prev, [capturedSealId]: 'missing' }));
      showToast('Verification failed — marked for review.');
    } finally {
      setUploading(null);
      setActiveSealId(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleTamperAlert() {
    if (!gps) { showToast('GPS lock required to send tamper alert.'); return; }
    const unverified = safeAuth.convoy.seals.find(s => !sealStatuses[s.id]);
    if (!unverified) { showToast('No unverified seals to report.'); return; }
    try {
      await sealApi.reportTamper(unverified.id, safeAuth.convoy.id, gps.lat, gps.lng, safeAuth.token);
      setSealStatuses(prev => ({ ...prev, [unverified.id]: 'tampered' }));
      showToast('⚠️ Tamper alert sent to admin — GPS logged');
    } catch {
      showToast('Alert failed. Please retry or call control room.');
    }
  }

  const totalSeals    = safeAuth.convoy.seals.length;
  const verifiedCount = Object.values(sealStatuses).filter(s => s === 'ok').length;

  return (
    <div style={{ minHeight: '100dvh', background: T.void, display: 'flex', flexDirection: 'column' }}>
      {/* Hidden file input */}
      <input
        type="file" accept="image/*" capture="environment"
        style={{ display: 'none' }} ref={fileInputRef}
        onChange={handleFileCapture}
      />

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
            SEAL REGISTER
          </div>
          <div style={{ fontFamily: T.mono, fontSize: 9, color: T.sub }}>Physical seal verification</div>
        </div>
        <div style={{
          background: T.limeBg, border: `1px solid ${T.limeRim}`,
          borderRadius: 6, padding: '4px 10px',
          fontFamily: T.cond, fontSize: 12, fontWeight: 700, color: T.lime, letterSpacing: 1,
        }}>{verifiedCount}/{totalSeals} OK</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 110px' }}>

        {/* Progress strip */}
        <div style={{
          background: T.card, border: `1px solid ${T.rim}`, borderRadius: 10,
          padding: '12px 16px', marginBottom: 16,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontFamily: T.cond, fontSize: 12, color: T.sub, letterSpacing: 2 }}>VERIFICATION PROGRESS</span>
            <span style={{ fontFamily: T.mono, fontSize: 12, color: T.lime }}>
              {totalSeals > 0 ? Math.round((verifiedCount / totalSeals) * 100) : 0}%
            </span>
          </div>
          <div style={{ background: T.raised, borderRadius: 4, height: 6 }}>
            <div style={{
              width: `${totalSeals > 0 ? (verifiedCount / totalSeals) * 100 : 0}%`,
              height: '100%', background: `linear-gradient(90deg, ${T.lime}, ${T.green})`,
              borderRadius: 4, transition: 'width 0.4s',
            }} />
          </div>
        </div>

        {/* Per-vehicle seal cards */}
        {groups.map(group => (
          <div key={group.plate} style={{
            background: T.card, border: `1px solid ${T.rim}`,
            borderRadius: 14, marginBottom: 14, overflow: 'hidden',
          }}>
            {/* Card header */}
            <div style={{
              background: T.raised, padding: '12px 16px',
              display: 'flex', alignItems: 'center', gap: 10,
              borderBottom: `1px solid ${T.rim}`,
            }}>
              <span style={{ fontSize: 18 }}>🚛</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: T.cond, fontSize: 16, fontWeight: 900, color: T.white, letterSpacing: 2 }}>
                  {group.plate}
                </div>
                <div style={{ fontFamily: T.mono, fontSize: 9, color: T.sub }}>
                  TRUCK {group.position} · {group.seals.length} seal{group.seals.length !== 1 ? 's' : ''}
                </div>
              </div>
              <div style={{
                background: T.limeBg, border: `1px solid ${T.limeRim}`,
                borderRadius: 12, padding: '3px 9px',
                fontFamily: T.mono, fontSize: 10, color: T.lime,
              }}>
                {group.seals.filter(s => sealStatuses[s.id] === 'ok').length}/{group.seals.length}
              </div>
            </div>

            {/* Seal rows */}
            <div style={{ padding: '8px 0' }}>
              {group.seals.length === 0 ? (
                <div style={{ padding: '10px 16px', fontFamily: T.mono, fontSize: 11, color: T.muted }}>
                  No seals assigned to this vehicle.
                </div>
              ) : (
                group.seals.map(seal => {
                  const status  = sealStatuses[seal.id];
                  const isUploading = uploading === seal.id;
                  const color = status === 'ok' ? T.green
                    : status === 'tampered' ? T.red
                    : status === 'missing' ? T.orange
                    : T.sub;
                  return (
                    <div key={seal.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 16px',
                      borderBottom: `1px solid ${T.rim}`,
                    }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                        background: color,
                        animation: isUploading ? 'sealBlink 0.8s ease-in-out infinite' : undefined,
                      }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: T.mono, fontSize: 13, color: T.text, letterSpacing: 1 }}>
                          {seal.serial}
                        </div>
                        <div style={{ fontFamily: T.mono, fontSize: 9, color: T.sub }}>{seal.position}</div>
                      </div>
                      <button
                        onClick={() => !isUploading && onPhotoClick(seal.id)}
                        disabled={isUploading}
                        style={{
                          background: status === 'ok' ? T.greenBg : T.card,
                          border: `1px solid ${status === 'ok' ? T.green + '44' : T.rim}`,
                          borderRadius: 8, padding: '6px 10px',
                          fontFamily: T.mono, fontSize: 12,
                          cursor: isUploading ? 'not-allowed' : 'pointer',
                          color: T.body,
                        }}
                      >
                        {isUploading ? '⏳' : '📷'}
                      </button>
                      <div style={{
                        fontFamily: T.mono, fontSize: 16,
                        color: status === 'ok' ? T.green : status === 'tampered' ? T.red : T.muted,
                      }}>
                        {status === 'ok' ? '✓' : status === 'tampered' ? '✗' : '⚠'}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Tamper alert button */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        padding: '12px 16px 24px', background: T.deep, borderTop: `1px solid ${T.rim}`,
      }}>
        <button
          onClick={handleTamperAlert}
          style={{
            width: '100%', background: T.redBg,
            border: `1.5px solid ${T.red}55`, borderRadius: 12,
            padding: '15px 0', cursor: 'pointer',
            fontFamily: T.cond, fontSize: 16, fontWeight: 900,
            color: T.red, letterSpacing: 2,
          }}
        >
          ⚠️ REPORT TAMPERED / BROKEN SEAL
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 88, left: 16, right: 16,
          background: T.card, border: `1px solid ${T.lime}`,
          borderRadius: 10, padding: '12px 16px',
          fontFamily: T.mono, fontSize: 12, color: T.text,
          zIndex: 200, textAlign: 'center',
          boxShadow: `0 4px 24px rgba(0,0,0,0.5)`,
        }}>{toast}</div>
      )}
    </div>
  );
}
