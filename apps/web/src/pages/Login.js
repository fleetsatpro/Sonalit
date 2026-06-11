import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useAuthStore } from '../stores/auth.js';
import './Login.css';
import './Login.enhancements.css';
// ---------------------------------------------------------------------------
// Schemas & types
// ---------------------------------------------------------------------------
const passwordSchema = z.object({
    email: z.string().email('Enter a valid email'),
    password: z.string().min(1, 'Password is required'),
});
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function base64UrlToBuffer(b) {
    const base64 = b.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++)
        bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}
function bufferToBase64Url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++)
        binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MAX_ATTEMPTS = 5;
const COOLDOWN_S = 30;
const TICKER_ROUTES = [
    { c: 'g', t: 'LAX → JFK  Active · ETA 4h 22m' },
    { c: 'o', t: 'ORD → MIA  Delayed · +38min' },
    { c: 'g', t: 'LHR → CDG  On-time · 2,847 units' },
    { c: 'c', t: 'SIN → HKG  In transit · 192 pallets' },
    { c: 'g', t: 'DXB → BOM  Cleared customs' },
    { c: 'g', t: 'SYD → NRT  Departed · 1,104 kg' },
    { c: 'o', t: 'FRA → IST  Weather hold' },
    { c: 'c', t: 'YYZ → MEX  En route · ping 12ms' },
    { c: 'g', t: 'GRU → EZE  Delivered · 4,281 units' },
    { c: 'g', t: 'ICN → PVG  Scanning · 142 cities' },
];
// The full background logo layer markup (static, trusted, no user data)
const LOGO_INNER_HTML = `
<div class="hring"></div>
<div class="halo"></div>
<div class="ow">
  <div class="orb o1"><div class="od od1"></div></div>
  <div class="orb o2"><div class="od od2"></div></div>
</div>
<svg class="icon-svg" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <radialGradient id="gG" cx="40%" cy="35%" r="65%"><stop offset="0%" stop-color="#4a6ac0" stop-opacity=".22"/><stop offset="100%" stop-color="#0a1030" stop-opacity="0"/></radialGradient>
    <linearGradient id="nG" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#3d5aaa"/><stop offset="100%" stop-color="#0a1228"/></linearGradient>
    <linearGradient id="oG" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#ff9040"/><stop offset="100%" stop-color="#bb3a00"/></linearGradient>
    <linearGradient id="tG" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#4060b0"/><stop offset="100%" stop-color="#0a1228"/></linearGradient>
    <linearGradient id="wG" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#88aaee" stop-opacity=".9"/><stop offset="100%" stop-color="#2244aa" stop-opacity=".5"/></linearGradient>
    <filter id="gf" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="sf" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <path id="rP" d="M42,160 C32,142 32,116 52,106 C77,92 117,98 140,82 C162,66 164,40 150,28"/>
    <path id="gP1" d="M22,78 Q72,40 122,78"/>
    <path id="gP2" d="M22,78 Q72,116 122,78"/>
    <path id="gP3" d="M72,28 Q42,80 72,132"/>
  </defs>
  <ellipse cx="72" cy="80" rx="56" ry="56" fill="url(#gG)" opacity=".9"/>
  <circle class="gr" cx="72" cy="80" r="52"/>
  <path class="gm" style="--d:.3s" d="M22,80 Q72,42 122,80 Q72,118 22,80"/>
  <path class="gm" style="--d:.4s" d="M72,28 Q42,80 72,132"/>
  <path class="gm" style="--d:.5s" d="M72,28 Q102,80 72,132"/>
  <path class="gm" style="--d:.6s;stroke-dasharray:110;stroke-dashoffset:110" d="M24,62 Q72,62 120,62"/>
  <path class="gm" style="--d:.65s;stroke-dasharray:110;stroke-dashoffset:110" d="M25,98 Q72,98 119,98"/>
  <path class="lg" d="M24,62 Q72,62 120,62"/>
  <g><circle class="nr" cx="72" cy="28" r="6" style="--d:1.2s"/><circle class="gn" cx="72" cy="28" r="4" fill="#1a2b5e" stroke="#6699ff" stroke-width="1.4" style="--d:1s"/></g>
  <g><circle class="nr" cx="122" cy="80" r="6" style="--d:1.5s"/><circle class="gn" cx="122" cy="80" r="4" fill="#1a2b5e" stroke="#6699ff" stroke-width="1.4" style="--d:1.1s"/></g>
  <g><circle class="nr" cx="22" cy="80" r="6" style="--d:1.8s"/><circle class="gn" cx="22" cy="80" r="4" fill="#1a2b5e" stroke="#5577ff" stroke-width="1.4" style="--d:1s"/></g>
  <g><circle class="nr" cx="72" cy="132" r="6" style="--d:2s"/><circle class="gn" cx="72" cy="132" r="4" fill="#1a2b5e" stroke="#6699ff" stroke-width="1.4" style="--d:1.2s"/></g>
  <circle r="3" fill="#ff9040" filter="url(#gf)"><animateMotion dur="2.8s" begin="2s" repeatCount="indefinite" rotate="auto"><mpath href="#gP1"/></animateMotion><animate attributeName="opacity" values="0;1;1;0" dur="2.8s" begin="2s" repeatCount="indefinite"/></circle>
  <circle r="2.2" fill="#6699ff" filter="url(#gf)"><animateMotion dur="3.8s" begin="2.6s" repeatCount="indefinite" rotate="auto"><mpath href="#gP2"/></animateMotion><animate attributeName="opacity" values="0;1;1;0" dur="3.8s" begin="2.6s" repeatCount="indefinite"/></circle>
  <circle r="2" fill="#00d4ff" filter="url(#gf)"><animateMotion dur="2.2s" begin="3.2s" repeatCount="indefinite" rotate="auto"><mpath href="#gP3"/></animateMotion><animate attributeName="opacity" values="0;1;1;0" dur="2.2s" begin="3.2s" repeatCount="indefinite"/></circle>
  <use href="#rP" class="rg"/><use href="#rP" class="rs"/>
  <use href="#rP" class="ro" style="stroke:url(#oG)"/>
  <use href="#rP" class="rn" style="stroke:url(#nG)"/>
  <use href="#rP" class="rd"/><use href="#rP" class="re1"/><use href="#rP" class="re2"/>
  <circle r="4.5" fill="#ff9040" filter="url(#sf)"><animateMotion dur="2.8s" begin="2.4s" repeatCount="indefinite"><mpath href="#rP"/></animateMotion><animate attributeName="opacity" values="0;.9;.9;0" dur="2.8s" begin="2.4s" repeatCount="indefinite"/></circle>
  <g class="pin">
    <circle class="pp pp1" cx="150" cy="34" r="8"/><circle class="pp pp2" cx="150" cy="34" r="8"/><circle class="pp pp3" cx="150" cy="34" r="8"/>
    <path d="M150,16 C143,16 137,22 137,29 C137,39 150,52 150,52 C150,52 163,39 163,29 C163,22 157,16 150,16Z" fill="url(#nG)" stroke="rgba(255,160,80,.65)" stroke-width="1" filter="url(#gf)"/>
    <circle class="pc" cx="150" cy="29" r="5" fill="#ffaa44"/>
  </g>
  <g class="tg"><g class="tf">
    <rect x="20" y="122" width="68" height="28" rx="3" fill="url(#tG)" stroke="rgba(80,120,200,.18)" stroke-width=".5"/>
    <rect x="22" y="128" width="64" height="3.5" rx="1" fill="rgba(240,112,32,.35)"/>
    <rect x="86" y="120" width="36" height="30" rx="4" fill="url(#tG)"/>
    <rect x="92" y="124" width="20" height="13" rx="2" fill="url(#wG)"/>
    <rect x="118" y="127" width="6" height="18" rx="1" fill="#1a2860"/>
    <rect class="hc" x="120" y="126" width="6" height="5" rx="1" fill="#ffcc44"/>
    <rect x="89" y="113" width="4" height="11" rx="2" fill="#1a2860"/>
    <circle class="ex ex1" cx="91" cy="111" r="2.5"/><circle class="ex ex2" cx="91" cy="111" r="4"/><circle class="ex ex3" cx="91" cy="111" r="3"/>
    <g class="wh" style="transform-origin:35px 152px"><circle cx="35" cy="152" r="8.5" fill="#111828" stroke="#334488" stroke-width="1.4"/><circle cx="35" cy="152" r="4.5" fill="none" stroke="#445588" stroke-width=".9"/><circle cx="35" cy="152" r="1.8" fill="#4466aa"/></g>
    <g class="wh" style="transform-origin:62px 152px"><circle cx="62" cy="152" r="8.5" fill="#111828" stroke="#334488" stroke-width="1.4"/><circle cx="62" cy="152" r="4.5" fill="none" stroke="#445588" stroke-width=".9"/><circle cx="62" cy="152" r="1.8" fill="#4466aa"/></g>
    <g class="wh" style="transform-origin:100px 152px"><circle cx="100" cy="152" r="8.5" fill="#111828" stroke="#334488" stroke-width="1.4"/><circle cx="100" cy="152" r="4.5" fill="none" stroke="#445588" stroke-width=".9"/><circle cx="100" cy="152" r="1.8" fill="#4466aa"/></g>
  </g></g>
  <g class="pkg"><g class="pkf">
    <rect x="112" y="133" width="17" height="14" rx="2" fill="#6878a8" stroke="rgba(255,255,255,.12)" stroke-width=".5"/>
    <rect x="128" y="137" width="12" height="10" rx="2" fill="#5568a0"/>
    <line x1="112" y1="140" x2="129" y2="140" stroke="rgba(255,255,255,.25)" stroke-width=".7"/>
    <line x1="120" y1="133" x2="120" y2="147" stroke="rgba(255,255,255,.25)" stroke-width=".7"/>
  </g></g>
</svg>
<div class="wm">
  <div class="bn">
    <span class="sona"><span class="lt" style="--d:1.55s;--gd:3.2s">S</span><span class="lt" style="--d:1.65s;--gd:3.4s">O</span><span class="lt" style="--d:1.75s;--gd:3.6s">N</span><span class="lt" style="--d:1.85s;--gd:3.8s">A</span></span>
    <span class="bdv"></span>
    <span class="litw"><span class="lt" style="--d:1.95s;--gd:3s">L</span><span class="lt" style="--d:2.05s;--gd:3.2s">I</span><span class="lt" style="--d:2.15s;--gd:3.4s">T</span></span>
  </div>
  <div class="tag">Logistics. Connected.</div>
</div>
<div style="display:flex;flex-direction:column;align-items:center;gap:9px">
  <div class="badge"><span class="bdot"></span><span>All Systems Live</span></div>
  <div class="mets">
    <div class="met"><span class="mv o" id="mS">4,281</span><span class="ml">Shipments</span></div>
    <div class="mdv"></div>
    <div class="met"><span class="mv c" id="mR">98.4%</span><span class="ml">On-Time</span></div>
    <div class="mdv"></div>
    <div class="met"><span class="mv w" id="mC">142</span><span class="ml">Cities</span></div>
  </div>
</div>`;
// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function Login() {
    const navigate = useNavigate();
    const setAuth = useAuthStore((s) => s.setAuth);
    const [mode, setMode] = useState('password');
    const [showPassword, setShowPassword] = useState(false);
    const [remembered, setRemembered] = useState(false);
    const [passkeyEmail, setPasskeyEmail] = useState('');
    const [alert, setAlert] = useState(null);
    const [, setFailCount] = useState(0);
    const [cooldownSecs, setCooldownSecs] = useState(0);
    const [hudCoords, setHudCoords] = useState('6.5244°N · 3.3792°E');
    const logoTextRef = useRef(null);
    const logoLayerRef = useRef(null);
    const cardRef = useRef(null);
    const { register, handleSubmit, formState: { errors }, watch } = useForm({
        resolver: zodResolver(passwordSchema),
    });
    // Clear alert on input changes
    const emailVal = watch('email');
    const passVal = watch('password');
    useEffect(() => { setAlert(null); }, [emailVal, passVal]);
    // Password strength (0–5)
    const STR_COLS = ['#ef4444', '#ff9040', '#f0c040', '#22ee88', '#00d4ff'];
    const strength = passVal ? Math.min(Math.floor(passVal.length / 4) + 1, 5) : 0;
    const strCol = strength > 0 ? STR_COLS[strength - 1] : STR_COLS[0];
    // Cooldown countdown
    useEffect(() => {
        if (cooldownSecs <= 0)
            return;
        const id = window.setTimeout(() => {
            setCooldownSecs((s) => {
                if (s <= 1)
                    setFailCount(0);
                return s - 1;
            });
        }, 1000);
        return () => clearTimeout(id);
    }, [cooldownSecs]);
    // Lock body scroll
    useEffect(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, []);
    // Canvas background
    useEffect(() => {
        const canvas = document.getElementById('login-bg-canvas');
        if (!canvas)
            return;
        const ctx = canvas.getContext('2d');
        const prefersRM = window.matchMedia('(prefers-reduced-motion:reduce)').matches;
        const isMobile = window.innerWidth < 768;
        const isLowEnd = (() => {
            try {
                const g = document.createElement('canvas').getContext('webgl');
                if (!g)
                    return true;
                const d = g.getExtension('WEBGL_debug_renderer_info');
                return !!(d && g.getParameter(d.UNMASKED_RENDERER_WEBGL).toLowerCase().includes('intel hd'));
            }
            catch {
                return false;
            }
        })();
        let W = (canvas.width = window.innerWidth);
        let H = (canvas.height = window.innerHeight);
        const onResize = () => { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; };
        window.addEventListener('resize', onResize);
        const SC = isLowEnd ? 100 : isMobile ? 160 : 240;
        const PC = isLowEnd ? 25 : isMobile ? 40 : 70;
        const stars = Array.from({ length: SC }, () => ({
            x: Math.random() * W, y: Math.random() * H,
            r: Math.random() * 1.6 + 0.2, op: Math.random() * 0.8 + 0.15,
            sp: Math.random() * 0.02 + 0.003, ph: Math.random() * Math.PI * 2,
            col: Math.random() < 0.25 ? 'rgba(160,190,255,1)' : Math.random() < 0.15 ? 'rgba(255,210,160,1)' : 'rgba(255,255,255,1)',
        }));
        let shooters = [];
        let shooterInt = null;
        if (!isLowEnd) {
            shooterInt = setInterval(() => {
                if (Math.random() < 0.35)
                    shooters.push({
                        x: Math.random() * W, y: Math.random() * H * 0.4,
                        vx: (Math.random() * 4 + 2) * (Math.random() < 0.5 ? 1 : -1),
                        vy: Math.random() * 2 + 0.6, len: Math.random() * 85 + 35, life: 1,
                        decay: Math.random() * 0.02 + 0.01,
                        col: Math.random() < 0.25 ? 'rgba(255,160,80,' : 'rgba(180,210,255,',
                    });
            }, 1200);
        }
        const particles = Array.from({ length: PC }, () => ({
            x: Math.random() * W, y: Math.random() * H,
            vx: (Math.random() - 0.5) * 0.38, vy: (Math.random() - 0.5) * 0.38,
            r: Math.random() * 1.9 + 0.4, op: Math.random() * 0.4 + 0.08,
            ph: Math.random() * Math.PI * 2, spd: Math.random() * 0.016 + 0.007,
            col: Math.random() < 0.33 ? '255,144,64' : Math.random() < 0.5 ? '80,140,255' : Math.random() < 0.75 ? '0,212,255' : '34,238,136',
        }));
        const warps = isLowEnd ? [] : Array.from({ length: 16 }, () => ({
            x: Math.random() * W, y: Math.random() * H, angle: Math.random() * Math.PI * 2,
            len: 0, maxLen: Math.random() * 65 + 12, spd: Math.random() * 2.2 + 0.7,
            life: 0, maxLife: Math.random() + 0.35,
            col: Math.random() < 0.5 ? '80,140,255' : '0,212,255',
        }));
        let ga = 0, t = 0, rafId;
        function loop() {
            ctx.clearRect(0, 0, W, H);
            if (t < 200)
                ga = Math.min(0.03, ga + 0.0002);
            ctx.globalAlpha = ga;
            ctx.strokeStyle = 'rgba(60,100,200,1)';
            ctx.lineWidth = 0.4;
            for (let x = 0; x < W; x += 80) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, H);
                ctx.stroke();
            }
            for (let y = 0; y < H; y += 80) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(W, y);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
            stars.forEach((s) => {
                s.ph += s.sp;
                ctx.beginPath();
                ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
                ctx.globalAlpha = s.op * (0.5 + 0.5 * Math.sin(s.ph));
                ctx.fillStyle = s.col;
                ctx.fill();
            });
            ctx.globalAlpha = 1;
            shooters = shooters.filter((s) => {
                s.x += s.vx;
                s.y += s.vy;
                s.life -= s.decay;
                if (s.life <= 0)
                    return false;
                const sp = Math.hypot(s.vx, s.vy);
                const gr = ctx.createLinearGradient(s.x, s.y, s.x - s.vx * (s.len / sp), s.y - s.vy * (s.len / sp));
                gr.addColorStop(0, s.col + s.life + ')');
                gr.addColorStop(1, s.col + '0)');
                ctx.beginPath();
                ctx.moveTo(s.x, s.y);
                ctx.lineTo(s.x - s.vx * (s.len / sp), s.y - s.vy * (s.len / sp));
                ctx.strokeStyle = gr;
                ctx.lineWidth = 1.4 * s.life;
                ctx.stroke();
                return true;
            });
            warps.forEach((w) => {
                w.life += 0.016 * w.spd;
                if (w.life > w.maxLife) {
                    w.life = 0;
                    w.x = Math.random() * W;
                    w.y = Math.random() * H;
                    w.angle = Math.random() * Math.PI * 2;
                }
                w.len = Math.min(w.maxLen, (w.life / w.maxLife) * w.maxLen);
                const op = Math.sin((w.life / w.maxLife) * Math.PI) * 0.18;
                ctx.beginPath();
                ctx.moveTo(w.x, w.y);
                ctx.lineTo(w.x + Math.cos(w.angle) * w.len, w.y + Math.sin(w.angle) * w.len);
                ctx.strokeStyle = `rgba(${w.col},${op})`;
                ctx.lineWidth = 0.7;
                ctx.stroke();
            });
            particles.forEach((p) => {
                p.x += p.vx;
                p.y += p.vy;
                if (p.x < 0)
                    p.x = W;
                if (p.x > W)
                    p.x = 0;
                if (p.y < 0)
                    p.y = H;
                if (p.y > H)
                    p.y = 0;
                p.ph += p.spd;
                const pulse = 0.36 + 0.64 * Math.sin(p.ph);
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(${p.col},${p.op * pulse})`;
                if (!isLowEnd) {
                    ctx.shadowColor = `rgba(${p.col},.45)`;
                    ctx.shadowBlur = 7;
                }
                ctx.fill();
                ctx.shadowBlur = 0;
            });
            t++;
            rafId = requestAnimationFrame(loop);
        }
        if (!prefersRM)
            rafId = requestAnimationFrame(loop);
        return () => { cancelAnimationFrame(rafId); if (shooterInt)
            clearInterval(shooterInt); window.removeEventListener('resize', onResize); };
    }, []);
    // Logo letter colour animation (card)
    useEffect(() => {
        const letters = Array.from(logoTextRef.current?.querySelectorAll('.logo-lt') ?? []);
        if (!letters.length)
            return;
        const PAL = [
            ['#ff9040', '#ffcc44'], ['#00d4ff', '#6699ff'], ['#22ee88', '#00d4ff'],
            ['#ff6080', '#ff9040'], ['#aa66ff', '#6699ff'], ['#ffffff', '#c8d4f0'],
            ['#ffcc80', '#f07020'], ['#00eebb', '#6699ff'], ['#ff4488', '#aa44ff'], ['#88ccff', '#ffffff'],
        ];
        function lerp(a, b, t) {
            const h = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
            const [ar, ag, ab] = h(a), [br, bg, bb] = h(b);
            return `rgb(${Math.round(ar + (br - ar) * t)},${Math.round(ag + (bg - ag) * t)},${Math.round(ab + (bb - ab) * t)})`;
        }
        const state = letters.map((el, i) => ({
            el, fromA: PAL[i % PAL.length], toA: PAL[(i + 2) % PAL.length],
            prog: Math.random(), spd: 0.004 + Math.random() * 0.005,
            op: 0.5 + Math.random() * 0.5, opDir: Math.random() < 0.5 ? 1 : -1, opSpd: 0.008 + Math.random() * 0.012,
        }));
        let rafId;
        function run() {
            state.forEach((s) => {
                s.prog += s.spd;
                s.op += s.opSpd * s.opDir;
                if (s.op >= 1) {
                    s.op = 1;
                    s.opDir = -1;
                }
                if (s.op <= 0.3) {
                    s.op = 0.3;
                    s.opDir = 1;
                }
                if (s.prog >= 1) {
                    s.prog = 0;
                    s.fromA = s.toA;
                    let next;
                    do {
                        next = PAL[Math.floor(Math.random() * PAL.length)];
                    } while (next === s.fromA);
                    s.toA = next;
                    s.spd = 0.004 + Math.random() * 0.006;
                }
                const tv = s.prog < 0.5 ? 2 * s.prog * s.prog : -1 + (4 - 2 * s.prog) * s.prog;
                s.el.style.backgroundImage = `linear-gradient(135deg,${lerp(s.fromA[0], s.toA[0], tv)},${lerp(s.fromA[1], s.toA[1], tv)})`;
                s.el.style.opacity = String(s.op);
            });
            rafId = requestAnimationFrame(run);
        }
        rafId = requestAnimationFrame(run);
        return () => cancelAnimationFrame(rafId);
    }, []);
    // Logo layer mouse parallax
    useEffect(() => {
        const layer = logoLayerRef.current;
        if (!layer || window.matchMedia('(prefers-reduced-motion:reduce)').matches)
            return;
        const onMove = (e) => {
            const mx = (e.clientX / window.innerWidth - 0.5) * 2;
            const my = (e.clientY / window.innerHeight - 0.5) * 2;
            layer.style.transform = `scale(1.03) translate(${mx * 7}px,${my * 5}px)`;
        };
        document.addEventListener('mousemove', onMove);
        return () => document.removeEventListener('mousemove', onMove);
    }, []);
    // Metrics counter animation
    useEffect(() => {
        const delay = setTimeout(() => {
            function countUp(id, end, dur, fmt) {
                const el = document.getElementById(id);
                if (!el)
                    return;
                const s = performance.now();
                (function u(n) {
                    const p = Math.min(1, (n - s) / dur), e = 1 - Math.pow(1 - p, 4);
                    el.textContent = fmt(Math.round(e * end));
                    if (p < 1)
                        requestAnimationFrame(u);
                })(performance.now());
            }
            countUp('mS', 4281, 2000, (v) => v.toLocaleString());
            countUp('mC', 142, 2000, (v) => String(v));
            const rEl = document.getElementById('mR');
            if (!rEl)
                return;
            const rs = performance.now();
            (function u(n) {
                const p = Math.min(1, (n - rs) / 2000), e = 1 - Math.pow(1 - p, 4);
                rEl.textContent = (e * 98.4).toFixed(1) + '%';
                if (p < 1)
                    requestAnimationFrame(u);
            })(performance.now());
        }, 3600);
        return () => clearTimeout(delay);
    }, []);
    // HUD coordinates cycling
    useEffect(() => {
        let t = 0;
        const id = setInterval(() => {
            t += 0.0015;
            const lat = (6.5244 + Math.sin(t) * 0.003).toFixed(4);
            const lng = (3.3792 + Math.cos(t) * 0.003).toFixed(4);
            setHudCoords(`${lat}°N · ${lng}°E`);
        }, 500);
        return () => clearInterval(id);
    }, []);
    // 3-D mouse tilt on card (starts after card-in animation completes)
    useEffect(() => {
        const card = cardRef.current;
        if (!card || window.matchMedia('(prefers-reduced-motion:reduce)').matches)
            return;
        const onMove = (e) => {
            const r = card.getBoundingClientRect();
            const dx = (e.clientX - (r.left + r.width * 0.5)) / (window.innerWidth * 0.5);
            const dy = (e.clientY - (r.top + r.height * 0.5)) / (window.innerHeight * 0.5);
            card.style.transform = `rotateX(${-dy * 7}deg) rotateY(${dx * 7}deg)`;
            card.style.transition = 'transform .07s';
        };
        const onLeave = () => {
            card.style.transform = 'rotateX(0deg) rotateY(0deg)';
            card.style.transition = 'transform 1.2s ease';
        };
        const tid = setTimeout(() => {
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseleave', onLeave);
        }, 1600);
        return () => {
            clearTimeout(tid);
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseleave', onLeave);
        };
    }, []);
    // ---------------------------------------------------------------------------
    // Auth mutations
    // ---------------------------------------------------------------------------
    const passwordMutation = useMutation({
        mutationFn: async (data) => (await api.post('/auth/login', data)).data,
        onSuccess: (data) => { setAuth(data.token, data.user); void navigate({ to: '/' }); },
        onError: (err) => {
            setFailCount((prev) => {
                const next = prev + 1;
                if (next >= MAX_ATTEMPTS) {
                    setCooldownSecs(COOLDOWN_S);
                    setAlert({ type: 'error', msg: `Too many failed attempts. Please wait ${COOLDOWN_S} seconds.` });
                }
                else {
                    const rem = MAX_ATTEMPTS - next;
                    const hint = rem <= 2 ? ` ${rem} attempt${rem === 1 ? '' : 's'} remaining.` : '';
                    setAlert({ type: 'error', msg: (err.message?.includes('401') || err.message?.includes('credential') ? 'Incorrect email or password.' : (err.message ?? 'Sign-in failed.')) + hint });
                }
                return next;
            });
        },
    });
    const passkeyMutation = useMutation({
        mutationFn: async (email) => {
            const opts = (await api.get('/auth/webauthn/authenticate-options', { params: { email } })).data;
            const credential = await navigator.credentials.get({
                publicKey: { challenge: base64UrlToBuffer(opts.challenge), timeout: 60000, userVerification: 'preferred', ...opts },
            });
            if (!credential || credential.type !== 'public-key')
                throw new Error('No passkey selected');
            const pkc = credential;
            const resp = pkc.response;
            return (await api.post('/auth/webauthn/authenticate', {
                id: pkc.id, rawId: bufferToBase64Url(pkc.rawId), type: pkc.type,
                response: {
                    authenticatorData: bufferToBase64Url(resp.authenticatorData),
                    clientDataJSON: bufferToBase64Url(resp.clientDataJSON),
                    signature: bufferToBase64Url(resp.signature),
                    userHandle: resp.userHandle ? bufferToBase64Url(resp.userHandle) : null,
                },
            })).data;
        },
        onSuccess: (data) => { setAuth(data.token, data.user); void navigate({ to: '/' }); },
        onError: (err) => setAlert({ type: 'error', msg: err.message ?? 'Passkey authentication failed' }),
    });
    const onPasswordSubmit = (data) => {
        if (cooldownSecs > 0)
            return;
        setAlert(null);
        passwordMutation.mutate(data);
    };
    const onPasskeySubmit = () => {
        if (!passkeyEmail.trim()) {
            setAlert({ type: 'error', msg: 'Enter your email first' });
            return;
        }
        setAlert(null);
        passkeyMutation.mutate(passkeyEmail);
    };
    const onForgotPassword = () => {
        setAlert({ type: 'success', msg: 'Check your email for a password reset link.' });
    };
    const isSubmitting = passwordMutation.isPending || passkeyMutation.isPending;
    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------
    return (<>
      <canvas id="login-bg-canvas" style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', zIndex: 0 }}/>

      <div ref={logoLayerRef} className="logo-layer" aria-hidden="true">
        <div className="logo-inner" dangerouslySetInnerHTML={{ __html: LOGO_INNER_HTML }}/>
      </div>

      {/* Aurora ambient blobs */}
      <div className="login-aurora" aria-hidden="true" style={{ width: 520, height: 520, top: '-12%', left: '-8%', background: 'radial-gradient(circle, rgba(240,112,32,.28) 0%, transparent 70%)', animationDuration: '9s', animationDelay: '0s' }}/>
      <div className="login-aurora" aria-hidden="true" style={{ width: 420, height: 420, bottom: '2%', right: '-6%', background: 'radial-gradient(circle, rgba(0,212,255,.22) 0%, transparent 70%)', animationDuration: '11s', animationDelay: '-4s' }}/>
      <div className="login-aurora" aria-hidden="true" style={{ width: 340, height: 340, bottom: '30%', left: '4%', background: 'radial-gradient(circle, rgba(85,136,255,.18) 0%, transparent 70%)', animationDuration: '13s', animationDelay: '-7s' }}/>

      <div className="vignette" aria-hidden="true"/>
      <div className="scanline" aria-hidden="true"/>

      <div className="card-wrap" role="main">
        <div className="card" ref={cardRef} role="region" aria-label="Sign in to Sonalit">
          <div className="card-scan-line" aria-hidden="true"/>
          <div className="ca ca-tl" aria-hidden="true"/>
          <div className="ca ca-tr" aria-hidden="true"/>
          <div className="ca ca-bl" aria-hidden="true"/>
          <div className="ca ca-br" aria-hidden="true"/>

          <div className="card-logo" aria-hidden="true">
            <div className="logo-dot"/>
            <div className="logo-text" ref={logoTextRef}>
              {'SONALIT'.split('').map((ch, i) => (<span key={i} className="logo-lt" data-i={i}>{ch}</span>))}
            </div>
          </div>

          <h1 className="card-title">Welcome Back</h1>
          <p className="card-sub">Sign in to access your logistics dashboard</p>

          {alert && (<div className={`alert alert-${alert.type} show`} role="alert" aria-live="polite" aria-atomic="true">
              {alert.type === 'error'
                ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>}
              <span>{alert.msg}</span>
            </div>)}

          <div className="login-hud" aria-hidden="true">
            <span className="hud-indicator"/>
            <span className="hud-status-text">AUTH · SECURE</span>
            <span className="hud-coords-text">{hudCoords}</span>
            <span className="hud-signal">
              <span className="hud-signal-bar" style={{ height: 4, animationDelay: '0s' }}/>
              <span className="hud-signal-bar" style={{ height: 7, animationDelay: '.2s' }}/>
              <span className="hud-signal-bar" style={{ height: 10, animationDelay: '.4s' }}/>
              <span className="hud-signal-bar" style={{ height: 7, animationDelay: '.6s' }}/>
            </span>
          </div>

          <div className="mode-tabs">
            <button className={`mode-tab${mode === 'password' ? ' active' : ''}`} onClick={() => { setMode('password'); setAlert(null); }}>Password</button>
            <button className={`mode-tab${mode === 'passkey' ? ' active' : ''}`} onClick={() => { setMode('passkey'); setAlert(null); }}>Passkey</button>
          </div>

          {mode === 'password' && (<form onSubmit={handleSubmit(onPasswordSubmit)} noValidate>
              <div className="fg">
                <label className="fl" htmlFor="lEmailInput">
                  <span>Email Address</span>
                  {errors.email && <span className="fl-err show" role="alert">{errors.email.message}</span>}
                </label>
                <div className="iw">
                  <input type="email" id="lEmailInput" className={`fi${errors.email ? ' invalid' : ''}`} placeholder="you@company.com" autoComplete="email" autoCapitalize="none" spellCheck={false} aria-required="true" aria-invalid={!!errors.email} {...register('email')}/>
                  <span className="ig" aria-hidden="true"/>
                  <span className="ii" aria-hidden="true">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                  </span>
                </div>
              </div>

              <div className="fg">
                <label className="fl" htmlFor="lPasswordInput">
                  <span>Password</span>
                  {errors.password && <span className="fl-err show" role="alert">{errors.password.message}</span>}
                </label>
                <div className="iw">
                  <input type={showPassword ? 'text' : 'password'} id="lPasswordInput" className={`fi fi-pw${errors.password ? ' invalid' : ''}`} placeholder="Enter your password" autoComplete="current-password" aria-required="true" aria-invalid={!!errors.password} {...register('password')}/>
                  <span className="ig" aria-hidden="true"/>
                  <button type="button" className="pw-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((v) => !v)}>
                    {showPassword
                ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
                  </button>
                </div>
                {passVal && (<div className="pw-strength-row" aria-hidden="true">
                    {[0, 1, 2, 3, 4].map((i) => (<span key={i} className={`pw-str-seg${i < strength ? ' active' : ''}`} style={i < strength ? { '--str-col': strCol } : undefined}/>))}
                  </div>)}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '-2px 0 16px' }}>
                <div className="check-row">
                  <div className={`check-box${remembered ? ' checked' : ''}`} role="checkbox" aria-checked={remembered} tabIndex={0} aria-label="Remember me for 30 days" onClick={() => setRemembered((r) => !r)} onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && setRemembered((r) => !r)}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <span className="check-label" onClick={() => setRemembered((r) => !r)}>Remember me</span>
                </div>
                <button type="button" className="forgot-link" onClick={onForgotPassword}>Forgot password?</button>
              </div>

              <button type="submit" className={`btn-login${isSubmitting ? ' loading' : ''}`} disabled={isSubmitting || cooldownSecs > 0}>
                <span className="btn-inner">
                  <span className="btn-spinner" aria-hidden="true"/>
                  <span className="btn-label">
                    {cooldownSecs > 0 ? `Wait ${cooldownSecs}s` : isSubmitting ? 'Authenticating…' : 'Access Dashboard →'}
                  </span>
                </span>
              </button>

              {cooldownSecs > 0 && (<div className="rate-notice show" aria-live="polite">
                  Too many attempts — please wait <span>{cooldownSecs}</span>s
                </div>)}
            </form>)}

          {mode === 'passkey' && (<div>
              <div className="fg">
                <label className="fl" htmlFor="lPasskeyEmail"><span>Email Address</span></label>
                <div className="iw">
                  <input type="email" id="lPasskeyEmail" className="fi" placeholder="you@company.com" autoComplete="email" value={passkeyEmail} onChange={(e) => { setPasskeyEmail(e.target.value); setAlert(null); }}/>
                  <span className="ig" aria-hidden="true"/>
                </div>
              </div>
              <button className={`btn-login${passkeyMutation.isPending ? ' loading' : ''}`} onClick={onPasskeySubmit} disabled={passkeyMutation.isPending}>
                <span className="btn-inner">
                  <span className="btn-spinner" aria-hidden="true"/>
                  <span className="btn-label">{passkeyMutation.isPending ? 'Authenticating…' : 'Sign in with Passkey →'}</span>
                </span>
              </button>
            </div>)}

          <div className="div-row" aria-hidden="true"><span>or continue with</span></div>

          <div className="soc-row">
            <button className="btn-soc" onClick={() => setAlert({ type: 'success', msg: 'Redirecting to Google SSO…' })}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
              Google SSO
            </button>
            <button className="btn-soc" onClick={() => setAlert({ type: 'success', msg: 'Redirecting to Microsoft SSO…' })}>
              <svg width="14" height="14" viewBox="0 0 23 23" fill="currentColor" aria-hidden="true"><rect x="1" y="1" width="10" height="10" fill="#f25022"/><rect x="12" y="1" width="10" height="10" fill="#7fba00"/><rect x="1" y="12" width="10" height="10" fill="#00a4ef"/><rect x="12" y="12" width="10" height="10" fill="#ffb900"/></svg>
              Microsoft SSO
            </button>
          </div>

          <div className="trust-row" aria-label="Security certifications">
            <div className="ti">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              <span>SOC2 Certified</span>
            </div>
            <div className="ti">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              <span>256-bit Encryption</span>
            </div>
            <div className="ti">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              <span>99.99% Uptime</span>
            </div>
          </div>

          <div className="card-footer">
            <p>Don't have an account? <button onClick={() => setAlert({ type: 'success', msg: 'Contact ops@sonalit.io to request access.' })}>Request access</button></p>
          </div>

          {isSubmitting && (<div className="bio-overlay" role="status" aria-label="Authenticating">
              <span className="bio-label">Verifying Identity</span>
              <div className="bio-rings" aria-hidden="true">
                <div className="bio-ring bio-ring-a"/>
                <div className="bio-ring bio-ring-b"/>
                <div className="bio-ring bio-ring-c"/>
                <div className="bio-center"/>
              </div>
              <span className="bio-phase-text">Authenticating…</span>
              <span className="bio-sub-text">Please wait</span>
            </div>)}
        </div>
      </div>

      <div className="login-ticker" aria-label="Live logistics feed" aria-live="off">
        <div className="ticker-lbl" aria-hidden="true">Live Feed</div>
        <div className="ticker-track" aria-hidden="true">
          {[...TICKER_ROUTES, ...TICKER_ROUTES].map((r, i) => (<span key={i} className="tick"><span className={`tdot ${r.c}`}/>{r.t}</span>))}
        </div>
      </div>
    </>);
}
