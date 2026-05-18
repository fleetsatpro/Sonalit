const USER_CLASSES = [
  { id:'operator',   label:'OPERATOR',     color:'var(--amber)',  desc:'Dispatcher / Fleet Manager / Supervisor' },
  { id:'strategist', label:'STRATEGIST',   color:'var(--purple)', desc:'C-Suite / Director / Procurement Head' },
  { id:'field',      label:'FIELD ACTOR',  color:'var(--green)',  desc:'Driver / Warehouse Staff / Contractor' },
  { id:'system',     label:'SYSTEM ACTOR', color:'var(--cyan)',   desc:'API / Automation / Webhook Consumer' },
];

const AUTONOMY = [
  { level:1, label:'L1 — ADVISORY',    desc:'Recommendations only. All actions require human approval.' },
  { level:2, label:'L2 — AUTO-DRAFT',  desc:'Prepares full action packages for human approval.' },
  { level:3, label:'L3 — AUTONOMOUS',  desc:'Executes end-to-end when confidence threshold is met.' },
];

function CheckCircle({ selected }) {
  return (
    <div className="settings-option-check">
      {selected && <div style={{ width:8, height:8, borderRadius:'50%', background:'var(--bg-void)' }} />}
    </div>
  );
}

export default function Settings({ autonomyLevel, setAutonomyLevel, userClass, setUserClass, mobileActive }) {
  return (
    <div className={`settings-panel-wrap ${mobileActive ? 'mob-show' : ''}`}>
      <div className="settings-panel">

        <div style={{ fontFamily:'var(--f-display)', fontSize:14, fontWeight:800, letterSpacing:'0.1em', color:'var(--text-hi)', paddingTop:4 }}>
          SONA<span style={{ color:'var(--amber)' }}>LIT</span>
          <span style={{ fontFamily:'var(--f-mono)', fontSize:9, color:'var(--text-low)', marginLeft:10, letterSpacing:'0.08em', fontWeight:400 }}>CONFIGURATION</span>
        </div>

        {/* User Class */}
        <div className="settings-section">
          <div className="settings-section-title">§1.3 USER CLASS — RESPONSE FORMAT</div>
          {USER_CLASSES.map(uc => (
            <div key={uc.id}
              className={`settings-option ${userClass === uc.id ? 'selected' : ''}`}
              onClick={() => setUserClass(uc.id)}>
              <CheckCircle selected={userClass === uc.id} />
              <div>
                <div className="settings-option-name" style={{ color: uc.color }}>{uc.label}</div>
                <div className="settings-option-desc">{uc.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Autonomy Level */}
        <div className="settings-section">
          <div className="settings-section-title">§8 AUTONOMY LEVEL — AI DECISION ENGINE</div>
          {AUTONOMY.map(al => (
            <div key={al.level}
              className={`settings-option ${autonomyLevel === al.level ? 'selected' : ''}`}
              onClick={() => setAutonomyLevel(al.level)}>
              <CheckCircle selected={autonomyLevel === al.level} />
              <div>
                <div className="settings-option-name" style={{ color:'var(--cyan)' }}>{al.label}</div>
                <div className="settings-option-desc">{al.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Priority Hierarchy */}
        <div className="settings-section">
          <div className="settings-section-title">⚡ PRIORITY HIERARCHY (NON-NEGOTIABLE)</div>
          {[
            { n:1, t:'HUMAN LIFE & SAFETY',    c:'var(--red)' },
            { n:2, t:'LEGAL & REGULATORY',      c:'var(--orange)' },
            { n:3, t:'CARGO & ASSET SECURITY',  c:'var(--amber)' },
            { n:4, t:'CONTRACTUAL (SLA)',        c:'var(--amber-bright)' },
            { n:5, t:'ENVIRONMENTAL',            c:'var(--green)' },
            { n:6, t:'OPERATIONAL EFFICIENCY',   c:'var(--cyan)' },
            { n:7, t:'COST OPTIMISATION',        c:'var(--purple)' },
            { n:8, t:'REVENUE MAXIMISATION',     c:'#a78bfa' },
          ].map(h => (
            <div key={h.n} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', borderBottom:'1px solid var(--border-dim)', minHeight:44 }}>
              <div style={{ width:22, height:22, borderRadius:4, background:`${h.c}18`, border:`1px solid ${h.c}44`, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--f-mono)', fontSize:10, fontWeight:700, color:h.c, flexShrink:0 }}>{h.n}</div>
              <span style={{ fontFamily:'var(--f-mono)', fontSize:10, color:h.c, letterSpacing:'0.05em' }}>{h.t}</span>
            </div>
          ))}
        </div>

        <div style={{ fontFamily:'var(--f-mono)', fontSize:9, color:'var(--text-dim)', textAlign:'center', lineHeight:1.7, paddingBottom:8 }}>
          SONALIT LOGISTICS INTELLIGENCE PLATFORM<br />
          35 OPERATIONAL DOMAINS · 7 PRODUCTION PHASES
        </div>
      </div>
    </div>
  );
}
