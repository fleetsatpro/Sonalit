import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject, type MutableRefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Search, Mic, X, Settings, LayoutDashboard, ShieldAlert, Truck, Briefcase, type LucideIcon } from 'lucide-react';
import { api } from '../lib/api.js';
import { useDashboardStore, type DashboardOverview } from '../stores/dashboardStore.js';
import { NAV_GROUPS } from '../components/layout/Rail.js';
import '../styles/orbit.css';

// ── Orbit: the immersive homepage. A real-time WebGL globe with the platform's
// operational layers composited on top, and the whole app segmented into four
// domain folders that float over it. Replaces the rigid rail on the home
// surface; deep pages keep AppShell's rail for in-app navigation.

const GROUP_COVER: Record<string, LucideIcon> = {
  Command: LayoutDashboard, Security: ShieldAlert, Fleet: Truck, Business: Briefcase,
};

interface MapData {
  convoys?: Array<{ lat: number | null; lng: number | null }>;
  vehicles?: Array<{ lat: number; lng: number }>;
  devices?: Array<{ lat: number; lng: number }>;
  geofences?: Array<{ lat: number | null; lng: number | null }>;
  riskzones?: Array<{ lat: number; lng: number; risk_level: string }>;
}
interface Ops {
  risk: Array<[number, number, number]>;
  hubs: Array<[number, number]>;
  pings: Array<[number, number, number]>;
  convoys: Array<Array<[number, number]>>;
}

// Geometry helpers must be declared before SEED, which calls greatCircle at
// module-eval time — greatCircle → toVec reads the `const D2R` below, and a
// const is in the temporal dead zone until its own line runs. Declaring SEED
// first threw "Cannot access 'D2R' before initialization" on import, which
// took down the whole homepage.
const D2R = Math.PI / 180;
function toVec(lo: number, la: number): [number, number, number] {
  lo *= D2R; la *= D2R;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}
function toLL(v: number[]): [number, number] { return [Math.atan2(v[1]!, v[0]!) / D2R, Math.asin(v[2]!) / D2R]; }
function greatCircle(a: [number, number], b: [number, number], n: number): Array<[number, number]> {
  const va = toVec(a[0], a[1]), vb = toVec(b[0], b[1]);
  let dot = va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2];
  dot = Math.max(-1, Math.min(1, dot));
  const om = Math.acos(dot), so = Math.sin(om) || 1e-6, out: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, s1 = Math.sin((1 - t) * om) / so, s2 = Math.sin(t * om) / so;
    out.push(toLL([va[0] * s1 + vb[0] * s2, va[1] * s1 + vb[1] * s2, va[2] * s1 + vb[2] * s2]));
  }
  return out;
}

// East-Africa seed overlays so the globe is never bare before/without data.
const SEED: Ops = {
  risk: [[28.8, -1.6, 1], [31.6, 6.8, .85], [45, 4, .8], [-3, 17, .65], [40, -12, .6], [18, 12, .5]],
  hubs: [[36.82, -1.29], [39.66, -4.05], [32.58, 0.35], [39.28, -6.82]],
  pings: Array.from({ length: 26 }, () => [18 + Math.random() * 44, -20 + Math.random() * 32, Math.random()] as [number, number, number]),
  convoys: ([
    [[39.66, -4.05], [36.82, -1.29]], [[36.82, -1.29], [32.58, 0.35]],
    [[32.58, 0.35], [29.2, -1.7]], [[39.28, -6.82], [35.75, -6.17]],
  ] as Array<[[number, number], [number, number]]>).map(([a, b]) => greatCircle(a, b, 54)),
};

const VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
const FS = `precision highp float;
uniform vec2 uC;uniform float uR;uniform float uT;uniform float uLam;uniform sampler2D uLand;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
 return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p=p*2.03+3.1;a*=.5;}return v;}
const float PI=3.14159265;
mat3 rotY(float a){float c=cos(a),s=sin(a);return mat3(c,0.,-s,0.,1.,0.,s,0.,c);}
void main(){
  vec2 fp=gl_FragCoord.xy;vec2 d=fp-uC;float r2=dot(d,d);float R2=uR*uR;
  if(r2>R2){float dd=sqrt(r2)/uR;float glow=pow(smoothstep(1.6,1.0,dd),2.2);
    vec3 col=vec3(0.015,0.02,0.04)+vec3(0.10,0.42,0.85)*glow*0.55;
    float st=hash(floor(fp*0.7));if(st>0.994)col+=vec3(0.7,0.8,1.0)*(st-0.994)*90.0*(0.5+0.5*sin(uT*2.0+st*50.0));
    gl_FragColor=vec4(col,1.);return;}
  float z=sqrt(R2-r2);vec3 n=vec3(d.x,d.y,z)/uR;vec3 g=rotY(uLam)*n;
  float lat=asin(clamp(g.y,-1.,1.));float lon=atan(g.x,g.z);
  vec2 uv=vec2(lon/(2.*PI)+0.5,0.5-lat/PI);
  vec2 w=vec2(fbm(uv*7.0),fbm(uv*7.0+11.7))-0.5;
  float land=texture2D(uLand,uv+w*0.02).r;
  land=smoothstep(0.42,0.55,land+(fbm(uv*46.0)-0.5)*0.22);
  float elev=fbm(uv*22.0);
  vec3 landc=mix(vec3(0.10,0.20,0.09),vec3(0.42,0.34,0.18),smoothstep(0.35,0.7,elev));
  landc=mix(landc,vec3(0.30,0.28,0.24),smoothstep(0.65,0.9,elev));
  landc=mix(landc,vec3(0.85,0.9,0.95),smoothstep(0.62,0.85,abs(lat)/1.2)*0.8);
  float coast=smoothstep(0.35,0.6,texture2D(uLand,uv).r);
  vec3 ocean=mix(vec3(0.015,0.07,0.17),vec3(0.05,0.35,0.5),coast*0.5+fbm(uv*26.0)*0.15);
  vec3 base=mix(ocean,landc,land);
  vec3 sun=normalize(vec3(cos(uT*0.06),0.32,sin(uT*0.06)));
  float day=smoothstep(-0.08,0.32,dot(n,sun));
  float cl=smoothstep(0.54,0.78,fbm(uv*8.0+vec2(uT*0.008,0.0)))*smoothstep(0.2,0.6,fbm(uv*3.0-vec2(uT*0.004,0.0)));
  vec3 h=normalize(sun+vec3(0.,0.,1.));
  float spec=pow(max(dot(n,h),0.),60.0)*(1.-land)*day;
  float lights=(1.-day)*land*step(0.86,hash(floor(uv*vec2(900.,450.))))*1.2;
  float fres=pow(1.-max(n.z,0.),3.0);
  vec3 col=base*(0.06+0.98*day);
  col+=vec3(1.0,0.92,0.75)*spec*1.4;
  col+=vec3(1.0,0.8,0.4)*lights;
  col=mix(col,vec3(0.95,0.97,1.0),cl*(0.15+0.75*day));
  col+=vec3(0.25,0.55,1.0)*fres*(0.35+0.5*day);
  col+=vec3(1.0,0.5,0.25)*smoothstep(0.0,0.25,day)*(1.-smoothstep(0.25,0.5,day))*0.12;
  gl_FragColor=vec4(col,1.);
}`;

function makeLandTex(): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const x = c.getContext('2d')!; x.fillStyle = '#000'; x.fillRect(0, 0, 1024, 512);
  const polys: Array<Array<[number, number]>> = [
    [[-6, 36], [3, 37], [10, 37], [16, 33], [20, 33], [25, 32], [30, 31], [32, 31.5], [34, 29], [35, 24], [37, 22], [38, 18], [39, 15], [42, 12], [43, 11], [45, 11], [48, 11], [51, 11.8], [49, 7], [47, 4], [44, 2], [42, -1], [41, -2], [40, -3], [40, -4.5], [39, -6.8], [40, -10], [40, -13], [38, -16], [35, -20], [33, -24], [32, -26], [30, -30], [28, -32], [25, -34], [20, -34.5], [18, -34], [16, -29], [14, -23], [13, -17], [12, -12], [13, -8], [12, -5], [9, -1], [9.5, 3], [8, 4], [5, 6], [1, 6], [-3, 5], [-8, 4.5], [-11, 5], [-13, 8], [-15, 12], [-17, 15], [-17, 21], [-13, 25], [-10, 29], [-8, 33], [-6, 36]],
    [[44, -16], [47, -12], [50, -15], [50, -20], [47, -25], [45, -24], [44, -19], [44, -16]],
    [[34, 29], [38, 30], [44, 30], [48, 30], [50, 28], [54, 25], [57, 23], [59, 22], [57, 17], [52, 16], [45, 13], [43, 13], [43, 17], [40, 21], [37, 25], [35, 28], [34, 29]],
    [[-9, 37], [-6, 44], [-1, 43], [3, 43], [8, 44], [12, 45], [13, 42], [16, 41], [19, 41], [24, 40], [27, 41], [30, 41], [36, 42], [40, 45], [30, 48], [16, 54], [8, 54], [0, 50], [-5, 48], [-9, 43], [-9, 37]],
    [[34, 36], [45, 40], [55, 42], [62, 42], [70, 40], [74, 37], [70, 30], [66, 25], [61, 25], [57, 25], [50, 29], [48, 30], [44, 37], [40, 39], [36, 37], [34, 36]],
    [[68, 24], [72, 21], [73, 18], [76, 10], [80, 9], [80, 15], [84, 18], [88, 22], [89, 24], [85, 26], [78, 30], [74, 32], [71, 28], [68, 24]],
    [[70, 40], [85, 50], [100, 52], [120, 50], [133, 47], [140, 40], [135, 33], [122, 31], [110, 22], [100, 22], [97, 17], [92, 22], [88, 24], [80, 15], [80, 9], [77, 8], [74, 20], [70, 30], [70, 40]],
  ];
  x.fillStyle = '#fff';
  for (const p of polys) { x.beginPath(); p.forEach(([lo, la], i) => { const px = (lo + 180) / 360 * 1024, py = (90 - la) / 180 * 512; i ? x.lineTo(px, py) : x.moveTo(px, py); }); x.closePath(); x.fill(); }
  x.globalAlpha = 0.5; x.filter = 'blur(2px)'; x.drawImage(c, 0, 0); x.filter = 'none'; x.globalAlpha = 1;
  return c;
}

function useGlobe(glRef: RefObject<HTMLCanvasElement>, ovRef: RefObject<HTMLCanvasElement>, opsRef: MutableRefObject<Ops>) {
  useEffect(() => {
    const glc = glRef.current, ov = ovRef.current;
    if (!glc || !ov) return;
    const reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;
    const octx = ov.getContext('2d')!;
    let gl: WebGLRenderingContext | null = null;
    try { gl = glc.getContext('webgl', { antialias: true, alpha: false }); } catch { gl = null; }

    let W = 0, H = 0, DPR = 1, cx = 0, cy = 0, R = 0, lam0 = 40 * D2R, T = 0, raf = 0;
    const uni: Record<string, WebGLUniformLocation | null> = {};
    let prog: WebGLProgram | null = null, haveGL = false;

    if (gl) {
      const g = gl;
      const sh = (t: number, s: string) => { const o = g.createShader(t)!; g.shaderSource(o, s); g.compileShader(o); return g.getShaderParameter(o, g.COMPILE_STATUS) ? o : null; };
      const vs = sh(g.VERTEX_SHADER, VS), fs = sh(g.FRAGMENT_SHADER, FS);
      if (vs && fs) {
        prog = g.createProgram()!; g.attachShader(prog, vs); g.attachShader(prog, fs); g.linkProgram(prog);
        if (g.getProgramParameter(prog, g.LINK_STATUS)) {
          g.useProgram(prog);
          const buf = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, buf);
          g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
          const loc = g.getAttribLocation(prog, 'p'); g.enableVertexAttribArray(loc); g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
          ['uC', 'uR', 'uT', 'uLam', 'uLand'].forEach((k) => { uni[k] = g.getUniformLocation(prog!, k); });
          const tex = g.createTexture(); g.bindTexture(g.TEXTURE_2D, tex);
          g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, makeLandTex());
          g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.REPEAT);
          g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
          g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
          g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
          g.uniform1i(uni['uLand'] ?? null, 0);
          haveGL = true;
        }
      }
    }

    const resize = () => {
      DPR = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight;
      cx = W * 0.5; cy = H * 0.5; R = Math.min(W, H) * 0.46;
      for (const c of [glc, ov]) { c.width = W * DPR; c.height = H * DPR; c.style.width = W + 'px'; c.style.height = H + 'px'; }
      octx.setTransform(DPR, 0, 0, DPR, 0, 0);
      if (gl) gl.viewport(0, 0, glc.width, glc.height);
    };
    addEventListener('resize', resize); resize();

    const project = (lon: number, lat: number) => {
      lon *= D2R; lat *= D2R;
      const gx = Math.cos(lat) * Math.sin(lon), gy = Math.sin(lat), gz = Math.cos(lat) * Math.cos(lon);
      const c = Math.cos(-lam0), s = Math.sin(-lam0);
      const x1 = c * gx + s * gz, z1 = -s * gx + c * gz;
      return { x: cx + R * x1, y: cy - R * gy, vis: z1 > 0, z: z1 };
    };

    const drawOverlay = () => {
      const ops = opsRef.current;
      octx.clearRect(0, 0, W, H);
      for (const [lo, la, m] of ops.risk) { const p = project(lo, la); if (!p.vis) continue;
        const pr = reduce ? 1 : (0.78 + 0.22 * Math.sin(T * 0.05 + lo)); const rr = (15 + m * 30) * (0.55 + 0.45 * p.z) * pr;
        const rb = octx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
        rb.addColorStop(0, 'rgba(255,70,55,.5)'); rb.addColorStop(.45, 'rgba(255,90,50,.22)'); rb.addColorStop(1, 'rgba(255,90,50,0)');
        octx.fillStyle = rb; octx.beginPath(); octx.arc(p.x, p.y, rr, 0, 7); octx.fill();
        octx.fillStyle = 'rgba(255,140,110,.95)'; octx.beginPath(); octx.arc(p.x, p.y, 1.7, 0, 7); octx.fill(); }
      for (const [lo, la] of ops.hubs) { const p = project(lo, la); if (!p.vis) continue; const rr = 17 * (0.55 + 0.45 * p.z);
        octx.strokeStyle = 'rgba(55,230,255,.7)'; octx.lineWidth = 1.3; octx.setLineDash([3, 4]);
        octx.beginPath(); octx.arc(p.x, p.y, rr, 0, 7); octx.stroke(); octx.setLineDash([]);
        octx.fillStyle = 'rgba(120,240,255,.95)'; octx.beginPath(); octx.arc(p.x, p.y, 2, 0, 7); octx.fill(); }
      for (const [lo, la, ph] of ops.pings) { const p = project(lo, la); if (!p.vis) continue;
        const pl = reduce ? .5 : (0.5 + 0.5 * Math.sin(T * 0.08 + ph * 6));
        octx.fillStyle = `rgba(120,240,255,${.3 + .5 * pl})`; octx.beginPath(); octx.arc(p.x, p.y, 1.5, 0, 7); octx.fill();
        if (!reduce) { octx.strokeStyle = `rgba(55,230,255,${.45 * (1 - pl)})`; octx.lineWidth = 1; octx.beginPath(); octx.arc(p.x, p.y, 2 + pl * 5, 0, 7); octx.stroke(); } }
      for (const pts of ops.convoys) {
        octx.lineWidth = 1.7; octx.strokeStyle = 'rgba(255,178,62,.55)'; octx.shadowColor = 'rgba(255,178,62,.7)'; octx.shadowBlur = 7;
        octx.setLineDash([5, 6]); octx.lineDashOffset = -T * 0.6; octx.beginPath(); let pen = false;
        for (const [lo, la] of pts) { const p = project(lo, la); if (!p.vis) { pen = false; continue; } pen ? octx.lineTo(p.x, p.y) : (octx.moveTo(p.x, p.y), pen = true); }
        octx.stroke(); octx.setLineDash([]); octx.shadowBlur = 0;
        if (pts.length) { const i = Math.floor((T * 0.4) % pts.length), mp = project(pts[i]![0], pts[i]![1]);
          if (mp.vis) { octx.fillStyle = '#ffd889'; octx.shadowColor = '#ffb23e'; octx.shadowBlur = 10; octx.beginPath(); octx.arc(mp.x, mp.y, 2.7, 0, 7); octx.fill(); octx.shadowBlur = 0; } }
      }
    };

    const drawFallback = () => {
      octx.clearRect(0, 0, W, H);
      const atm = octx.createRadialGradient(cx, cy, R * .85, cx, cy, R * 1.3);
      atm.addColorStop(0, 'rgba(55,230,255,0)'); atm.addColorStop(.6, 'rgba(45,150,220,.18)'); atm.addColorStop(1, 'rgba(20,60,120,0)');
      octx.fillStyle = atm; octx.beginPath(); octx.arc(cx, cy, R * 1.3, 0, 7); octx.fill();
      const oc = octx.createRadialGradient(cx - R * .3, cy - R * .32, R * .1, cx, cy, R);
      oc.addColorStop(0, '#123a5c'); oc.addColorStop(.6, '#0a2338'); oc.addColorStop(1, '#05101c');
      octx.fillStyle = oc; octx.beginPath(); octx.arc(cx, cy, R, 0, 7); octx.fill();
      drawOverlay();
    };

    const loop = () => {
      T += 1; if (!reduce) lam0 += 0.0016;
      if (haveGL && gl && prog) {
        gl.uniform2f(uni['uC'] ?? null, cx * DPR, (H - cy) * DPR);
        gl.uniform1f(uni['uR'] ?? null, R * DPR);
        gl.uniform1f(uni['uT'] ?? null, T * 0.02);
        gl.uniform1f(uni['uLam'] ?? null, lam0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        drawOverlay();
      } else { drawFallback(); }
      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => { cancelAnimationFrame(raf); removeEventListener('resize', resize); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function useClock(): string {
  const [t, setT] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setT(new Date()), 1000); return () => clearInterval(id); }, []);
  return [t.getHours(), t.getMinutes(), t.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

export default function Orbit() {
  const nav = useNavigate();
  const glRef = useRef<HTMLCanvasElement>(null);
  const ovRef = useRef<HTMLCanvasElement>(null);
  const opsRef = useRef<Ops>(SEED);
  const clock = useClock();
  const { setOverview } = useDashboardStore.getState();
  const overview = useDashboardStore((s) => s.overview);
  const panicActive = useDashboardStore((s) => s.panicState?.status === 'active');
  const [openGroup, setOpenGroup] = useState<number | null>(null);
  const [q, setQ] = useState('');

  useGlobe(glRef, ovRef, opsRef);

  useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: async () => { try { const r = await api.get<DashboardOverview>('/dashboard/overview'); setOverview(r.data); return r.data; } catch { return null; } },
    staleTime: 30000, refetchInterval: 60000,
  });

  // Compose the globe's operational layers from the same feed the tactical map uses.
  useQuery({
    queryKey: ['dashboard-map'],
    queryFn: async () => {
      try {
        const r = await api.get<MapData>('/dashboard/map');
        const m = r.data;
        const risk = (m.riskzones ?? []).map((z) => [z.lng, z.lat, z.risk_level === 'critical' || z.risk_level === 'high' ? 1 : 0.6] as [number, number, number]);
        const hubs = (m.geofences ?? []).filter((f) => f.lat != null && f.lng != null).map((f) => [f.lng!, f.lat!] as [number, number]);
        const pings = [...(m.devices ?? []), ...(m.vehicles ?? [])].map((d) => [d.lng, d.lat, Math.random()] as [number, number, number]);
        const cvs = (m.convoys ?? []).filter((c) => c.lat != null && c.lng != null);
        const convoys = cvs.map((c) => greatCircle([c.lng!, c.lat!], [36.82, -1.29], 48)); // arc each convoy toward the Nairobi hub
        opsRef.current = {
          risk: risk.length ? risk : SEED.risk,
          hubs: hubs.length ? hubs : SEED.hubs,
          pings: pings.length ? pings : SEED.pings,
          convoys: convoys.length ? convoys : SEED.convoys,
        };
        return m;
      } catch { return null; }
    },
    staleTime: 30000, refetchInterval: 60000,
  });

  const kpi = overview?.kpi;
  const glances = [
    { l: 'Vehicles', v: kpi?.vehicles_live ?? '—', d: 'live', c: 'var(--o-cyan)' },
    { l: 'Convoys', v: kpi?.convoys_active ?? '—', d: 'active', c: 'var(--o-green)' },
    { l: 'On-time', v: kpi?.on_time_pct != null ? `${kpi.on_time_pct}%` : '—', d: '30-day', c: 'var(--o-amber)' },
    { l: 'Guards', v: kpi?.guards_active ?? '—', d: 'on shift', c: 'var(--o-violet)' },
  ];

  // Live badges per folder, from real overview state.
  const badges: Record<string, { kind: string; text: string } | null> = {
    Command: panicActive ? { kind: 'crit', text: '1' } : null,
    Security: overview?.threat.alerts_open ? { kind: 'crit', text: String(overview.threat.alerts_open) } : null,
    Fleet: kpi?.convoys_active ? { kind: 'count', text: String(kpi.convoys_active) } : null,
    Business: null,
  };

  const jump = useMemo(() => NAV_GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, hue: g.hue, group: g.label }))), []);
  const matches = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return [];
    return jump.filter((i) => i.label.toLowerCase().includes(n) || i.group.toLowerCase().includes(n)).slice(0, 6);
  }, [q, jump]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenGroup(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const go = (path: string) => { setOpenGroup(null); nav({ to: path }); };

  return (
    <div className="orbit">
      <canvas ref={glRef} className="o-gl" />
      <canvas ref={ovRef} className="o-ov" />
      <div className="o-vignette" />

      {/* top bar */}
      <div className="o-top">
        <div className="o-brand">
          <div className="o-avatar">AU</div>
          <div><b>SONALIT</b><br /><span>Northern Corridor · Ops</span></div>
        </div>
        <div className="o-spacer" />
        <div className="o-clockwrap">
          <div className="o-clock">{clock}</div>
          <div className="o-live"><i />LIVE · ALL SYSTEMS NOMINAL</div>
        </div>
        <div className="o-spacer" />
        <div className={`o-chip ${overview?.threat.level ?? 'secure'}`}>
          <span className="o-dot" />THREAT {(overview?.threat.level ?? 'secure').toUpperCase()}
        </div>
        <button className="o-iconbtn" title="Settings" onClick={() => nav({ to: '/settings' })}><Settings size={17} /></button>
      </div>

      {/* hero */}
      <div className="o-hero">
        <div className="o-k">Command · Orbit</div>
        <h1>Every mission, over one live globe.</h1>
      </div>

      {/* floating deck */}
      <div className="o-float">
        <div className="o-glance">
          {glances.map((g) => (
            <div key={g.l} className="o-pod" style={{ '--c': g.c } as CSSProperties}>
              <div className="o-pl">{g.l}</div>
              <div className="o-pv">{g.v}</div>
              <div className="o-pd">{g.d}</div>
            </div>
          ))}
        </div>
        <div className="o-launch">
          <div className="o-lh"><b>Mission apps</b><span>· tap a folder to open its apps</span></div>
          <div className="o-groups">
            {NAV_GROUPS.map((gr, gi) => {
              const Cover = GROUP_COVER[gr.label] ?? LayoutDashboard;
              const b = badges[gr.label];
              return (
                <button key={gr.label} className="o-grp" style={{ '--gc': `rgb(${gr.hue})` } as CSSProperties} onClick={() => setOpenGroup(gi)}>
                  {b && <span className={`o-badge ${b.kind}`}>{b.text}</span>}
                  <span className="o-folder"><Cover size={28} /></span>
                  <h3>{gr.label}</h3>
                  <p>{gr.items.length} apps</p>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* command bar */}
      <div className="o-cmdwrap">
        <div className="o-cmd">
          <Search size={18} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) go(matches[0].path); }}
            placeholder="Search a vehicle, jump to an app, or run a command…"
            aria-label="Command bar"
          />
          <span className="o-kbd">⌘K</span>
          <Mic size={18} className="o-mic" />
          {matches.length > 0 && (
            <div className="o-results">
              {matches.map((m) => (
                <button key={m.path} className="o-result" onMouseDown={(e) => { e.preventDefault(); go(m.path); }}>
                  <span className="o-rdot" style={{ background: `rgb(${m.hue})` }} />
                  {m.label}<span className="o-rgrp">{m.group}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* folder overlay */}
      {openGroup != null && (() => {
        const gr = NAV_GROUPS[openGroup]!;
        const Cover = GROUP_COVER[gr.label] ?? LayoutDashboard;
        return (
          <div className="o-scrim" onClick={(e) => { if (e.target === e.currentTarget) setOpenGroup(null); }}>
            <div className="o-folderpanel" style={{ '--gc': `rgb(${gr.hue})` } as CSSProperties}>
              <div className="o-fp-head">
                <span className="o-fi"><Cover size={22} /></span>
                <div><h2>{gr.label}</h2><div className="o-fsub">{gr.items.length} apps</div></div>
                <button className="o-x" onClick={() => setOpenGroup(null)} aria-label="Close"><X size={18} /></button>
              </div>
              <div className="o-apps">
                {gr.items.map((it) => { const Icon = it.icon; return (
                  <button key={it.path} className="o-app" style={{ '--gc': `rgb(${gr.hue})` } as CSSProperties} onClick={() => go(it.path)}>
                    <span className="o-aic"><Icon size={22} /></span>
                    <span className="o-atl">{it.label}</span>
                  </button>
                ); })}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
