import { useState, useEffect, useRef } from 'react';
import { Activity, Truck, AlertTriangle, Leaf, Clock, TrendingUp, TrendingDown } from 'lucide-react';

const ALERTS = [
  { sev:'SEV-1', cls:'s1', text:'VHC-0482 · Panic button + GPS anomaly · Driver welfare check triggered', time:'00m' },
  { sev:'SEV-2', cls:'s2', text:'SHP-00734 · Temp breach +4.2°C on pharma load · QA hold issued', time:'04m' },
  { sev:'SEV-2', cls:'s2', text:'GPS spoofing suspected · VHC-0119 · Cross-validation mismatch', time:'09m' },
  { sev:'SEV-3', cls:'s3', text:'SHP-00917 · ETA breach P82 · 42min decision window remaining', time:'13m' },
  { sev:'SEV-3', cls:'s3', text:'Nairobi Weighbridge queue 34min · 6 vehicles impacted', time:'18m' },
  { sev:'SEV-4', cls:'s4', text:'LNE-MBS-04 · Empty mile rate 18.2% · Threshold breach', time:'27m' },
  { sev:'SEV-4', cls:'s4', text:'Vendor SCR-441 · Insurance renewal due 12 days', time:'35m' },
];

const LATENCY_DATA = [
  { label:'Active incident status',     max:'1s',    color:'var(--green)' },
  { label:'Live vehicle positions',     max:'5s',    color:'var(--green)' },
  { label:'Active threat/risk overlays',max:'60s',   color:'var(--amber)' },
  { label:'SLA breach predictions',     max:'60s',   color:'var(--amber)' },
  { label:'Sensor health status',       max:'30s',   color:'var(--cyan)' },
  { label:'Warehouse bin inventory',    max:'10s',   color:'var(--green)' },
  { label:'Border wait times',          max:'60s',   color:'var(--amber)' },
  { label:'Weather & hazard feeds',     max:'5 min', color:'var(--orange)' },
  { label:'Vendor scores',              max:'15 min',color:'var(--orange)' },
  { label:'Financial metrics',          max:'1 hr',  color:'var(--purple)' },
];

const INFRA = [
  { section:'DATA FABRIC', color:'var(--cyan)', items:[
    'Apache Kafka · Event streaming · sub-second latency',
    'Apache Iceberg · Lakehouse + time-travel queries',
    'Neo4j · Supplier graph + risk propagation paths',
    'TimescaleDB · IoT time-series / GPS hypertables',
    'Redis Cluster · sub-5ms state reads',
    'ClickHouse · OLAP petabyte analytics engine',
  ]},
  { section:'AI / ML', color:'var(--purple)', items:[
    'Edge AI Runtime · ONNX/TensorRT · <100ms inference',
    'Federated Learning · GDPR-compliant gradient aggregation',
    'Feature Store (Feast) · No training-serving skew',
    'MLflow Registry · Versioned, staged, traceable models',
    'RL Policy Engine · Multi-agent, explainable decisions',
    'Causal Inference Engine · Correlation ≠ causation',
  ]},
  { section:'ORCHESTRATION', color:'var(--amber)', items:[
    'Temporal.io · Durable, compensable workflow execution',
    'Apache Airflow · Scheduled batch orchestration',
    'Kubernetes · Multi-region · <60s RTO Tier-1 services',
  ]},
  { section:'SECURITY', color:'var(--red)', items:[
    'Zero-Trust · mTLS + SPIFFE/SPIRE identity + OPA',
    'TPM-Backed Key Storage · Hardware-bound crypto keys',
    'Hyperledger Fabric · Immutable permissioned audit ledger',
    'Homomorphic Encryption · Multi-party analytics',
  ]},
  { section:'OBSERVABILITY', color:'var(--green)', items:[
    'OpenTelemetry · Unified traces, metrics, and logs',
    'Prometheus + Grafana · SLO tracking, 30+ services',
    'PagerDuty · On-call escalation, never masked',
  ]},
];

function useFlicker(base, range, ms = 3200) {
  const [val, setVal] = useState(base);
  const ref = useRef(null);
  useEffect(() => {
    ref.current = setInterval(() => {
      setVal(parseFloat((base + (Math.random() - 0.5) * range).toFixed(1)));
    }, ms + Math.random() * 800);
    return () => clearInterval(ref.current);
  }, []); // eslint-disable-line
  return val;
}

function MCard({ label, Icon, value, unit, vcls, barPct, barColor, delta, deltaDir }) {
  return (
    <div className="m-card">
      <div className="m-card-hdr">
        <span className="m-card-lbl">{label}</span>
        <span style={{ marginLeft:'auto', color:'var(--text-low)' }}><Icon size={12} /></span>
      </div>
      <div>
        <span className={`m-val ${vcls}`}>{value}</span>
        {unit && <span className="m-unit">{unit}</span>}
      </div>
      {delta && (
        <div className={`m-delta ${deltaDir}`}>
          {deltaDir === 'up'
            ? <TrendingUp  size={9} style={{ display:'inline', marginRight:3 }} />
            : <TrendingDown size={9} style={{ display:'inline', marginRight:3 }} />}
          {delta}
        </div>
      )}
      {barPct !== undefined && (
        <div className="m-bar">
          <div className={`m-bar-fill ${barColor}`} style={{ width:`${Math.min(100, barPct)}%` }} />
        </div>
      )}
    </div>
  );
}

export default function MetricsPanel({ mobileActive }) {
  const [tab, setTab] = useState('metrics');

  const onTime    = useFlicker(94.2, 1.2);
  const shipments = useFlicker(347,  8,   5000);
  const sla       = useFlicker(97.1, 0.6);
  const empty     = useFlicker(11.4, 0.8);
  const util      = useFlicker(82.3, 1.8);
  const co2       = useFlicker(28.4, 1.4);

  const otCls  = onTime >= 95 ? 'good' : onTime >= 90 ? 'amber' : 'bad';
  const otBar  = onTime >= 95 ? 'green': onTime >= 90 ? 'amber' : 'red';
  const slaCls = sla >= 98 ? 'good' : sla >= 95 ? 'amber' : 'warn';
  const slaBar = sla >= 98 ? 'green': sla >= 95 ? 'amber' : 'orange';
  const emCls  = empty < 10 ? 'good' : empty < 15 ? 'amber' : 'warn';
  const emBar  = empty < 10 ? 'green': empty < 15 ? 'amber' : 'orange';

  return (
    <aside className={`metrics-panel ${mobileActive ? 'mob-show' : ''}`}>
      <div className="mp-hdr">
        <Activity size={11} style={{ color:'var(--cyan)' }} />
        <span className="mp-hdr-title">LIVE INTELLIGENCE</span>
        <div className="mp-live">
          <div className="s-dot g" style={{ width:4, height:4 }} /> LIVE
        </div>
      </div>

      <div className="mp-tabs">
        {[['metrics','METRICS'],['latency','LATENCY'],['infra','INFRA']].map(([id, lbl]) => (
          <button key={id} className={`mp-tab ${tab===id?'active':''}`} onClick={() => setTab(id)}>
            {lbl}
          </button>
        ))}
      </div>

      <div className="mp-scroll">

        {/* ── METRICS ── */}
        {tab === 'metrics' && <>
          <MCard label="ON-TIME DELIVERY" Icon={Clock}
            value={onTime.toFixed(1)} unit="%" vcls={otCls}
            barPct={onTime} barColor={otBar}
            delta={`${onTime>=94?'+':''}0.3% vs 30-day avg`} deltaDir={onTime>=94?'up':'dn'} />

          <MCard label="ACTIVE SHIPMENTS" Icon={Truck}
            value={Math.round(shipments)} vcls="info"
            barPct={(Math.round(shipments)/400)*100} barColor="cyan"
            delta={`${Math.round(shipments)} in transit · 12 at-risk`} deltaDir="up" />

          <MCard label="SLA COMPLIANCE" Icon={TrendingUp}
            value={sla.toFixed(1)} unit="%" vcls={slaCls}
            barPct={sla} barColor={slaBar} />

          <MCard label="EMPTY MILE RATE" Icon={Activity}
            value={empty.toFixed(1)} unit="%" vcls={emCls}
            barPct={empty * 5} barColor={emBar}
            delta={`Target: <15% · ${empty>15?'BREACH':'NOMINAL'}`}
            deltaDir={empty>15?'dn':'up'} />

          <MCard label="FLEET UTILISATION" Icon={Truck}
            value={util.toFixed(1)} unit="%"
            vcls={util>=80?'good':'warn'}
            barPct={util} barColor={util>=80?'green':'amber'} />

          <MCard label="CO₂e TODAY" Icon={Leaf}
            value={co2.toFixed(1)} unit="t" vcls="good"
            delta="↓ 4.1% vs yesterday" deltaDir="up" />

          {/* Severity Matrix */}
          <div className="m-card">
            <div className="m-card-hdr">
              <span className="m-card-lbl">INCIDENT MATRIX</span>
              <AlertTriangle size={11} style={{ marginLeft:'auto', color:'var(--text-low)' }} />
            </div>
            <div className="sev-grid">
              {[
                { s:1, n:2,  c:'var(--red)',    bg:'var(--red-glow)',    lbl:'CRITICAL' },
                { s:2, n:5,  c:'var(--orange)', bg:'var(--orange-glow)', lbl:'HIGH' },
                { s:3, n:11, c:'var(--amber)',  bg:'var(--amber-glow)',  lbl:'MEDIUM' },
                { s:4, n:23, c:'var(--cyan)',   bg:'var(--cyan-glow)',   lbl:'LOW' },
              ].map(({ s, n, c, bg, lbl }) => (
                <div key={s} className="sev-cell" style={{ background:bg, border:`1px solid ${c}22` }}>
                  <div className="sev-n" style={{ color:c }}>{n}</div>
                  <div className="sev-lbl" style={{ color:c, opacity:.75 }}>SEV-{s} {lbl}</div>
                </div>
              ))}
            </div>
          </div>
        </>}

        {/* ── LATENCY §2.3 ── */}
        {tab === 'latency' && <>
          <div style={{ fontFamily:'var(--f-mono)', fontSize:9, color:'var(--text-low)', letterSpacing:'0.1em', padding:'2px 2px 8px' }}>
            §2.3 DATA STALENESS COMMITMENTS
          </div>
          {LATENCY_DATA.map((l, i) => (
            <div key={i} className="lat-row">
              <span className="lat-label">{l.label}</span>
              <span className="lat-val" style={{ color:l.color }}>≤ {l.max}</span>
            </div>
          ))}
          <div style={{ padding:'10px 10px', background:'var(--amber-glow)', border:'1px solid var(--amber-dim)', borderRadius:'var(--r-sm)', fontFamily:'var(--f-mono)', fontSize:9, color:'var(--amber)', lineHeight:1.6, marginTop:4 }}>
            ⚠ When any source exceeds its staleness threshold, Sonalit flags it explicitly, states the assumption being made, and reduces confidence output accordingly. Stale data is never presented as current.
          </div>
          <div style={{ padding:'10px 10px', background:'var(--cyan-glow)', border:'1px solid var(--cyan-dim)', borderRadius:'var(--r-sm)', fontFamily:'var(--f-mono)', fontSize:9, color:'var(--cyan)', lineHeight:1.6 }}>
            §2.2 DATA SOVEREIGNTY: EU data stays within eu-west-1 / eu-central-1. Defence and healthcare tenants use dedicated HSM-encrypted clusters. Cross-region routing requires explicit tenant authorisation.
          </div>
        </>}

        {/* ── INFRASTRUCTURE §2.1 ── */}
        {tab === 'infra' && <>
          <div style={{ fontFamily:'var(--f-mono)', fontSize:9, color:'var(--text-low)', letterSpacing:'0.1em', padding:'2px 2px 8px' }}>
            §2.1 PLATFORM INFRASTRUCTURE SUBSTRATE
          </div>
          {INFRA.map(({ section, color, items }) => (
            <div key={section} className="infra-section">
              <div className="infra-sec-title" style={{ color }}>
                <div className="infra-sec-bar" style={{ background:color }} />
                {section}
              </div>
              {items.map((item, i) => (
                <div key={i} className="infra-item" style={{ borderColor:`${color}44` }}>{item}</div>
              ))}
            </div>
          ))}
        </>}

      </div>

      {/* Alert Feed */}
      <div className="alert-hdr">
        <AlertTriangle size={11} style={{ color:'var(--amber)' }} />
        <span className="alert-hdr-title">ALERT FEED</span>
        <div className="alert-count">{ALERTS.length}</div>
      </div>
      <div className="alert-list">
        {ALERTS.map((a, i) => (
          <div key={i} className="alert-row">
            <span className={`a-sev ${a.cls}`}>{a.sev}</span>
            <span className="a-text">{a.text}</span>
            <span className="a-time">{a.time}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
