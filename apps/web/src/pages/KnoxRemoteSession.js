import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Monitor, Camera, ChevronLeft, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api.js';
import { subscribe } from '../lib/centrifuge.js';
const C = {
    bg: '#080C14', surf: '#0D1420', panel: '#111827', border: '#1E2D40',
    gold: '#F0B429', green: '#22c55e', red: '#ef4444', amber: '#f59e0b', blue: '#3b82f6',
    cyan: '#06b6d4', sub: '#6b7280', mid: '#94a3b8', txt: '#cbd5e1', hi: '#f1f5f9', purple: '#a855f7',
};
const TURN_SERVER = {
    urls: import.meta.env['VITE_TURN_URL'] ?? 'stun:stun.l.google.com:19302',
    ...(import.meta.env['VITE_TURN_USERNAME'] ? { username: import.meta.env['VITE_TURN_USERNAME'] } : {}),
    ...(import.meta.env['VITE_TURN_CREDENTIAL'] ? { credential: import.meta.env['VITE_TURN_CREDENTIAL'] } : {}),
};
const TURN_CONFIG = { iceServers: [TURN_SERVER] };
export default function KnoxRemoteSession() {
    const navigate = useNavigate();
    const { deviceId } = useParams({ strict: false });
    const [sessionStatus, setSessionStatus] = useState('connecting');
    const [telemetry, setTelemetry] = useState({});
    const [sessionLog, setSessionLog] = useState([]);
    const [recordings, setRecordings] = useState([]);
    const [endConfirm, setEndConfirm] = useState(false);
    const [wipeConfirm, setWipeConfirm] = useState(false);
    const [wipeText, setWipeText] = useState('');
    const [cmdMsg, setCmdMsg] = useState(null);
    const videoRef = useRef(null);
    const overlayRef = useRef(null);
    const pcRef = useRef(null);
    const sessionRef = useRef(null);
    function appendLog(type, label) {
        setSessionLog(prev => [{ type, label, ts: new Date().toISOString() }, ...prev].slice(0, 50));
    }
    useEffect(() => {
        if (!deviceId)
            return;
        let cancelled = false;
        (async () => {
            try {
                const startRes = await api.post(`/guardian/devices/${deviceId}/remote-session/start`, { triggered_by: 'manual' });
                if (cancelled)
                    return;
                const { session_id } = startRes.data;
                sessionRef.current = session_id;
                appendLog('session_started', 'Session initialized');
                const pc = new RTCPeerConnection(TURN_CONFIG);
                pcRef.current = pc;
                pc.ontrack = (event) => {
                    if (videoRef.current && event.streams[0]) {
                        videoRef.current.srcObject = event.streams[0];
                        if (!cancelled) {
                            setSessionStatus('live');
                            appendLog('stream_live', 'Stream live');
                        }
                    }
                };
                pc.onicecandidate = (event) => {
                    if (event.candidate && sessionRef.current)
                        api.post(`/guardian/devices/${deviceId}/remote-session/webrtc-signal`, { type: 'ice_candidate', payload: event.candidate, session_id: sessionRef.current }).catch(() => { });
                };
                const unsub = subscribe(`session:${session_id}`, (msg) => {
                    if (msg.type === 'answer' && pc.signalingState !== 'stable')
                        pc.setRemoteDescription(new RTCSessionDescription(msg.payload)).catch(() => { });
                    else if (msg.type === 'ice_candidate' && msg.payload)
                        pc.addIceCandidate(new RTCIceCandidate(msg.payload)).catch(() => { });
                });
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                await api.post(`/guardian/devices/${deviceId}/remote-session/webrtc-signal`, { type: 'offer', payload: offer, session_id });
                setTimeout(() => {
                    if (!cancelled && !videoRef.current?.srcObject) {
                        setSessionStatus('error');
                        appendLog('error', 'Stream timeout — no device response');
                    }
                }, 15000);
                return () => { cancelled = true; unsub(); };
            }
            catch (err) {
                if (!cancelled) {
                    const axErr = err;
                    if (axErr.response?.status === 400 && axErr.response?.data?.error === 'NOT_DEVICE_OWNER')
                        appendLog('error', 'Device not enrolled as Knox Device Owner');
                    else if (axErr.response?.status === 409)
                        appendLog('error', 'Session already active on this device');
                    else
                        appendLog('error', 'Failed to start remote session');
                    setSessionStatus('error');
                }
            }
        })();
        return () => { cancelled = true; };
    }, [deviceId]);
    useEffect(() => {
        if (!deviceId)
            return;
        return subscribe(`device:${deviceId}:telemetry`, (data) => setTelemetry(data));
    }, [deviceId]);
    useEffect(() => {
        if (!deviceId)
            return;
        api.get(`/guardian/devices/${deviceId}/remote-session/recordings`)
            .then(r => setRecordings(r.data?.sessions || [])).catch(() => { });
    }, [deviceId]);
    function handleOverlayClick(e) {
        if (sessionStatus !== 'live' || !sessionRef.current || !deviceId)
            return;
        const rect = e.currentTarget.getBoundingClientRect();
        const x = Math.round(e.clientX - rect.left);
        const y = Math.round(e.clientY - rect.top);
        api.post(`/guardian/devices/${deviceId}/remote-session/inject-touch`, { x, y, action: 'tap', session_id: sessionRef.current }).catch(() => { });
        appendLog('touch', `Tap (${x}, ${y})`);
    }
    async function mdmAction(action, confirm) {
        if (!sessionRef.current || !deviceId)
            return;
        if (confirm && !window.confirm(`Execute: ${action}?`))
            return;
        try {
            await api.post(`/guardian/devices/${deviceId}/remote-session/mdm-action`, { action, session_id: sessionRef.current, ...(action === 'remote_wipe' ? { confirm: true } : {}) });
            appendLog('mdm_action', `MDM: ${action}`);
            setCmdMsg({ text: `Command issued: ${action}`, ok: true });
        }
        catch {
            setCmdMsg({ text: `Failed: ${action}`, ok: false });
        }
        setTimeout(() => setCmdMsg(null), 3000);
    }
    async function endSession() {
        if (!sessionRef.current || !deviceId) {
            void navigate({ to: '/guardian' });
            return;
        }
        try {
            await api.post(`/guardian/devices/${deviceId}/remote-session/end`);
            pcRef.current?.close();
            setSessionStatus('ended');
            appendLog('session_ended', 'Session ended');
            setTimeout(() => void navigate({ to: '/guardian' }), 2000);
        }
        catch {
            void navigate({ to: '/guardian' });
        }
    }
    async function takeScreenshot() {
        if (!videoRef.current || !sessionRef.current || !deviceId)
            return;
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth || 360;
        canvas.height = videoRef.current.videoHeight || 640;
        canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0);
        const frameData = canvas.toDataURL('image/png').split(',')[1];
        try {
            await api.post(`/guardian/devices/${deviceId}/remote-session/screenshot`, { frame_data: frameData, session_id: sessionRef.current });
            appendLog('screenshot', 'Screenshot captured');
        }
        catch {
            appendLog('error', 'Screenshot failed');
        }
    }
    const statusColor = { connecting: C.amber, live: C.cyan, ended: C.sub, error: C.red }[sessionStatus] ?? C.amber;
    const logColor = { session_started: C.purple, stream_live: C.green, touch: C.blue, key: C.amber, mdm_action: C.amber, screenshot: C.green, session_ended: C.red, error: C.red };
    return (<div style={{ padding: 16, background: C.bg, minHeight: '100vh', fontFamily: 'Inter, sans-serif', fontSize: 12 }}>
      <style>{`@keyframes ripple{to{transform:scale(3);opacity:0}}@keyframes livePulse{0%,100%{opacity:1}50%{opacity:0.5}}`}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, borderBottom: `1px solid ${C.border}`, paddingBottom: 10, flexWrap: 'wrap' }}>
        <button onClick={() => void navigate({ to: '/guardian' })} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 4, padding: '4px 10px', color: C.mid, cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
          <ChevronLeft size={12}/> GUARDIAN
        </button>
        <Monitor size={14} style={{ color: C.cyan }}/>
        <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 800, fontSize: 16, color: C.hi, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          REMOTE SESSION — {String(deviceId || '').slice(0, 8).toUpperCase()}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, animation: sessionStatus === 'live' ? 'livePulse 1.5s infinite' : 'none' }}/>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: statusColor, fontWeight: 700 }}>{sessionStatus.toUpperCase()}</span>
          {sessionStatus === 'live' && <>
            <button onClick={takeScreenshot} style={{ background: `${C.green}18`, border: `1px solid ${C.green}40`, borderRadius: 3, padding: '3px 8px', color: C.green, cursor: 'pointer', fontSize: 10, fontFamily: 'JetBrains Mono, monospace', display: 'flex', alignItems: 'center', gap: 4 }}><Camera size={10}/> SCREENSHOT</button>
            <button onClick={() => setEndConfirm(true)} style={{ background: `${C.red}18`, border: `1px solid ${C.red}40`, borderRadius: 3, padding: '3px 8px', color: C.red, cursor: 'pointer', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}>END SESSION</button>
          </>}
        </div>
      </div>

      {((telemetry.battery_pct ?? 100) < 15 || (telemetry.signal_pct ?? 100) < 30) && (<div style={{ background: `${C.amber}18`, border: `1px solid ${C.amber}40`, borderRadius: 4, padding: '6px 12px', marginBottom: 10, display: 'flex', gap: 12, alignItems: 'center' }}>
          <AlertTriangle size={12} style={{ color: C.amber }}/>
          {(telemetry.battery_pct ?? 100) < 15 && <span style={{ color: C.amber, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700 }}>BATTERY CRITICAL: {telemetry.battery_pct}%</span>}
          {(telemetry.signal_pct ?? 100) < 30 && <span style={{ color: C.amber, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700 }}>SIGNAL WEAK: {telemetry.signal_pct}%</span>}
        </div>)}

      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr 240px', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12 }}>
            <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 12, color: C.gold, letterSpacing: '0.08em', marginBottom: 10 }}>DEVICE TELEMETRY</div>
            {[['Battery', `${telemetry.battery_pct ?? '--'}%`, (telemetry.battery_pct ?? 100) < 20 ? C.red : (telemetry.battery_pct ?? 100) < 50 ? C.amber : C.green],
            ['Signal', `${telemetry.signal_pct ?? '--'}%`, (telemetry.signal_pct ?? 100) < 30 ? C.red : C.green],
            ['GPS', telemetry.gps_locked ? 'LOCKED' : 'SEARCHING', telemetry.gps_locked ? C.green : C.amber],
            ['App', telemetry.app_version || '--', C.mid],
            ['Android', telemetry.android_version || '--', C.mid],
            ['Knox', telemetry.knox_version || '--', C.cyan],
        ].map(([label, val, color]) => (<div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: C.sub, fontSize: 10 }}>{label}</span>
                <span style={{ color, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 600 }}>{val}</span>
              </div>))}
          </div>
          <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12 }}>
            <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 12, color: C.gold, letterSpacing: '0.08em', marginBottom: 8 }}>MDM CONTROLS</div>
            {cmdMsg && <div style={{ marginBottom: 8, fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: cmdMsg.ok ? C.green : C.red }}>{cmdMsg.text}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[['Request Location', 'request_location', C.gold, false], ['Force Check-In', 'force_checkin', C.amber, false], ['Restart App', 'restart_app', C.green, false], ['Trigger Siren', 'trigger_siren', C.red, true], ['Lock Screen', 'lock_screen', C.blue, true], ['Clear App Data', 'clear_app_data', C.amber, true]].map(([label, action, color, confirm]) => (<button key={action} onClick={() => mdmAction(action, confirm)} style={{ background: `${color}14`, border: `1px solid ${color}35`, borderRadius: 4, padding: '6px 10px', color, fontSize: 10, fontFamily: 'JetBrains Mono, monospace', cursor: 'pointer', textAlign: 'left', fontWeight: 600 }}>
                  {label}
                </button>))}
              <button onClick={() => setWipeConfirm(true)} style={{ background: `${C.red}18`, border: `2px solid ${C.red}50`, borderRadius: 4, padding: '6px 10px', color: C.red, fontSize: 10, fontFamily: 'JetBrains Mono, monospace', cursor: 'pointer', textAlign: 'left', fontWeight: 800, letterSpacing: '0.06em' }}>
                REMOTE WIPE
              </button>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ position: 'relative', background: '#0a0a0a', borderRadius: 10, overflow: 'hidden', border: `2px solid ${sessionStatus === 'live' ? C.cyan : C.border}`, aspectRatio: '9/18', maxWidth: 360, margin: '0 auto', width: '100%' }}>
            <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}/>
            <div ref={overlayRef} onClick={handleOverlayClick} style={{ position: 'absolute', inset: 0, cursor: 'crosshair', userSelect: 'none' }}/>
            {sessionStatus !== 'live' && (<div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(8,12,20,0.9)' }}>
                <Monitor size={32} style={{ color: sessionStatus === 'error' ? C.red : C.cyan, marginBottom: 8 }}/>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: statusColor, fontWeight: 700 }}>
                  {sessionStatus === 'error' ? 'CONNECTION FAILED' : sessionStatus === 'ended' ? 'SESSION ENDED' : 'CONNECTING…'}
                </span>
                {sessionStatus === 'error' && (<button onClick={() => window.location.reload()} style={{ marginTop: 12, background: `${C.amber}20`, border: `1px solid ${C.amber}50`, color: C.amber, padding: '6px 16px', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>RETRY</button>)}
              </div>)}
          </div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
            {['HOME', 'BACK', 'RECENTS', 'POWER', 'VOLUME_UP', 'VOLUME_DOWN'].map(key => (<button key={key} onClick={() => { if (sessionRef.current && deviceId)
            api.post(`/guardian/devices/${deviceId}/remote-session/inject-key`, { key, session_id: sessionRef.current }).catch(() => { }); appendLog('key', `Key: ${key}`); }} style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 4, padding: '5px 12px', color: C.mid, fontSize: 10, fontFamily: 'JetBrains Mono, monospace', cursor: 'pointer', fontWeight: 600 }}>
                {key.replace('_', ' ')}
              </button>))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12, maxHeight: 350, overflowY: 'auto' }}>
            <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 12, color: C.gold, letterSpacing: '0.08em', marginBottom: 8 }}>SESSION LOG <span style={{ color: C.mid, fontSize: 10 }}>({sessionLog.length})</span></div>
            {sessionLog.length === 0 ? <div style={{ color: C.sub, fontSize: 10 }}>Session events will appear here…</div>
            : sessionLog.map((ev, i) => (<div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: logColor[ev.type] || C.mid, marginTop: 3, flexShrink: 0 }}/>
                  <div>
                    <div style={{ color: C.txt, fontSize: 10 }}>{ev.label}</div>
                    <div style={{ color: C.sub, fontSize: 9, fontFamily: 'JetBrains Mono, monospace' }}>{new Date(ev.ts).toLocaleTimeString()}</div>
                  </div>
                </div>))}
          </div>
          <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12 }}>
            <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 12, color: C.gold, letterSpacing: '0.08em', marginBottom: 8 }}>PAST RECORDINGS</div>
            {recordings.length === 0 ? <div style={{ color: C.sub, fontSize: 10 }}>No recordings yet</div>
            : recordings.slice(0, 5).map((rec, i) => (<div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: `1px solid ${C.border}` }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: C.txt, fontSize: 10 }}>{new Date(rec.started_at).toLocaleDateString()}</div>
                    <div style={{ color: C.sub, fontSize: 9, fontFamily: 'JetBrains Mono, monospace' }}>{rec.duration_secs ? `${Math.floor(rec.duration_secs / 60)}m ${rec.duration_secs % 60}s` : '--'}</div>
                  </div>
                  {rec.presigned_url && <a href={rec.presigned_url} target="_blank" rel="noreferrer" style={{ background: `${C.cyan}18`, border: `1px solid ${C.cyan}40`, borderRadius: 3, padding: '3px 8px', color: C.cyan, fontSize: 9, fontFamily: 'JetBrains Mono, monospace', textDecoration: 'none', fontWeight: 700 }}>PLAY</a>}
                </div>))}
          </div>
        </div>
      </div>

      {endConfirm && (<div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
          <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 8, padding: 24, maxWidth: 360, width: '100%', margin: '0 16px' }}>
            <h2 style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 800, fontSize: 16, color: C.hi, margin: '0 0 8px' }}>END SESSION?</h2>
            <p style={{ color: C.mid, fontSize: 12, marginBottom: 16 }}>This will close the remote session and disconnect from the device.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setEndConfirm(false)} style={{ flex: 1, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 4, padding: '8px', color: C.mid, cursor: 'pointer', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>CANCEL</button>
              <button onClick={() => { setEndConfirm(false); void endSession(); }} style={{ flex: 1, background: `${C.red}20`, border: `1px solid ${C.red}50`, borderRadius: 4, padding: '8px', color: C.red, cursor: 'pointer', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>END SESSION</button>
            </div>
          </div>
        </div>)}

      {wipeConfirm && (<div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
          <div style={{ background: C.surf, border: `2px solid ${C.red}50`, borderRadius: 8, padding: 24, maxWidth: 400, width: '100%', margin: '0 16px' }}>
            <h2 style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 800, fontSize: 18, color: C.red, margin: '0 0 8px' }}>REMOTE WIPE</h2>
            <p style={{ color: C.txt, fontSize: 12, marginBottom: 8 }}>This will factory reset the device and permanently erase all data.</p>
            <p style={{ color: C.red, fontSize: 11, fontFamily: 'JetBrains Mono, monospace', marginBottom: 12, fontWeight: 700 }}>Type WIPE to confirm:</p>
            <input value={wipeText} onChange={e => setWipeText(e.target.value)} placeholder="WIPE" style={{ width: '100%', background: C.panel, border: `1px solid ${C.red}40`, borderRadius: 4, padding: '8px 10px', fontSize: 12, color: C.red, outline: 'none', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, boxSizing: 'border-box', marginBottom: 12 }}/>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setWipeConfirm(false); setWipeText(''); }} style={{ flex: 1, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 4, padding: '8px', color: C.mid, cursor: 'pointer', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>CANCEL</button>
              <button onClick={() => { if (wipeText === 'WIPE') {
            setWipeConfirm(false);
            setWipeText('');
            void mdmAction('remote_wipe');
        } }} disabled={wipeText !== 'WIPE'} style={{ flex: 1, background: C.red, border: 'none', borderRadius: 4, padding: '8px', color: '#fff', cursor: wipeText === 'WIPE' ? 'pointer' : 'not-allowed', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, opacity: wipeText === 'WIPE' ? 1 : 0.5 }}>
                EXECUTE WIPE
              </button>
            </div>
          </div>
        </div>)}
    </div>);
}
