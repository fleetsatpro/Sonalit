import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../../lib/api.js'
import type { LiveVehicle, LiveStatus } from '../types/fleet.js'

const MAX_VOICE_MS = 60_000

interface VoiceNote { id: string; duration_ms: number | null; created_at: string }

function fmtNoteAge(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

const STATUS_COLOR: Record<LiveStatus, string> = {
  move: '#16c784', idle: '#f59e0b', stop: '#475569', offline: '#3e4252', sos: '#ef4444',
}
const STATUS_LABEL: Record<LiveStatus, string> = {
  move: 'MOVING', idle: 'IDLE', stop: 'STOPPED', offline: 'OFFLINE', sos: 'SOS ACTIVE',
}

function fmtHeading(h: number | null): string {
  if (h == null) return '—°'
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']
  return `${Math.round(h)}° ${dirs[Math.round(h / 22.5) % 16]}`
}

function fmtAgo(s: number): string {
  if (s > 99000) return '—'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

/** device_health stores -1/NULL for "unknown" — never render a fabricated value. */
function pct(v: number | null | undefined): number | null {
  return v != null && v >= 0 ? v : null
}

const HEALTH_STALE_AFTER_MS = 30 * 60_000

function fmtHealthAge(ts: string | null): string | null {
  if (!ts) return null
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

function HealthBar({ label, value }: { label: string; value: number | null }) {
  const color = value == null ? '#3e4252' : value < 20 ? '#ef4444' : value < 50 ? '#f59e0b' : '#16c784'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, color: '#7a7e8a', width: 24, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,.06)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${value ?? 0}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, fontWeight: 600, color, width: 30, textAlign: 'right', flexShrink: 0 }}>
        {value == null ? '—' : `${value}%`}
      </span>
    </div>
  )
}

interface Props {
  vehicle: LiveVehicle | null
  onClose: () => void
  /** id of the vehicle/device the map camera is currently following */
  trackedId: string | null
  onToggleTrack: (v: LiveVehicle) => void
}

type ActionState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; note: string } | { kind: 'error'; note: string }

export default function DetailCard({ vehicle: v, onClose, trackedId, onToggleTrack }: Props) {
  const [msgOpen, setMsgOpen] = useState(false)
  const [msgText, setMsgText] = useState('')
  const [action, setAction] = useState<ActionState>({ kind: 'idle' })
  const [recording, setRecording] = useState(false)
  const [recElapsed, setRecElapsed] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recChunksRef = useRef<BlobPart[]>([])
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recStartRef = useRef(0)
  // 'send' posts the clip; 'discard' just tears the recorder down
  const recIntentRef = useRef<'send' | 'discard'>('discard')
  const [playingId, setPlayingId] = useState<string | null>(null)
  const playerRef = useRef<HTMLAudioElement | null>(null)

  const { data: voiceNotes } = useQuery<VoiceNote[]>({
    queryKey: ['guardian-voice-notes', v?.id],
    queryFn: async () => {
      const r = await api.get<{ data: VoiceNote[] }>(`/guardian/devices/${v!.id}/voice-messages`)
      return r.data.data ?? []
    },
    enabled: !!v && v.kind === 'guardian',
    refetchInterval: 30_000,
  })

  const stopRecorder = (intent: 'send' | 'discard') => {
    recIntentRef.current = intent
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null }
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') rec.stop()
    else setRecording(false)
  }

  // Reset transient action UI when the operator switches device
  useEffect(() => {
    setMsgOpen(false); setMsgText(''); setAction({ kind: 'idle' })
    stopRecorder('discard')
    playerRef.current?.pause()
    setPlayingId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v?.id])
  // Tear down the mic if the card unmounts mid-recording
  useEffect(() => () => stopRecorder('discard'), [])
  // Stop playback if the card unmounts mid-clip
  useEffect(() => () => playerRef.current?.pause(), [])

  if (!v) return null

  const color = STATUS_COLOR[v.status]
  const isSos = v.status === 'sos'
  const isGuardian = v.kind === 'guardian'
  const tracking = trackedId === v.id

  const sendCommand = async (command: string, payload: Record<string, unknown> | null, doneNote: string): Promise<boolean> => {
    setAction({ kind: 'busy' })
    try {
      await api.post(`/guardian/devices/${v.id}/commands`, { command, payload })
      setAction({ kind: 'done', note: doneNote })
      return true
    } catch {
      setAction({ kind: 'error', note: 'Failed — device command not sent' })
      return false
    }
  }

  const onCall = () => {
    if (v.officer_phone) window.location.href = `tel:${v.officer_phone}`
  }
  const playNote = async (noteId: string) => {
    if (playingId === noteId) { playerRef.current?.pause(); setPlayingId(null); return }
    try {
      const res = await api.get(`/guardian/devices/${v!.id}/voice-messages/${noteId}/audio`, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data as Blob)
      if (!playerRef.current) playerRef.current = new Audio()
      const player = playerRef.current
      player.src = url
      player.onended = () => { setPlayingId(null); URL.revokeObjectURL(url) }
      await player.play()
      setPlayingId(noteId)
    } catch {
      setAction({ kind: 'error', note: 'Failed to play voice note' })
    }
  }
  const onMsg = () => { setMsgOpen(o => !o); setAction({ kind: 'idle' }) }
  const onAlert = () => {
    if (window.confirm(`Sound an alert on ${v.registration}'s device?`)) {
      void sendCommand('trigger_siren', null, 'Alert sent to device')
    }
  }
  const sendMsg = () => {
    const text = msgText.trim()
    if (!text) return
    void sendCommand('show_message', { text }, 'Message delivered to device').then(ok => {
      if (ok) { setMsgText(''); setMsgOpen(false) }
    })
  }

  const startRecording = async () => {
    setAction({ kind: 'idle' })
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setAction({ kind: 'error', note: 'Microphone access denied' })
      return
    }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(m => MediaRecorder.isTypeSupported(m)) ?? ''
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    recorderRef.current = rec
    recChunksRef.current = []
    recIntentRef.current = 'discard'
    rec.ondataavailable = e => { if (e.data.size > 0) recChunksRef.current.push(e.data) }
    rec.onstop = () => {
      stream.getTracks().forEach(t => t.stop())
      setRecording(false)
      const durationMs = Math.min(Date.now() - recStartRef.current, MAX_VOICE_MS)
      if (recIntentRef.current !== 'send' || recChunksRef.current.length === 0) return
      const blob = new Blob(recChunksRef.current, { type: rec.mimeType || 'audio/webm' })
      setAction({ kind: 'busy' })
      api.post(`/guardian/devices/${v!.id}/voice-message?duration_ms=${durationMs}`, blob, {
        headers: { 'Content-Type': blob.type || 'audio/webm' },
      })
        .then(() => setAction({ kind: 'done', note: 'Voice message sent — playing on the device in seconds' }))
        .catch(() => setAction({ kind: 'error', note: 'Failed — voice message not sent' }))
    }
    recStartRef.current = Date.now()
    setRecElapsed(0)
    setRecording(true)
    rec.start()
    recTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - recStartRef.current
      setRecElapsed(elapsed)
      if (elapsed >= MAX_VOICE_MS) stopRecorder('send')
    }, 200)
  }

  return (
    <div style={{
      position: 'absolute', right: 14, top: 14, zIndex: 800,
      width: 276, background: 'rgba(8,11,20,.97)',
      border: `1px solid ${isSos ? 'rgba(239,68,68,.4)' : 'rgba(255,255,255,.11)'}`,
      borderRadius: 12,
      boxShadow: isSos ? '0 24px 64px rgba(0,0,0,.85),0 0 24px rgba(239,68,68,.12)' : '0 24px 64px rgba(0,0,0,.85)',
      backdropFilter: 'blur(12px)',
      overflow: 'hidden',
    }}>
      {/* accent left */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: color }} />

      {/* header */}
      <div style={{ padding: '12px 14px 10px 17px', display: 'flex', alignItems: 'flex-start', gap: 10, borderBottom: '1px solid rgba(255,255,255,.07)' }}>
        <div style={{ width: 36, height: 36, borderRadius: v.kind === 'guardian' ? 18 : 8, background: isSos ? 'rgba(239,68,68,.1)' : 'rgba(255,255,255,.04)', border: `1.5px solid ${color}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {v.kind === 'guardian' ? (
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
              <circle cx="12" cy="7.5" r="4.2"/>
              <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
              <rect x="1" y="3" width="15" height="13" rx="1"/>
              <path d="M16 8h4l3 5v3h-7V8z"/>
              <circle cx="5.5" cy="18.5" r="2.5"/>
              <circle cx="18.5" cy="18.5" r="2.5"/>
            </svg>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 17, fontWeight: 700, letterSpacing: '.03em', color: '#dfe0db' }}>{v.registration}</div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, color: '#7a7e8a', marginTop: 2 }}>
            {v.kind === 'guardian' ? 'Field Officer · Guardian Device' : (v.convoy_name ?? 'Standalone')}
          </div>
          <div style={{ marginTop: 4, display: 'inline-flex', fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, fontWeight: 700, letterSpacing: '.08em', padding: '2px 7px', borderRadius: 3, color, background: `${color}18`, border: `1px solid ${color}44` }}>
            {STATUS_LABEL[v.status]}
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#3e4252', cursor: 'pointer', fontSize: 16, padding: 2, lineHeight: 1 }}>✕</button>
      </div>

      {/* metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
        {[
          { label: 'Speed', value: `${Math.round(v.speed_kmh)}`, unit: 'km/h', color: v.status === 'move' ? '#16c784' : v.status === 'sos' ? '#ef4444' : '#dfe0db' },
          { label: 'Heading', value: fmtHeading(v.heading), unit: '', color: '#e8a830' },
          { label: 'Last ping', value: fmtAgo(v.secondsAgo), unit: '', color: v.secondsAgo > 1800 ? '#ef4444' : '#dfe0db' },
        ].map(m => (
          <div key={m.label} style={{ padding: '10px 12px', borderRight: '1px solid rgba(255,255,255,.07)' }}>
            <div style={{ fontSize: 9, color: '#3e4252', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 3 }}>{m.label}</div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: m.value.length > 6 ? 12 : 17, fontWeight: 600, color: m.color, lineHeight: 1.2 }}>
              {m.value}{m.unit && <span style={{ fontSize: 9, color: '#3e4252', fontWeight: 400 }}> {m.unit}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* device health — Guardian devices only; vehicles have no battery/signal telemetry.
          A battery/signal check is a separate event from a GPS fix, so this reading
          can be far older than "Last ping" above — showing it with no age would make
          a long-stale reading look like live telemetry for a device that's OFFLINE. */}
      {v.kind === 'guardian' && (() => {
        const ageMs = v.health_recorded_at ? Date.now() - new Date(v.health_recorded_at).getTime() : null
        const stale = ageMs == null || ageMs > HEALTH_STALE_AFTER_MS
        const ageLabel = fmtHealthAge(v.health_recorded_at)
        return (
          <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,.07)', display: 'flex', flexDirection: 'column', gap: 6, opacity: stale ? 0.55 : 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 9, color: '#3e4252', textTransform: 'uppercase', letterSpacing: '.08em' }}>Device Health</span>
              <span style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: stale ? '#ef4444' : '#3e4252' }}>
                {ageLabel ? `as of ${ageLabel}` : 'never reported'}
              </span>
            </div>
            <HealthBar label="BAT" value={pct(v.battery_level)} />
            <HealthBar label="SIG" value={pct(v.signal_strength)} />
          </div>
        )
      })()}

      {/* location */}
      {v.lat != null && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,.07)', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#7a7e8a' }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#e8a830" strokeWidth="2"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5" fill="#e8a830" stroke="none"/></svg>
          {v.lat.toFixed(5)}, {v.lng!.toFixed(5)}
        </div>
      )}

      {/* actions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, padding: '9px 10px' }}>
        {[
          // Call rings the linked field officer's phone; Msg/Alert are device
          // commands, so both need a guardian device on the other end.
          { label: 'Call', icon: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.1 19.79 19.79 0 0 1 1.61 4.53 2 2 0 0 1 3.58 2.34h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.91A16 16 0 0 0 14 16l.91-.91a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 17z', danger: false, onClick: onCall, disabled: !v.officer_phone, active: false, title: v.officer_phone ? `Call ${v.officer_name ?? v.registration} (${v.officer_phone})` : 'No officer phone on record' },
          { label: 'Msg', icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z', danger: false, onClick: onMsg, disabled: !isGuardian, active: msgOpen, title: isGuardian ? 'Send a message to the device' : 'Messaging is only available for Guardian devices' },
          { label: 'Track', icon: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z', danger: false, onClick: () => onToggleTrack(v), disabled: v.lat == null, active: tracking, title: tracking ? 'Stop following' : 'Follow on map' },
          { label: 'Alert', icon: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01', danger: true, onClick: onAlert, disabled: !isGuardian, active: false, title: isGuardian ? 'Sound an alert on the device' : 'Alerts are only available for Guardian devices' },
        ].map(a => (
          <button key={a.label} onClick={a.onClick} disabled={a.disabled || action.kind === 'busy'} title={a.title} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '7px 4px', borderRadius: 7, cursor: a.disabled ? 'not-allowed' : 'pointer', opacity: a.disabled ? 0.35 : 1, background: a.active ? 'rgba(232,168,48,.14)' : a.danger ? 'rgba(239,68,68,.07)' : 'rgba(255,255,255,.04)', border: `1px solid ${a.active ? 'rgba(232,168,48,.45)' : a.danger ? 'rgba(239,68,68,.2)' : 'rgba(255,255,255,.06)'}`, color: a.active ? '#e8a830' : a.danger ? '#fca5a5' : '#7a7e8a', fontSize: 10, fontFamily: 'inherit', transition: 'all .12s' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={a.icon}/></svg>
            {a.label === 'Track' && tracking ? 'Following' : a.label}
          </button>
        ))}
      </div>

      {/* message composer */}
      {msgOpen && (
        <div style={{ padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea
            value={msgText}
            onChange={e => setMsgText(e.target.value)}
            placeholder={`Message to ${v.officer_name ?? v.registration}…`}
            rows={2}
            maxLength={240}
            autoFocus
            style={{ resize: 'none', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 7, color: '#dfe0db', fontSize: 12, fontFamily: 'inherit', padding: '7px 9px', outline: 'none' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* voice message — record & send; plays out loud on the device */}
            {!recording ? (
              <button
                onClick={() => void startRecording()}
                disabled={action.kind === 'busy'}
                title="Record a voice message — it plays out loud on the device"
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, cursor: 'pointer', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', color: '#7a7e8a', fontSize: 11, fontFamily: 'inherit' }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/></svg>
                Voice
              </button>
            ) : (
              <>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, color: '#ef4444' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', animation: 'lf-ldot 1s ease-in-out infinite' }} />
                  {Math.floor(recElapsed / 1000)}s / 60s
                </span>
                <button onClick={() => stopRecorder('send')} style={{ padding: '5px 10px', borderRadius: 6, cursor: 'pointer', background: 'rgba(22,199,132,.12)', border: '1px solid rgba(22,199,132,.4)', color: '#16c784', fontSize: 11, fontWeight: 600, fontFamily: 'inherit' }}>
                  Send voice
                </button>
                <button onClick={() => stopRecorder('discard')} style={{ padding: '5px 8px', borderRadius: 6, cursor: 'pointer', background: 'none', border: '1px solid rgba(255,255,255,.1)', color: '#7a7e8a', fontSize: 11, fontFamily: 'inherit' }}>
                  Cancel
                </button>
              </>
            )}
            <button
              onClick={sendMsg}
              disabled={!msgText.trim() || action.kind === 'busy' || recording}
              style={{ marginLeft: 'auto', padding: '5px 14px', borderRadius: 6, cursor: msgText.trim() ? 'pointer' : 'not-allowed', background: 'rgba(232,168,48,.14)', border: '1px solid rgba(232,168,48,.4)', color: '#e8a830', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', opacity: msgText.trim() && !recording ? 1 : 0.4 }}
            >
              {action.kind === 'busy' ? 'Sending…' : 'Send to device'}
            </button>
          </div>
        </div>
      )}

      {/* incoming voice notes — the officer's device recorded and sent these up;
          reverse direction of the "Voice" recorder above, which sends dispatch's
          own clip down to play on the device. */}
      {isGuardian && !!voiceNotes?.length && (
        <div style={{ padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 9, color: '#3e4252', textTransform: 'uppercase', letterSpacing: '.08em' }}>
            Voice notes from device
          </div>
          {voiceNotes.slice(0, 5).map(note => (
            <div key={note.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 6, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)' }}>
              <button
                onClick={() => void playNote(note.id)}
                title={playingId === note.id ? 'Pause' : 'Play'}
                style={{ width: 22, height: 22, flexShrink: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: playingId === note.id ? 'rgba(232,168,48,.18)' : 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', color: playingId === note.id ? '#e8a830' : '#7a7e8a' }}
              >
                {playingId === note.id ? (
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                ) : (
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l14 8-14 8z"/></svg>
                )}
              </button>
              <span style={{ fontSize: 10, fontFamily: 'IBM Plex Mono, monospace', color: '#9a9890' }}>
                {note.duration_ms != null ? `${Math.round(note.duration_ms / 1000)}s` : '—'}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 9, color: '#6e6c64', fontFamily: 'IBM Plex Mono, monospace' }}>
                {fmtNoteAge(note.created_at)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* action feedback */}
      {(action.kind === 'done' || action.kind === 'error') && (
        <div style={{ padding: '0 12px 10px', fontSize: 10, fontFamily: 'IBM Plex Mono, monospace', color: action.kind === 'done' ? '#16c784' : '#ef4444' }}>
          {action.note}
        </div>
      )}
    </div>
  )
}
