import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ShieldCheck, Play, MapPin, Activity, Radio, ChevronRight } from 'lucide-react';
import { api } from '../lib/api.js';
import { useDashboardStore, type DashboardOverview } from '../stores/dashboardStore.js';
import { NAV_GROUPS } from '../components/layout/Rail.js';
import { meridianIconSrc } from './meridianIcons.js';
import { bgRenderers, miniRenderers, appVizRenderers, type BgType, type VizType } from './meridianRenderers.js';
import '../styles/orbit.css';

interface ChannelCfg {
  color: string; bgType: BgType; vizType: VizType;
  statusLabel: string; statusColor: string; statusGlow: string;
}

const CHANNEL_CFG: Record<string, ChannelCfg> = {
  Command:              { color: '#e8a020', bgType: 'radar',     vizType: 'signalBars',    statusLabel: 'Operational', statusColor: '#2dd4a8', statusGlow: 'rgba(45,212,168,.5)' },
  Security:             { color: '#ff2d55', bgType: 'shield',    vizType: 'threatArc',     statusLabel: 'Monitoring',  statusColor: '#ff2d55', statusGlow: 'rgba(255,45,85,.5)' },
  Surveillance:         { color: '#8b6bff', bgType: 'camera',    vizType: 'waveform',      statusLabel: 'Recording',   statusColor: '#2dd4a8', statusGlow: 'rgba(45,212,168,.5)' },
  Fleet:                { color: '#22d4e6', bgType: 'route',     vizType: 'routeProgress', statusLabel: 'Active',      statusColor: '#2dd4a8', statusGlow: 'rgba(45,212,168,.5)' },
  'Executive & Reporting': { color: '#2dd4a8', bgType: 'chart', vizType: 'donut',         statusLabel: 'Synced',      statusColor: '#2dd4a8', statusGlow: 'rgba(45,212,168,.5)' },
  'Container Management':  { color: '#ff7a00', bgType: 'container', vizType: 'fillLevel', statusLabel: 'Tracking',    statusColor: '#2dd4a8', statusGlow: 'rgba(45,212,168,.5)' },
};

const BOOT_LINES = [
  { text: 'SONALIT v3.1.0', hl: true },
  { text: 'Initializing secure channel...' },
  { text: 'Loading intelligence modules.......... OK' },
  { text: 'Establishing encrypted uplink......... OK' },
  { text: 'Threat matrix calibrated.............. OK' },
  { text: 'All systems nominal — 38 modules online', hl: true },
];

const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
const SOS_REASONS = [
  { value: 'resolved_safe', label: 'Safe' },
  { value: 'false_alarm', label: 'False alarm' },
  { value: 'escalated_to_authorities', label: 'Escalated' },
];
const LIVE_WINDOW_MS = 15 * 60_000;

interface RecentVoice { id: string; device_id: string; device_name: string; duration_ms: number | null; created_at: string; lat: number | null; lng: number | null }
interface RailRow { id: string; kind: 'alert' | 'feed' | 'voice' | 'capture'; severity: string; title: string; sub?: string; at: string; voice?: { deviceId: string; voiceId: string; durationMs: number | null }; imageUrl?: string }

function relTime(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
function useClock(): string {
  const [t, setT] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setT(new Date()), 1000); return () => clearInterval(id); }, []);
  return [t.getHours(), t.getMinutes(), t.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
}

export default function Orbit() {
  const nav = useNavigate();
  const clock = useClock();
  const lastVoiceId = useRef<string | null>(null);
  const voicePollInit = useRef(false);
  const voicePlayerRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlocked = useRef(false);

  const { setOverview, acknowledgePanicState, updatePanicState, setVoiceNoteAlert } = useDashboardStore.getState();
  const overview = useDashboardStore(s => s.overview);
  const panic = useDashboardStore(s => s.panicState);
  const alerts = useDashboardStore(s => s.alerts);
  const feedItems = useDashboardStore(s => s.feedItems);
  const voiceNoteAlert = useDashboardStore(s => s.voiceNoteAlert);
  const panicActive = panic?.status === 'active';
  const acknowledged = !!panic?.acknowledgedAt;

  const [booted, setBooted] = useState(false);
  const [bootLines, setBootLines] = useState<number>(0);
  const [sos, setSos] = useState<{ label: string; short: string | null; lat: number; lng: number; at: string } | null>(null);
  const [voiceLoc, setVoiceLoc] = useState<{ name: string; short: string | null; lat: number; lng: number; at: string; voiceId: string; deviceId: string } | null>(null);
  const [resolving, setResolving] = useState(false);
  const [q, setQ] = useState('');
  const [railOpen, setRailOpen] = useState<boolean>(() => {
    try { const saved = localStorage.getItem('orbit-rail'); if (saved != null) return saved !== '0'; } catch { /* private mode */ }
    return typeof window !== 'undefined' ? window.innerWidth > 680 : true;
  });
  useEffect(() => { try { localStorage.setItem('orbit-rail', railOpen ? '1' : '0'); } catch { /* private mode */ } }, [railOpen]);
  const [railTab, setRailTab] = useState<'live' | 'history'>('live');
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const [voiceBlocked, setVoiceBlocked] = useState(false);

  // ── boot sequence ─────────────────────────────────────────────────────
  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;
    if (reduce) { setBooted(true); setBootLines(BOOT_LINES.length); return; }
    let i = 0;
    const id = setInterval(() => { i++; setBootLines(i); if (i >= BOOT_LINES.length) { clearInterval(id); setTimeout(() => setBooted(true), 600); } }, 280);
    const skip = () => { clearInterval(id); setBootLines(BOOT_LINES.length); setBooted(true); };
    window.addEventListener('keydown', skip, { once: true });
    window.addEventListener('click', skip, { once: true });
    return () => { clearInterval(id); window.removeEventListener('keydown', skip); window.removeEventListener('click', skip); };
  }, []);

  // ── dashboard data ────────────────────────────────────────────────────
  useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: async () => { try { const r = await api.get<DashboardOverview>('/dashboard/overview'); setOverview(r.data); return r.data; } catch { return null; } },
    staleTime: 30000, refetchInterval: 60000,
  });
  const { data: recentVoice } = useQuery<RecentVoice[]>({
    queryKey: ['orbit-recent-voice'],
    queryFn: async () => { try { const r = await api.get<{ data: RecentVoice[] }>('/guardian/voice-messages/recent'); return r.data.data ?? []; } catch { return []; } },
    staleTime: 8000, refetchInterval: 12000,
  });

  // ── SOS mutations ─────────────────────────────────────────────────────
  const ackMut = useMutation({
    mutationFn: (id: string) => api.patch(`/guardian/panic/${id}/ack`, {}),
    onSuccess: (_r, id) => acknowledgePanicState(id, new Date().toISOString(), null),
  });
  const resolveMut = useMutation({
    mutationFn: (v: { id: string; reason: string }) => api.patch(`/guardian/panic/${v.id}/resolve`, { reason_code: v.reason }),
    onSuccess: (_r, v) => { updatePanicState({ id: v.id, status: 'resolved', triggered_at: panic?.triggered_at ?? new Date().toISOString() }); setResolving(false); },
  });

  // ── panic lock ────────────────────────────────────────────────────────
  const lastPanicId = useRef<string | null>(null);
  useEffect(() => {
    const locked = panicActive && !acknowledged && !!panic && panic.lat != null && panic.lng != null;
    if (locked && panic!.id !== lastPanicId.current) {
      lastPanicId.current = panic!.id;
      setSos({ label: panic!.deviceName ?? panic!.vehicle_id ?? 'unassigned device', short: null, lat: panic!.lat!, lng: panic!.lng!, at: panic!.triggered_at });
      api.get<{ short: string | null; address: string | null }>(`/dashboard/reverse-geocode?lat=${panic!.lat}&lng=${panic!.lng}`)
        .then(r => setSos(s => (s && s.lat === panic!.lat ? { ...s, short: r.data.short ?? r.data.address } : s)))
        .catch(() => {});
    }
    if (!locked && lastPanicId.current) { lastPanicId.current = null; setSos(null); }
  }, [panicActive, acknowledged, panic]);

  // ── voice playback ────────────────────────────────────────────────────
  const playVoice = useCallback(async (deviceId: string, voiceId: string) => {
    let url: string | null = null;
    try {
      const res = await api.get(`/guardian/devices/${deviceId}/voice-messages/${voiceId}/audio`, { responseType: 'blob' });
      url = URL.createObjectURL(res.data as Blob);
      if (!voicePlayerRef.current) voicePlayerRef.current = new Audio();
      const p = voicePlayerRef.current;
      const objUrl = url;
      p.src = url; p.muted = false; p.volume = 1;
      p.onended = () => { setPlayingVoice(null); URL.revokeObjectURL(objUrl); };
      await p.play();
      setPlayingVoice(voiceId); setVoiceBlocked(false);
      return true;
    } catch { setPlayingVoice(null); setVoiceBlocked(true); if (url) URL.revokeObjectURL(url); return false; }
  }, []);
  useEffect(() => () => voicePlayerRef.current?.pause(), []);

  useEffect(() => {
    const unlock = () => {
      if (audioUnlocked.current) return;
      audioUnlocked.current = true;
      if (!voicePlayerRef.current) voicePlayerRef.current = new Audio();
      const p = voicePlayerRef.current;
      try { p.muted = true; p.src = SILENT_WAV; void p.play().then(() => { p.pause(); p.currentTime = 0; p.muted = false; }).catch(() => { p.muted = false; }); } catch { /* ignore */ }
      window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); window.removeEventListener('touchstart', unlock);
    };
    window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock); window.addEventListener('touchstart', unlock);
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); window.removeEventListener('touchstart', unlock); };
  }, []);

  // ── voice note alert handling ─────────────────────────────────────────
  const voiceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const a = voiceNoteAlert;
    if (!a || a.id === lastVoiceId.current) return;
    lastVoiceId.current = a.id;
    if (panicActive) return;
    void playVoice(a.deviceId, a.voiceId);
    if (a.lat == null || a.lng == null) return;
    if (voiceTimerRef.current) clearTimeout(voiceTimerRef.current);
    setVoiceLoc({ name: a.deviceName, short: null, lat: a.lat, lng: a.lng, at: a.createdAt, voiceId: a.voiceId, deviceId: a.deviceId });
    api.get<{ short: string | null; address: string | null }>(`/dashboard/reverse-geocode?lat=${a.lat}&lng=${a.lng}`)
      .then(r => setVoiceLoc(s => (s && s.lat === a.lat ? { ...s, short: r.data.short ?? r.data.address } : s)))
      .catch(() => {});
    const hold = Math.min(20000, Math.max(10000, (a.durationMs ?? 0) + 4000));
    voiceTimerRef.current = setTimeout(() => setVoiceLoc(null), hold);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceNoteAlert, panicActive]);
  useEffect(() => () => { if (voiceTimerRef.current) clearTimeout(voiceTimerRef.current); }, []);

  useEffect(() => {
    const list = recentVoice ?? [];
    if (list.length === 0) return;
    const newest = list[0]!;
    if (!voicePollInit.current) { voicePollInit.current = true; if (!lastVoiceId.current) lastVoiceId.current = newest.id; return; }
    if (newest.id === lastVoiceId.current) return;
    setVoiceNoteAlert({ id: newest.id, deviceId: newest.device_id, deviceName: newest.device_name, voiceId: newest.id, durationMs: newest.duration_ms, createdAt: newest.created_at, lat: newest.lat, lng: newest.lng });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentVoice]);

  // ── canvas animations ─────────────────────────────────────────────────
  const bgCanvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const miniCanvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const footCanvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const appVizRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());

  useEffect(() => {
    let raf = 0;
    const draw = (t: number) => {
      bgCanvasRefs.current.forEach((canvas, key) => {
        const cfg = CHANNEL_CFG[key]; if (!cfg) return;
        const ctx = canvas.getContext('2d'); if (!ctx) return;
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
        ctx.save(); ctx.scale(dpr, dpr);
        bgRenderers[cfg.bgType](ctx, w, h, t, cfg.color);
        ctx.restore();
      });
      miniCanvasRefs.current.forEach((canvas, key) => {
        const cfg = CHANNEL_CFG[key]; if (!cfg) return;
        miniRenderers[cfg.vizType](canvas, cfg.color, t);
      });
      footCanvasRefs.current.forEach((canvas, key) => {
        const cfg = CHANNEL_CFG[key]; if (!cfg) return;
        miniRenderers[cfg.vizType](canvas, cfg.color, t);
      });
      appVizRefs.current.forEach((canvas, compositeKey) => {
        const [groupLabel, idxStr] = compositeKey.split('::');
        const cfg = CHANNEL_CFG[groupLabel!]; if (!cfg) return;
        const ctx = canvas.getContext('2d'); if (!ctx) return;
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
        ctx.save(); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h);
        appVizRenderers[cfg.vizType](ctx, w, h, cfg.color, 'ok', t, parseInt(idxStr ?? '0', 10));
        ctx.restore();
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── priority rail data ────────────────────────────────────────────────
  const railRows = useMemo<RailRow[]>(() => {
    const rows: RailRow[] = [];
    const seenVoice = new Set<string>();
    const pushVoice = (voiceId: string, deviceId: string, deviceName: string, durationMs: number | null, at: string) => {
      if (seenVoice.has(voiceId)) return; seenVoice.add(voiceId);
      rows.push({ id: `voice-${voiceId}`, kind: 'voice', severity: 'info', title: 'Voice note', sub: deviceName, at, voice: { deviceId, voiceId, durationMs } });
    };
    if (voiceNoteAlert) pushVoice(voiceNoteAlert.voiceId, voiceNoteAlert.deviceId, voiceNoteAlert.deviceName, voiceNoteAlert.durationMs, voiceNoteAlert.createdAt);
    for (const v of (recentVoice ?? [])) pushVoice(v.id, v.device_id, v.device_name, v.duration_ms, v.created_at);
    for (const a of alerts) rows.push({ id: `alert-${a.id}`, kind: 'alert', severity: a.severity, title: a.title, sub: a.summary, at: a.occurred_at });
    for (const f of feedItems) rows.push({ id: `feed-${f.id}`, kind: f.imageUrl ? 'capture' : 'feed', severity: f.severity ?? 'low', title: f.message, at: f.timestamp, ...(f.imageUrl ? { imageUrl: f.imageUrl } : {}) });
    rows.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime());
    return rows;
  }, [alerts, feedItems, voiceNoteAlert, recentVoice]);
  const { liveRows, historyRows } = useMemo(() => {
    const now = Date.now(); const live: RailRow[] = [], hist: RailRow[] = [];
    for (const r of railRows) (now - new Date(r.at).getTime() < LIVE_WINDOW_MS ? live : hist).push(r);
    return { liveRows: live, historyRows: hist };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [railRows, clock]);
  const shownRows = railTab === 'live' ? liveRows : historyRows;
  const railCount = liveRows.length + (panicActive ? 1 : 0);

  // ── command bar search ────────────────────────────────────────────────
  const jump = useMemo(() => NAV_GROUPS.flatMap(g => g.items.map(i => ({ ...i, hue: g.hue, group: g.label }))), []);
  const matches = useMemo(() => {
    const n = q.trim().toLowerCase(); if (!n) return [];
    return jump.filter(i => i.label.toLowerCase().includes(n) || i.group.toLowerCase().includes(n)).slice(0, 6);
  }, [q, jump]);
  const go = useCallback((path: string) => nav({ to: path }), [nav]);

  // ── threat level from overview ────────────────────────────────────────
  const threatLevel = overview?.threat.level ?? 'secure';
  const threatSegs = threatLevel === 'critical' ? 5 : threatLevel === 'elevated' ? 3 : (threatLevel as string) === 'guarded' ? 2 : 1;

  return (
    <div className="meridian">
      {/* Ambient aurora + noise + scanlines */}
      <div className="m-ambient" />
      <svg className="m-noise" aria-hidden="true" width="100%" height="100%">
        <filter id="mnoise"><feTurbulence baseFrequency=".65" numOctaves="3" stitchTiles="stitch" /></filter>
        <rect width="100%" height="100%" filter="url(#mnoise)" />
      </svg>
      <div className="m-scanlines" />

      {/* Boot sequence */}
      <div className={`m-boot ${booted ? 'done' : ''}`}>
        <div className="m-boot-inner">
          {BOOT_LINES.slice(0, bootLines).map((ln, i) => (
            <div key={i} className={`m-boot-line ${ln.hl ? 'hl' : ''}`}>{ln.text}</div>
          ))}
        </div>
        {!booted && <div className="m-boot-skip">Press any key to skip</div>}
      </div>

      {/* Console */}
      <div className={`m-console ${booted ? 'live' : ''}`}>
        {/* Top bar */}
        <header className="m-bar m-bar--top">
          <Link to="/home" style={{ textDecoration: 'none' }}><span className="m-bar-brand">SONALIT</span></Link>
          <span className="m-bar-sep">|</span>
          <span><span className="pip pip--on" />System Online</span>
          <span className="m-bar-sep m-hide-mobile">|</span>
          <span className="m-hide-mobile">{NAV_GROUPS.reduce((n, g) => n + g.items.length, 0)} Modules</span>
          <span className="m-bar-fill" />
          <span className="m-hide-mobile">Threat</span>
          <div className="m-threat" title={`Threat level: ${threatLevel}`}>
            {[1, 2, 3, 4, 5].map(i => <div key={i} className={`m-threat-seg ${i <= threatSegs ? 'filled' : ''}`} />)}
          </div>
          <span className="m-bar-sep">|</span>
          <span className="m-bar-clock">{clock}</span>
        </header>

        {/* Channel strips */}
        <main className="m-channels">
          {NAV_GROUPS.map((group, gi) => {
            const cfg = CHANNEL_CFG[group.label];
            if (!cfg) return null;
            const style = { '--ch-color': cfg.color, '--ch-status-color': cfg.statusColor, '--ch-status-glow': cfg.statusGlow, animationDelay: `${gi * 0.08}s` } as React.CSSProperties;
            const hasAlerts = group.label === 'Security' && (overview?.threat.alerts_open ?? 0) > 0;
            return (
              <div key={group.label} className="m-strip" style={style}>
                <canvas className="m-strip-bg" ref={el => { if (el) bgCanvasRefs.current.set(group.label, el); else bgCanvasRefs.current.delete(group.label); }} />
                {hasAlerts && <div className="m-strip-active-dot" />}
                <div className="m-strip-head">
                  <span className="m-strip-pip" />
                  <span className="m-strip-code">{group.label}</span>
                  <span className="m-strip-count">{String(group.items.length).padStart(2, '0')}</span>
                </div>
                <div className="m-strip-body">
                  {group.items.map((item, ii) => (
                    <Link key={item.path} to={item.path} className="m-app">
                      <span className="m-app-icon">
                        <img src={meridianIconSrc(item.label, group.label)} alt={item.label} className="m-icon-tile" draggable={false} />
                      </span>
                      <span className="m-app-info">
                        <span className="m-app-name">{item.label}</span>
                        <span className="m-app-status">{cfg.statusLabel}</span>
                      </span>
                      <span className="m-app-right">
                        <canvas className="m-app-viz" ref={el => { const k = `${group.label}::${ii}`; if (el) appVizRefs.current.set(k, el); else appVizRefs.current.delete(k); }} />
                      </span>
                    </Link>
                  ))}
                </div>
                <div className="m-strip-mini-viz">
                  <canvas style={{ width: '100%', height: '100%' }} ref={el => { if (el) miniCanvasRefs.current.set(group.label, el); else miniCanvasRefs.current.delete(group.label); }} />
                </div>
                <div className="m-strip-foot">
                  <span className="m-strip-foot-label">Status</span>
                  <canvas className="m-strip-foot-viz" ref={el => { if (el) footCanvasRefs.current.set(group.label, el); else footCanvasRefs.current.delete(group.label); }} />
                </div>
              </div>
            );
          })}
        </main>

        {/* Bottom bar */}
        <footer className="m-bar m-bar--bottom" style={{ position: 'relative' }}>
          <span className="m-cmd-prompt">&#9656;</span>
          <input className="m-cmd-input" value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && matches[0]) go(matches[0].path); if (e.key === 'Escape') setQ(''); }}
            placeholder="Search modules... (⌘K)" aria-label="Command bar" />
          <span className="m-bar-fill" />
          <span><span className="pip pip--on" />Encrypted</span>
          <span className="m-bar-sep m-hide-mobile">|</span>
          <span className="m-hide-mobile">Sonalit v3.1</span>
          {matches.length > 0 && (
            <div className="m-results">
              {matches.map(m => (
                <button key={m.path} className="m-result" onMouseDown={e => { e.preventDefault(); go(m.path); }}>
                  <span className="m-rdot" style={{ background: `rgb(${m.hue})` }} />{m.label}<span className="m-rgrp">{m.group}</span>
                </button>
              ))}
            </div>
          )}
        </footer>
      </div>

      {/* ── SOS lock card ──────────────────────────────────────────────── */}
      {sos && panic && (
        <div className="o-sos">
          <div className="o-sos-head"><span className="o-sos-tag">● SOS</span><b>PANIC ACTIVE</b><span className="o-sos-t">{relTime(sos.at)}</span></div>
          <div className="o-sos-who">{panic.deviceName ?? panic.vehicle_id ?? sos.label}</div>
          <div className="o-sos-addr">{sos.short ?? `${sos.lat.toFixed(4)}, ${sos.lng.toFixed(4)}`}</div>
          <div className="o-sos-coord">{sos.lat.toFixed(5)}, {sos.lng.toFixed(5)}</div>
          {!resolving ? (
            <div className="o-sos-actions">
              <button className="o-sos-act ack" disabled={ackMut.isPending || !!panic.acknowledgedAt}
                onClick={() => ackMut.mutate(panic.id)}>
                <ShieldCheck size={14} />{panic.acknowledgedAt ? 'ACKNOWLEDGED' : ackMut.isPending ? 'ACKNOWLEDGING…' : 'ACKNOWLEDGE'}
              </button>
              <button className="o-sos-act resolve" disabled={resolveMut.isPending} onClick={() => setResolving(true)}>RESOLVE</button>
            </div>
          ) : (
            <div className="o-sos-resolve">
              <span className="o-sos-rl">Resolve — pick a reason</span>
              <div className="o-sos-reasons">
                {SOS_REASONS.map(r => (
                  <button key={r.value} className="o-sos-reason" disabled={resolveMut.isPending}
                    onClick={() => resolveMut.mutate({ id: panic.id, reason: r.value })}>{r.label}</button>
                ))}
              </div>
              <button className="o-sos-cancel" disabled={resolveMut.isPending} onClick={() => setResolving(false)}>Cancel</button>
            </div>
          )}
          <button className="o-sos-link" onClick={() => nav({ to: '/panic-center' })}>Open Panic Center →</button>
        </div>
      )}

      {/* ── Voice note callout ─────────────────────────────────────────── */}
      {voiceLoc && !sos && (
        <div className="o-voice">
          <div className="o-voice-head"><span className="o-voice-tag">🎙 VOICE NOTE</span><span className="o-voice-live"><i />PLAYING LIVE</span><span className="o-voice-t">{relTime(voiceLoc.at)}</span></div>
          <div className="o-voice-who">{voiceLoc.name}</div>
          <div className="o-voice-addr"><MapPin size={13} />{voiceLoc.short ?? `${voiceLoc.lat.toFixed(4)}, ${voiceLoc.lng.toFixed(4)}`}</div>
          <div className="o-voice-coord">{voiceLoc.lat.toFixed(5)}, {voiceLoc.lng.toFixed(5)}</div>
          <div className="o-voice-actions">
            <button className={`o-voice-play ${playingVoice === voiceLoc.voiceId ? 'on' : ''} ${voiceBlocked && playingVoice !== voiceLoc.voiceId ? 'blocked' : ''}`} onClick={() => void playVoice(voiceLoc.deviceId, voiceLoc.voiceId)}>
              <Play size={13} />{playingVoice === voiceLoc.voiceId ? 'Playing…' : voiceBlocked ? 'TAP TO PLAY' : 'Replay'}
            </button>
            <button className="o-voice-go" onClick={() => nav({ to: '/gps' })}>Open in GPS Live →</button>
          </div>
        </div>
      )}

      {/* ── Priority rail ──────────────────────────────────────────────── */}
      <aside className={`o-rail ${railOpen ? 'open' : 'closed'}`}>
        {!railOpen ? (
          <button className="o-rail-tab" onClick={() => setRailOpen(true)} title="Open live feed">
            <Radio size={17} />
            {railCount > 0 && <span className="o-rail-badge">{railCount > 99 ? '99+' : railCount}</span>}
          </button>
        ) : (
          <div className="o-rail-body">
            <div className="o-rail-head">
              <Activity size={15} />
              <div className="o-rail-tabs">
                <button className={`o-rail-tabbtn ${railTab === 'live' ? 'on' : ''}`} onClick={() => setRailTab('live')}>
                  <i className="o-rail-livei" />LIVE{liveRows.length > 0 ? ` ${liveRows.length}` : ''}
                </button>
                <button className={`o-rail-tabbtn ${railTab === 'history' ? 'on' : ''}`} onClick={() => setRailTab('history')}>
                  HISTORY{historyRows.length > 0 ? ` ${historyRows.length}` : ''}
                </button>
              </div>
              <button className="o-rail-collapse" onClick={() => setRailOpen(false)} title="Collapse"><ChevronRight size={16} /></button>
            </div>
            <div className="o-rail-list">
              {railTab === 'live' && panicActive && panic && (
                <button className="o-rail-row pinned" onClick={() => nav({ to: '/panic-center' })}>
                  <span className="o-rail-chip crit">SOS</span>
                  <div className="o-rail-main">
                    <div className="o-rail-title">Panic active · {panic.deviceName ?? panic.vehicle_id ?? 'device'}</div>
                    <div className="o-rail-sub">{panic.acknowledgedAt ? 'Acknowledged — resolve to clear' : 'Awaiting response'}</div>
                  </div>
                  <span className="o-rail-t">{relTime(panic.triggered_at)}</span>
                </button>
              )}
              {shownRows.length === 0 && !(railTab === 'live' && panicActive) && (
                <div className="o-rail-empty">{railTab === 'live'
                  ? <>All quiet.<br />Live alerts, driver events and voice notes stream in here.</>
                  : 'No earlier events yet.'}</div>
              )}
              {shownRows.map(r => (
                <div key={r.id} className={`o-rail-row ${r.kind === 'voice' ? 'voice' : ''} ${r.kind === 'capture' ? 'capture' : ''}`}>
                  <span className={`o-rail-chip ${r.severity}`}>{r.kind === 'voice' ? '♪' : r.kind === 'capture' ? '📷' : r.severity[0]!.toUpperCase()}</span>
                  <div className="o-rail-main">
                    <div className="o-rail-title">{r.title}</div>
                    {r.sub && <div className="o-rail-sub">{r.sub}</div>}
                    {r.imageUrl && (
                      <a className="o-rail-thumb" href={r.imageUrl} target="_blank" rel="noreferrer" title="Open full-size">
                        <img src={r.imageUrl} alt="Captured photo" loading="lazy" />
                      </a>
                    )}
                    {r.voice && (
                      <button className={`o-rail-play ${playingVoice === r.voice.voiceId ? 'on' : ''}`} onClick={() => void playVoice(r.voice!.deviceId, r.voice!.voiceId)}>
                        <Play size={11} />{playingVoice === r.voice.voiceId ? 'Playing…' : 'Play'}
                        {r.voice.durationMs != null && <span className="o-rail-dur">{Math.round(r.voice.durationMs / 1000)}s</span>}
                      </button>
                    )}
                  </div>
                  <span className="o-rail-t">{relTime(r.at)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
