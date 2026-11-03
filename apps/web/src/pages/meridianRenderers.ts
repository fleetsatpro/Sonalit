export type BgType = 'radar' | 'shield' | 'camera' | 'route' | 'chart' | 'container';
export type VizType = 'signalBars' | 'threatArc' | 'waveform' | 'routeProgress' | 'donut' | 'fillLevel';

type Renderer = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number, color: string) => void;

export const bgRenderers: Record<BgType, Renderer> = {
  radar: (ctx, w, h, t, color) => {
    ctx.clearRect(0, 0, w, h);
    const cx = w * 0.5, cy = h * 0.4, maxR = Math.min(w, h) * 0.35;
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath(); ctx.arc(cx, cy, maxR * (i / 4), 0, Math.PI * 2);
      ctx.strokeStyle = color; ctx.globalAlpha = 0.03; ctx.lineWidth = 0.6; ctx.stroke();
    }
    const angle = (t * 0.0008) % (Math.PI * 2);
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * maxR, cy + Math.sin(angle) * maxR);
    ctx.strokeStyle = color; ctx.globalAlpha = 0.1; ctx.lineWidth = 1; ctx.stroke();
    [[0.3, 0.25], [0.7, 0.5], [0.45, 0.65], [0.6, 0.3]].forEach(([bx, by], i) => {
      const p = Math.sin(t * 0.003 + i * 1.2) * 0.5 + 0.5;
      ctx.beginPath(); ctx.arc(bx! * w, by! * h, 2 + p, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.globalAlpha = 0.06 + p * 0.06; ctx.fill();
    });
    ctx.globalAlpha = 1;
  },
  shield: (ctx, w, h, t, color) => {
    ctx.clearRect(0, 0, w, h);
    const hexR = 22, hexH = hexR * Math.sqrt(3);
    ctx.strokeStyle = color; ctx.lineWidth = 0.4;
    for (let r = -1; r < h / hexH + 1; r++) {
      for (let c = -1; c < w / (hexR * 1.5) + 1; c++) {
        const cx = c * hexR * 1.5, cy = r * hexH + (c % 2 ? hexH / 2 : 0);
        ctx.globalAlpha = 0.02; ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i - Math.PI / 6;
          i === 0
            ? ctx.moveTo(cx + hexR * 0.8 * Math.cos(a), cy + hexR * 0.8 * Math.sin(a))
            : ctx.lineTo(cx + hexR * 0.8 * Math.cos(a), cy + hexR * 0.8 * Math.sin(a));
        }
        ctx.closePath(); ctx.stroke();
      }
    }
    const beamY = ((t * 0.03) % (h + 60)) - 30;
    const grad = ctx.createLinearGradient(0, beamY - 30, 0, beamY + 30);
    grad.addColorStop(0, 'transparent'); grad.addColorStop(0.5, color); grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad; ctx.globalAlpha = 0.025; ctx.fillRect(0, beamY - 30, w, 60);
    ctx.globalAlpha = 1;
  },
  camera: (ctx, w, h, t, color) => {
    ctx.clearRect(0, 0, w, h);
    const cx = w * 0.5, cy = h * 0.45, sz = Math.min(w, h) * 0.28;
    ([[cx - sz, cy - sz, 1, 1], [cx + sz, cy - sz, -1, 1], [cx - sz, cy + sz, 1, -1], [cx + sz, cy + sz, -1, -1]] as number[][])
      .forEach(([x, y, dx, dy]) => {
        const cL = sz * 0.35;
        ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.globalAlpha = 0.06;
        ctx.beginPath(); ctx.moveTo(x! + dx! * cL, y!); ctx.lineTo(x!, y!); ctx.lineTo(x!, y! + dy! * cL); ctx.stroke();
      });
    const p = Math.sin(t * 0.003) * 0.5 + 0.5;
    ctx.beginPath(); ctx.arc(cx, cy, 2 + p * 2, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.globalAlpha = 0.04 + p * 0.03; ctx.fill();
    ctx.globalAlpha = 1;
  },
  route: (ctx, w, h, t, color) => {
    ctx.clearRect(0, 0, w, h);
    [{ pts: [[0.1, 0.8], [0.3, 0.3], [0.7, 0.6], [0.95, 0.15]], speed: 0.0004 },
     { pts: [[0.05, 0.5], [0.25, 0.7], [0.6, 0.25], [0.9, 0.5]], speed: 0.0003 }]
      .forEach((route, ri) => {
        const [p0, p1, p2, p3] = route.pts.map(p => [p[0]! * w, p[1]! * h]);
        ctx.strokeStyle = color; ctx.globalAlpha = 0.025; ctx.lineWidth = 0.6;
        ctx.setLineDash([5, 4]); ctx.beginPath();
        ctx.moveTo(p0![0]!, p0![1]!); ctx.bezierCurveTo(p1![0]!, p1![1]!, p2![0]!, p2![1]!, p3![0]!, p3![1]!);
        ctx.stroke(); ctx.setLineDash([]);
        const progress = (t * route.speed + ri * 0.33) % 1, tp = 1 - progress;
        const x = tp ** 3 * p0![0]! + 3 * tp * tp * progress * p1![0]! + 3 * tp * progress * progress * p2![0]! + progress ** 3 * p3![0]!;
        const y = tp ** 3 * p0![1]! + 3 * tp * tp * progress * p1![1]! + 3 * tp * progress * progress * p2![1]! + progress ** 3 * p3![1]!;
        ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.globalAlpha = 0.08; ctx.fill();
      });
    ctx.globalAlpha = 1;
  },
  chart: (ctx, w, h, t, color) => {
    ctx.clearRect(0, 0, w, h);
    const barCount = 10, barW = w / (barCount * 2), baseY = h * 0.85;
    for (let i = 0; i < barCount; i++) {
      const bH = (Math.sin(t * 0.002 + i * 0.6) * 0.3 + 0.5) * h * 0.6;
      const x = (w / barCount) * i + barW * 0.5;
      ctx.fillStyle = color; ctx.globalAlpha = 0.015; ctx.fillRect(x, baseY - bH, barW, bH);
      ctx.globalAlpha = 0.03; ctx.fillRect(x, baseY - bH, barW, 1);
    }
    ctx.globalAlpha = 1;
  },
  container: (ctx, w, h, _t, color) => {
    ctx.clearRect(0, 0, w, h);
    const boxW = 28, boxH = 14;
    const cols = Math.floor(w / (boxW + 4)), rows = Math.floor(h / (boxH + 4));
    const offX = (w - cols * (boxW + 4)) / 2, offY = h - rows * (boxH + 4) - 10;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = offX + c * (boxW + 4), y = offY + r * (boxH + 4);
        ctx.strokeStyle = color; ctx.globalAlpha = 0.02; ctx.lineWidth = 0.6; ctx.strokeRect(x, y, boxW, boxH);
      }
    }
    ctx.globalAlpha = 1;
  },
};

type MiniRenderer = (canvas: HTMLCanvasElement, color: string, t: number) => void;

function prepCanvas(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

export const miniRenderers: Record<VizType, MiniRenderer> = {
  signalBars: (canvas, color, t) => {
    const r = prepCanvas(canvas); if (!r) return;
    const { ctx, w, h } = r, bars = 5, gap = 3, bw = (w - gap * (bars - 1)) / bars;
    for (let i = 0; i < bars; i++) {
      const maxH = h * (0.3 + i * 0.15), pulse = Math.sin(t * 0.003 + i * 0.5) * 0.15 + 0.85;
      ctx.fillStyle = color; ctx.globalAlpha = i < 4 ? 0.5 : 0.15 + Math.max(0, Math.sin(t * 0.004)) * 0.35;
      ctx.fillRect(i * (bw + gap), h - maxH * pulse, bw, maxH * pulse);
    }
    ctx.globalAlpha = 1;
  },
  threatArc: (canvas, color, t) => {
    const r = prepCanvas(canvas); if (!r) return;
    const { ctx, w, h } = r, cx = w / 2, cy = h * 0.85, rad = Math.min(w / 2, h) * 0.8;
    (['#2dd4a8', '#e8a020', '#ff2d55'] as const).forEach((c, i) => {
      const s = Math.PI + i * (Math.PI / 3), e = s + Math.PI / 3;
      ctx.beginPath(); ctx.arc(cx, cy, rad, s, e);
      ctx.strokeStyle = c; ctx.globalAlpha = 0.2; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.stroke();
    });
    const level = 0.55 + Math.sin(t * 0.001) * 0.1;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(Math.PI + level * Math.PI) * rad * 0.9, cy + Math.sin(Math.PI + level * Math.PI) * rad * 0.9);
    ctx.strokeStyle = color; ctx.globalAlpha = 0.7; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.globalAlpha = 0.8; ctx.fill(); ctx.globalAlpha = 1;
  },
  waveform: (canvas, color, t) => {
    const r = prepCanvas(canvas); if (!r) return;
    const { ctx, w, h } = r, mid = h / 2, bars = 20, gap = 2, bw = (w - gap * (bars - 1)) / bars;
    for (let i = 0; i < bars; i++) {
      const amp = Math.sin(t * 0.005 + i * 0.4) * 0.4 + 0.5;
      const bh = Math.max(2, amp * h * 0.8);
      ctx.fillStyle = color; ctx.globalAlpha = 0.3 + amp * 0.3; ctx.fillRect(i * (bw + gap), mid - bh / 2, bw, bh);
    }
    ctx.globalAlpha = 1;
  },
  routeProgress: (canvas, color, t) => {
    const r = prepCanvas(canvas); if (!r) return;
    const { ctx, w, h } = r, mid = h / 2;
    ctx.beginPath(); ctx.moveTo(6, mid); ctx.lineTo(w - 6, mid);
    ctx.strokeStyle = color; ctx.globalAlpha = 0.15; ctx.lineWidth = 2; ctx.stroke();
    for (let i = 0; i < 5; i++) {
      const x = 6 + ((w - 12) / 4) * i;
      ctx.beginPath(); ctx.arc(x, mid, 3, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.globalAlpha = 0.3; ctx.fill();
    }
    const progress = (t * 0.0003) % 1, vx = 6 + progress * (w - 12);
    ctx.beginPath(); ctx.moveTo(6, mid); ctx.lineTo(vx, mid);
    ctx.strokeStyle = color; ctx.globalAlpha = 0.5; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(vx, mid, 4, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.globalAlpha = 0.8; ctx.fill();
    ctx.beginPath(); ctx.arc(vx, mid, 8, 0, Math.PI * 2); ctx.globalAlpha = 0.1; ctx.fill();
    ctx.globalAlpha = 1;
  },
  donut: (canvas, color, t) => {
    const r = prepCanvas(canvas); if (!r) return;
    const { ctx, w, h } = r, cx = w / 2, cy = h / 2, rad = Math.min(w, h) * 0.38;
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.strokeStyle = color; ctx.globalAlpha = 0.1; ctx.lineWidth = 3.5; ctx.stroke();
    let startA = -Math.PI / 2;
    [0.35, 0.25, 0.2, 0.12, 0.08].forEach((seg, i) => {
      const endA = startA + seg * Math.PI * 2;
      ctx.beginPath(); ctx.arc(cx, cy, rad, startA, endA);
      ctx.strokeStyle = color; ctx.globalAlpha = 0.3 + i * 0.1 + Math.sin(t * 0.002 + i) * 0.1;
      ctx.lineWidth = 3.5; ctx.lineCap = 'round'; ctx.stroke();
      startA = endA + 0.04;
    });
    ctx.globalAlpha = 1;
  },
  fillLevel: (canvas, color, t) => {
    const r = prepCanvas(canvas); if (!r) return;
    const { ctx, w, h } = r;
    ctx.strokeStyle = color; ctx.globalAlpha = 0.25; ctx.lineWidth = 1.5; ctx.strokeRect(4, 4, w - 8, h - 8);
    const level = 0.6 + Math.sin(t * 0.0015) * 0.15;
    ctx.fillStyle = color; ctx.globalAlpha = 0.15; ctx.fillRect(5, 5 + (h - 10) * (1 - level), w - 10, (h - 10) * level - 1);
    ctx.fillStyle = color; ctx.globalAlpha = 0.3; ctx.fillRect(5, 5 + (h - 10) * (1 - level), w - 10, 2);
    ctx.globalAlpha = 1;
  },
};

type AppVizFn = (ctx: CanvasRenderingContext2D, w: number, h: number, color: string, status: string, t: number, idx: number) => void;

export const appVizRenderers: Record<VizType, AppVizFn> = {
  signalBars: (ctx, w, h, color, status, t, idx) => {
    for (let i = 0; i < 4; i++) {
      const bh = h * (0.3 + i * 0.2);
      ctx.fillStyle = status === 'crit' ? '#ff2d55' : status === 'warn' ? '#e8a020' : color;
      ctx.globalAlpha = i < 3 ? 0.5 : 0.12 + Math.max(0, Math.sin(t * 0.005 + idx)) * 0.38;
      ctx.fillRect(i * ((w - 6) / 4 + 2), h - bh, (w - 6) / 4, bh);
    }
  },
  threatArc: (ctx, w, h, color, status, t, idx) => {
    const cx = w / 2, cy = h * 0.9, rad = Math.min(w, h) * 0.65;
    const c = status === 'crit' ? '#ff2d55' : status === 'warn' ? '#e8a020' : color;
    ctx.beginPath(); ctx.arc(cx, cy, rad, Math.PI, Math.PI * 2);
    ctx.strokeStyle = c; ctx.globalAlpha = 0.15; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.stroke();
    const lv = status === 'crit' ? 0.85 : status === 'warn' ? 0.55 : 0.25;
    ctx.beginPath(); ctx.arc(cx, cy, rad, Math.PI, Math.PI + (lv + Math.sin(t * 0.002 + idx) * 0.05) * Math.PI);
    ctx.strokeStyle = c; ctx.globalAlpha = 0.6; ctx.lineWidth = 3; ctx.stroke();
  },
  waveform: (ctx, w, h, color, status, t, idx) => {
    const mid = h / 2, bars = 10, bw = (w - 9) / bars;
    const c = status === 'crit' ? '#ff2d55' : status === 'warn' ? '#e8a020' : color;
    for (let i = 0; i < bars; i++) {
      const amp = Math.sin(t * 0.006 + i * 0.5 + idx) * 0.35 + 0.5;
      const bh = Math.max(1, amp * h * 0.7);
      ctx.fillStyle = c; ctx.globalAlpha = 0.25 + amp * 0.25; ctx.fillRect(i * (bw + 1), mid - bh / 2, bw, bh);
    }
  },
  routeProgress: (ctx, w, h, color, status, t, idx) => {
    const mid = h / 2;
    const c = status === 'crit' ? '#ff2d55' : status === 'warn' ? '#e8a020' : color;
    ctx.beginPath(); ctx.moveTo(2, mid); ctx.lineTo(w - 2, mid);
    ctx.strokeStyle = c; ctx.globalAlpha = 0.12; ctx.lineWidth = 2; ctx.stroke();
    const progress = (t * 0.0002 + idx * 0.15) % 1;
    ctx.beginPath(); ctx.moveTo(2, mid); ctx.lineTo(2 + progress * (w - 4), mid);
    ctx.strokeStyle = c; ctx.globalAlpha = 0.45; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(2 + progress * (w - 4), mid, 3, 0, Math.PI * 2);
    ctx.fillStyle = c; ctx.globalAlpha = 0.7; ctx.fill();
  },
  donut: (ctx, w, h, color, status, t, idx) => {
    const cx = w / 2, cy = h / 2, rad = Math.min(w, h) * 0.35;
    const c = status === 'crit' ? '#ff2d55' : status === 'warn' ? '#e8a020' : color;
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.strokeStyle = c; ctx.globalAlpha = 0.1; ctx.lineWidth = 3; ctx.stroke();
    const pct = 0.5 + Math.sin(t * 0.0015 + idx * 0.7) * 0.3;
    ctx.beginPath(); ctx.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
    ctx.strokeStyle = c; ctx.globalAlpha = 0.5; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.stroke();
  },
  fillLevel: (ctx, w, h, color, status, t, idx) => {
    const c = status === 'crit' ? '#ff2d55' : status === 'warn' ? '#e8a020' : color;
    ctx.strokeStyle = c; ctx.globalAlpha = 0.2; ctx.lineWidth = 1; ctx.strokeRect(2, 2, w - 4, h - 4);
    const level = 0.5 + Math.sin(t * 0.0012 + idx * 0.5) * 0.25;
    ctx.fillStyle = c; ctx.globalAlpha = 0.15; ctx.fillRect(3, 3 + (h - 6) * (1 - level), w - 6, (h - 6) * level);
    ctx.fillStyle = c; ctx.globalAlpha = 0.35; ctx.fillRect(3, 3 + (h - 6) * (1 - level), w - 6, 1.5);
  },
};
