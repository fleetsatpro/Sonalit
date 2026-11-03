import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { useDashboardStore } from '../../stores/dashboardStore.js';

const AUTO_DISMISS_MS = 15_000;

// Global — mounted once alongside PanicAlarm (see GlobalPanicAlarm.tsx) so a
// voice note from a field officer is impossible to miss regardless of which
// page/device is on screen, instead of only ever showing up passively in
// Live Fleet's per-device detail card (the only place it used to appear).
export default function VoiceNoteAlertToast() {
  const alert = useDashboardStore((s) => s.voiceNoteAlert);
  const setVoiceNoteAlert = useDashboardStore((s) => s.setVoiceNoteAlert);
  const [playing, setPlaying] = useState(false);
  const [playError, setPlayError] = useState(false);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playerRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!alert) return;
    setPlaying(false);
    setPlayError(false);
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(() => setVoiceNoteAlert(null), AUTO_DISMISS_MS);
    return () => { if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alert?.id]);

  // Stop playback if the toast is dismissed/replaced mid-clip
  useEffect(() => () => playerRef.current?.pause(), []);

  if (!alert) return null;

  const play = async () => {
    setPlayError(false);
    try {
      const res = await api.get(`/guardian/devices/${alert.deviceId}/voice-messages/${alert.voiceId}/audio`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      if (!playerRef.current) playerRef.current = new Audio();
      const player = playerRef.current;
      player.src = url;
      player.onended = () => { setPlaying(false); URL.revokeObjectURL(url); };
      await player.play();
      setPlaying(true);
    } catch {
      setPlayError(true);
    }
  };

  const enableNotifications = async () => {
    const perm = await Notification.requestPermission();
    setNotifPermission(perm);
  };

  return (
    <div
      style={{
        position: 'fixed', top: 70, right: 16, zIndex: 9000,
        width: 300, background: 'rgba(8,11,20,.97)', border: '1px solid rgba(232,168,48,.35)',
        borderRadius: 12, boxShadow: '0 16px 48px rgba(0,0,0,.6), 0 0 20px rgba(232,168,48,.08)',
        backdropFilter: 'blur(12px)', animation: 'vna-slide-in .25s ease-out',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <style>{`@keyframes vna-slide-in { from { transform: translateX(24px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }`}</style>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 12px 8px' }}>
        <div style={{
          width: 30, height: 30, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: 'rgba(232,168,48,.14)', border: '1px solid rgba(232,168,48,.4)', color: '#e8a830',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/></svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#e8e6de' }}>Voice note received</div>
          <div style={{ fontSize: 11, color: '#9a9890', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{alert.deviceName}</div>
        </div>
        <button
          onClick={() => setVoiceNoteAlert(null)}
          title="Dismiss"
          style={{ background: 'none', border: 'none', color: '#6e6c64', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 2 }}
        >×</button>
      </div>

      <div style={{ padding: '0 12px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={() => void play()}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 7, cursor: 'pointer',
            background: playing ? 'rgba(232,168,48,.18)' : 'rgba(22,199,132,.14)',
            border: `1px solid ${playing ? 'rgba(232,168,48,.5)' : 'rgba(22,199,132,.4)'}`,
            color: playing ? '#e8a830' : '#16c784', fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l14 8-14 8z"/></svg>
          {playing ? 'Playing…' : 'Play'}
        </button>
        {alert.durationMs != null && (
          <span style={{ fontSize: 10, fontFamily: 'IBM Plex Mono, monospace', color: '#6e6c64' }}>{Math.round(alert.durationMs / 1000)}s</span>
        )}
        {playError && <span style={{ fontSize: 10, color: '#ef4444', marginLeft: 'auto' }}>Playback failed</span>}
      </div>

      {notifPermission === 'default' && (
        <button
          onClick={() => void enableNotifications()}
          style={{
            width: '100%', textAlign: 'left', padding: '7px 12px', background: 'rgba(255,255,255,.03)',
            border: 'none', borderTop: '1px solid rgba(255,255,255,.06)', borderRadius: '0 0 12px 12px',
            color: '#7a7e8a', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Enable desktop notifications for new voice notes →
        </button>
      )}
    </div>
  );
}
