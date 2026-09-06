import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Monitor, Camera, ChevronLeft, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import socketService from '../services/socket';

const C = {
  bg:'#080C14', surf:'#0D1420', panel:'#111827', border:'#1E2D40', border2:'#243650',
  gold:'#F0B429', green:'#22c55e', red:'#ef4444', amber:'#f59e0b', blue:'#3b82f6',
  cyan:'#06b6d4', purple:'#a855f7', dim:'#374151', muted:'#4b5563', sub:'#6b7280',
  mid:'#94a3b8', txt:'#cbd5e1', hi:'#f1f5f9',
};

const TURN_CONFIG = {
  iceServers: [{
    urls: import.meta.env.VITE_TURN_URL || 'stun:stun.l.google.com:19302',
    username: import.meta.env.VITE_TURN_USERNAME,
    credential: import.meta.env.VITE_TURN_CREDENTIAL,
  }],
};

export default function KnoxRemoteSessionPage() {
  const { deviceId } = useParams();
  const navigate = useNavigate();

  const [session, setSession] = useState(null);
  const [sessionStatus, setSessionStatus] = useState('connecting');
  const [telemetry, setTelemetry] = useState({});
  const [sessionLog, setSessionLog] = useState([]);
  const [recordings, setRecordings] = useState([]);
  const [streamStats] = useState({ latency: null, fps: null });
  const [endConfirm, setEndConfirm] = useState(false);
  const [wipeConfirm, setWipeConfirm] = useState(false);
  const [wipeText, setWipeText] = useState('');

  const videoRef = useRef(null);
  const overlayRef = useRef(null);
  const pcRef = useRef(null);
  const sessionRef = useRef(null);

  function appendLog(event) {
    setSessionLog(prev => [{ ...event, ts: new Date().toISOString() }, ...prev].slice(0, 50));
  }

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const startRes = await api.post(`/guardian/devices/${deviceId}/remote-session/start`, { triggered_by: 'manual' });
        if (cancelled) return;
        const { session_id } = startRes.data;
        setSession({ session_id });
        sessionRef.current = session_id;
        appendLog({ type: 'session_started', label: 'Session initialized' });

        const pc = new RTCPeerConnection(TURN_CONFIG);
        pcRef.current = pc;

        pc.ontrack = (event) => {
          if (videoRef.current && event.streams[0]) {
            videoRef.current.srcObject = event.streams[0];
            if (!cancelled) { setSessionStatus('live'); appendLog({ type: 'stream_live', label: 'Stream live' }); }
          }
        };

        pc.onicecandidate = (event) => {
          if (event.candidate && sessionRef.current) {
            api.post(`/guardian/devices/${deviceId}/remote-session/webrtc-signal`, {
              type: 'ice_candidate', payload: event.candidate, session_id: sessionRef.current,
            }).catch(() => {});
          }
        };

        const sigHandler = (msg) => {
          if (msg.type === 'answer' && pc.signalingState !== 'stable') {
            pc.setRemoteDescription(new RTCSessionDescription(msg.payload)).catch(() => {});
          } else if (msg.type === 'ice_candidate' && msg.payload) {
            pc.addIceCandidate(new RTCIceCandidate(msg.payload)).catch(() => {});
          }
        };
        socketService.on(`session:${session_id}:signal`, sigHandler);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await api.post(`/guardian/devices/${deviceId}/remote-session/webrtc-signal`, {
          type: 'offer', payload: offer, session_id,
        });

        setTimeout(() => {
          if (!cancelled && sessionRef.current && videoRef.current?.srcObject == null) {
            setSessionStatus('error');
            appendLog({ type: 'error', label: 'Stream timeout — no response from device' });
          }
        }, 15000);

      } catch (err) {
        if (!cancelled) {
          if (err.response?.status === 400 && err.response?.data?.error === 'NOT_DEVICE_OWNER') {
            toast.error('Device is not enrolled as Knox Device Owner');
          } else if (err.response?.status === 409) {
            toast.error('Session already active on this device');
          } else {
            toast.error('Failed to start remote session');
          }
          setSessionStatus('error');
        }
      }
    }
    init();
    return () => { cancelled = true; };
  }, [deviceId]);

  useEffect(() => {
    const handler = (data) => { if (data.device_id === deviceId) setTelemetry(data); };
    socketService.on('device:telemetry', handler);
    return () => socketService.off('device:telemetry', handler);
  }, [deviceId]);

  useEffect(() => {
    api.get(`/guardian/devices/${deviceId}/remote-session/recordings`)
      .then(r => setRecordings(r.data?.sessions || []))
      .catch(() => {});
  }, [deviceId]);

  function handleOverlayClick(e) {
    if (sessionStatus !== 'live' || !sessionRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(e.clientX - rect.left);
    const y = Math.round(e.clientY - rect.top);

    const ripple = document.createElement('div');
    ripple.style.cssText = `position:absolute;left:${x - 12}px;top:${y - 12}px;width:24px;height:24px;border-radius:50%;border:2px solid ${C.gold};pointer-events:none;animation:ripple 0.6s ease-out forwards`;
    e.currentTarget.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);

    api.post(`/guardian/devices/${deviceId}/remote-session/inject-touch`, { x, y, action: 'tap', session_id: sessionRef.current }).catch(() => {});
    appendLog({ type: 'touch', label: `Tap (${x}, ${y})` });
  }

  function injectKey(key) {
    if (!sessionRef.current) return;
    api.post(`/guardian/devices/${deviceId}/remote-session/inject-key`, { key, session_id: sessionRef.current }).catch(() => {});
    appendLog({ type: 'key', label: `Key: ${key}` });
  }

  async function mdmAction(action) {
    if (!sessionRef.current) return;
    try {
      const body = { action, session_id: sessionRef.current };
      if (action === 'remote_wipe') body.confirm = true;
      await api.post(`/guardian/devices/${deviceId}/remote-session/mdm-action`, body);
      appendLog({ type: 'mdm_action', label: `MDM: ${action}` });
      toast.success(`Command issued: ${action}`);
    } catch (err) {
      toast.error(err.response?.data?.error || `Failed: ${action}`);
    }
  }

  async function endSession() {
    if (!sessionRef.current) { navigate('/guardian'); return; }
    try {
      await api.post(`/guardian/devices/${deviceId}/remote-session/end`);
      pcRef.current?.close();
      setSessionStatus('ended');
      appendLog({ type: 'session_ended', label: 'Session ended' });
      setTimeout(() => navigate('/guardian'), 2000);
    } catch { navigate('/guardian'); }
  }

  async function takeScreenshot() {
    if (!videoRef.current || !sessionRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 360;
    canvas.height = videoRef.current.videoHeight || 640;
    canvas.getContext('2d').drawImage(videoRef.current, 0, 0);
    const frameData = canvas.toDataURL('image/png').split(',')[1];
    try {
      await api.post(`/guardian/devices/${deviceId}/remote-session/screenshot`, { frame_data: frameData, session_id: sessionRef.current });
      appendLog({ type: 'screenshot', label: 'Screenshot captured' });
      toast.success('Screenshot saved');
    } catch { toast.error('Screenshot failed'); }
  }

  const statusColor = { connecting: C.amber, live: C.cyan, ended: C.sub, error: C.red }[sessionStatus] || C.amber;

  return (
    <div style={{ padding: 16, background: C.bg, minHeight: '100vh', fontFamily: 'Inter, sans-serif', fontSize: 12 }}>
      <style>{`@keyframes ripple{to{transform:scale(3);opacity:0}}@keyframes livePulse{0%,100%{opacity:1}50%{opacity:0.5}}`}</style>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, borderBottom: `1px solid ${C.border}`, paddingBottom: 10, flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/guardian')} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 4, padding: '4px 10px', color: C.mid, cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
          <ChevronLeft size={12} /> GUARDIAN
        </button>
        <Monitor size={14} style={{ color: C.cyan }} />
        <span style={{ fontFamily: 'Barlow Condensed', fontWeight: 800, fontSize: 16, color: C.hi, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          REMOTE SESSION — DEVICE {String(deviceId).slice(0, 8).toUpperCase()}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, animation: sessionStatus === 'live' ? 'livePulse 1.5s infinite' : 'none' }} />
          <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: statusColor, fontWeight: 700 }}>{sessionStatus.toUpperCase()}</span>
          {sessionStatus === 'live' && (
            <>
              <button onClick={takeScreenshot} style={{ background: `${C.green}18`, border: `1px solid ${C.green}40`, borderRadius: 3, padding: '3px 8px', color: C.green, cursor: 'pointer', fontSize: 10, fontFamily: 'JetBrains Mono', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Camera size={10} /> SCREENSHOT
              </button>
              <button onClick={() => setEndConfirm(true)} style={{ background: `${C.red}18`, border: `1px solid ${C.red}40`, borderRadius: 3, padding: '3px 8px', color: C.red, cursor: 'pointer', fontSize: 10, fontFamily: 'JetBrains Mono' }}>
                END SESSION
              </button>
            </>
          )}
        </div>
      </div>

      {(telemetry.battery_pct < 15 || telemetry.signal_pct < 30) && (
        <div style={{ background: `${C.amber}18`, border: `1px solid ${C.amber}40`, borderRadius: 4, padding: '6px 12px', marginBottom: 10, display: 'flex', gap: 12, alignItems: 'center' }}>
          <AlertTriangle size={12} style={{ color: C.amber }} />
          {telemetry.battery_pct < 15 && <span style={{ color: C.amber, fontFamily: 'JetBrains Mono', fontSize: 10, fontWeight: 700 }}>BATTERY CRITICAL: {telemetry.battery_pct}%</span>}
          {telemetry.signal_pct < 30 && <span style={{ color: C.amber, fontFamily: 'JetBrains Mono', fontSize: 10, fontWeight: 700 }}>SIGNAL WEAK: {telemetry.signal_pct}%</span>}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr 240px', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12 }}>
            <div style={{ fontFamily: 'Barlow Condensed', fontWeight: 700, fontSize: 12, color: C.gold, letterSpacing: '0.08em', marginBottom: 10 }}>DEVICE TELEMETRY</div>
            {[['Battery', `${telemetry.battery_pct ?? '--'}%`, telemetry.battery_pct < 20 ? C.red : telemetry.battery_pct < 50 ? C.amber : C.green],
              ['Signal', `${telemetry.signal_pct ?? '--'}%`, telemetry.signal_pct < 30 ? C.red : C.green],
              ['GPS', telemetry.gps_locked ? 'LOCKED' : 'SEARCHING', telemetry.gps_locked ? C.green : C.amber],
              ['App', telemetry.app_version || '--', C.mid],
              ['Android', telemetry.android_version || '--', C.mid],
              ['Knox', telemetry.knox_version || '--', C.cyan],
            ].map(([label, val, color]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: C.sub, fontFamily: 'Inter', fontSize: 10 }}>{label}</span>
                <span style={{ color, fontFamily: 'JetBrains Mono', fontSize: 10, fontWeight: 600 }}>{val}</span>
              </div>
            ))}
          </div>

          <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12 }}>
            <div style={{ fontFamily: 'Barlow Condensed', fontWeight: 700, fontSize: 12, color: C.gold, letterSpacing: '0.08em', marginBottom: 8 }}>MDM CONTROLS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[['Request Location', 'request_location', C.gold, false],
                ['Force Check-In', 'force_checkin', C.amber, false],
                ['Restart App', 'restart_app', C.green, false],
                ['Trigger Siren', 'trigger_siren', C.red, true],
                ['Lock Screen', 'lock_screen', C.blue, true],
                ['Clear App Data', 'clear_app_data', C.amber, true],
              ].map(([label, action, color, confirm]) => (
                <button key={action} onClick={() => { if (confirm && !window.confirm(`Execute: ${label}?`)) return; mdmAction(action); }}
                  style={{ background: `${color}14`, border: `1px solid ${color}35`, borderRadius: 4, padding: '6px 10px', color, fontSize: 10, fontFamily: 'JetBrains Mono', cursor: 'pointer', textAlign: 'left', fontWeight: 600 }}>
                  {label}
                </button>
              ))}
              <button onClick={() => setWipeConfirm(true)}
                style={{ background: `${C.red}18`, border: `2px solid ${C.red}50`, borderRadius: 4, padding: '6px 10px', color: C.red, fontSize: 10, fontFamily: 'JetBrains Mono', cursor: 'pointer', textAlign: 'left', fontWeight: 800, letterSpacing: '0.06em' }}>
                REMOTE WIPE
              </button>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ position: 'relative', background: '#0a0a0a', borderRadius: 10, overflow: 'hidden', border: `2px solid ${sessionStatus === 'live' ? C.cyan : C.border}`, aspectRatio: '9/18', maxWidth: 360, margin: '0 auto', width: '100%' }}>
            <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            <div ref={overlayRef} onClick={handleOverlayClick} style={{ position: 'absolute', inset: 0, cursor: 'crosshair', userSelect: 'none' }} />
            {sessionStatus !== 'live' && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(8,12,20,0.9)' }}>
                <Monitor size={32} style={{ color: sessionStatus === 'error' ? C.red : C.cyan, marginBottom: 8 }} />
                <span style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: statusColor, fontWeight: 700 }}>
                  {sessionStatus === 'error' ? 'CONNECTION FAILED' : sessionStatus === 'ended' ? 'SESSION ENDED' : 'CONNECTING TO DEVICE…'}
                </span>
                {sessionStatus === 'error' && (
                  <button onClick={() => window.location.reload()} style={{ marginTop: 12, background: `${C.amber}20`, border: `1px solid ${C.amber}50`, color: C.amber, padding: '6px 16px', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontFamily: 'JetBrains Mono', fontWeight: 700 }}>RETRY</button>
                )}
              </div>
            )}
            {sessionStatus === 'live' && streamStats.latency && (
              <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)', borderRadius: 3, padding: '3px 6px', display: 'flex', gap: 8 }}>
                <span style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: C.mid }}>{streamStats.latency}ms</span>
                {streamStats.fps && <span style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: C.mid }}>{streamStats.fps}fps</span>}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <input placeholder="Type text to send to device…"
              style={{ flex: 1, background: C.surf, border: `1px solid ${C.border}`, borderRadius: 4, padding: '6px 10px', fontSize: 11, color: C.txt, outline: 'none', fontFamily: 'Inter' }}
              onKeyDown={e => e.key === 'Enter' && toast('Keystroke injection coming soon', { icon: '⌨️' })} />
          </div>

          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
            {[['HOME','Home'],['BACK','Back'],['RECENTS','Recents'],['POWER','Power'],['VOLUME_UP','Vol+'],['VOLUME_DOWN','Vol-']].map(([key, label]) => (
              <button key={key} onClick={() => injectKey(key)}
                style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 4, padding: '5px 12px', color: C.mid, fontSize: 10, fontFamily: 'JetBrains Mono', cursor: 'pointer', fontWeight: 600 }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12, maxHeight: 350, overflowY: 'auto' }}>
            <div style={{ fontFamily: 'Barlow Condensed', fontWeight: 700, fontSize: 12, color: C.gold, letterSpacing: '0.08em', marginBottom: 8 }}>
              SESSION LOG <span style={{ color: C.mid, fontSize: 10 }}>({sessionLog.length})</span>
            </div>
            {sessionLog.length === 0 ? (
              <div style={{ color: C.sub, fontSize: 10, fontFamily: 'Inter' }}>Session events will appear here…</div>
            ) : sessionLog.map((ev, i) => {
              const iconColor = { session_started: C.purple, stream_live: C.green, touch: C.blue, key: C.amber, mdm_action: C.amber, screenshot: C.green, session_ended: C.red, error: C.red }[ev.type] || C.mid;
              return (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'flex-start' }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: iconColor, marginTop: 3, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ color: C.txt, fontSize: 10, fontFamily: 'Inter' }}>{ev.label}</div>
                    <div style={{ color: C.sub, fontSize: 9, fontFamily: 'JetBrains Mono' }}>{ev.ts ? new Date(ev.ts).toLocaleTimeString() : ''}</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12 }}>
            <div style={{ fontFamily: 'Barlow Condensed', fontWeight: 700, fontSize: 12, color: C.gold, letterSpacing: '0.08em', marginBottom: 8 }}>PAST RECORDINGS</div>
            {recordings.length === 0 ? (
              <div style={{ color: C.sub, fontSize: 10 }}>No recordings yet</div>
            ) : recordings.slice(0, 5).map((rec, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: `1px solid ${C.border}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ color: C.txt, fontSize: 10, fontFamily: 'Inter' }}>{new Date(rec.started_at).toLocaleDateString()}</div>
                  <div style={{ color: C.sub, fontSize: 9, fontFamily: 'JetBrains Mono' }}>{rec.duration_secs ? `${Math.floor(rec.duration_secs/60)}m ${rec.duration_secs%60}s` : '--'}</div>
                </div>
                {rec.presigned_url && (
                  <a href={rec.presigned_url} target="_blank" rel="noreferrer"
                    style={{ background: `${C.cyan}18`, border: `1px solid ${C.cyan}40`, borderRadius: 3, padding: '3px 8px', color: C.cyan, fontSize: 9, fontFamily: 'JetBrains Mono', textDecoration: 'none', fontWeight: 700 }}>
                    PLAY
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {endConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
          <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 8, padding: 24, maxWidth: 360, width: '100%', margin: '0 16px' }}>
            <h2 style={{ fontFamily: 'Barlow Condensed', fontWeight: 800, fontSize: 16, color: C.hi, letterSpacing: '0.06em', margin: '0 0 8px' }}>END SESSION?</h2>
            <p style={{ color: C.mid, fontSize: 12, marginBottom: 16 }}>This will close the remote session and disconnect from the device.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setEndConfirm(false)} style={{ flex: 1, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 4, padding: '8px', color: C.mid, cursor: 'pointer', fontSize: 11, fontFamily: 'JetBrains Mono' }}>CANCEL</button>
              <button onClick={() => { setEndConfirm(false); endSession(); }} style={{ flex: 1, background: `${C.red}20`, border: `1px solid ${C.red}50`, borderRadius: 4, padding: '8px', color: C.red, cursor: 'pointer', fontSize: 11, fontFamily: 'JetBrains Mono', fontWeight: 700 }}>END SESSION</button>
            </div>
          </div>
        </div>
      )}

      {wipeConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
          <div style={{ background: C.surf, border: `2px solid ${C.red}50`, borderRadius: 8, padding: 24, maxWidth: 400, width: '100%', margin: '0 16px' }}>
            <h2 style={{ fontFamily: 'Barlow Condensed', fontWeight: 800, fontSize: 18, color: C.red, letterSpacing: '0.08em', margin: '0 0 8px' }}>REMOTE WIPE</h2>
            <p style={{ color: C.txt, fontSize: 12, marginBottom: 8 }}>This will factory reset the device and permanently erase all data. This action cannot be undone.</p>
            <p style={{ color: C.red, fontSize: 11, fontFamily: 'JetBrains Mono', marginBottom: 12, fontWeight: 700 }}>Type WIPE to confirm:</p>
            <input value={wipeText} onChange={e => setWipeText(e.target.value)} placeholder="WIPE"
              style={{ width: '100%', background: C.panel, border: `1px solid ${C.red}40`, borderRadius: 4, padding: '8px 10px', fontSize: 12, color: C.red, outline: 'none', fontFamily: 'JetBrains Mono', fontWeight: 700, boxSizing: 'border-box', marginBottom: 12 }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setWipeConfirm(false); setWipeText(''); }} style={{ flex: 1, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 4, padding: '8px', color: C.mid, cursor: 'pointer', fontSize: 11, fontFamily: 'JetBrains Mono' }}>CANCEL</button>
              <button onClick={() => { if (wipeText === 'WIPE') { setWipeConfirm(false); setWipeText(''); mdmAction('remote_wipe'); } else toast.error('Type WIPE to confirm'); }}
                style={{ flex: 1, background: C.red, border: 'none', borderRadius: 4, padding: '8px', color: '#fff', cursor: 'pointer', fontSize: 11, fontFamily: 'JetBrains Mono', fontWeight: 800 }}>EXECUTE WIPE</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
