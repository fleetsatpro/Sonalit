import { useEffect, useState } from 'react';
import {
  Brain, CheckCircle, X, ChevronRight, Clock,
  AlertTriangle, Zap, Eye, Shield,
} from 'lucide-react';
import { aiAPI } from '../services/api';
import { SLACountdown } from '../components/MLOSComponents';

const C = {
  bg:'#060e1a', panel:'#0b1829', surface:'#0d2240',
  cyan:'#00d4ff', cyanBg:'rgba(0,212,255,0.07)', cyanBd:'rgba(0,212,255,0.18)',
  blue:'#0066ff', success:'#00ff88', warning:'#ffaa00',
  danger:'#ff3355', muted:'#4a7090', body:'#c8ddf0', bright:'#e8f4ff',
};

const MOCK_RECS = [
  {
    id:'r1', level:'approval',
    title:'Reroute SHP-00482 via N3 bypass',
    rationale:'22-min weighbridge queue detected at Athi River. Saves 18 min at +$4.20 fuel cost. Carrier KBS Haulage has confirmed N3 availability.',
    confidence:83,
    affected:['SHP-00482','VEH-KBC450M'],
    timestamp: new Date(Date.now()-47000),
    approved:false,
    situation:'Shipment SHP-00482 is en route from Nairobi ICD to Mombasa SGR ramp. Real-time telematics data shows an unusual dwell-time pattern at the Athi River weighbridge checkpoint on the A109.',
    diagnosis:'Queue sensor data and satellite imagery indicate 22-minute average wait time at the weighbridge, driven by peak commercial traffic. HOS analysis shows the assigned driver (DRV-EK204) has 3.1 hours of available drive time remaining.',
    recommendation:'Divert via N3 highway (Mombasa Road bypass). Estimated fuel cost delta: +$4.20. Time saving: 18 minutes. SLA compliance maintained. Carrier approval required per contract clause 8.3.',
    tradeoffs:[
      { option:'N3 Bypass',  time:'-18 min', cost:'+$4.20', risk:'Low',    sla:'Maintained' },
      { option:'A109 Queue', time:'+22 min', cost:'$0',     risk:'Medium', sla:'At Risk'    },
    ],
  },
  {
    id:'r2', level:'advisory',
    title:'Fatigue alert — Driver John Kamau',
    rationale:'Driver has been on-road 9.2h. HOS limit approaching in 48 min. Recommend scheduling a 30-min mandatory rest at Voi rest hub.',
    confidence:94,
    affected:['DRV-JK001'],
    timestamp: new Date(Date.now()-180000),
    approved:false,
    situation:'Driver John Kamau (DRV-JK001) operating VEH-KDB221T on the NBI–MBA route. Electronic logbook data shows cumulative drive time of 9.2 hours within the current duty period.',
    diagnosis:'HOS regulations require mandatory rest after 10 hours continuous driving. At current pace, the limit will be breached in approximately 48 minutes, 34 km before the Voi interchange.',
    recommendation:'Schedule a mandatory 30-minute rest stop at the Voi Truck Hub (km 330). Notify dispatch to adjust delivery ETA to customer. No SLA breach expected given 90-min ETA buffer.',
    tradeoffs:[
      { option:'Rest at Voi',  time:'+30 min', cost:'+$0',     risk:'Low',      sla:'Maintained' },
      { option:'Continue',     time:'+0 min',  cost:'+$0',     risk:'Critical', sla:'Violation'  },
    ],
  },
  {
    id:'r3', level:'autonomous',
    title:'Rescheduled pickup SHP-00491',
    rationale:'Customer confirmed delay via WhatsApp integration. Auto-adjusted ETA and notified carrier Simba Logistics. No manual action required.',
    confidence:99,
    affected:['SHP-00491'],
    timestamp: new Date(Date.now()-600000),
    approved:true,
    autonomous:true,
    situation:'Customer Bidco Africa confirmed a 2-hour loading bay delay for outbound shipment SHP-00491 via the integrated messaging channel at 09:14 EAT.',
    diagnosis:'The delay falls within the auto-reschedule confidence threshold (>95% confidence, customer-confirmed, no carrier conflict). Carrier availability window extends until 18:00 EAT.',
    recommendation:'Auto-rescheduled pickup from 10:00 to 12:00 EAT. Updated carrier dispatch (Simba Logistics ref SL-8821). Customer and carrier notifications sent. Audit trail logged.',
    tradeoffs:[
      { option:'Auto-reschedule', time:'+120 min', cost:'$0',    risk:'None', sla:'Maintained' },
    ],
  },
];

const LEVEL_CFG = {
  advisory:   { label:'ADVISORY',          color:C.blue,    icon:Eye       },
  approval:   { label:'APPROVAL REQUIRED', color:C.warning, icon:Shield    },
  autonomous: { label:'AUTONOMOUS',        color:C.success, icon:Zap       },
};

const FILTERS = [
  { id:'all',       label:'ALL'           },
  { id:'advisory',  label:'ADVISORY'      },
  { id:'approval',  label:'APPROVAL REQ'  },
  { id:'autonomous',label:'AUTONOMOUS'    },
];

function timeAgo(ts) {
  const diff = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  return `${Math.floor(diff/3600)}h ago`;
}

function ConfidenceBar({ value }) {
  const color = value >= 85 ? C.success : value >= 70 ? C.cyan : C.warning;
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
      <div style={{ flex:1, height:4, background:'rgba(255,255,255,0.06)', borderRadius:2, overflow:'hidden' }}>
        <div style={{
          width:`${value}%`, height:'100%',
          background:`linear-gradient(90deg, ${color}80, ${color})`,
          borderRadius:2, transition:'width 0.5s ease',
        }} />
      </div>
      <span style={{ fontFamily:'IBM Plex Mono', fontSize:9, color, minWidth:80 }}>
        {value}% confidence
      </span>
    </div>
  );
}

function EntityChip({ id }) {
  return (
    <span style={{
      fontFamily:'IBM Plex Mono', fontSize:9, color:C.cyan,
      background:C.cyanBg, border:`1px solid ${C.cyanBd}`,
      borderRadius:3, padding:'2px 7px',
    }}>{id}</span>
  );
}

function RecCard({ rec, selected, onSelect, onApprove, onDismiss }) {
  const cfg  = LEVEL_CFG[rec.level] || LEVEL_CFG.advisory;
  const Icon = cfg.icon;

  return (
    <div
      onClick={() => onSelect(rec)}
      style={{
        background: selected ? `rgba(0,212,255,0.06)` : C.surface,
        border:`1px solid ${selected ? C.cyan : C.cyanBd}`,
        borderLeft:`3px solid ${cfg.color}`,
        borderRadius:8, padding:'16px 18px', cursor:'pointer',
        display:'flex', flexDirection:'column', gap:10,
        transition:'background 0.15s, border-color 0.15s',
      }}
    >
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <Icon size={12} color={cfg.color} />
        <span style={{
          fontFamily:'IBM Plex Mono', fontSize:8, fontWeight:700,
          color:cfg.color, background:`${cfg.color}18`,
          border:`1px solid ${cfg.color}40`, borderRadius:3,
          padding:'2px 7px', letterSpacing:'0.12em',
        }}>{cfg.label}</span>
        {rec.autonomous && (
          <span style={{
            fontFamily:'IBM Plex Mono', fontSize:8, color:C.success,
            background:`${C.success}12`, border:`1px solid ${C.success}30`,
            borderRadius:3, padding:'2px 7px', letterSpacing:'0.1em', marginLeft:'auto',
          }}>EXECUTED AUTONOMOUSLY</span>
        )}
        <span style={{
          fontFamily:'IBM Plex Mono', fontSize:9, color:C.muted,
          marginLeft: rec.autonomous ? 0 : 'auto',
        }}>{timeAgo(rec.timestamp)}</span>
      </div>

      {/* Title */}
      <div style={{ fontFamily:'Syne, sans-serif', fontSize:14, fontWeight:600, color:C.bright }}>
        {rec.title}
      </div>

      {/* Rationale */}
      <div style={{ fontFamily:'IBM Plex Sans, sans-serif', fontSize:12, color:C.body, lineHeight:1.6 }}>
        {rec.rationale}
      </div>

      {/* Confidence */}
      <ConfidenceBar value={rec.confidence} />

      {/* Affected */}
      {rec.affected?.length > 0 && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
          {rec.affected.map(a => <EntityChip key={a} id={a} />)}
        </div>
      )}

      {/* Actions */}
      {rec.level === 'approval' && !rec.approved && (
        <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:2 }}>
          <SLACountdown deadline={new Date(rec.timestamp.getTime() + 30*60*1000)} />
          <div style={{ display:'flex', gap:8, marginLeft:'auto' }}>
            <button
              onClick={e => { e.stopPropagation(); onApprove(rec.id); }}
              style={{
                fontFamily:'IBM Plex Mono', fontSize:10, fontWeight:700,
                letterSpacing:'0.1em', color:C.bg, background:C.cyan,
                border:'none', borderRadius:5, padding:'7px 18px', cursor:'pointer',
              }}
            >APPROVE</button>
            <button
              onClick={e => { e.stopPropagation(); onDismiss(rec.id); }}
              style={{
                fontFamily:'IBM Plex Mono', fontSize:10, fontWeight:700,
                letterSpacing:'0.1em', color:C.muted, background:'transparent',
                border:`1px solid rgba(74,112,144,0.3)`, borderRadius:5, padding:'7px 14px', cursor:'pointer',
              }}
            >DISMISS</button>
          </div>
        </div>
      )}

      {rec.autonomous && (
        <button
          onClick={e => e.stopPropagation()}
          style={{
            alignSelf:'flex-start', fontFamily:'IBM Plex Mono', fontSize:9,
            color:C.success, background:'transparent', border:'none',
            cursor:'pointer', padding:0, letterSpacing:'0.1em',
          }}
        >View Audit →</button>
      )}
    </div>
  );
}

function DetailDrawer({ rec, onClose, onApprove, onDismiss }) {
  const [override, setOverride] = useState('');
  if (!rec) return null;
  const cfg = LEVEL_CFG[rec.level] || LEVEL_CFG.advisory;

  return (
    <div style={{
      width:'45%', flexShrink:0, background:C.panel,
      borderLeft:`1px solid ${C.cyanBd}`, display:'flex', flexDirection:'column',
      overflowY:'auto', minWidth:0,
    }}>
      {/* Drawer header */}
      <div style={{
        padding:'16px 18px', borderBottom:`1px solid rgba(0,212,255,0.08)`,
        display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12,
      }}>
        <div>
          <div style={{ fontFamily:'IBM Plex Mono', fontSize:8, color:cfg.color, letterSpacing:'0.12em', marginBottom:6 }}>
            {cfg.label}
          </div>
          <div style={{ fontFamily:'Syne, sans-serif', fontSize:14, fontWeight:700, color:C.bright, lineHeight:1.35 }}>
            {rec.title}
          </div>
        </div>
        <button onClick={onClose} style={{
          background:'transparent', border:'none', color:C.muted,
          cursor:'pointer', padding:4, flexShrink:0,
        }}>
          <X size={16} />
        </button>
      </div>

      <div style={{ padding:'18px 18px', display:'flex', flexDirection:'column', gap:20, flex:1 }}>

        {/* Situation */}
        <Section label="SITUATION" color={C.cyan}>
          <p style={{ fontFamily:'IBM Plex Sans, sans-serif', fontSize:12, color:C.body, lineHeight:1.7, margin:0 }}>
            {rec.situation}
          </p>
        </Section>

        {/* Diagnosis */}
        <Section label="DIAGNOSIS" color={C.warning}>
          <p style={{ fontFamily:'IBM Plex Sans, sans-serif', fontSize:12, color:C.body, lineHeight:1.7, margin:0 }}>
            {rec.diagnosis}
          </p>
        </Section>

        {/* Recommendation */}
        <Section label="RECOMMENDATION" color={C.success}>
          <p style={{ fontFamily:'IBM Plex Sans, sans-serif', fontSize:12, color:C.body, lineHeight:1.7, margin:0 }}>
            {rec.recommendation}
          </p>
        </Section>

        {/* Confidence */}
        <Section label="CONFIDENCE" color={C.cyan}>
          <ConfidenceBar value={rec.confidence} />
        </Section>

        {/* Trade-off matrix */}
        {rec.tradeoffs?.length > 0 && (
          <Section label="TRADE-OFF MATRIX" color={C.muted}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontFamily:'IBM Plex Mono', fontSize:10 }}>
              <thead>
                <tr>
                  {['Option','Time Saved','Cost Delta','Risk Impact','SLA Impact'].map(h => (
                    <th key={h} style={{
                      textAlign:'left', padding:'5px 8px',
                      borderBottom:`1px solid rgba(0,212,255,0.1)`,
                      color:C.muted, fontSize:8, letterSpacing:'0.1em', fontWeight:600,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rec.tradeoffs.map((row, i) => (
                  <tr key={i}>
                    <td style={{ padding:'6px 8px', color:C.bright }}>{row.option}</td>
                    <td style={{ padding:'6px 8px', color: row.time.startsWith('-') ? C.success : C.warning }}>{row.time}</td>
                    <td style={{ padding:'6px 8px', color:C.body }}>{row.cost}</td>
                    <td style={{ padding:'6px 8px', color: row.risk === 'Low' || row.risk === 'None' ? C.success : row.risk === 'Critical' ? C.danger : C.warning }}>{row.risk}</td>
                    <td style={{ padding:'6px 8px', color: row.sla === 'Maintained' ? C.success : C.danger }}>{row.sla}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {/* Override */}
        {rec.level === 'approval' && !rec.approved && (
          <Section label="MANUAL OVERRIDE" color={C.danger}>
            <textarea
              value={override}
              onChange={e => setOverride(e.target.value)}
              placeholder="Provide override justification…"
              rows={3}
              style={{
                width:'100%', background:C.surface,
                border:`1px solid rgba(255,51,85,0.25)`, borderRadius:6,
                color:C.body, fontFamily:'IBM Plex Sans, sans-serif', fontSize:12,
                padding:'10px 12px', resize:'vertical', outline:'none', boxSizing:'border-box',
              }}
            />
            <div style={{ display:'flex', gap:8, marginTop:10 }}>
              <button
                onClick={() => onApprove(rec.id)}
                style={{
                  flex:1, fontFamily:'IBM Plex Mono', fontSize:10, fontWeight:700,
                  letterSpacing:'0.1em', color:C.bg, background:C.cyan,
                  border:'none', borderRadius:5, padding:'9px 0', cursor:'pointer',
                }}
              >APPROVE</button>
              <button
                onClick={() => onDismiss(rec.id)}
                style={{
                  fontFamily:'IBM Plex Mono', fontSize:10, fontWeight:700,
                  letterSpacing:'0.1em', color:C.danger, background:'transparent',
                  border:`1px solid ${C.danger}50`, borderRadius:5, padding:'9px 14px', cursor:'pointer',
                }}
              >OVERRIDE &amp; DISMISS</button>
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ label, color, children }) {
  return (
    <div>
      <div style={{
        fontFamily:'IBM Plex Mono', fontSize:8, fontWeight:700,
        color, letterSpacing:'0.16em', marginBottom:8,
      }}>{label}</div>
      {children}
    </div>
  );
}

export default function AIDecisionPage() {
  const [recs, setRecs]         = useState(MOCK_RECS);
  const [selected, setSelected] = useState(null);
  const [filter, setFilter]     = useState('all');
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    aiAPI.anomalies()
      .then(r => {
        const data = r.data;
        if (Array.isArray(data) && data.length > 0) {
          const mapped = data.map((a, i) => ({
            id:`api-${i}`,
            level: a.severity === 'critical' ? 'approval' : 'advisory',
            title: a.message || `Anomaly detected on ${a.entity || 'unknown'}`,
            rationale: a.details || 'See full details in the drawer.',
            confidence: a.confidence || 75,
            affected: a.entity ? [a.entity] : [],
            timestamp: new Date(a.timestamp || Date.now()),
            approved:false,
            situation: a.details || '',
            diagnosis: a.message || '',
            recommendation:'Review and take appropriate action.',
            tradeoffs:[],
          }));
          setRecs(mapped.length > 0 ? mapped : MOCK_RECS);
        }
      })
      .catch(() => {});
  }, []);

  function approve(id) {
    setRecs(prev => prev.map(r => r.id === id ? { ...r, approved:true } : r));
    if (selected?.id === id) setSelected(prev => ({ ...prev, approved:true }));
  }

  function dismiss(id) {
    setRecs(prev => prev.filter(r => r.id !== id));
    if (selected?.id === id) setSelected(null);
  }

  const visible = filter === 'all' ? recs : recs.filter(r => r.level === filter);

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:C.bg, overflow:'hidden' }}>

      {/* ── Header ── */}
      <div style={{
        padding:'16px 24px', borderBottom:`1px solid ${C.cyanBd}`,
        display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0,
      }}>
        <div>
          <div style={{ fontFamily:'Syne, sans-serif', fontSize:16, fontWeight:800, color:C.bright, letterSpacing:'0.06em' }}>
            AI DECISION ENGINE
          </div>
          <div style={{ fontFamily:'IBM Plex Mono', fontSize:9, color:C.muted, marginTop:3, letterSpacing:'0.1em' }}>
            {recs.filter(r => r.level === 'approval' && !r.approved).length} PENDING APPROVAL · {recs.length} TOTAL
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <div style={{ width:7, height:7, borderRadius:'50%', background:C.success, animation:'pulse 1.5s ease-in-out infinite' }} />
          <span style={{ fontFamily:'IBM Plex Mono', fontSize:9, color:C.success, letterSpacing:'0.1em' }}>ENGINE ACTIVE</span>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div style={{
        padding:'12px 24px', borderBottom:`1px solid rgba(0,212,255,0.06)`,
        display:'flex', gap:6, flexShrink:0,
      }}>
        {FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            style={{
              fontFamily:'IBM Plex Mono', fontSize:9, fontWeight:700,
              letterSpacing:'0.1em', cursor:'pointer',
              color: filter === f.id ? C.bg : C.muted,
              background: filter === f.id ? C.cyan : 'transparent',
              border: filter === f.id ? 'none' : `1px solid rgba(74,112,144,0.3)`,
              borderRadius:20, padding:'5px 14px', transition:'all 0.15s',
            }}
          >{f.label}</button>
        ))}
      </div>

      {/* ── Body ── */}
      <div style={{ flex:1, display:'flex', overflow:'hidden', position:'relative' }}>

        {/* Cards list */}
        <div style={{
          width: (selected && !isMobile) ? '55%' : '100%', transition:'width 0.25s ease',
          overflowY:'auto', padding:'16px 20px', display:'flex', flexDirection:'column', gap:12,
        }}>
          {visible.length === 0 && (
            <div style={{ textAlign:'center', padding:'60px 0', fontFamily:'IBM Plex Mono', fontSize:10, color:C.muted, letterSpacing:'0.12em' }}>
              NO RECOMMENDATIONS IN THIS CATEGORY
            </div>
          )}
          {visible.map(r => (
            <RecCard
              key={r.id}
              rec={r}
              selected={selected?.id === r.id}
              onSelect={setSelected}
              onApprove={approve}
              onDismiss={dismiss}
            />
          ))}
        </div>

        {/* Detail drawer — side panel on desktop, full-screen overlay on mobile */}
        {selected && !isMobile && (
          <DetailDrawer
            rec={selected}
            onClose={() => setSelected(null)}
            onApprove={approve}
            onDismiss={dismiss}
          />
        )}
        {selected && isMobile && (
          <>
            <div
              style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:200 }}
              onClick={() => setSelected(null)}
            />
            <div style={{ position:'fixed', inset:0, zIndex:201, overflowY:'auto', background:C.panel }}>
              <DetailDrawer
                rec={selected}
                onClose={() => setSelected(null)}
                onApprove={approve}
                onDismiss={dismiss}
              />
            </div>
          </>
        )}
      </div>

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  );
}
