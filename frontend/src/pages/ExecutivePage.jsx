import { useEffect, useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { analyticsAPI } from '../services/api';
import { Spinner } from '../components/UI';

const C = {
  bg:'#060e1a', panel:'#0b1829', surface:'#0d2240',
  cyan:'#00d4ff', cyanBg:'rgba(0,212,255,0.07)', cyanBd:'rgba(0,212,255,0.18)',
  blue:'#0066ff', success:'#00ff88', warning:'#ffaa00',
  danger:'#ff3355', muted:'#4a7090', body:'#c8ddf0', bright:'#e8f4ff',
};

const PL_DATA = [
  { month:'Jul', base:1.82, optimistic:2.1,  stress:1.4  },
  { month:'Aug', base:1.95, optimistic:2.3,  stress:1.5  },
  { month:'Sep', base:2.1,  optimistic:2.55, stress:1.55 },
  { month:'Oct', base:2.0,  optimistic:2.45, stress:1.35 },
  { month:'Nov', base:2.25, optimistic:2.75, stress:1.6  },
  { month:'Dec', base:2.4,  optimistic:3.0,  stress:1.7  },
  { month:'Jan', base:2.2,  optimistic:2.8,  stress:1.5  },
  { month:'Feb', base:2.35, optimistic:2.9,  stress:1.65 },
  { month:'Mar', base:2.5,  optimistic:3.1,  stress:1.75 },
  { month:'Apr', base:2.6,  optimistic:3.25, stress:1.8  },
  { month:'May', base:2.45, optimistic:3.05, stress:1.7  },
  { month:'Jun', base:2.7,  optimistic:3.4,  stress:1.85 },
];

const CORRIDOR_DATA = [
  { corridor:'NBI–MBA', reefer:420, bulk:310, hazmat:80  },
  { corridor:'MBA–DAR', reefer:280, bulk:390, hazmat:60  },
  { corridor:'NBI–KIS', reefer:190, bulk:220, hazmat:30  },
  { corridor:'KIS–ENT', reefer:140, bulk:180, hazmat:15  },
  { corridor:'DAR–DSM', reefer:320, bulk:410, hazmat:90  },
];

const ALERTS = [
  {
    id:'sa1',
    title:'Fuel hedging window opens in 6 days',
    insight:'Brent crude futures signal a 7-day dip. Locking in Q3 fuel contracts now could reduce transport COGS by an estimated $184k based on current route volumes.',
    confidence:79,
  },
  {
    id:'sa2',
    title:'Corridor MBA–DAR showing margin compression',
    insight:'Last 30-day P&L for the Mombasa–Dar es Salaam corridor shows a 2.1pp margin decline driven by port dwell increases. Recommend renegotiating carrier SLA or activating alternate Tanga port routing.',
    confidence:87,
  },
  {
    id:'sa3',
    title:'Driver attrition risk in East Region',
    insight:'HOS violations and fatigue alerts are concentrated in the East Region fleet. Modelling predicts a 23% attrition probability over 60 days if shift schedules are unchanged. Initiating a pilot rest-hub at Voi.',
    confidence:72,
  },
];

const RESILIENCE = [
  { label:'Route Diversity',       value:78 },
  { label:'Carrier Coverage',      value:91 },
  { label:'Inventory Buffer',      value:64 },
  { label:'IT Redundancy',         value:88 },
  { label:'Financial Reserves',    value:82 },
];

const ESG = [
  { label:'Carbon Reduction vs Target', value:61, target:100, unit:'%' },
  { label:'SBTi Score',                 value:74, target:100, unit:'/100' },
  { label:'Green Freight %',            value:38, target:60,  unit:'%' },
];

const TOOLTIP_STYLE = {
  contentStyle: {
    background:'#0b1829', border:'1px solid rgba(0,212,255,0.18)',
    borderRadius:8, fontSize:11, color:C.body, padding:'8px 12px',
  },
  cursor:{ fill:'rgba(0,212,255,0.03)' },
};

function KpiTile({ label, value, trend, accent }) {
  const trendUp = trend >= 0;
  return (
    <div style={{
      background:C.surface, border:`1px solid ${C.cyanBd}`,
      borderRadius:12, padding:'24px 28px', position:'relative', overflow:'hidden',
    }}>
      <div style={{
        position:'absolute', top:0, left:0, right:0, height:2,
        background:`linear-gradient(90deg, ${accent}, transparent)`,
      }} />
      <div style={{ fontFamily:'IBM Plex Mono', fontSize:9, color:C.muted, letterSpacing:'0.18em', marginBottom:14 }}>
        {label}
      </div>
      <div style={{ fontFamily:'Syne, sans-serif', fontSize:38, fontWeight:800, color:C.bright, lineHeight:1, marginBottom:12 }}>
        {value}
      </div>
      {trend !== undefined && (
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ fontFamily:'IBM Plex Mono', fontSize:11, color: trendUp ? C.success : C.danger }}>
            {trendUp ? '▲' : '▼'} {Math.abs(trend)}%
          </span>
          <span style={{ fontFamily:'IBM Plex Mono', fontSize:9, color:C.muted }}>vs last month</span>
        </div>
      )}
      <div style={{
        position:'absolute', bottom:12, right:16, height:3, width:60,
        background:`linear-gradient(90deg, ${accent}30, ${accent})`,
        borderRadius:2,
      }} />
    </div>
  );
}

function StrategicAlertCard({ alert, onDismiss }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div style={{
      background:C.surface, border:'1px solid rgba(0,212,255,0.15)',
      borderLeft:`3px solid ${C.cyan}`, borderRadius:8, padding:'16px 18px',
      display:'flex', flexDirection:'column', gap:10,
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ fontSize:14 }}>⚡</span>
        <span style={{
          fontFamily:'IBM Plex Mono', fontSize:8, fontWeight:700,
          color:C.cyan, background:C.cyanBg, border:`1px solid ${C.cyanBd}`,
          borderRadius:3, padding:'2px 7px', letterSpacing:'0.14em',
        }}>STRATEGIC ALERT</span>
        <span style={{
          fontFamily:'IBM Plex Mono', fontSize:8,
          color:C.warning, background:`${C.warning}15`,
          border:`1px solid ${C.warning}40`, borderRadius:3,
          padding:'2px 7px', letterSpacing:'0.1em', marginLeft:'auto',
        }}>{alert.confidence}% CONFIDENCE</span>
      </div>
      <div style={{ fontFamily:'Syne, sans-serif', fontSize:13, fontWeight:600, color:C.bright }}>
        {alert.title}
      </div>
      <div style={{ fontFamily:'IBM Plex Sans, sans-serif', fontSize:12, color:C.body, lineHeight:1.65 }}>
        {alert.insight}
      </div>
      <div style={{ display:'flex', gap:8, marginTop:2 }}>
        <button style={{
          fontFamily:'IBM Plex Mono', fontSize:9, fontWeight:700,
          letterSpacing:'0.1em', color:C.bg, background:C.cyan,
          border:'none', borderRadius:4, padding:'5px 14px', cursor:'pointer',
        }}>View Analysis</button>
        <button onClick={() => setDismissed(true)} style={{
          fontFamily:'IBM Plex Mono', fontSize:9, fontWeight:700,
          letterSpacing:'0.1em', color:C.muted, background:'transparent',
          border:`1px solid rgba(74,112,144,0.3)`, borderRadius:4, padding:'5px 14px', cursor:'pointer',
        }}>Dismiss</button>
      </div>
    </div>
  );
}

function ResilienceBar({ label, value }) {
  const color = value >= 80 ? C.success : value >= 65 ? C.cyan : C.warning;
  return (
    <div style={{ marginBottom:12 }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5 }}>
        <span style={{ fontFamily:'IBM Plex Mono', fontSize:9, color:C.body }}>{label}</span>
        <span style={{ fontFamily:'IBM Plex Mono', fontSize:9, color, fontWeight:700 }}>{value}</span>
      </div>
      <div style={{ height:4, background:'rgba(255,255,255,0.06)', borderRadius:2, overflow:'hidden' }}>
        <div style={{
          width:`${value}%`, height:'100%', borderRadius:2,
          background:`linear-gradient(90deg, ${color}80, ${color})`,
          transition:'width 0.6s ease',
        }} />
      </div>
    </div>
  );
}

function EsgBar({ label, value, target, unit }) {
  const pct = Math.min(100, (value / target) * 100);
  const color = pct >= 80 ? C.success : pct >= 55 ? C.cyan : C.warning;
  return (
    <div style={{ marginBottom:14 }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5 }}>
        <span style={{ fontFamily:'IBM Plex Mono', fontSize:9, color:C.body }}>{label}</span>
        <span style={{ fontFamily:'IBM Plex Mono', fontSize:9, color }}>
          {value}{unit} <span style={{ color:C.muted }}>/ {target}{unit}</span>
        </span>
      </div>
      <div style={{ height:5, background:'rgba(255,255,255,0.06)', borderRadius:3, overflow:'hidden', position:'relative' }}>
        <div style={{
          width:`${pct}%`, height:'100%', borderRadius:3,
          background:`linear-gradient(90deg, ${color}70, ${color})`,
          transition:'width 0.7s ease',
        }} />
      </div>
    </div>
  );
}

export default function ExecutivePage() {
  const [kpis, setKpis]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    analyticsAPI.dashboard()
      .then(r => setKpis(r.data?.kpis || null))
      .catch(() => setKpis(null))
      .finally(() => setLoading(false));
  }, []);

  const revenue       = kpis?.revenue    ?? '$2.4M';
  const onTimeRate    = kpis?.onTimeRate  != null ? `${kpis.onTimeRate}%` : '94.2%';

  if (loading) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', background:C.bg }}>
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div style={{ background:C.bg, minHeight:'100%', padding:'28px 32px', overflowY:'auto' }}>

      {/* ── Header ── */}
      <div style={{ marginBottom:32 }}>
        <div style={{ fontFamily:'Syne, sans-serif', fontSize:26, fontWeight:800, color:C.bright, letterSpacing:'0.06em' }}>
          EXECUTIVE STRATEGY SUITE
        </div>
        <div style={{ fontFamily:'IBM Plex Mono', fontSize:11, color:C.muted, marginTop:6, letterSpacing:'0.12em' }}>
          BOARDROOM ANALYTICS · LIVE · {new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}
        </div>
      </div>

      {/* ── KPI Row ── */}
      <div style={{ display:'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap:16, marginBottom:28 }}>
        <KpiTile label="REVENUE THIS MONTH"        value={revenue}    trend={8.3}   accent={C.cyan}    />
        <KpiTile label="ON-TIME DELIVERY RATE"     value={onTimeRate} trend={1.2}   accent={C.success} />
        <KpiTile label="NETWORK RESILIENCE SCORE"  value="87/100"     trend={2.1}   accent={C.blue}    />
        <KpiTile label="OPERATING MARGIN %"        value="18.4%"      trend={-0.6}  accent={C.warning} />
      </div>

      {/* ── Charts Row ── */}
      <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap:16, marginBottom:28 }}>

        {/* P&L Forecast */}
        <div style={{ background:C.panel, border:`1px solid ${C.cyanBd}`, borderRadius:10, padding:'20px 22px' }}>
          <div style={{ fontFamily:'IBM Plex Mono', fontSize:10, color:C.cyan, letterSpacing:'0.15em', marginBottom:16 }}>
            12-MONTH P&L FORECAST
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={PL_DATA} margin={{ top:4, right:4, left:-20, bottom:0 }}>
              <defs>
                <linearGradient id="baseGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"   stopColor={C.cyan}    stopOpacity={0.18} />
                  <stop offset="95%"  stopColor={C.cyan}    stopOpacity={0}    />
                </linearGradient>
                <linearGradient id="optGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"   stopColor={C.success} stopOpacity={0.12} />
                  <stop offset="95%"  stopColor={C.success} stopOpacity={0}    />
                </linearGradient>
                <linearGradient id="stressGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"   stopColor={C.danger}  stopOpacity={0.12} />
                  <stop offset="95%"  stopColor={C.danger}  stopOpacity={0}    />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontFamily:'IBM Plex Mono', fontSize:9, fill:C.muted }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontFamily:'IBM Plex Mono', fontSize:9, fill:C.muted }} axisLine={false} tickLine={false} tickFormatter={v=>`$${v}M`} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v, n) => [`$${v}M`, n]} />
              <Legend wrapperStyle={{ fontFamily:'IBM Plex Mono', fontSize:9, color:C.muted }} />
              <Area type="monotone" dataKey="optimistic" name="Optimistic" stroke={C.success} fill="url(#optGrad)"    strokeWidth={1.5} dot={false} />
              <Area type="monotone" dataKey="base"       name="Base"       stroke={C.cyan}    fill="url(#baseGrad)"   strokeWidth={2}   dot={false} />
              <Area type="monotone" dataKey="stress"     name="Stress"     stroke={C.danger}  fill="url(#stressGrad)" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Volume by Corridor */}
        <div style={{ background:C.panel, border:`1px solid ${C.cyanBd}`, borderRadius:10, padding:'20px 22px' }}>
          <div style={{ fontFamily:'IBM Plex Mono', fontSize:10, color:C.cyan, letterSpacing:'0.15em', marginBottom:16 }}>
            VOLUME BY CORRIDOR
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={CORRIDOR_DATA} margin={{ top:4, right:4, left:-20, bottom:0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis dataKey="corridor" tick={{ fontFamily:'IBM Plex Mono', fontSize:9, fill:C.muted }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontFamily:'IBM Plex Mono', fontSize:9, fill:C.muted }} axisLine={false} tickLine={false} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontFamily:'IBM Plex Mono', fontSize:9, color:C.muted }} />
              <Bar dataKey="reefer"  name="Reefer"  stackId="a" fill={C.cyan}    radius={[0,0,0,0]} />
              <Bar dataKey="bulk"    name="Bulk"    stackId="a" fill={C.blue}    radius={[0,0,0,0]} />
              <Bar dataKey="hazmat"  name="Hazmat"  stackId="a" fill={C.warning} radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Strategic Alerts ── */}
      <div style={{ marginBottom:28 }}>
        <div style={{ fontFamily:'IBM Plex Mono', fontSize:10, color:C.muted, letterSpacing:'0.18em', marginBottom:14 }}>
          STRATEGIC ALERTS
        </div>
        <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3,1fr)', gap:14 }}>
          {ALERTS.map(a => <StrategicAlertCard key={a.id} alert={a} />)}
        </div>
      </div>

      {/* ── Bottom Row ── */}
      <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap:16 }}>

        {/* Expansion Map placeholder */}
        <div style={{ background:C.panel, border:`1px solid ${C.cyanBd}`, borderRadius:10, padding:'20px 22px' }}>
          <div style={{ fontFamily:'IBM Plex Mono', fontSize:10, color:C.cyan, letterSpacing:'0.15em', marginBottom:14 }}>
            EXPANSION MAP
          </div>
          <div style={{
            height:200, background:'rgba(0,212,255,0.03)', border:`1px dashed ${C.cyanBd}`,
            borderRadius:8, display:'flex', flexDirection:'column',
            alignItems:'center', justifyContent:'center', gap:8,
          }}>
            <div style={{ fontSize:28 }}>🌍</div>
            <div style={{ fontFamily:'IBM Plex Mono', fontSize:9, color:C.muted, letterSpacing:'0.15em', textAlign:'center' }}>
              EXPANSION MAP<br />INTERACTIVE
            </div>
            <div style={{
              fontFamily:'IBM Plex Mono', fontSize:8, color:C.cyan,
              background:C.cyanBg, border:`1px solid ${C.cyanBd}`,
              borderRadius:3, padding:'2px 8px', letterSpacing:'0.1em',
            }}>LOAD MAP</div>
          </div>
        </div>

        {/* Network Resilience */}
        <div style={{ background:C.panel, border:`1px solid ${C.cyanBd}`, borderRadius:10, padding:'20px 22px' }}>
          <div style={{ fontFamily:'IBM Plex Mono', fontSize:10, color:C.cyan, letterSpacing:'0.15em', marginBottom:16 }}>
            NETWORK RESILIENCE
          </div>
          {RESILIENCE.map(r => <ResilienceBar key={r.label} label={r.label} value={r.value} />)}
        </div>

        {/* ESG Progress */}
        <div style={{ background:C.panel, border:`1px solid ${C.cyanBd}`, borderRadius:10, padding:'20px 22px' }}>
          <div style={{ fontFamily:'IBM Plex Mono', fontSize:10, color:C.cyan, letterSpacing:'0.15em', marginBottom:16 }}>
            ESG PROGRESS
          </div>
          {ESG.map(e => <EsgBar key={e.label} {...e} />)}
          <div style={{ marginTop:16, padding:'10px 12px', background:'rgba(0,255,136,0.05)', border:`1px solid ${C.success}25`, borderRadius:6 }}>
            <div style={{ fontFamily:'IBM Plex Mono', fontSize:8, color:C.success, letterSpacing:'0.12em' }}>
              SBTi COMMITMENT ACTIVE
            </div>
            <div style={{ fontFamily:'IBM Plex Sans, sans-serif', fontSize:11, color:C.body, marginTop:4 }}>
              Net-zero target: 2035 · Verified by Bureau Veritas
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
