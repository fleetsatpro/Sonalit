import { useState, useEffect } from 'react';
import { Activity, Truck, AlertTriangle, Leaf, Clock, TrendingUp, TrendingDown, Server, Database } from 'lucide-react';

const ALERTS = [
  { sev: 'SEV-2', cls: 'sev2', text: 'VHC-0482 · Temp breach +4.2°C · pharma load KNB→NRB', time: '02m' },
  { sev: 'SEV-3', cls: 'sev3', text: 'SHP-00917 · ETA breach P82 · 42min window remaining', time: '08m' },
  { sev: 'SEV-3', cls: 'sev3', text: 'Nairobi Weighbridge queue 34min · 6 vehicles affected', time: '11m' },
  { sev: 'SEV-4', cls: 'sev4', text: 'LNE-MBS-04 · Empty mile 18.2% · Threshold 15% breached', time: '19m' },
  { sev: 'SEV-4', cls: 'sev4', text: 'Vendor SCR-441 · Insurance renewal due 12 days', time: '31m' },
  { sev: 'SEV-2', cls: 'sev2', text: 'GPS anomaly VHC-0119 · Possible spoofing event', time: '44m' },
];

const LATENCY = [
  { label: 'Active incidents',     max: '1s',   color: 'var(--green)' },
  { label: 'Vehicle positions',    max: '5s',   color: 'var(--green)' },
  { label: 'Threat / risk overlays', max: '60s', color: 'var(--amber)' },
  { label: 'SLA breach predictions', max: '60s', color: 'var(--amber)' },
  { label: 'Sensor health',        max: '30s',  color: 'var(--cyan)' },
  { label: 'Warehouse inventory',  max: '10s',  color: 'var(--green)' },
  { label: 'Border wait times',    max: '60s',  color: 'var(--amber)' },
  { label: 'Weather / hazards',    max: '5min', color: 'var(--orange)' },
  { label: 'Vendor scores',        max: '15min',color: 'var(--orange)' },
  { label: 'Financial metrics',    max: '1hr',  color: 'var(--purple)' },
];

function useFlicker(base, variance, interval = 3000) {
  const [val, setVal] = useState(base);
  useEffect(() => {
    const id = setInterval(() => {
      setVal(parseFloat((base + (Math.random() - 0.5) * variance * 2).toFixed(1)));
    }, interval + Math.random() * 1000);
    return () => clearInterval(id);
  }, [base, variance, interval]);
  return val;
}

function MetricCard({ label, icon: Icon, value, unit, colorClass, barPct, barColor, delta, deltaDir }) {
  return (
    <div className="metric-card">
      <div className="metric-card-header">
        <span className="metric-card-label">{label}</span>
        <span className="metric-card-icon" style={{ color: 'var(--text-muted)' }}><Icon size={12} /></span>
      </div>
      <div>
        <span className={`metric-value ${colorClass}`}>{value}</span>
        {unit && <span className="metric-unit">{unit}</span>}
      </div>
      {delta && (
        <div className={`metric-delta ${deltaDir}`}>
          {deltaDir === 'up' ? <TrendingUp size={9} style={{ display: 'inline', marginRight: 3 }} /> : <TrendingDown size={9} style={{ display: 'inline', marginRight: 3 }} />}
          {delta}
        </div>
      )}
      {barPct !== undefined && (
        <div className="metric-bar">
          <div className={`metric-bar-fill ${barColor}`} style={{ width: `${Math.min(100, barPct)}%` }} />
        </div>
      )}
    </div>
  );
}

export default function MetricsPanel() {
  const [activeTab, setActiveTab] = useState('metrics');
  const onTime    = useFlicker(94.2, 0.8);
  const active    = useFlicker(347, 5, 5000);
  const emptyMile = useFlicker(11.4, 0.6);
  const slaHealth = useFlicker(97.1, 0.5);
  const co2Today  = useFlicker(28.4, 1.2);
  const fleetUtil = useFlicker(82.3, 1.5);

  const onTimeCls  = onTime >= 95 ? 'good'  : onTime >= 90 ? 'amber' : 'danger';
  const onTimeBar  = onTime >= 95 ? 'green' : onTime >= 90 ? 'amber' : 'red';
  const emptyCls   = emptyMile < 10 ? 'good'  : emptyMile < 15 ? 'amber' : 'warn';
  const emptyBar   = emptyMile < 10 ? 'green' : emptyMile < 15 ? 'amber' : 'orange';
  const slaCls     = slaHealth >= 98 ? 'good' : slaHealth >= 95 ? 'amber' : 'warn';
  const slaBar     = slaHealth >= 98 ? 'green': slaHealth >= 95 ? 'amber' : 'orange';

  const tabs = [
    { id: 'metrics', label: 'METRICS' },
    { id: 'latency', label: 'LATENCY' },
    { id: 'infra',   label: 'INFRA' },
  ];

  return (
    <aside className="metrics-panel">
      <div className="metrics-header">
        <Activity size={11} style={{ color: 'var(--cyan)' }} />
        <span className="metrics-header-title">LIVE INTEL</span>
        <div className="metrics-live">
          <div className="status-dot green" style={{ width: 4, height: 4 }} /> LIVE
        </div>
      </div>

      {/* Tab Bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-dim)' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{
              flex: 1, padding: '6px 4px',
              fontFamily: 'var(--font-mono)', fontSize: 8, fontWeight: 700,
              letterSpacing: '0.1em', color: activeTab === t.id ? 'var(--amber)' : 'var(--text-muted)',
              background: 'transparent', border: 'none', cursor: 'pointer',
              borderBottom: activeTab === t.id ? '2px solid var(--amber)' : '2px solid transparent',
              transition: 'color 0.15s',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="metrics-scroll">

        {/* METRICS TAB */}
        {activeTab === 'metrics' && <>
          <MetricCard label="ON-TIME DELIVERY" icon={Clock}
            value={parseFloat(onTime).toFixed(1)} unit="%"
            colorClass={onTimeCls} barPct={onTime} barColor={onTimeBar}
            delta={`${onTime >= 94 ? '+' : ''}0.3% vs 30d avg`} deltaDir={onTime >= 94 ? 'up' : 'down'} />

          <MetricCard label="ACTIVE SHIPMENTS" icon={Truck}
            value={Math.round(active)} colorClass="info"
            barPct={(Math.round(active) / 400) * 100} barColor="cyan"
            delta={`${Math.round(active)} in transit · 12 at risk`} deltaDir="up" />

          <MetricCard label="SLA COMPLIANCE" icon={TrendingUp}
            value={parseFloat(slaHealth).toFixed(1)} unit="%"
            colorClass={slaCls} barPct={slaHealth} barColor={slaBar} />

          <MetricCard label="EMPTY MILE RATE" icon={Activity}
            value={parseFloat(emptyMile).toFixed(1)} unit="%"
            colorClass={emptyCls} barPct={emptyMile * 5} barColor={emptyBar}
            delta={`Target: <15% · ${emptyMile > 15 ? 'THRESHOLD BREACHED' : 'NOMINAL'}`}
            deltaDir={emptyMile > 15 ? 'down' : 'up'} />

          <MetricCard label="FLEET UTILISATION" icon={Truck}
            value={parseFloat(fleetUtil).toFixed(1)} unit="%"
            colorClass={fleetUtil >= 80 ? 'good' : 'warn'}
            barPct={fleetUtil} barColor={fleetUtil >= 80 ? 'green' : 'amber'} />

          <MetricCard label="CO₂e TODAY" icon={Leaf}
            value={parseFloat(co2Today).toFixed(1)} unit="t"
            colorClass="good" delta="↓ 4.1% vs yesterday" deltaDir="up" />

          {/* Severity Matrix */}
          <div className="metric-card">
            <div className="metric-card-header">
              <span className="metric-card-label">INCIDENT MATRIX</span>
              <AlertTriangle size={11} style={{ color: 'var(--text-muted)' }} />
            </div>
            <div className="sev-matrix">
              {[
                { sev: 1, n: 2,  color: 'var(--red)',    bg: 'var(--red-glow)',    label: 'CRITICAL' },
                { sev: 2, n: 5,  color: 'var(--orange)', bg: 'var(--orange-glow)', label: 'HIGH' },
                { sev: 3, n: 11, color: 'var(--amber)',  bg: 'var(--amber-glow)',  label: 'MEDIUM' },
                { sev: 4, n: 23, color: 'var(--cyan)',   bg: 'var(--cyan-glow)',   label: 'LOW' },
              ].map(({ sev, n, color, bg, label }) => (
                <div key={sev} className="sev-cell" style={{ background: bg, border: `1px solid ${color}22` }}>
                  <div className="sev-cell-num" style={{ color }}>{n}</div>
                  <div className="sev-cell-label" style={{ color, opacity: 0.7 }}>SEV-{sev} {label}</div>
                </div>
              ))}
            </div>
          </div>
        </>}

        {/* LATENCY TAB — §2.3 */}
        {activeTab === 'latency' && <>
          <div style={{ padding: '6px 4px 2px' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 8 }}>
              §2.3 DATA LATENCY COMMITMENTS
            </div>
            {LATENCY.map((l, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 8px', marginBottom: 3, background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-dim)' }}>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--text-secondary)' }}>{l.label}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: l.color, letterSpacing: '0.05em' }}>≤ {l.max}</span>
              </div>
            ))}
            <div style={{ marginTop: 10, padding: '6px 8px', background: 'var(--amber-glow)', border: '1px solid var(--amber-dim)', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--amber)', lineHeight: 1.5 }}>
              ⚠ If a data source exceeds its staleness threshold, MLOS Copilot flags it explicitly and states what assumption it is operating on. Never serves stale data as current.
            </div>
          </div>
        </>}

        {/* INFRA TAB — §2.1 */}
        {activeTab === 'infra' && <>
          <div style={{ padding: '6px 4px 2px' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 8 }}>§2.1 INFRASTRUCTURE SUBSTRATE</div>

            {[
              { section: 'DATA FABRIC', color: 'var(--cyan)', items: ['Apache Kafka · Event streaming · sub-second', 'Apache Iceberg · Lakehouse + time-travel', 'Neo4j · Supplier graph / risk propagation', 'TimescaleDB · IoT time-series / GPS', 'Redis Cluster · sub-5ms state reads', 'ClickHouse · OLAP petabyte analytics'] },
              { section: 'AI / ML', color: 'var(--purple)', items: ['Edge AI Runtime · ONNX/TensorRT · <100ms', 'Federated Learning · GDPR-compliant', 'Feature Store (Feast) · No training skew', 'MLflow Registry · Versioned, staged models', 'RL Policy Engine · Explainable decisions', 'Causal Inference Engine · Root-cause'] },
              { section: 'ORCHESTRATION', color: 'var(--amber)', items: ['Temporal.io · Durable workflow execution', 'Apache Airflow · Batch scheduling', 'Kubernetes · Multi-region · <60s RTO'] },
              { section: 'SECURITY', color: 'var(--red)', items: ['Zero-Trust · mTLS + SPIFFE/SPIRE', 'TPM-Backed Key Storage · HW-bound', 'Hyperledger Fabric · Immutable audit', 'Homomorphic Encryption · Multi-party'] },
              { section: 'OBSERVABILITY', color: 'var(--green)', items: ['OpenTelemetry · Unified traces/metrics', 'Prometheus + Grafana · SLO tracking', 'PagerDuty · On-call escalation'] },
            ].map(({ section, color, items }) => (
              <div key={section} style={{ marginBottom: 10 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, fontWeight: 700, color, letterSpacing: '0.12em', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 3, height: 10, background: color, borderRadius: 2 }} />
                  {section}
                </div>
                {items.map((item, i) => (
                  <div key={i} style={{ padding: '3px 8px', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-secondary)', borderLeft: `2px solid ${color}33`, marginLeft: 4, marginBottom: 2, lineHeight: 1.4 }}>
                    {item}
                  </div>
                ))}
              </div>
            ))}

            <div style={{ marginTop: 6, padding: '6px 8px', background: 'var(--cyan-glow)', border: '1px solid var(--cyan-dim)', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--cyan)', lineHeight: 1.5 }}>
              §2.2 DATA SOVEREIGNTY: EU data stays in eu-west-1/eu-central-1. Regulated sectors (defence, healthcare) isolated in dedicated HSM-encrypted tenants. Cross-region routing requires explicit tenant authorisation.
            </div>
          </div>
        </>}

      </div>

      {/* Alert Feed */}
      <div className="alert-feed-header">
        <AlertTriangle size={11} style={{ color: 'var(--amber)' }} />
        <span className="alert-feed-title">ALERT FEED</span>
        <div className="alert-count">{ALERTS.length}</div>
      </div>
      <div className="alert-list">
        {ALERTS.map((a, i) => (
          <div key={i} className="alert-item">
            <span className={`alert-sev ${a.cls}`}>{a.sev}</span>
            <span className="alert-text">{a.text}</span>
            <span className="alert-time">{a.time}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
